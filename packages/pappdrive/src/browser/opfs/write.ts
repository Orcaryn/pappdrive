// createWritable() swaps the new contents in on close(). Safari before 26 lacks it and has only sync access handles, worker-only, which write in place; move() swaps a file in atomically.
import type { OpfsDirHandle, OpfsFileHandle, OpfsWritable, Part } from './handles.js';

export type WriteFile = (dir: OpfsDirHandle, segs: string[], name: string, parts: Part[]) => Promise<OpfsFileHandle>;

export const writeWithWritable: WriteFile = async (dir, _segs, name, parts) => {
  const handle = (await dir.getFileHandle(name, { create: true })) as OpfsFileHandle & { createWritable(): Promise<OpfsWritable> };
  const writable = await handle.createWritable();
  try {
    for (const part of parts) {
      await writable.write(part);
    }

    await writable.close();
  } catch (e) {
    await writable.abort();

    throw e;
  }

  return handle;
};

export const writeViaWorker: WriteFile = async (dir, segs, name, parts) => {
  const saving = `${name}.${Math.random().toString(36).slice(2, 10)}.saving`;
  await writeInWorker(
    segs,
    saving,
    parts.map(p => (p instanceof Blob ? p : new Blob([p])))
  );
  const saved = await dir.getFileHandle(saving);
  await saved.move(dir, name);

  return saved;
};

const SLICE = 16 * 1024 * 1024;
const WORKER_SOURCE = `onmessage = async ({ data: { id, path, name, parts } }) => {
  let handle
  try {
    let dir = await navigator.storage.getDirectory()
    for (const s of path) dir = await dir.getDirectoryHandle(s)
    handle = await (await dir.getFileHandle(name, { create: true })).createSyncAccessHandle()
    let at = 0
    for (const part of parts) {
      for (let o = 0; o < part.size; o += ${SLICE}) {
        at += handle.write(new Uint8Array(await part.slice(o, o + ${SLICE}).arrayBuffer()), { at })
      }
    }
    handle.flush()
    postMessage({ id })
  } catch (e) {
    postMessage({ id, error: String(e) })
  } finally {
    handle?.close()
  }
}`;
let worker: Worker | null = null;
let nextId = 0;
const waiting = new Map<number, (error?: string) => void>();

function startWorker(): Worker {
  const w = new Worker(URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' })));
  w.onmessage = ({ data }: MessageEvent<{ id: number; error?: string }>) => {
    const done = waiting.get(data.id);

    if (!done) {
      throw new Error(`pappdrive: the OPFS worker answered write ${data.id}, which nobody waits for.`);
    }

    waiting.delete(data.id);
    done(data.error);
  };

  // a Content-Security-Policy without `worker-src blob:` stops the worker with an empty message.
  w.onerror = e => {
    for (const done of waiting.values()) {
      done(e.message === '' ? 'the OPFS worker could not start' : e.message);
    }

    waiting.clear();
  };

  return w;
}

function writeInWorker(path: string[], name: string, parts: Blob[]): Promise<void> {
  const w = (worker ??= startWorker());
  const id = nextId++;

  return new Promise((resolve, reject) => {
    waiting.set(id, error => (error === undefined ? resolve() : reject(new Error(`pappdrive: could not write ${name}: ${error}`))));
    w.postMessage({ id, path, name, parts });
  });
}
