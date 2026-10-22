import { openOpfs } from '../browser/opfs/index.js';
import { createPappCore } from '../papp/index.js';
import { createChannel } from '../rpc/channel.js';
import { hostKeyStore } from '../rpc/host-keystore.js';
import { serve } from '../rpc/serve.js';
import type { HostMethods, PappEvents, PappMethods } from '../rpc/types.js';
import { hashWasmArgon2 } from '../shared/argon2.js';
import { SyncError } from '../shared/errors.js';
import type { Platform } from '../shared/platform.js';
import type { PappOptions } from '../shared/types.js';

export type EmbeddedMethods = PappMethods & { 'host.background': { params: Record<string, never>; result: void } };

export type StartOptions = Omit<PappOptions, 'keyStore'>;

let receiveFromHost: (text: string) => void = () => {
  throw new Error('pappdrive.start(options, send) must run before pappdrive.receive(text).');
};

export function start(opts: StartOptions, send: (text: string) => void): void {
  const channel = createChannel<HostMethods & PappEvents, EmbeddedMethods>({
    send,
    onMessage: cb => {
      receiveFromHost = cb;
    },
  });
  const background = new Set<() => Promise<unknown>>();
  const platform: Platform = {
    argon2: hashWasmArgon2,
    openPrivate: openOpfs,
    async openVisible(path) {
      throw new SyncError('not-allowed', `A visible folder ("${path}") works only on the desktop. On a phone, open the private folder: open({ mode: "private" }).`);
    },
    async persist() {
      await navigator.storage.persist();
    },
    onBackground(cb) {
      background.add(cb);

      return () => {
        background.delete(cb);
      };
    },
  };

  channel.on({
    'host.background': async () => {
      await Promise.all([...background].map(cb => cb()));
    },
  });
  serve(createPappCore(opts, platform, hostKeyStore(channel)), channel);
}

export function receive(text: string): void {
  receiveFromHost(text);
}
