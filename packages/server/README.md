# @pappdrive/server

The Pappdrive server: one Cloudflare Worker (`src/index.ts`), a D1 database,
the R2 bucket, and one Durable Object per folder (`FolderQueue`) that runs
commits, the daily sweep and folder deletion one at a time, and holds the
`/index/watch` WebSockets it tells about each commit.

There is no local copy of the server and no test bucket. Development deploys
to the real Worker and `pappdrive-prod`. Test with a separate test account,
never the real one.

This project has a Wrangler config (`wrangler.jsonc`), so use `wrangler` for
everything below, not the `cf` CLI. Run the commands from `packages/server`.

## One-time setup

1. Sign in: `pnpm wrangler login`. The account needs a `workers.dev` subdomain
   (Workers & Pages, Account details), or the deploy fails with error 10063.

2. D1, in Western Europe, then apply the schema:

   ```sh
   pnpm wrangler d1 create pappdrive --location weur
   # paste the printed database_id into wrangler.jsonc (d1_databases[0].database_id)
   pnpm wrangler d1 migrations apply pappdrive --remote
   ```

3. The bucket, in Western Europe:

   ```sh
   pnpm wrangler r2 bucket create pappdrive-prod --location weur
   ```

   The location hint only applies when the bucket is created. Blobs, the delta and the
   checkpoints go through the Worker, so the bucket needs no CORS rules and no API
   token.

4. The access token key (HS256). Any long random string:

   ```sh
   openssl rand -base64 32 | pnpm wrangler secret put TOKEN_KEY
   ```

5. Email sending, for the sign-up codes. Onboard the domain in Email Service
   (Cloudflare adds the SPF, DKIM and DMARC records on `cf-bounce.<domain>`):

   ```sh
   cf email-sending subdomains create --zone pappdrive.com --name pappdrive.com
   ```

   The `EMAIL` binding in `wrangler.jsonc` sends from `noreply@pappdrive.com`.

6. Deploy: `pnpm run deploy`. The Workers Paid plan is required (CPU time for
   large commits and sweeps). The Worker answers on `sync.pappdrive.com`, the
   custom domain in `wrangler.jsonc` `routes`; the zone must be on Cloudflare.
   Another instance changes the pattern to its own hostname.

## Schema

`src/shared/schema.ts` defines the tables. After changing it, generate a
migration and apply it:

```sh
pnpm db:generate --name <change>
pnpm wrangler d1 migrations apply pappdrive --remote
```

## Plans

A plan is a row in `plans`: `id` and `quota_bytes`, the storage of all of an
account's apps together. `migrations/0001_plans.sql` seeds `free`, `plus` and
`pro`; new accounts start on `free`.

```sh
# change a plan for everyone on it
pnpm wrangler d1 execute pappdrive --remote --command "UPDATE plans SET quota_bytes = 2000000000 WHERE id = 'free'"
# a special customer: a plan of their own
pnpm wrangler d1 execute pappdrive --remote --command "INSERT INTO plans (id, quota_bytes) VALUES ('acme', 5000000000000)"
pnpm wrangler d1 execute pappdrive --remote --command "UPDATE users SET plan = 'acme' WHERE email = 'it@acme.com'"
```

A folder's size is the sum of its blob sizes in the index header, kept in
`apps.bytes` after each commit. A commit that grows the account past its quota
answers `507 over-quota`; one that shrinks a folder always goes through.

## Email verification

Sign-up emails a 6-digit code: an HMAC of the user id and the hour under
`TOKEN_KEY`, so nothing is stored. A code is valid in its hour and the next.
`POST /auth/verify` sets `users.verified`; `POST /auth/verify/send` sends a new
code. Until then every write (blob upload, commit) answers `403 unverified`.
Rotating `TOKEN_KEY` voids codes already sent.

## Rotating TOKEN_KEY

Copy the current value into `TOKEN_KEY_OLD`, put a new `TOKEN_KEY`, deploy.
New tokens are signed with the new key; both are accepted. After an hour
(the access token lifetime), delete `TOKEN_KEY_OLD`.

## Scripts

- `pnpm typecheck`
- `pnpm test`: plain vitest, no Workers runtime: tokens, credentials,
  validation, and the folder queue's logic
  (`src/folder-queue/`: delta and checkpoint commits, checkpoint thinning, sweep,
  folder deletion, watch-socket notification) against an in-memory bucket.
  The Durable Object in `src/folder-queue/index.ts` only queues calls into
  it and accepts the sockets.
- `pnpm build`: `wrangler deploy --dry-run --outdir dist`. Bundles only.
- `pnpm run deploy`: the real deploy. The operator runs it.

## Rate limits

`RL_UPLOAD`: 600 blob uploads per minute per account, on `PUT /blobs`.

`RL_EMAIL` (20 per minute per email) and `RL_IP` (60 per minute per IP), on
`/auth/params`, `/auth/signup`, `/auth/login`, `/auth/recover`, `/auth/verify`,
`/auth/verify/send`, `/app/delete`
and `/account/delete`. They count per Cloudflare location. A sign-in calls
`/auth/params` and then `/auth/login`, so it uses two. Change the numbers in
`wrangler.jsonc`. The period must be 10 or 60 seconds; the server answers
`Retry-After: 60`.
