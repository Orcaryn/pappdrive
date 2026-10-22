import { hashWasmArgon2 } from '../shared/argon2.js';
import { SyncError } from '../shared/errors.js';
import { createPappCore } from '../papp/index.js';
import type { Papp, PappOptions } from '../shared/types.js';
import type { Platform } from '../shared/platform.js';
import { browserCoordinator } from './coordinator.js';
import { indexedDbKeyStore } from './keystore.js';
import { openOpfs } from './opfs/index.js';

export function createPapp(opts: PappOptions): Papp {
  return createPappCore(opts, browserPlatform, opts.keyStore ?? indexedDbKeyStore());
}

const browserPlatform: Platform = {
  argon2: hashWasmArgon2,
  openPrivate: openOpfs,
  async openVisible(path) {
    throw new SyncError(
      'not-allowed',
      `A visible folder ("${path}") works only on the desktop. In a browser or on a phone, open the private folder: await papp.open({ mode: "private" }).`
    );
  },
  coordinator: browserCoordinator,
  async persist() {
    await navigator.storage.persist();
  },
  onBackground(cb) {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        void cb();
      }
    };

    const onPageHide = () => void cb();

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
    };
  },
};

export { SyncError } from '../shared/errors.js';
export type { SyncErrorCode } from '../shared/errors.js';
export type { Change, FileInfo, Files, KeyStore, Papp, PappOptions, Status, WriteData } from '../shared/types.js';
export { capacitorKeyStore, indexedDbKeyStore, type SecureStorage } from './keystore.js';
