import type { FolderBucket, ListPage } from '../src/shared/bucket';

interface Entry {
  value: string;
  size: number;
  uploaded: Date;
  etag: string;
}

export interface FakeBucket extends FolderBucket {
  objects: Map<string, Entry>;
  calls: { head: number; list: number };
  now: () => Date;
  blob(key: string, size: number, uploaded?: Date): void;
}

export function createFakeBucket(): FakeBucket {
  let n = 0;
  const bucket: FakeBucket = { objects: new Map<string, Entry>(), calls: { head: 0, list: 0 }, now: () => new Date(), blob, get, head, put, list, delete: remove };

  function blob(key: string, size: number, uploaded = bucket.now()): void {
    bucket.objects.set(key, { value: '', size, uploaded, etag: `"e${++n}"` });
  }

  async function get(key: string) {
    const e = bucket.objects.get(key);

    return e ? { httpEtag: e.etag, text: async () => e.value } : null;
  }

  async function head(key: string) {
    bucket.calls.head++;
    const e = bucket.objects.get(key);

    return e ? { size: e.size } : null;
  }

  async function put(key: string, value: string, options?: { onlyIf?: Headers }) {
    const existing = bucket.objects.get(key);
    const ifMatch = options?.onlyIf?.get('If-Match');

    if (options?.onlyIf?.get('If-None-Match') === '*' && existing) {
      return null;
    } else if (ifMatch && existing?.etag !== ifMatch) {
      return null;
    }

    const etag = `"e${++n}"`;
    bucket.objects.set(key, { value, size: value.length, uploaded: bucket.now(), etag });

    return { httpEtag: etag };
  }

  async function list({ prefix, cursor, limit }: { prefix: string; cursor?: string; limit: number }): Promise<ListPage> {
    bucket.calls.list++;
    const all = [...bucket.objects].filter(([k]) => k.startsWith(prefix)).sort(([a], [b]) => (a < b ? -1 : 1));
    const start = cursor ? all.findIndex(([k]) => k > cursor) : 0;
    const slice = start < 0 ? [] : all.slice(start, start + limit);
    const truncated = start >= 0 && start + limit < all.length;

    return { objects: slice.map(([key, e]) => ({ key, size: e.size, uploaded: e.uploaded })), truncated, cursor: truncated ? slice.at(-1)?.[0] : undefined };
  }

  async function remove(keys: string | string[]): Promise<void> {
    for (const k of [keys].flat()) {
      bucket.objects.delete(k);
    }
  }

  return bucket;
}
