import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ignoreRules } from '../src/papp/folder/scan/ignore.js';
import { openNodeFs } from '../src/node/fs.js';
import { loadParcelWatcher } from '../src/node/watcher.js';
import { must } from './helpers/must.js';

const scratch: string[] = [];
afterAll(() => scratch.forEach(d => rmSync(d, { recursive: true, force: true })));

const hasWatcher = (await loadParcelWatcher()) !== null;

describe.runIf(hasWatcher)('node watcher', () => {
  it('reports changed paths as relative NFC hints, and skips ignored folders', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pappdrive-watch-'));
    scratch.push(root);
    const fs = await openNodeFs(root, 'visible');
    mkdirSync(join(root, 'node_modules'));
    const seen = new Set<string>();
    let dropped = 0;
    const stop = await must(fs.watch)(
      ignoreRules().watcherSkipGlobs(),
      ps => ps.forEach(p => seen.add(p)),
      () => dropped++
    );
    try {
      await new Promise(r => setTimeout(r, 300));
      mkdirSync(join(root, 'notes'));
      writeFileSync(join(root, 'notes', 'Café.md'.normalize('NFD')), 'x');
      writeFileSync(join(root, 'node_modules', 'dep.js'), 'x');
      await fs.saveState('synced', '{}');
      const until = Date.now() + 5000;
      while (!seen.has('notes/Café.md'.normalize('NFC')) && Date.now() < until) {
        await new Promise(r => setTimeout(r, 50));
      }

      await new Promise(r => setTimeout(r, 300));
    } finally {
      await stop();
    }

    expect(seen.has('notes/Café.md'.normalize('NFC'))).toBe(true);
    expect([...seen].some(p => p.startsWith('node_modules'))).toBe(false);
    expect([...seen].some(p => p.startsWith('.pappdrive'))).toBe(false);
    expect(dropped).toBe(0);
  });
});
