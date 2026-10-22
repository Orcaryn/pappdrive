import { defineConfig } from 'tsup';

const external = ['@parcel/watcher', '@napi-rs/keyring', 'hash-wasm', 'ignore', 'fflate'];

export default defineConfig([
  {
    entry: { node: 'src/node/index.ts', browser: 'src/browser/index.ts', core: 'src/core.ts', rpc: 'src/rpc/index.ts' },
    format: 'esm',
    dts: { resolve: ['@pappdrive/protocol'] },
    clean: true,
    target: 'es2022',
    noExternal: ['@pappdrive/protocol'],
    external,
  },
  { entry: { cli: 'src/cli/main.ts' }, format: 'esm', platform: 'node', target: 'node22', banner: { js: '#!/usr/bin/env node' }, noExternal: ['@pappdrive/protocol'], external },
  {
    entry: { embedded: 'src/embedded/index.ts' },
    format: 'iife',
    globalName: 'pappdrive',
    platform: 'browser',
    target: 'es2022',
    noExternal: [/.*/],
    outExtension: () => ({ js: '.js' }),
  },
]);
