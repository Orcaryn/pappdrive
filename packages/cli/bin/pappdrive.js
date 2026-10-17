#!/usr/bin/env node
// Runs the TypeScript sources directly, with no build step (Node 23.6 or later; Node 24 recommended).
// Node's own type stripping is not quite enough here, for two reasons:
//   - the sources import "./x.js", the TypeScript convention, while the file on disk is x.ts;
//   - some library files use TypeScript-only syntax (parameter properties) that plain stripping refuses.
// So this file adds a resolve hook (x.js -> x.ts when x.js does not exist) and a load hook that
// transforms .ts files with node:module's stripTypeScriptTypes in "transform" mode.
import { readFileSync } from "node:fs"
import * as mod from "node:module"
import { fileURLToPath, pathToFileURL } from "node:url"

if (typeof mod.registerHooks !== "function" || typeof mod.stripTypeScriptTypes !== "function") {
  process.stderr.write(`pappdrive needs Node 23.6 or later (this is ${process.version}). Install a newer Node, such as Node 24.\n`)
  process.exit(1)
}

// stripTypeScriptTypes is marked experimental; keep its warning out of the tool's output.
const emit = process.emitWarning
process.emitWarning = (warning, ...rest) => {
  const text = typeof warning === "string" ? warning : warning?.message
  if (/stripTypeScriptTypes|Type Stripping/i.test(String(text))) return
  return emit.call(process, warning, ...rest)
}

mod.registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (e) {
      if (e?.code === "ERR_MODULE_NOT_FOUND" && specifier.endsWith(".js") && /^(\.{1,2}\/|file:)/.test(specifier)) {
        return nextResolve(specifier.slice(0, -3) + ".ts", context)
      }
      throw e
    }
  },
  load(url, context, nextLoad) {
    if (url.startsWith("file:") && url.endsWith(".ts") && !url.includes("/node_modules/")) {
      const source = mod.stripTypeScriptTypes(readFileSync(fileURLToPath(url), "utf8"), { mode: "transform", sourceUrl: url })
      return { format: "module", source, shortCircuit: true }
    }
    return nextLoad(url, context)
  },
})

const { main } = await import(pathToFileURL(fileURLToPath(new URL("../src/main.ts", import.meta.url))).href)
process.exitCode = await main(process.argv.slice(2))
