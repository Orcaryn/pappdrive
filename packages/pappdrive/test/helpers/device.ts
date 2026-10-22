import type { GoneReason } from '@pappdrive/protocol';
import { dataKeys, randomBytes, type DataKeys } from '../../src/shared/crypto.js';
import { openFolder } from '../../src/papp/folder/index.js';
import type { Tuning } from '../../src/papp/folder/types.js';
import type { Change } from '../../src/shared/types.js';
import type { Coordinator, Platform } from '../../src/shared/platform.js';
import type { Folder, FolderContext } from '../../src/papp/folder/types.js';
import { hashWasmArgon2 } from '../../src/shared/argon2.js';
import { createMemFs, type MemFs, type MemFsOptions } from './memfs.js';
import { createFakeServer, type FakeServer } from './server.js';

export const PS = 1024;
const APP = 'notes';

export async function setup(n = 2): Promise<{ server: FakeServer; keys: DataKeys; devs: Device[] }> {
  const server = createFakeServer(APP);
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
  syncOnBackground?: boolean;
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
  const platform: Platform = { argon2: hashWasmArgon2, openPrivate: async () => fs, openVisible: async () => fs, coordinator: o.coordinator };
  const ctx: FolderContext = {
    app: APP,
    readOnly: o.readOnly ?? false,
    fs,
    keys,
    api: server.api(),
    platform,
    syncOnBackground: o.syncOnBackground,
    noticeGone: async () => {
      gone.calls++;

      if (gone.reason) {
        await folder.markDeleted(gone.reason);
      }
    },
  };
  const folder = openFolder(ctx, { partSize: PS, quietMs: 60_000, maxWaitMs: 60_000, ...o.tuning });
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
