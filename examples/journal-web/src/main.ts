import { createPapp, SyncError, type Change, type Status } from 'pappdrive';
import './style.css';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const editor = $<HTMLTextAreaElement>('editor');
const papp = createPapp({ app: 'journal' });

const ignoreNotFound = (e: unknown) => {
  if (!(e instanceof SyncError && e.code === 'not-found')) {
    throw e;
  }
};

const LOCAL_ISO_DATE_LOCALE = 'en-CA';
const today = () => new Date().toLocaleDateString(LOCAL_ISO_DATE_LOCALE) + '.md';
let current: string | null = null;
let dirty = false;
let lastSaved = '';
let saveTimer: ReturnType<typeof setTimeout> | undefined = undefined;

function label(name: string): string {
  const base = name.slice(0, -3);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(base);

  if (!m) {
    return base;
  }

  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));

  return d.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
}

const readEntry = (name: string) =>
  papp.files.readText(name).catch((e: unknown) => {
    ignoreNotFound(e);

    return '';
  });

async function refreshList() {
  const entries = (await papp.files.list()).filter(e => !e.dir && e.path.endsWith('.md'));
  const names = entries.map(e => e.path).sort((a, b) => b.localeCompare(a));

  if (current && !names.includes(current)) {
    names.unshift(current);
  }

  const list = $('entries');
  list.replaceChildren();

  for (const name of names) {
    const li = document.createElement('li');
    li.textContent = label(name);
    li.title = name;

    if (name.includes('(conflict ')) {
      li.classList.add('conflict');
    }

    if (name === current) {
      li.classList.add('current');
    }

    li.onclick = () => void select(name).catch(showError);
    list.append(li);
  }
}

async function select(name: string) {
  await saveNow();
  current = name;
  $('title').textContent = label(name);
  lastSaved = await readEntry(name);
  editor.value = lastSaved;
  dirty = false;
  hideNotice();
  await refreshList();
}

async function saveNow() {
  clearTimeout(saveTimer);

  if (!current || !dirty) {
    return;
  }

  dirty = false;
  const text = editor.value;
  lastSaved = text;

  if (text === '') {
    await papp.files.remove(current).catch(ignoreNotFound);
  } else {
    await papp.files.write(current, text);
  }
}

editor.addEventListener('input', () => {
  dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void saveNow().catch(showError), 800);
});
editor.addEventListener('blur', () => void saveNow().catch(showError));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    void saveNow().catch(showError);
  }
});

$('today').onclick = () => void select(today()).catch(showError);
$('delete').onclick = () => void deleteEntry().catch(showError);

async function deleteEntry() {
  if (!current || !confirm(`Delete ${current} on every device?`)) {
    return;
  }

  dirty = false;
  await papp.files.remove(current).catch(ignoreNotFound);
  await select(today());
}

$('sync').onclick = () => void papp.files.sync().catch(showError);
$('signout').onclick = () => void signOut().catch(showError);

async function signOut() {
  if (!confirm('Sign out? Keep your password or recovery code: you need one of them to sign in again.')) {
    return;
  }

  await saveNow();
  await papp.signOut();
  location.reload();
}

async function onChange(change: Change) {
  await refreshList();

  if (change.origin === 'conflict') {
    showNotice(`"${change.path}" was edited on two devices. The other device's version kept the name. This one's is now "${change.copy}".`);
  } else if (change.origin === 'skipped') {
    showNotice(`"${change.path}" cannot be saved on this device (bad name). Your other devices keep it.`);
  }

  if (change.path !== current) {
    return;
  }

  const text = await readEntry(current);

  if (text === lastSaved || text === editor.value) {
    return;
  }

  lastSaved = text;

  if (!dirty) {
    editor.value = text;

    return;
  }

  showNotice('This day changed on another device while you were typing. Your text is kept.', {
    label: 'Load the other version',
    run: () => {
      dirty = false;
      editor.value = text;
      hideNotice();
    },
  });
}

function renderStatus(s: Status) {
  if (s.deleted) {
    alert(s.deleted === 'account' ? 'Your account was deleted.' : 'This journal was deleted on another device.');
    location.reload();

    return;
  }

  const skipped = s.skipped.length > 0 ? ` · ${s.skipped.length} skipped` : '';
  $('status').textContent = statusText(s) + skipped;
}

function statusText(s: Status): string {
  if (s.syncing) {
    return 'Syncing…';
  } else if (s.error) {
    return `Not synced: ${s.error}`;
  } else if (s.pending > 0) {
    return `${s.pending} change${s.pending === 1 ? '' : 's'} waiting`;
  } else if (s.lastSync) {
    return `Synced ${new Date(s.lastSync).toLocaleTimeString()}`;
  }

  return 'Not synced yet';
}

function showNotice(text: string, action?: { label: string; run: () => void }) {
  $('notice-text').textContent = text;
  const button = $<HTMLButtonElement>('notice-action');
  button.hidden = !action;

  if (action) {
    button.textContent = action.label;
    button.onclick = action.run;
  }

  $('notice').hidden = false;
}

function hideNotice() {
  $('notice').hidden = true;
}

function showError(err: unknown) {
  showNotice(err instanceof Error ? err.message : String(err));
}

$('notice-close').onclick = hideNotice;

async function signIn() {
  const signUp = (await papp.pendingSignUp()) ?? (await accountForm());

  if (signUp) {
    await recoveryCodeSaved(signUp.recoveryCode);
    await papp.confirmRecoveryCode();
    await emailConfirmed();
  }
}

function accountForm(): Promise<{ recoveryCode: string } | void> {
  const email = $<HTMLInputElement>('email');
  const password = $<HTMLInputElement>('password');
  const code = $<HTMLInputElement>('code');

  return new Promise(resolve => {
    const attempt = (action: Promise<{ recoveryCode: string } | void>) => void action.then(resolve, (err: Error) => ($('sign-in-error').textContent = err.message));

    $<HTMLFormElement>('sign-in').onsubmit = event => {
      event.preventDefault();
      attempt(code.value ? papp.recover(email.value, code.value, password.value) : papp.signIn(email.value, password.value));
    };

    $('sign-up').onclick = () => attempt(papp.signUp(email.value, password.value));
  });
}

function recoveryCodeSaved(recoveryCode: string): Promise<void> {
  const lastGroup = recoveryCode.split('-').pop();
  $('sign-in').hidden = true;
  $('recovery').hidden = false;
  $('recovery-code').textContent = recoveryCode;

  return new Promise(resolve => {
    $('recovery-done').onclick = () => {
      if ($<HTMLInputElement>('recovery-check').value.trim().toUpperCase() === lastGroup) {
        resolve();
      }
    };
  });
}

function emailConfirmed(): Promise<void> {
  $('recovery').hidden = true;
  $('verify').hidden = false;

  return new Promise(resolve => {
    const fail = (err: Error) => ($('verify-error').textContent = err.message);
    $('verify-done').onclick = () => void papp.verifyEmail($<HTMLInputElement>('verify-code').value).then(resolve, fail);
    $('verify-resend').onclick = () => void papp.sendVerificationEmail().catch(fail);
  });
}

async function start() {
  await papp.ready;

  if (!papp.signedIn) {
    $('sign-in-screen').hidden = false;
    await signIn();
    $('sign-in-screen').hidden = true;
  }

  await papp.open({ mode: 'private' });
  papp.files.watch(change => void onChange(change).catch(showError));
  papp.files.onStatus(renderStatus);
  $('journal-screen').hidden = false;
  renderStatus(papp.files.status);
  await select(today());
}

start().catch(showError);
