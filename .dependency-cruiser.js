import { basename } from 'node:path';

const packageName = basename(process.cwd());
const isProtocol = packageName === 'protocol';
const isPappdrive = packageName === 'pappdrive';

const workspaceRules = [
  { name: 'no-circular-dependencies', severity: 'error', from: {}, to: { circular: true } },
  { name: 'no-unresolvable-dependencies', severity: 'error', from: {}, to: { couldNotResolve: true, pathNot: '^cloudflare:' } },
  ...(isProtocol ? [{ name: 'protocol-does-not-import-packages', severity: 'error', from: { path: '^src/' }, to: { path: '^[.][.]/' } }] : []),
];

const pappdriveRules =
  isPappdrive ?
    [
      { name: 'shared-does-not-import-the-library', severity: 'error', from: { path: '^src/shared/' }, to: { path: '^src/(papp|node|browser)/' } },
      { name: 'papp-does-not-import-platforms', severity: 'error', from: { path: '^src/papp/' }, to: { path: '^src/(node|browser)/' } },
      { name: 'node-does-not-import-browser', severity: 'error', from: { path: '^src/node/' }, to: { path: '^src/browser/' } },
      { name: 'browser-does-not-import-node', severity: 'error', from: { path: '^src/browser/' }, to: { path: '^src/node/' } },
      { name: 'library-does-not-import-cli', severity: 'error', from: { path: '^src/(papp|shared|node|browser)/' }, to: { path: '^src/cli/' } },
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
