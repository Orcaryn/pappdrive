import type { IndexEntry } from '@pappdrive/protocol';
import { blobIdsOf } from '@pappdrive/protocol';
import { blobId, encryptBlob } from '../../../shared/crypto.js';
import type { LocalState } from '../state.js';
import type { FolderContext } from '../types.js';

const BATCH_BYTES = 32 * 1024 * 1024;
const PUT_CONCURRENCY = 4;

export type Uploader = ReturnType<typeof createUploader>;

export function createUploader(ctx: FolderContext, state: LocalState, partSize: number, header: Record<string, number>) {
  let batch: { id: string; data: Uint8Array }[] = [];
  let batchBytes = 0;
  const inBatch = new Set<string>();
  const sources = new Map<string, { path: string; offset: number; length: number }>();

  async function addFile(path: string, entry: IndexEntry): Promise<'ok' | 'changed' | 'missing'> {
    const { fs, keys } = ctx;
    const before = await fs.stat(path);

    if (!before) {
      return 'missing';
    } else if (before.size !== entry.size || before.mtime !== entry.mtime) {
      return 'changed';
    }

    const ids = blobIdsOf(entry);

    for (const [i, id] of ids.entries()) {
      const offset = i * partSize;
      const length = Math.min(partSize, entry.size - offset);
      sources.set(id, { path, offset, length });

      if (header[id] !== undefined || state.isUploaded(id) || inBatch.has(id)) {
        continue;
      }

      const data = await fs.read(path, offset, length);

      if ((await blobId(keys, data)) !== id) {
        return 'changed';
      }

      await addBlob(id, data);
    }

    const after = await fs.stat(path);

    if (!after) {
      return 'missing';
    }

    return after.size === before.size && after.mtime === before.mtime ? 'ok' : 'changed';
  }

  async function reupload(ids: string[]): Promise<boolean> {
    for (const id of ids) {
      state.dropUploaded(id);
      const src = sources.get(id);

      if (!src) {
        return false;
      }

      const data = await ctx.fs.read(src.path, src.offset, src.length);

      if ((await blobId(ctx.keys, data)) !== id) {
        return false;
      }

      await addBlob(id, data);
    }

    await flush();

    return true;
  }

  async function flush(): Promise<void> {
    if (batch.length === 0) {
      return;
    }

    const sending = batch;
    batch = [];
    batchBytes = 0;
    try {
      const queue = sending.values();
      await Promise.all(
        Array.from({ length: Math.min(PUT_CONCURRENCY, sending.length) }, async () => {
          for (const b of queue) {
            await ctx.api.putBlob(b.id, b.data);
            state.markUploaded(b.id);
          }
        })
      );
    } finally {
      for (const b of sending) {
        inBatch.delete(b.id);
      }

      await state.flush();
    }
  }

  async function addBlob(id: string, plaintext: Uint8Array): Promise<void> {
    const data = await encryptBlob(ctx.keys, plaintext);

    if (batch.length > 0 && batchBytes + data.length > BATCH_BYTES) {
      await flush();
    }

    batch.push({ id, data });
    batchBytes += data.length;
    inBatch.add(id);
  }

  return { addFile, reupload, flush };
}
