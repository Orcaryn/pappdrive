// TypeScript's DOM lib lacks FileSystemHandle.move(), and its entries() yields a FileSystemHandle that does not narrow on kind.
export interface OpfsWritable {
  write(data: Blob | Uint8Array<ArrayBuffer>): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}

export interface OpfsFileHandle {
  readonly kind: 'file';
  readonly name: string;
  getFile(): Promise<File>;
  createWritable?(): Promise<OpfsWritable>;
  move(dir: OpfsDirHandle, name: string): Promise<void>;
}

export interface OpfsDirHandle {
  readonly kind: 'directory';
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<OpfsDirHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<OpfsFileHandle>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  entries(): AsyncIterable<[string, OpfsDirHandle | OpfsFileHandle]>;
}

export type Part = Blob | Uint8Array<ArrayBuffer>;

const CHUNK = /^\d{8}$/;

export function nullIfMissing(e: unknown): null {
  if (e instanceof DOMException && ['NotFoundError', 'TypeMismatchError'].includes(e.name)) {
    return null;
  }

  throw e;
}

export async function chunksOf(tdir: OpfsDirHandle): Promise<OpfsFileHandle[]> {
  const out: OpfsFileHandle[] = [];

  for await (const [name, h] of tdir.entries()) {
    if (h.kind === 'file' && CHUNK.test(name)) {
      out.push(h);
    }
  }

  return out.sort((a, b) => (a.name < b.name ? -1 : 1));
}

export async function makeDirs(dir: OpfsDirHandle, dirPath: string): Promise<OpfsDirHandle> {
  let d = dir;

  for (const s of dirPath === '' ? [] : dirPath.split('/')) {
    d = await d.getDirectoryHandle(s, { create: true });
  }

  return d;
}

export async function isEmpty(dir: OpfsDirHandle): Promise<boolean> {
  for await (const _ of dir.entries()) {
    return false;
  }

  return true;
}

// Chrome's move() moves files only, not folders.
export async function moveDir(src: OpfsDirHandle, dest: OpfsDirHandle): Promise<void> {
  const entries: [string, OpfsDirHandle | OpfsFileHandle][] = [];

  for await (const e of src.entries()) {
    entries.push(e);
  }

  for (const [name, h] of entries) {
    if (h.kind === 'file') {
      await h.move(dest, name);
    } else {
      await moveDir(h, await dest.getDirectoryHandle(name, { create: true }));
      await src.removeEntry(name);
    }
  }
}
