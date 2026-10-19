#!/usr/bin/env node
import { createPapp, SyncError } from 'pappdrive';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';

const APP = 'notes';

function option(name, envName) {
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1) {
    const value = process.argv[i + 1];
    process.argv.splice(i, 2);
    return value;
  }
  return process.env[envName];
}

const server = option('server', 'PAPPDRIVE_SERVER');
const folder = option('folder', 'NOTES_FOLDER');
const [command, ...args] = process.argv.slice(2);

const usage = `usage: notes [--server <url>] [--folder <dir>] <command>
  add <text...>   add a note
  list            list notes, newest first
  show <name>     print a note
  sync            sync now`;

function newName(text) {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const slug = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `notes/${stamp}${slug ? '-' + slug : ''}.md`;
}

async function trySync(files) {
  try {
    await files.sync();
    return true;
  } catch (err) {
    if (err instanceof SyncError && (err.code === 'network' || err.code === 'server')) {
      console.error('(offline: saved on this computer, will sync next time)');
      return false;
    }
    throw err;
  }
}

async function noteNames(files) {
  const notes = (await files.list('notes')).filter(f => !f.dir && f.path.endsWith('.md'));
  return notes.map(f => f.path.slice('notes/'.length)).sort((a, b) => b.localeCompare(a));
}

async function signIn(papp) {
  let muted = false;
  const output = new Writable({
    write(chunk, encoding, done) {
      if (!muted) process.stdout.write(chunk, encoding);
      done();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  const email = await rl.question('Email: ');
  process.stdout.write('Password: ');
  muted = true;
  const password = await rl.question('');
  muted = false;
  process.stdout.write('\n');
  rl.close();
  await papp.signIn(email, password);
}

async function main() {
  if (!command || command === 'help' || command === '--help') {
    console.log(usage);
    return;
  }
  if (!server) throw new Error('Set PAPPDRIVE_SERVER or pass --server <url>, e.g. https://sync.pappdrive.com');

  const papp = createPapp({ server, app: APP });
  await papp.ready;
  if (!papp.signedIn) await signIn(papp);

  const files = await papp.open(folder ? { mode: 'visible', path: folder.replace(/^~(?=\/|$)/, homedir()) } : { mode: 'private' });

  switch (command) {
    case 'add': {
      const text = args.join(' ').trim();
      if (!text) throw new Error('Nothing to add. Usage: notes add <text...>');
      const path = newName(text);
      await files.write(path, text + '\n');
      await trySync(files);
      console.log(path.slice('notes/'.length));
      break;
    }
    case 'list': {
      await trySync(files);
      const notes = await noteNames(files);
      for (const name of notes) {
        const first = (await files.readText('notes/' + name)).split('\n')[0].slice(0, 60);
        console.log(`${name.padEnd(48)}  ${first}`);
      }
      if (notes.length === 0) console.log('No notes yet. Add one: notes add <text>');
      break;
    }
    case 'show': {
      const name = args.join(' ');
      if (!name) throw new Error('Which note? Usage: notes show <name>');
      await trySync(files);
      const notes = await noteNames(files);
      const matches = notes.includes(name) ? [name] : notes.filter(n => n.startsWith(name));
      if (matches.length === 0) throw new Error(`No note starts with "${name}". See: notes list`);
      if (matches.length > 1) throw new Error(`"${name}" matches ${matches.length} notes:\n  ${matches.join('\n  ')}`);
      process.stdout.write(await files.readText('notes/' + matches[0]));
      break;
    }
    case 'sync': {
      if (await trySync(files)) {
        const s = files.status;
        console.log(`synced${s.pending ? `, ${s.pending} change(s) still waiting` : ''}${s.skipped.length ? `, skipped: ${s.skipped.join(', ')}` : ''}`);
      }
      break;
    }
    default:
      throw new Error(`Unknown command "${command}".\n${usage}`);
  }
  return papp;
}

main().then(
  async papp => {
    await papp?.close();
    process.exit(0);
  },
  err => {
    if (err instanceof SyncError && err.code === 'no-app') {
      console.error(`${err.message}\nCreate the app once with: pappdrive apps create ${APP}`);
    } else {
      console.error(err instanceof Error ? err.message : err);
    }
    process.exit(1);
  }
);
