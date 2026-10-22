# pappdrive from Python

The engine as a child process: `pappdrived` (built with `pnpm build:sidecar` in `packages/pappdrive`), JSON lines over stdin and stdout, the envelope from [docs/hosts.md](../../docs/hosts.md). `pappdrive.py` is the whole client: spawn, request, answer the engine's `host.keystore.*` requests, deliver `change` and `status` events.

```sh
python3 pappdrive.py ../../packages/pappdrive/dist/pappdrived
```

```python
papp = Pappdrive("pappdrived", "https://sync.pappdrive.com", "journal", FileKeyStore("~/.config/my-app"))
papp.call("signIn", email=email, password=password)
files = papp.call("open", where={"mode": "visible", "path": "~/Journal"})
papp.call("files.writeText", files=files, path="2026-10-21.md", text="Hello")
papp.on("change", lambda event: print(event["change"]))
```
