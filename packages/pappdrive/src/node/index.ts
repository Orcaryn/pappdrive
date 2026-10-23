import { HOSTED_SERVER } from '@pappdrive/protocol';
import { createPappCore } from '../papp/index.js';
import type { Papp, PappOptions } from '../shared/types.js';
import { nodeKeyStore } from './keystore.js';
import { nodePlatform } from './platform.js';

export function createPapp(opts: PappOptions): Papp {
  return createPappCore({ ...opts, server: opts.server ?? HOSTED_SERVER }, nodePlatform, opts.keyStore ?? nodeKeyStore());
}

export { SyncError } from '../shared/errors.js';
export type { SyncErrorCode } from '../shared/errors.js';
export type { Change, FileInfo, Files, KeyStore, Papp, PappOptions, Status, WriteData } from '../shared/types.js';
export { nodeKeyStore, type NodeKeyStoreOptions } from './keystore.js';
