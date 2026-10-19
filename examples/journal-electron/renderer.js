const j = window.journal;
const $ = id => document.getElementById(id);
const editor = $('editor');

function ignoreNotFound(err) {
  if (err.code !== 'not-found') throw err;
}

async function unwrap(promise) {
  const result = await promise;
  if (result.ok) return result.value;
  throw Object.assign(new Error(result.error.message), { name: 'SyncError', ...result.error });
}

const LOCAL_ISO_DATE_LOCALE = 'en-CA';
const today = () => new Date().toLocaleDateString(LOCAL_ISO_DATE_LOCALE) + '.md';
let current = null;
let dirty = false;
let saveTimer = null;
let lastSaved = '';

function label(name) {
  const base = name.slice(0, -3);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(base);
  if (!m) return base;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
}

async function refreshList() {
  const entries = await unwrap(j.list());
  const list = $('entries');
  list.replaceChildren();
  const names = entries.map(e => e.path);
  if (current && !names.includes(current)) names.unshift(current);
  for (const name of names) {
    const li = document.createElement('li');
    li.textContent = label(name);
    li.title = name;
    if (name.includes('(conflict ')) li.classList.add('conflict');
    if (name === current) li.classList.add('current');
    li.onclick = () => select(name);
    list.append(li);
  }
}

async function select(name) {
  await saveNow();
  current = name;
  $('title').textContent = label(name);
  lastSaved = await unwrap(j.read(name));
  editor.value = lastSaved;
  dirty = false;
  hideNotice();
  await refreshList();
}

async function saveNow() {
  clearTimeout(saveTimer);
  if (!current || !dirty) return;
  dirty = false;
  const text = editor.value;
  lastSaved = text;
  if (text === '') {
    await unwrap(j.remove(current)).catch(ignoreNotFound);
  } else {
    await unwrap(j.write(current, text));
  }
}

editor.addEventListener('input', () => {
  dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveNow().catch(showError), 800);
});
editor.addEventListener('blur', () => saveNow().catch(showError));
$('today').onclick = () => select(today()).catch(showError);
$('delete').onclick = () => deleteEntry().catch(showError);
async function deleteEntry() {
  if (!current || !confirm(`Delete ${current} on every computer?`)) return;
  dirty = false;
  await unwrap(j.remove(current)).catch(ignoreNotFound);
  await select(today());
}
$('sync').onclick = () => unwrap(j.sync()).catch(showError);
$('signout').onclick = () => signOut().catch(showError);
async function signOut() {
  if (!confirm('Sign out? Keep your password or recovery code: you need one of them to sign in again.')) return;
  await saveNow();
  await unwrap(j.signOut());
  location.reload();
}

j.onChange(async change => {
  await refreshList();
  if (change.origin === 'conflict') {
    showNotice(`"${change.path}" was edited on two computers. The other computer's version kept the name. Yours is now "${change.copy}".`);
  } else if (change.origin === 'skipped') {
    showNotice(`"${change.path}" cannot be saved on this computer (bad name). The other computers keep it.`);
  }
  if (change.path !== current) return;
  const text = await unwrap(j.read(current));
  if (text === lastSaved || text === editor.value) return;
  lastSaved = text;
  if (!dirty) {
    editor.value = text;
    return;
  }
  showNotice('This day changed somewhere else while you were typing. Your text is kept.', {
    label: 'Load the other version',
    run: () => {
      dirty = false;
      editor.value = text;
      hideNotice();
    },
  });
});

j.onStatus(renderStatus);

function renderStatus(s) {
  if (s.deleted) {
    alert(
      s.deleted === 'account' ?
        'Your account was deleted. The files in ~/Journal stay on this computer.'
      : 'This journal was deleted on another computer. The files in ~/Journal stay on this computer.'
    );
    location.reload();
    return;
  }
  const skipped = s.skipped.length > 0 ? ` · ${s.skipped.length} skipped` : '';
  $('status').textContent = statusText(s) + skipped;
}

function statusText(s) {
  if (s.syncing) return 'Syncing…';
  if (s.error) return `Not synced: ${s.error}`;
  if (s.pending > 0) return `${s.pending} change${s.pending === 1 ? '' : 's'} waiting`;
  if (s.lastSync) return `Synced ${new Date(s.lastSync).toLocaleTimeString()}`;
  return 'Not synced yet';
}

function showNotice(text, action) {
  $('notice-text').textContent = text;
  $('notice-action').hidden = !action;
  if (action) {
    $('notice-action').textContent = action.label;
    $('notice-action').onclick = action.run;
  }
  $('notice').hidden = false;
}
function hideNotice() {
  $('notice').hidden = true;
}
function showError(err) {
  showNotice(err.message);
}
$('notice-close').onclick = hideNotice;

async function signIn() {
  const signUp = (await unwrap(j.pendingSignUp())) ?? (await accountForm());
  if (signUp) {
    await recoveryCodeSaved(signUp.recoveryCode);
    await unwrap(j.confirmRecoveryCode());
  }
}

function accountForm() {
  const email = $('email');
  const password = $('password');
  const code = $('code');
  return new Promise(resolve => {
    const attempt = action => unwrap(action).then(resolve, err => ($('sign-in-error').textContent = err.message));
    $('sign-in').onsubmit = event => {
      event.preventDefault();
      attempt(code.value ? j.recover(email.value, code.value, password.value) : j.signIn(email.value, password.value));
    };
    $('sign-up').onclick = () => attempt(j.signUp(email.value, password.value));
  });
}

function recoveryCodeSaved(recoveryCode) {
  const lastGroup = recoveryCode.split('-').pop();
  $('sign-in').hidden = true;
  $('recovery').hidden = false;
  $('recovery-code').textContent = recoveryCode;
  return new Promise(resolve => {
    $('recovery-done').onclick = () => {
      if ($('recovery-check').value.trim().toUpperCase() === lastGroup) resolve();
    };
  });
}

async function start() {
  if (!(await unwrap(j.signedIn()))) {
    $('sign-in-screen').hidden = false;
    await signIn();
    $('sign-in-screen').hidden = true;
  }
  await unwrap(j.open());
  $('journal-screen').hidden = false;
  renderStatus(await unwrap(j.status()));
  await select(today());
}

start().catch(showError);
