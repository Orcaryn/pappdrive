# pappdrive

One folder of plain files that stays the same on every device of its user. The app reads and writes files; the library syncs them in the background, works offline, and encrypts everything on the device, so the server sees only encrypted bytes.

For personal apps, usually built through a coding agent: "make me a journal that syncs between my Mac and my laptop".

## Install

```sh
npm install pappdrive
```

## Create the app

In your own terminal, because it asks for a password:

```sh
export PAPPDRIVE_SERVER=https://sync.pappdrive.com
npx pappdrive signup --app journal
```

It shows a recovery code once. Keep it: nobody can recover your password, only your other devices or that code. Then enter the 6-digit code from the sign-up email.

## Use it

```ts
import { createPapp } from "pappdrive"

const papp = createPapp({ server: "https://sync.pappdrive.com", app: "journal" })
await papp.ready
if (!papp.signedIn) await papp.signIn(email, password) // from the app's own form
const files = await papp.open({ mode: "private" })
await files.write("2026-10-17.md", "# Friday\n")
files.watch(change => console.log(change.origin, change.path))
```

On desktop, `papp.open({ mode: "visible", path: "~/Journal" })` syncs a real folder the user can see.

## Docs

Shipped in this package under `docs/`:

- [api.md](https://github.com/Orcaryn/pappdrive/blob/main/docs/api.md): the whole API and every rule an app must follow. Start here.
- [hosts.md](https://github.com/Orcaryn/pappdrive/blob/main/docs/hosts.md): native iOS, Android and non-JavaScript desktop apps.
- [skill/SKILL.md](https://github.com/Orcaryn/pappdrive/blob/main/docs/skill/SKILL.md): a Claude Code skill. Copy it with `api.md` and `hosts.md` into `.claude/skills/pappdrive/`.
- [llms.txt](https://github.com/Orcaryn/pappdrive/blob/main/docs/llms.txt): entry point for coding agents.

## License

MIT
