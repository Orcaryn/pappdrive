import type { IndexEntry } from '@pappdrive/protocol';
import { bigFileId, decryptBlob } from '../../../shared/crypto.js';
import { SyncError } from '../../../shared/errors.js';
import type { RoundDeps } from './deps.js';

const CONCURRENCY = 3;

export async function downloadAll<J extends { entry: IndexEntry }>(
  r: RoundDeps,
  jobs: J[],
  land: (job: J, temp: string) => Promise<void>,
  onError: (job: J, err: Error) => void
): Promise<void> {
  const { fs, keys, api } = r.ctx;
  const sorted = [...jobs].sort((a, b) => a.entry.size - b.entry.size);

  const fetchBlob = async (id: string, size: number): Promise<Uint8Array> => {
    const pt = await decryptBlob(keys, await api.getBlob(id), id);

    if (pt.length !== size) {
      throw new SyncError('server', `Blob ${id} has the wrong size. The next sync fetches the index again.`);
    }

    return pt;
  };

  const fetchToTemp = async (entry: IndexEntry): Promise<string> => {
    const temp = entry.id;

    if (!entry.parts) {
      if ((await fs.tempSize(temp)) === entry.size) {
        return temp;
      }

      const pt = await fetchBlob(entry.id, entry.size);
      await fs.tempRemove(temp);
      await fs.tempAppend(temp, pt);

      return temp;
    } else if ((await bigFileId(keys, entry.parts)) !== entry.id) {
      throw new SyncError('server', "A big file's part list does not match its file id. The next sync fetches the index again.");
    }

    const have = await fs.tempSize(temp);
    const whole = have === null || have > entry.size ? 0 : Math.floor(have / r.partSize);

    if (have !== null && have !== whole * r.partSize) {
      await fs.tempTruncate(temp, whole * r.partSize);
    }

    for (const [i, part] of entry.parts.entries()) {
      if (i < whole) {
        continue;
      }

      r.signal.throwIfAborted();

      await fs.tempAppend(temp, await fetchBlob(part, Math.min(r.partSize, entry.size - i * r.partSize)));
    }

    return temp;
  };

  const sameBlob = Map.groupBy(sorted, job => job.entry.id).values();

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, sorted.length) }, async () => {
      for (const jobs of sameBlob) {
        for (const job of jobs) {
          r.signal.throwIfAborted();

          try {
            const temp = await fetchToTemp(job.entry);
            r.signal.throwIfAborted();
            await land(job, temp);
          } catch (e) {
            // fetch, Web Crypto, node:fs and the File System API reject with Error instances only.
            onError(job, e as Error);
          }
        }
      }
    })
  );
}
