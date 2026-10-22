"""A Python client for the pappdrive engine running as the `pappdrived` sidecar. See docs/hosts.md for the envelope."""

import json
import os
import queue
import subprocess
import sys
import threading
from pathlib import Path


class PappError(Exception):
    def __init__(self, body):
        super().__init__(body["message"])
        self.code = body["code"]
        self.retry_after = body.get("retryAfter")
        self.reason = body.get("reason")


class FileKeyStore:
    """Keeps the session in a file only this user can read. A real app uses the OS keychain."""

    def __init__(self, directory):
        self.directory = Path(directory)

    def _path(self, name):
        return self.directory / (name.replace("/", "_").replace(":", "_") + ".key")

    def get(self, name):
        path = self._path(name)
        return path.read_text() if path.exists() else None

    def set(self, name, value):
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        path = self._path(name)
        path.write_text(value)
        path.chmod(0o600)

    def delete(self, name):
        self._path(name).unlink(missing_ok=True)


class EngineExited(Exception):
    def __init__(self, code):
        super().__init__(f"pappdrived exited with code {code}")
        self.code = code


class Pappdrive:
    def __init__(self, binary, server, app, key_store, read=()):
        args = [binary, "--server", server, "--app", app] + (["--read", ",".join(read)] if read else [])
        self.process = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)
        self.answers = {
            "host.keystore.get": lambda p: key_store.get(p["name"]),
            "host.keystore.set": lambda p: key_store.set(p["name"], p["value"]),
            "host.keystore.delete": lambda p: key_store.delete(p["name"]),
        }
        self.replies = {}
        self.listeners = {"change": [], "status": []}
        self.events = queue.Queue()
        self.ready = threading.Event()
        self.exit_code = None
        self.next_id = 1
        self.lock = threading.Lock()
        threading.Thread(target=self._read, daemon=True).start()
        threading.Thread(target=self._deliver, daemon=True).start()
        self.ready.wait()
        if self.exit_code is not None:
            raise EngineExited(self.exit_code)

    def _read(self):
        try:
            for line in self.process.stdout:
                message = json.loads(line)
                if "method" not in message:
                    with self.lock:
                        arrived, slot = self.replies[message["id"]]
                    slot.append(message)
                    arrived.set()
                elif message["method"] == "ready":
                    self.ready.set()
                elif message["method"] in self.listeners:
                    self.events.put(message)
                else:
                    self._answer(message)
        finally:
            code = self.process.wait()
            with self.lock:
                self.exit_code = code
                waiting = [arrived for arrived, _ in self.replies.values()]
            self.ready.set()
            for arrived in waiting:
                arrived.set()

    def _answer(self, message):
        method = message["method"]
        try:
            reply = {"id": message["id"], "ok": True, "value": self.answers[method](message["params"])}
        except Exception as error:
            reply = {"id": message["id"], "ok": False, "error": {"code": "internal", "message": f"{method}: {error!r}"}}
        with self.lock:
            self.process.stdin.write(json.dumps(reply) + "\n")

    def _deliver(self):
        while True:
            message = self.events.get()
            for callback in self.listeners[message["method"]]:
                callback(message["params"])

    def call(self, method, **params):
        arrived, slot = threading.Event(), []
        with self.lock:
            if self.exit_code is not None:
                raise EngineExited(self.exit_code)
            request_id = self.next_id
            self.next_id += 1
            self.replies[request_id] = (arrived, slot)
            self.process.stdin.write(json.dumps({"id": request_id, "method": method, "params": params}) + "\n")
        arrived.wait()
        with self.lock:
            del self.replies[request_id]
        if not slot:
            raise EngineExited(self.exit_code)
        message = slot[0]
        if not message["ok"]:
            raise PappError(message["error"])
        return message["value"]

    def on(self, event, callback):
        self.listeners[event].append(callback)

    def close(self):
        try:
            self.call("close")
        finally:
            self.process.stdin.close()
            self.process.wait()


if __name__ == "__main__":
    binary = sys.argv[1] if len(sys.argv) > 1 else "pappdrived"
    server = os.environ.get("PAPPDRIVE_SERVER", "https://sync.pappdrive.com")
    papp = Pappdrive(binary, server, "journal", FileKeyStore(Path.home() / ".config" / "pappdrive-python"))
    print("signed in:", papp.call("signedIn"))
    try:
        papp.call("open", where={"mode": "private"})
    except PappError as error:
        print("open:", error.code, "-", error)
    papp.close()
