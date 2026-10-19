# 9. Limits and guidance
## Limits
- **No size limit per file.** Files over 16 MiB are cut into 16 MiB parts. See [Index](03-index.md).
- **Size limit per blob: 16 MiB.** A blob is encrypted whole, in memory, so the limit keeps memory small on phones. The server refuses a link above it, and R2 stores no more bytes than the link says. The exact byte counts are in [Implementation details](12-implementation.md). Nothing for the builder to set.
- Until the quota exists, nothing limits how big a file can be.
- **Not set yet: a per-user quota and a limit on upload links per hour.** One user needs neither. Both must exist before other users store data.
  - Quota: the sum of the sizes in the index header. The commit already checks each size against R2.
  - Upload limit: stops a broken or hostile client from filling the bucket.
- **One commit per second per index.** R2 rate-limits writes to one key. Fine for one person.
## The agent is the builder
- Most builders work through a coding agent, like Claude Code. The agent reads the docs, picks the library, and writes the app. The person may never read the docs.
- So the docs and the library are written for the agent first:
  - An `llms.txt` at the docs root, and one page with the whole API and every rule an app must follow. It fits in one read.
  - A Claude Code skill, and a short block for `AGENTS.md` or `CLAUDE.md`, that the builder drops into a project.
  - Working examples for each platform: an Electron app, a command-line tool, a web app. Agents copy examples.
  - Error messages that say how to fix the problem. See [Implementation details](12-implementation.md).
- The docs tell the agent what every app must handle:
  - Conflict copies show up as normal files. The app must not break on them.
  - Build output, caches and logs go in `.pappignore`.
  - One file per record. See Builder guidance below.
  - Create the app first, with the command-line tool. It also signs up a new user. Then the app signs in with the library's sign-in form. It shows the recovery code and does not let the user skip it.
  - Phones and browsers sync only while the app is open.
- The test: a person asks their agent "make me a journal that syncs between my Mac and my laptop", and gets a working app without ever thinking about a server.
## Builder guidance
- **One file per record.** One JSON file per note, not one database file.
- Every change to a big file uploads at least one 16 MiB part, often more. A conflict copy of a database helps nobody.
- **If an app truly needs a database:** do not sync the database. Each device appends change files, `changes/<install-id>/<n>`. Every device rebuilds the database locally from everyone's changes. Paths unique per device, so nothing conflicts. Documented, not built.
- **Browser:** the library's sign-in form, inside the app. No background after the tab closes. One tab syncs.
- **Phones:** sync only while the app is open.
## Out of scope
- Merging inside a file.
- Queries across files.
- Downloading on demand instead of mirroring everything.
- Share links.
- An unencrypted mode per app. It would make share links and downloading on demand simple: plain URLs that any browser can open. Every folder is encrypted for now. Adding an unencrypted mode later is easy. Encrypting data that was already stored in plain form would not be.
- Native iOS and Android libraries, until asked.
- A "take control" lease, until conflict copies actually show up.
- Backups and long-term file history. Versions are kept for a week: every commit from the last hour, then one per day. See [Cleanup](08-cleanup.md).
- A visible folder in the browser.
## Open questions
- A price for users.
- The quota number.
- The upload link rate limit.
## Cost
- Server: $5 a month, the Workers Paid plan.
- The plan includes 10 million requests a month. Reads go straight to R2, so the server sees only sign-ins, token refreshes, links, and commits.
- A busy device makes about 5,000 server calls a month. So $5 covers several hundred users with three devices each. After that: $0.30 per extra million requests.
- D1 and Durable Objects stay inside the plan's included amounts at this size.
- The Free plan is too small. It allows 10 ms of CPU per request. A commit on a large index, or a sweep on a large folder, needs more.
- Storage: free for a single user, within R2's free tier.
- A hundred users with a few gigabytes each: a few dollars a month of storage on top. Polling is inside R2's free tier until thousands of devices.
