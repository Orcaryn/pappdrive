import type { GoneReason } from '@pappdrive/protocol';
import { dataKeys, randomBytes, type DataKeys } from '../../src/shared/crypto.js';
import { openFolder } from '../../src/papp/folder/index.js';
import type { Tuning } from '../../src/papp/folder/shared/types.js';
import type { Change } from '../../src/shared/types.js';
import type { Coordinator, Platform } from '../../src/shared/platform.js';
import type { Folder, FolderContext } from '../../src/papp/folder/shared/types.js';
import { createMemFs, type MemFs, type MemFsOptions } from './memfs.js';
import { createFakeServer, type FakeServer } from './server.js';

export const PS = 1024;

export async function setup(n = 2): Promise<{ server: FakeServer; keys: DataKeys; devs: Device[] }> {
  const server = createFakeServer();
  const keys = await dataKeys(randomBytes(32));
  const devs: Device[] = [];

  for (let i = 0; i < n; i++) {
    devs.push(await device(server, keys));
  }

  return { server, keys, devs };
}

const opened: Device[] = [];

export async function closeDevices(): Promise<void> {
  for (const d of opened.splice(0)) {
    await d.folder.close();
  }
}

export interface DeviceOptions extends MemFsOptions {
  readOnly?: boolean;
  tuning?: Partial<Tuning>;
  coordinator?: () => Coordinator;
  fs?: MemFs;
  gone?: GoneReason | null;
}

export interface Device {
  fs: MemFs;
  folder: Folder;
  changes: Change[];
  gone: { calls: number; reason: GoneReason | null };
  ctx: FolderContext;
}

export async function device(server: FakeServer, keys: DataKeys, o: DeviceOptions = {}, start = true): Promise<Device> {
  const fs = o.fs ?? createMemFs(o);
  const gone = { calls: 0, reason: o.gone ?? null };
  const platform: Platform = { openPrivate: async () => fs, openVisible: async () => fs, coordinator: o.coordinator };
  const ctx: FolderContext = {
    app: 'notes',
    readOnly: o.readOnly ?? false,
    fs,
    keys,
    api: server.api(),
    platform,
    checkGone: async () => {
      gone.calls++;

      if (gone.reason) {
        await folder.markDeleted(gone.reason);

        return 'gone';
      }

      return 'ok';
    },
  };
  const folder = openFolder(ctx, { pollMs: 0, partSize: PS, quietMs: 60_000, maxWaitMs: 60_000, ...o.tuning });
  const changes: Change[] = [];
  folder.watch(c => changes.push(c));
  const d = { fs, folder, changes, gone, ctx };
  opened.push(d);

  if (start) {
    await folder.start();
    await folder.sync();
  }

  return d;
}
