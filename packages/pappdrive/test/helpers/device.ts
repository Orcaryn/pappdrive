// One test device: an in-memory folder synced through a fake server.
import type { GoneReason } from "@pappdrive/protocol"
import { dataKeys, newDataKey, type DataKeys } from "../../src/core/crypto.js"
import { openFolder } from "../../src/core/folder.js"
import type { Tuning } from "../../src/core/sync.js"
import type { Change, Coordinator, Folder, FolderContext, Platform, Watcher } from "../../src/core/types.js"
import { MemFs, type MemFsOptions } from "./memfs.js"
import type { FakeServer } from "./server.js"

export const PS = 1024 // part size in tests

export function newKeys(): Promise<DataKeys> {
  return dataKeys(newDataKey())
}

export interface DeviceOptions extends MemFsOptions {
  app?: string
  readOnly?: boolean
  tuning?: Partial<Tuning>
  watcher?: Watcher
  coordinator?: () => Coordinator
  fs?: MemFs
  /** What checkGone answers. With "gone", the device is marked deleted, as the account layer does. */
  gone?: GoneReason | null
}

export interface Device {
  fs: MemFs
  folder: Folder
  changes: Change[]
  gone: { calls: number; reason: GoneReason | null }
  ctx: FolderContext
}

export async function device(server: FakeServer, keys: DataKeys, o: DeviceOptions = {}, start = true): Promise<Device> {
  const fs = o.fs ?? new MemFs(o)
  const gone = { calls: 0, reason: o.gone ?? null }
  let folder: Folder
  const platform = {
    name: "node",
    defaultKeyStore: () => {
      throw new Error("unused")
    },
    openPrivate: async () => fs,
    openVisible: async () => fs,
    ...(o.watcher ? { watcher: o.watcher } : {}),
    ...(o.coordinator ? { coordinator: o.coordinator } : {}),
  } as Platform
  const ctx: FolderContext = {
    app: o.app ?? "notes",
    readOnly: o.readOnly ?? false,
    fs,
    keys,
    api: server.api(),
    platform,
    checkGone: async () => {
      gone.calls++
      if (gone.reason) {
        await folder.markDeleted(gone.reason)
        return "gone"
      }
      return "ok"
    },
  }
  folder = openFolder(ctx, { pollMs: 0, partSize: PS, quietMs: 60_000, maxWaitMs: 60_000, ...o.tuning })
  const changes: Change[] = []
  folder.watch((c) => changes.push(c))
  if (start) {
    await folder.start()
    await folder.sync()
  }
  return { fs, folder, changes, gone, ctx }
}

export const text = (s: string) => new TextEncoder().encode(s)
