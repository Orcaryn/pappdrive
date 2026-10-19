import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('..', import.meta.url));
const workspace = process.argv[2];
const cruise = spawnSync(join(repository, 'node_modules/.bin/depcruise'), ['--config', join(repository, '.dependency-cruiser.js'), '--ts-config', 'tsconfig.json', 'src'], {
  cwd: join(repository, workspace),
  encoding: 'utf8',
  env: { ...process.env, FORCE_COLOR: process.stdout.isTTY ? '1' : '0' },
});

process.stdout.write(cruise.stdout);
process.stderr.write(cruise.stderr);

// dependency-cruiser's `err` reporter ends both its pass and its fail summary with `<n> modules, <n> dependencies cruised`.
const cruised = /(\d+) modules, \d+ dependencies cruised/.exec(cruise.stdout);

if (!cruised) {
  throw new Error(`${workspace}: dependency-cruiser reported no module count, so nothing was checked.`);
}

if (cruised[1] === '0') {
  throw new Error(
    `${workspace}: dependency-cruiser cruised 0 modules, so every rule passed vacuously. It cannot load a TypeScript compiler in the supported range, or the entry path is wrong.`
  );
}

process.exit(cruise.status);
