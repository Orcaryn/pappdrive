import type { DirEntry, FileStat, FsAdapter } from '../../src/shared/platform.js';
import { HIDDEN_DIR } from '../../src/shared/paths.js';
import { must } from './must.js';

interface FileNode {
  path: string;
  data: Uint8Array;
  mtime: number;
}

export interface MemFsOptions {
  kind?: 'visible' | 'private';
  caseInsensitive?: boolean;
  canCreate?: (segment: string) => boolean;
  watch?: FsAdapter['watch'];
}

let clock = 0;

function tick(): number {
  clock = Math.max(clock + 1, Date.now());

  return clock;
}

export type MemFs = ReturnType<typeof createMemFs>;

export function createMemFs(opts: MemFsOptions = {}) {
  const kind = opts.kind ?? 'private';
  const caseInsensitive = opts.caseInsensitive ?? false;
  const canCreateFn = opts.canCreate ?? (() => true);
  const files = new Map<string, FileNode>();
  const dirs = new Map<string, string>();
  const temps = new Map<string, Uint8Array>();
  const state = new Map<string, string>();
  let destroyed = false;

  function norm(p: string): string {
    return caseInsensitive ? p.toLowerCase() : p;
  }

  function canCreate(segment: string): boolean {
    return canCreateFn(segment);
  }

  function isDir(path: string): boolean {
    if (path === '') {
      return true;
    }

    const n = norm(path);

    if (dirs.has(n)) {
      return true;
    }

    for (const k of files.keys()) {
      if (k.startsWith(n + '/')) {
        return true;
      }
    }

    return false;
  }

  function resolve(path: string): string {
    if (!caseInsensitive) {
      return path;
    }

    const slash = path.lastIndexOf('/');

    if (slash === -1) {
      return path;
    }

    let out = '';

    for (const seg of path.slice(0, slash).split('/')) {
      const next = out ? `${out}/${seg}` : seg;
      out = dirSpelling(next) ?? next;
    }

    return out + path.slice(slash);
  }

  function dirSpelling(dir: string): string | undefined {
    const n = norm(dir);
    const d = dirs.get(n);

    if (d) {
      return d;
    }

    const depth = dir.split('/').length;

    for (const f of files.values()) {
      if (norm(f.path).startsWith(n + '/')) {
        return f.path.split('/').slice(0, depth).join('/');
      }
    }

    return undefined;
  }

  async function stat(path: string): Promise<FileStat | null> {
    const f = files.get(norm(path));

    return f ? { size: f.data.length, mtime: f.mtime } : null;
  }

  async function list(dir: string): Promise<DirEntry[]> {
    const out = new Map<string, DirEntry>();

    if (dir === '' && (state.size > 0 || temps.size > 0)) {
      out.set(HIDDEN_DIR, { name: HIDDEN_DIR, dir: true });
    }

    const n = dir === '' ? '' : norm(dir) + '/';

    for (const f of files.values()) {
      if (!norm(f.path).startsWith(n)) {
        continue;
      }

      const rest = f.path.slice(n.length);
      const slash = rest.indexOf('/');
      const name = slash === -1 ? rest : rest.slice(0, slash);
      const isDir = slash !== -1;
      const k = norm(name);

      if (!out.has(k)) {
        out.set(k, { name, dir: isDir });
      }
    }

    for (const d of dirs.values()) {
      if (!norm(d).startsWith(n)) {
        continue;
      }

      const rest = d.slice(n.length);

      if (rest === '') {
        continue;
      }

      const slash = rest.indexOf('/');
      const name = slash === -1 ? rest : rest.slice(0, slash);
      const k = norm(name);

      if (!out.has(k)) {
        out.set(k, { name, dir: true });
      }
    }

    return [...out.values()];
  }

  async function read(path: string, offset: number, length: number): Promise<Uint8Array> {
    const f = files.get(norm(path));

    if (!f) {
      throw new Error(`memfs: no file ${path}`);
    }

    return f.data.slice(offset, offset + length);
  }

  function writeFile(path: string, data: Uint8Array): FileStat {
    const p = resolve(path);
    const segs = p.split('/');

    for (let i = 1; i < segs.length; i++) {
      if (files.has(norm(segs.slice(0, i).join('/')))) {
        throw new Error(`memfs: ${segs.slice(0, i).join('/')} is a file`);
      }
    }

    if (isDir(p)) {
      throw new Error(`memfs: ${p} is a folder`);
    }

    for (const s of segs) {
      if (!canCreateFn(s)) {
        throw new Error(`memfs: cannot create ${s}`);
      }
    }

    const mtime = tick();
    files.delete(norm(p));
    files.set(norm(p), { path: p, data: new Uint8Array(data), mtime });

    return { size: data.length, mtime };
  }

  async function moveTempInto(temp: string, path: string): Promise<FileStat> {
    const data = temps.get(temp);

    if (!data) {
      throw new Error(`memfs: no temp ${temp}`);
    }

    const st = writeFile(path, data);
    temps.delete(temp);

    return st;
  }

  async function move(from: string, to: string): Promise<void> {
    const f = files.get(norm(from));

    if (f) {
      files.delete(norm(from));
      const dest = resolve(to);
      files.set(norm(dest), { path: dest, data: f.data, mtime: f.mtime });

      return;
    }

    const n = norm(from) + '/';
    let moved = false;

    for (const [k, node] of [...files]) {
      if (!k.startsWith(n)) {
        continue;
      }

      files.delete(k);
      const p = to + node.path.slice(from.length);
      files.set(norm(p), { ...node, path: p });
      moved = true;
    }

    if (!moved) {
      throw new Error(`memfs: nothing at ${from}`);
    }
  }

  async function remove(path: string): Promise<void> {
    files.delete(norm(path));
  }

  async function removeEmptyDirs(dir: string): Promise<void> {
    let d = dir;
    while (d !== '') {
      const n = norm(d);
      let used = false;

      for (const k of files.keys()) {
        if (k.startsWith(n + '/')) {
          used = true;
        }
      }

      for (const k of dirs.keys()) {
        if (k !== n && k.startsWith(n + '/')) {
          used = true;
        }
      }

      if (used) {
        return;
      }

      dirs.delete(n);
      d = d.includes('/') ? d.slice(0, d.lastIndexOf('/')) : '';
    }
  }

  async function tempSize(temp: string): Promise<number | null> {
    return temps.get(temp)?.length ?? null;
  }

  async function tempAppend(temp: string, data: Uint8Array): Promise<void> {
    const cur = temps.get(temp) ?? new Uint8Array(0);
    const next = new Uint8Array(cur.length + data.length);
    next.set(cur);
    next.set(data, cur.length);
    temps.set(temp, next);
  }

  async function tempTruncate(temp: string, size: number): Promise<void> {
    temps.set(temp, must(temps.get(temp)).slice(0, size));
  }

  async function tempRemove(temp: string): Promise<void> {
    temps.delete(temp);
  }

  async function tempList(): Promise<string[]> {
    return [...temps.keys()];
  }

  async function loadState(name: string): Promise<string | null> {
    return state.get(name) ?? null;
  }

  async function saveState(name: string, data: string): Promise<void> {
    state.set(name, data);
  }

  async function destroy(): Promise<void> {
    state.clear();
    temps.clear();

    if (kind === 'private') {
      files.clear();
    }

    destroyed = true;
  }

  function put(path: string, text: string): void {
    writeFile(path, new TextEncoder().encode(text));
  }

  function text(path: string): string | undefined {
    const f = files.get(norm(path));

    return f ? new TextDecoder().decode(f.data) : undefined;
  }

  function paths(): string[] {
    return [...files.values()].map(f => f.path).sort();
  }

  return {
    kind,
    caseInsensitive,
    files,
    dirs,
    temps,
    state,
    get destroyed() {
      return destroyed;
    },
    canCreate,
    stat,
    list,
    read,
    moveTempInto,
    move,
    remove,
    removeEmptyDirs,
    tempSize,
    tempAppend,
    tempTruncate,
    tempRemove,
    tempList,
    loadState,
    saveState,
    destroy,
    watch: opts.watch,
    put,
    text,
    paths,
  } satisfies FsAdapter & Record<string, unknown>;
}
