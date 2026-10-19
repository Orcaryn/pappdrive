import { spawnSync } from 'node:child_process';

const checks = process.argv.slice(2);
const failed = checks.filter(check => spawnSync('pnpm', [check], { stdio: 'inherit' }).status !== 0);

if (failed.length > 0) {
  console.error(`\nfailed: ${failed.join(', ')}`);
  process.exit(1);
}

console.log(`\npassed: ${checks.join(', ')}`);
