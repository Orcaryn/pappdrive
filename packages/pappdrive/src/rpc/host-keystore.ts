import type { KeyStore } from '../shared/types.js';
import type { Channel } from './channel.js';
import type { HostMethods, MethodMap } from './types.js';

/** The host keeps the session and the data key: it answers host.keystore.* with its own secure storage. */
export function hostKeyStore(channel: Channel<HostMethods, MethodMap>): KeyStore {
  return {
    get: name => channel.request('host.keystore.get', { name }),
    set: (name, value) => channel.request('host.keystore.set', { name, value }),
    delete: name => channel.request('host.keystore.delete', { name }),
  };
}
