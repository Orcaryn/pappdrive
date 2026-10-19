# Pappdrive

Pappdrive gives a personal app one folder of plain files that stays the same on every device its user owns. The app reads and writes files; the library syncs them in the background, works offline, and encrypts everything on the device, so the server and the storage see only encrypted bytes. It is for apps a person builds for themselves, usually through a coding agent: "make me a journal that syncs between my Mac and my laptop" should give a working app without anyone thinking about a server.

```ts
import { createPapp } from "pappdrive"

const papp = createPapp({ server: "https://sync.example.com", app: "journal" })
await papp.ready
if (!papp.signedIn) await papp.signIn(email, password) // from the app's own form
const files = await papp.open({ mode: "private" })
await files.write("2026-10-17.md", "# Friday\n")
files.watch(change => console.log(change.origin, change.path))
```

## Docs

- [docs/api.md](docs/api.md): the whole API and every rule an app must follow, on one page. Start here.
- [docs/llms.txt](docs/llms.txt): entry point for coding agents.
- [docs/skill/SKILL.md](docs/skill/SKILL.md): a Claude Code skill. [docs/AGENTS-block.md](docs/AGENTS-block.md): a block for `AGENTS.md` or `CLAUDE.md`.
- [packages/server/README.md](packages/server/README.md): operator setup (Cloudflare Worker, R2, D1).
- Design spec: `~/git/Writings/Pappdrive/` (overview, storage, index, server, client, sync, encryption, cleanup, limits, implementation).

## Layout

| Path                        | npm name    | What                                                                                                                                                                                                                                                      |
| --------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/pappdrive`        | `pappdrive` | The library, and the `pappdrive` command: `signup`, `login`, `logout`, `apps list`, `apps create <name>`, `export <app> <dir>`, `delete-app <name>`, `delete-account`. Entry point `pappdrive`: node and browser adapters, picked by `exports` conditions |
| `packages/server`           | private     | The Cloudflare Worker: sign-in, blobs, index commits, cleanup                                                                                                                                                                                             |
| `packages/protocol`         | private     | Types and constants shared by the library and the server                                                                                                                                                                                                  |
| `examples/journal-electron` |             | Electron journal, visible folder `~/Journal`                                                                                                                                                                                                              |
| `examples/notes-cli`        |             | Command-line notes                                                                                                                                                                                                                                        |
| `examples/journal-web`      |             | Web journal (Vite), private folder                                                                                                                                                                                                                        |
| `docs`                      |             | Docs for builders and their agents                                                                                                                                                                                                                        |

The examples are not part of the pnpm workspace. Each has its own `package.json` that depends on `pappdrive` from npm.

## Status

Built, not yet deployed. No public server exists yet, and the packages are not yet published to npm. Before anyone else's data is stored, a per-user quota and an upload rate limit must exist (see the spec, Limits).

## Development

```sh
pnpm install
pnpm typecheck
pnpm test
```
