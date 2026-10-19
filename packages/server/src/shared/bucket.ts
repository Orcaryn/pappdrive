export const keys = {
  userKey: (user: string) => `${user}/key`,
  folderPrefix: (user: string, app: string) => `${user}/${app}/`,
  delta: (user: string, app: string) => `${user}/${app}/delta`,
  indexPrefix: (user: string, app: string) => `${user}/${app}/index/`,
  index: (user: string, app: string, id: string) => `${user}/${app}/index/${id}`,
  blob: (user: string, app: string, id: string) => `${user}/${app}/${id}`,
};

export interface FolderBucket {
  get(key: string): Promise<{ httpEtag: string; text(): Promise<string> } | null>;
  head(key: string): Promise<{ size: number } | null>;
  put(key: string, value: string, options?: { onlyIf?: Headers }): Promise<{ httpEtag: string } | null>;
  list(options: { prefix: string; cursor?: string; limit: number }): Promise<ListPage>;
  delete(keys: string | string[]): Promise<void>;
}

export interface ListPage {
  objects: { key: string; size: number; uploaded: Date }[];
  truncated: boolean;
  cursor?: string;
}

export interface Folder {
  user: string;
  app: string;
}

export interface KeptIndex {
  key: string;
  id: string;
  time: number;
}

export const R2_MAX_KEYS_PER_CALL = 1000;

export async function* listAll(bucket: FolderBucket, prefix: string) {
  let cursor: string | undefined = undefined;
  do {
    const page = await bucket.list({ prefix, cursor, limit: R2_MAX_KEYS_PER_CALL });
    yield* page.objects;
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

export async function listIndexes(bucket: FolderBucket, f: Folder): Promise<KeptIndex[]> {
  const prefix = keys.indexPrefix(f.user, f.app);
  const kept: KeptIndex[] = [];

  for await (const o of listAll(bucket, prefix)) {
    kept.push({ key: o.key, id: o.key.slice(prefix.length), time: o.uploaded.getTime() });
  }

  return kept.sort((a, b) => b.time - a.time);
}

export async function deleteKeys(bucket: FolderBucket, doomed: string[]): Promise<void> {
  for (let i = 0; i < doomed.length; i += R2_MAX_KEYS_PER_CALL) {
    await bucket.delete(doomed.slice(i, i + R2_MAX_KEYS_PER_CALL));
  }
}
