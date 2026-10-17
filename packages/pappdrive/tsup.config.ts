import { defineConfig } from "tsup"

// The protocol package is private to this repo, so it is bundled in. Real dependencies stay external.
export default defineConfig({
  entry: { node: "src/node/index.ts", browser: "src/browser/index.ts", ui: "src/ui/index.ts" },
  format: "esm",
  dts: true,
  clean: true,
  target: "es2022",
  noExternal: ["@pappdrive/protocol"],
  external: ["@parcel/watcher", "@napi-rs/keyring", "hash-wasm", "ignore"],
})
