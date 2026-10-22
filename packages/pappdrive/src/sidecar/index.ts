import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { nodePlatform } from '../node/platform.js';
import { createPappCore } from '../papp/index.js';
import { createChannel } from '../rpc/channel.js';
import { hostKeyStore } from '../rpc/host-keystore.js';
import { serve } from '../rpc/serve.js';
import type { HostMethods, PappEvents, PappMethods } from '../rpc/types.js';

const USAGE = `usage: pappdrived --server <url> --app <name> [--read <app>,<app>] [--sync-on-background]

Runs the pappdrive engine for one app. Requests come in on stdin, one JSON message per line; replies, events and the
engine's own requests (host.keystore.*) go out on stdout the same way. The envelope is documented in docs/hosts.md.
`;
const { values } = parseArgs({
  options: { server: { type: 'string' }, app: { type: 'string' }, read: { type: 'string' }, 'sync-on-background': { type: 'boolean' } },
  strict: true,
});

if (values.server === undefined || values.app === undefined) {
  process.stderr.write(USAGE);
  process.exit(2);
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
const channel = createChannel<PappEvents & HostMethods, PappMethods>({
  send: text => {
    process.stdout.write(text + '\n');
  },
  onMessage: cb => lines.on('line', cb),
});
const papp = createPappCore(
  { server: values.server, app: values.app, read: values.read?.split(','), syncOnBackground: values['sync-on-background'] },
  nodePlatform,
  hostKeyStore(channel)
);
serve(papp, channel);
lines.on('close', () => {
  void papp.close().then(
    () => process.exit(0),
    (e: unknown) => {
      console.error(e);
      process.exit(1);
    }
  );
});
await papp.ready;
channel.notify('ready', {});
