import { utf8 } from './bytes.js';

export const HIDDEN_DIR = '.pappdrive';
const MAX_SEGMENT_BYTES = 255;
const MAX_PATH_BYTES = 1024;

export function pathProblem(path: string): string | null {
  if (path === '') {
    return 'the path is empty';
  } else if (path.startsWith('/')) {
    return 'it starts with a slash. Paths are relative to the folder, like "notes/todo.md"';
  } else if (/\p{Cc}/u.test(path)) {
    return 'it contains a control character';
  } else if (utf8.encode(path).length > MAX_PATH_BYTES) {
    return `it is longer than ${MAX_PATH_BYTES} bytes`;
  }

  for (const seg of path.split('/')) {
    if (seg === '') {
      return 'it has an empty segment ("//" or a trailing slash)';
    } else if (seg === '.' || seg === '..') {
      return 'it contains "." or ".."';
    } else if (utf8.encode(seg).length > MAX_SEGMENT_BYTES) {
      return `a segment is longer than ${MAX_SEGMENT_BYTES} bytes`;
    }
  }

  return null;
}

export function pathKey(path: string): string {
  return path.normalize('NFC').toLowerCase();
}

export function parentOf(path: string): string {
  const i = path.lastIndexOf('/');

  return i < 0 ? '' : path.slice(0, i);
}

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

export function joinPath(dir: string, name: string): string {
  return dir === '' ? name : `${dir}/${name}`;
}

export function dirKeysOf(paths: Iterable<string>): Set<string> {
  const out = new Set<string>();

  for (const p of paths) {
    const segs = pathKey(p).split('/');

    for (let i = 1; i < segs.length; i++) {
      out.add(segs.slice(0, i).join('/'));
    }
  }

  return out;
}
