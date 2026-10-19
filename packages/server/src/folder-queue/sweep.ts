import { ID_RE, SWEEP_GRACE_MS, type DeltaFile, type IndexFile } from '@pappdrive/protocol';
import { deleteKeys, keys, listAll, listIndexes, R2_MAX_KEYS_PER_CALL, type Folder, type FolderBucket } from '../shared/bucket';

export async function sweep(bucket: FolderBucket, f: Folder, nowMs = Date.now()): Promise<boolean> {
  const prefix = keys.folderPrefix(f.user, f.app);
  const current = await bucket.get(keys.delta(f.user, f.app));

  if (current === null) {
    await deletePrefix(bucket, prefix);

    return false;
  }

  const needed = new Set(Object.keys((JSON.parse(await current.text()) as DeltaFile).blobs));

  for (const k of await listIndexes(bucket, f)) {
    const kept = await bucket.get(k.key);

    if (kept === null) {
      throw new Error(`The index ${k.key} vanished during the sweep. The next sweep tries again.`);
    }

    for (const id of Object.keys((JSON.parse(await kept.text()) as IndexFile).blobs)) {
      needed.add(id);
    }
  }

  const cutoff = nowMs - SWEEP_GRACE_MS;
  const doomed: string[] = [];

  for await (const o of listAll(bucket, prefix)) {
    const name = o.key.slice(prefix.length);

    if (ID_RE.test(name) && !needed.has(name) && o.uploaded.getTime() < cutoff) {
      doomed.push(o.key);
    }
  }

  await deleteKeys(bucket, doomed);

  return true;
}

export async function deleteFolder(bucket: FolderBucket, f: Folder): Promise<void> {
  await bucket.delete(keys.delta(f.user, f.app));
  await deletePrefix(bucket, keys.folderPrefix(f.user, f.app));
}

async function deletePrefix(bucket: FolderBucket, prefix: string): Promise<void> {
  for (;;) {
    const page = await bucket.list({ prefix, limit: R2_MAX_KEYS_PER_CALL });

    if (page.objects.length > 0) {
      await bucket.delete(page.objects.map(o => o.key));
    }

    if (!page.truncated) {
      return;
    }
  }
}
