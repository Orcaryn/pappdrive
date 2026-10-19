import type { CommitResult, DeltaBody, DeltaFile, IndexBody, IndexFile } from '@pappdrive/protocol';
import { decodeBody, type DataKeys } from '../../src/shared/crypto.js';
import { SyncError } from '../../src/shared/errors.js';
import type { FolderApi } from '../../src/papp/folder/shared/types.js';

export type FakeServer = ReturnType<typeof createFakeServer>;

export function createFakeServer() {
  let etagN = 0;
  const server = {
    blobs: new Map<string, Uint8Array>(),
    indexes: new Map<string, string>(),
    delta: null as { text: string; etag: string } | null,
    puts: [] as string[],
    watchers: new Set<() => void>(),
    putAttempts: 0,
    commits: 0,
    offline: false,
    beforeCommit: null as ((n: number) => Promise<void> | void) | null,
    beforeBlobGet: null as ((id: string) => Promise<void> | void) | null,
    api,
    notify,
    writeDelta,
    body,
    header,
    texts,
  };

  function online(): void {
    if (server.offline) {
      throw new SyncError('network', 'The fake server is offline.');
    }
  }

  function api(): FolderApi {
    return {
      getDelta: async known => {
        online();

        if (!server.delta) {
          return { kind: 'missing' };
        } else if (known !== null && known.etag === server.delta.etag) {
          return { kind: 'unchanged', known };
        }

        const delta = JSON.parse(server.delta.text) as Omit<DeltaFile, 'v'> & { v: number };

        if (delta.v !== 1) {
          throw new SyncError('update-needed', 'The fake delta has an unknown version. Update the pappdrive package.');
        }

        return { kind: 'found', delta: { v: 1, base: delta.base, blobs: delta.blobs, body: delta.body }, etag: server.delta.etag };
      },
      getIndex: async id => {
        online();
        const text = server.indexes.get(id);

        if (text === undefined) {
          throw new SyncError('server', `The fake server has no index ${id}.`);
        }

        return JSON.parse(text) as IndexFile;
      },
      getBlob: async id => {
        online();
        await server.beforeBlobGet?.(id);
        const b = server.blobs.get(id);

        if (!b) {
          throw new SyncError('server', `The fake server has no blob ${id}.`);
        }

        return b;
      },
      putBlob: async (id, data) => {
        online();
        server.putAttempts++;
        server.blobs.set(id, data);
        server.puts.push(id);
      },
      commitDelta,
      commitCheckpoint,
      watchIndex: onChange => {
        server.watchers.add(onChange);

        return () => server.watchers.delete(onChange);
      },
    };
  }

  function notify(): void {
    for (const onChange of server.watchers) {
      onChange();
    }
  }

  async function commitDelta(delta: DeltaFile, etag: string): Promise<CommitResult> {
    online();
    server.commits++;
    await server.beforeCommit?.(server.commits);

    if (!server.delta || server.delta.etag !== etag) {
      return { ok: false, error: 'stale' };
    }

    const old = JSON.parse(server.delta.text) as DeltaFile;

    if (old.base !== delta.base) {
      return { ok: false, error: 'stale' };
    }

    const missing = missingBlobs(old.blobs, delta.blobs);

    if (missing.length) {
      return { ok: false, error: 'missing', missing };
    }

    return { ok: true, etag: writeDelta(delta) };
  }

  async function commitCheckpoint(index: IndexFile, delta: DeltaFile, etag: string | null): Promise<CommitResult> {
    online();
    server.commits++;
    await server.beforeCommit?.(server.commits);

    if ((server.delta?.etag ?? null) !== etag) {
      return { ok: false, error: 'stale' };
    }

    const missing = missingBlobs(header(), index.blobs);

    if (missing.length) {
      return { ok: false, error: 'missing', missing };
    }

    server.indexes.set(delta.base, JSON.stringify(index));

    return { ok: true, etag: writeDelta(delta) };
  }

  function missingBlobs(before: Record<string, number>, after: Record<string, number>): string[] {
    const missing: string[] = [];

    for (const [id, size] of Object.entries(after)) {
      const known = before[id];
      const stored = known === undefined ? server.blobs.get(id)?.length : known;

      if (stored !== size) {
        missing.push(id);
      }
    }

    return missing;
  }

  function writeDelta(delta: DeltaFile): string {
    const etag = `"e${++etagN}"`;
    server.delta = { text: JSON.stringify(delta), etag };

    return etag;
  }

  function current(): { index: IndexFile; delta: DeltaFile } | null {
    if (!server.delta) {
      return null;
    }

    const delta = JSON.parse(server.delta.text) as DeltaFile;
    const text = server.indexes.get(delta.base);

    if (text === undefined) {
      throw new Error(`The fake delta points at index ${delta.base}, which does not exist.`);
    }

    return { index: JSON.parse(text) as IndexFile, delta };
  }

  async function body(keys: DataKeys): Promise<IndexBody> {
    const c = current();

    if (!c) {
      return {};
    }

    const merged = await decodeBody<IndexBody>(keys, c.index.body);

    for (const [path, entry] of Object.entries(await decodeBody<DeltaBody>(keys, c.delta.body))) {
      if (entry === null) {
        delete merged[path];
      } else {
        merged[path] = entry;
      }
    }

    return merged;
  }

  function header(): Record<string, number> {
    const c = current();

    return c ? { ...c.index.blobs, ...c.delta.blobs } : {};
  }

  function texts(): string {
    return [server.delta?.text ?? '', ...server.indexes.values()].join('\n');
  }

  return server;
}
