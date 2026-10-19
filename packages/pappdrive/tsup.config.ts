import { defineConfig } from 'tsup';

const external = ['@parcel/watcher', '@napi-rs/keyring', 'hash-wasm', 'ignore'];

export default defineConfig([
  { entry: { node: 'src/node/index.ts', browser: 'src/browser/index.ts' }, format: 'esm', dts: true, clean: true, target: 'es2022', noExternal: ['@pappdrive/protocol'], external },
  { entry: { cli: 'src/cli/main.ts' }, format: 'esm', platform: 'node', target: 'node22', banner: { js: '#!/usr/bin/env node' }, noExternal: ['@pappdrive/protocol'], external },
]);
