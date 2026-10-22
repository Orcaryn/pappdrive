import { concat, fromBase64, toBase64 } from '../shared/bytes.js';
import type { Change, Files, Papp, Status } from '../shared/types.js';
import type { Channel } from './channel.js';
import type { FilesHandle, OpenWhere, PappEvents, PappMethods } from './types.js';

const SLICE = 1024 * 1024;

export interface RemoteFiles extends Omit<Files, 'readOnly' | 'status' | 'readStream' | 'write'> {
  readonly handle: FilesHandle;
  readOnly(): Promise<boolean>;
  status(): Promise<Status>;
  write(path: string, data: string | Uint8Array): Promise<void>;
}

export interface RemotePapp extends Omit<Papp, 'ready' | 'signedIn' | 'files' | 'open' | 'openReadOnly'> {
  signedIn(): Promise<boolean>;
  open(where: OpenWhere): Promise<RemoteFiles>;
  openReadOnly(app: string): Promise<RemoteFiles>;
}

export function createClient(channel: Channel<PappMethods, PappEvents>): RemotePapp {
  const changeListeners = new Map<FilesHandle, Set<(change: Change) => void>>();
  const statusListeners = new Map<FilesHandle, Set<(status: Status) => void>>();

  channel.on({
    change: ({ files, change }) => {
      for (const cb of changeListeners.get(files) ?? []) {
        cb(change);
      }
    },
    status: ({ files, status }) => {
      for (const cb of statusListeners.get(files) ?? []) {
        cb(status);
      }
    },
  });

  function subscribe<T>(listeners: Map<FilesHandle, Set<(value: T) => void>>, handle: FilesHandle, cb: (value: T) => void): () => void {
    const set = listeners.get(handle) ?? new Set();
    listeners.set(handle, set);
    set.add(cb);

    return () => {
      set.delete(cb);
    };
  }

  const files = (handle: FilesHandle): RemoteFiles => ({
    handle,
    readOnly: () => channel.request('files.readOnly', { files: handle }),
    async write(path, data) {
      if (!(data instanceof Uint8Array)) {
        return channel.request('files.writeText', { files: handle, path, text: data });
      }

      const id = await channel.request('files.writeStart', { files: handle, path });

      for (let offset = 0; offset < data.length; offset += SLICE) {
        await channel.request('files.writeChunk', { id, base64: toBase64(data.subarray(offset, offset + SLICE)) });
      }

      await channel.request('files.writeEnd', { id });
    },
    async read(path) {
      const id = await channel.request('files.readStart', { files: handle, path });
      const slices: Uint8Array[] = [];

      for (;;) {
        const slice = await channel.request('files.readChunk', { id });

        if (slice === null) {
          return concat(...slices);
        }

        slices.push(fromBase64(slice));
      }
    },
    readText: path => channel.request('files.readText', { files: handle, path }),
    list: dir => channel.request('files.list', { files: handle, dir }),
    remove: path => channel.request('files.remove', { files: handle, path }),
    status: () => channel.request('files.status', { files: handle }),
    sync: () => channel.request('files.sync', { files: handle }),
    watch: cb => subscribe(changeListeners, handle, cb),
    onStatus: cb => subscribe(statusListeners, handle, cb),
  });

  return {
    signedIn: () => channel.request('signedIn', {}),
    open: async where => files(await channel.request('open', { where })),
    openReadOnly: async app => files(await channel.request('openReadOnly', { app })),
    signUp: (email, password) => channel.request('signUp', { email, password }),
    pendingSignUp: () => channel.request('pendingSignUp', {}),
    confirmRecoveryCode: () => channel.request('confirmRecoveryCode', {}),
    verifyEmail: code => channel.request('verifyEmail', { code }),
    sendVerificationEmail: () => channel.request('sendVerificationEmail', {}),
    signIn: (email, password) => channel.request('signIn', { email, password }),
    recover: (email, recoveryCode, newPassword) => channel.request('recover', { email, recoveryCode, newPassword }),
    setPassword: newPassword => channel.request('setPassword', { newPassword }),
    signOut: () => channel.request('signOut', {}),
    deleteApp: password => channel.request('deleteApp', { password }),
    deleteAccount: password => channel.request('deleteAccount', { password }),
    close: () => channel.request('close', {}),
  };
}
