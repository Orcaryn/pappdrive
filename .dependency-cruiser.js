import { basename } from 'node:path';

const packageName = basename(process.cwd());
const isProtocol = packageName === 'protocol';
const isPappdrive = packageName === 'pappdrive';
const isServer = packageName === 'server';

const workspaceRules = [
  { name: 'no-circular-dependencies', severity: 'error', from: {}, to: { circular: true } },
  { name: 'no-unresolvable-dependencies', severity: 'error', from: {}, to: { couldNotResolve: true, pathNot: '^cloudflare:' } },
  ...(isProtocol ? [{ name: 'protocol-does-not-import-packages', severity: 'error', from: { path: '^src/' }, to: { path: '^[.][.]/' } }] : []),
  ...(isServer ? [{ name: 'server-does-not-import-clients', severity: 'error', from: { path: '^src/' }, to: { path: '^[.][.]/pappdrive/' } }] : []),
  ...(isPappdrive ? [{ name: 'pappdrive-does-not-import-server', severity: 'error', from: { path: '^src/' }, to: { path: '^[.][.]/server/' } }] : []),
];

const pappdriveRules =
  isPappdrive ?
    [
      { name: 'shared-does-not-import-the-library', severity: 'error', from: { path: '^src/shared/' }, to: { path: '^src/(papp|node|browser|rpc|embedded)/' } },
      { name: 'papp-does-not-import-platforms', severity: 'error', from: { path: '^src/papp/' }, to: { path: '^src/(node|browser|rpc|embedded)/' } },
      { name: 'rpc-imports-only-shared', severity: 'error', from: { path: '^src/rpc/' }, to: { path: '^src/(papp|node|browser|embedded)/' } },
      { name: 'node-does-not-import-browser', severity: 'error', from: { path: '^src/node/' }, to: { path: '^src/(browser|embedded)/' } },
      { name: 'browser-does-not-import-node', severity: 'error', from: { path: '^src/browser/' }, to: { path: '^src/(node|embedded)/' } },
      { name: 'embedded-does-not-import-node', severity: 'error', from: { path: '^src/embedded/' }, to: { path: '^src/node/' } },
      { name: 'library-does-not-import-cli', severity: 'error', from: { path: '^src/(papp|shared|node|browser|rpc|embedded)/' }, to: { path: '^src/cli/' } },
      { name: 'cli-does-not-import-browser', severity: 'error', from: { path: '^src/cli/' }, to: { path: '^src/browser/' } },
    ]
  : [];

const config = {
  forbidden: [...workspaceRules, ...pappdriveRules],
  options: {
    doNotFollow: { path: 'node_modules' },
    enhancedResolveOptions: { exportsFields: ['exports'], conditionNames: ['import', 'require', 'node', 'default', 'types'], mainFields: ['module', 'main', 'types', 'typings'] },
    moduleSystems: ['es6', 'cjs'],
  },
};

export default config;
