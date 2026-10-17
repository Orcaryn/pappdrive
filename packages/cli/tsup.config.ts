import { defineConfig } from "tsup"

// One file. The library's internals are bundled in; its native and npm dependencies stay external.
export default defineConfig({
  entry: { main: "src/main.ts" },
  format: "esm",
  platform: "node",
  target: "node20",
  clean: true,
  banner: { js: "#!/usr/bin/env node" },
  noExternal: ["@pappdrive/protocol"],
  external: ["@parcel/watcher", "@napi-rs/keyring", "hash-wasm", "ignore"],
})
