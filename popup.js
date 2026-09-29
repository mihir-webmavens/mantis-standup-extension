// Toolbar popup: today's EODs (works from any tab) plus settings — the EOD
// reminder, shortcuts and the corner button's look. EODs load and save through
// background.js like the Mantis panel; settings live in chrome.storage.sync.

const grid = document.querySelector('.grid');
const status = document.querySelector('.status');
const key = ButtonStyles.STORAGE_KEY;
let statusTimer = null;

// Each preview renders the real button stylesheet in its own shadow root,
// so it looks exactly like the button on the page.
function preview(styleId) {
  const host = document.createElement('div');
  host.className = 'preview-host';
  host.attachShadow({ mode: 'open' }).innerHTML = `
    <style>
      :host { display: inline-block; }
      * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
      ${ButtonStyles.css(styleId)}
    </style>
    <div class="fab-scroll"><span class="fab">+ Standup</span></div>
  `;
  return host;
}

function card(style) {
  const label = document.createElement('label');
  label.className = 'card';
  label.dataset.id = style.id;

  const input = document.createElement('input');
  input.type = 'radio';
  input.name = 'style';
  input.value = style.id;
  input.className = 'sr-only';
  input.addEventListener('change', () => select(style.id, true));

  const stage = document.createElement('div');
  stage.className = 'stage';
  stage.append(preview(style.id));

  const info = document.createElement('div');
  info.className = 'info';
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = style.name;
  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = 'Selected';
  const desc = document.createElement('span');
  desc.className = 'desc';
  desc.textContent = style.description;
  info.append(name, badge, desc);

  label.append(input, stage, info);
  return label;
}

function select(id, save) {
  for (const el of grid.querySelectorAll('.card')) {
    const on = el.dataset.id === id;
    el.classList.toggle('selected', on);
    el.querySelector('input').checked = on;
  }
  if (!save) return;
  chrome.storage.sync.set({ [key]: id }).then(
    () => showStatus(`${ButtonStyles.STYLES.find((s) => s.id === id).name} saved · open Mantis tabs update instantly`),
    (err) => showStatus(`Could not save: ${err.message}`, true),
  );
}

function showStatus(text, isError = false) {
  status.textContent = text;
  status.classList.toggle('error', isError);
  status.classList.add('visible');
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => status.classList.remove('visible'), 2600);
}

// ---------- reminders ----------
// Two sections in Settings with the same controls; background.js schedules them.

const REMINDERS = {
  standup: { key: 'standupReminder', label: 'Standup reminder', defaults: { enabled: false, time: '11:00', weekdaysOnly: true } },
  eod: { key: 'eodReminder', label: 'EOD reminder', defaults: { enabled: false, time: '18:30', weekdaysOnly: true } },
};

// Notifications are an optional permission; Chrome only lets us ask for it
// straight from a click, so request it before any other await.
function askForNotifications() {
  return chrome.permissions.request({ permissions: ['notifications'] }).catch(() => false);
}

function setupReminder(kind) {
  const { key, label, defaults } = REMINDERS[kind];
  const box = document.querySelector(`.reminder[data-reminder="${kind}"]`);
  const ui = {
    enabled: box.querySelector('.rem-enabled'),
    time: box.querySelector('.rem-time'),
    weekdays: box.querySelector('.rem-weekdays'),
    preview: box.querySelector('.rem-preview'),
  };
  let reminder = { ...defaults };

  const render = () => {
    ui.enabled.checked = reminder.enabled;
    ui.time.value = reminder.time;
    ui.weekdays.checked = reminder.weekdaysOnly;
    box.classList.toggle('on', reminder.enabled);
  };

  const summary = () => {
    const [h, m] = reminder.time.split(':').map(Number);
    const at = new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return `${label} on · ${at} ${reminder.weekdaysOnly ? 'on weekdays' : 'every day'}`;
  };

  async function save(changes) {
    reminder = { ...reminder, ...changes };
    render();
    try {
      await chrome.storage.sync.set({ [key]: reminder });
      showStatus(reminder.enabled ? summary() : `${label} off`);
    } catch (err) {
      showStatus(`Could not save: ${err.message}`, true);
    }
  }

  ui.enabled.addEventListener('change', () => {
    if (!ui.enabled.checked) return save({ enabled: false });
    askForNotifications().then((granted) => {
      if (granted) return save({ enabled: true });
      ui.enabled.checked = false;
      showStatus(`Allow notifications to use the ${label.toLowerCase()}.`, true);
    });
  });
  ui.time.addEventListener('change', () => {
    if (/^\d{2}:\d{2}$/.test(ui.time.value)) save({ time: ui.time.value });
    else render();
  });
  ui.weekdays.addEventListener('change', () => save({ weekdaysOnly: ui.weekdays.checked }));
  ui.preview.addEventListener('click', () => {
    askForNotifications().then(async (granted) => {
      if (!granted) return showStatus('Allow notifications to preview the reminder.', true);
      const res = await chrome.runtime.sendMessage({ type: 'previewReminder', payload: { kind } }).catch((err) => ({ ok: false, error: err.message }));
      if (!res?.ok) showStatus(res?.error || 'Could not show the preview.', true);
      else if (!res.shown) showStatus(res.reason || 'Could not show the preview.', true);
      else showStatus('Preview notification sent');
    });
  });

  render();
  Promise.all([chrome.storage.sync.get(key), chrome.permissions.contains({ permissions: ['notifications'] })]).then(
    ([stored, granted]) => {
      reminder = { ...defaults, ...stored[key] };
      // Notifications blocked since it was turned on: show it as off until re-enabled.
      if (reminder.enabled && !granted) reminder.enabled = false;
      render();
    },
    render,
  );
}

setupReminder('standup');
setupReminder('eod');

// ---------- EOD from commits ----------
// Settings for background.js's daily run; Preview shows the matches without saving.

const AUTO_EOD_KEY = 'autoEod';
const AUTO_EOD_LAST_KEY = 'autoEodLastRun';
const AUTO_EOD_DEFAULTS = { enabled: false, time: '19:00', weekdaysOnly: false, repos: [] };

const ae = {
  box: document.querySelector('#auto-eod'),
  enabled: document.querySelector('#ae-enabled'),
  time: document.querySelector('#ae-time'),
  weekdays: document.querySelector('#ae-weekdays'),
  repos: document.querySelector('#ae-repos'),
  preview: document.querySelector('#ae-preview'),
  run: document.querySelector('#ae-run'),
  last: document.querySelector('.ae-last'),
  result: document.querySelector('.ae-result'),
};
let autoEod = { ...AUTO_EOD_DEFAULTS };

const parseRepos = (text) => [...new Set(text.split('\n').map((l) => l.trim()).filter(Boolean))];

function renderAutoEod() {
  ae.enabled.checked = autoEod.enabled;
  ae.time.value = autoEod.time;
  ae.weekdays.checked = autoEod.weekdaysOnly;
  if (document.activeElement !== ae.repos) ae.repos.value = autoEod.repos.join('\n');
  ae.box.classList.toggle('on', autoEod.enabled);
}

async function saveAutoEod(changes, message) {
  autoEod = { ...autoEod, ...changes };
  renderAutoEod();
  try {
    await chrome.storage.sync.set({ [AUTO_EOD_KEY]: autoEod });
    if (message) showStatus(message);
  } catch (err) {
    showStatus(`Could not save: ${err.message}`, true);
  }
}

function autoEodSummary() {
  const [h, m] = autoEod.time.split(':').map(Number);
  const at = new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `EOD from commits on · ${at} ${autoEod.weekdaysOnly ? 'on weekdays' : 'every day'}`;
}

function renderLastRun(run) {
  if (!run?.ranAt) return;
  const when = new Date(run.ranAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  ae.last.textContent = run.error ? `Last run ${when}: failed` : `Last run ${when}: ${run.filled.length} filled`;
  ae.last.title = run.error || '';
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function renderAutoEodResult(result, error) {
  ae.result.replaceChildren();
  ae.result.hidden = false;
  ae.result.classList.toggle('err', Boolean(error));
  if (error) return ae.result.append(error);
  if (!result.pending) return ae.result.append('No empty EODs to fill.');
  if (result.dryRun) {
    ae.result.append(result.matches.length
      ? `${result.matches.length} of ${result.pending} empty EODs have commits today:`
      : `None of the ${result.pending} empty EODs have a commit today that mentions their ticket.`);
    const ul = el('ul');
    for (const m of result.matches) {
      const li = el('li');
      li.append(el('strong', null, `#${m.ticket}`), ` · ${m.commits.join(' · ')}`);
      ul.append(li);
    }
    if (result.matches.length) ae.result.append(ul);
  } else {
    ae.result.append(result.filled.length ? `Filled ${result.filled.length} EOD${result.filled.length === 1 ? '' : 's'}:` : 'No EODs were filled: no empty EOD has a commit today that mentions its ticket.');
    const ul = el('ul');
    for (const f of result.filled) {
      const li = el('li');
      li.append(el('strong', null, `#${f.ticket}`), ` · ${f.update}`);
      ul.append(li);
    }
    if (result.filled.length) ae.result.append(ul);
  }
  const problems = [...result.errors.map((e) => `#${e.ticket}: ${e.error}`), ...result.repoErrors.map((e) => `${e.repo}: ${e.error}`)];
  if (problems.length) {
    const ul = el('ul', 'ae-problems');
    for (const p of problems) ul.append(el('li', null, p));
    ae.result.append(ul);
  }
}

async function runAutoEodFromPopup(type, button, busyLabel) {
  const label = button.textContent;
  ae.preview.disabled = ae.run.disabled = true;
  button.textContent = busyLabel;
  try {
    const res = await chrome.runtime.sendMessage({ type }).catch((err) => ({ ok: false, error: err.message }));
    renderAutoEodResult(res?.result, res?.ok ? null : res?.error || 'Something went wrong.');
    if (res?.ok && !res.result.dryRun) renderLastRun(res.result);
  } finally {
    button.textContent = label;
    ae.preview.disabled = ae.run.disabled = false;
  }
}

ae.enabled.addEventListener('change', async () => {
  if (!ae.enabled.checked) return saveAutoEod({ enabled: false }, 'EOD from commits off');
  // Straight from the click (Chrome requires a user gesture); a result notification is optional.
  const notified = askForNotifications();
  if (!autoEod.repos.length) {
    ae.enabled.checked = false;
    ae.repos.focus();
    return showStatus('Add at least one repo folder first.', true);
  }
  if (!(await chrome.permissions.contains({ permissions: ['nativeMessaging'] }).catch(() => false))) {
    ae.enabled.checked = false;
    showMantisAi();
    return showStatus('Set up MantisAI first: it reads your commits and writes the EODs.', true);
  }
  await notified;
  saveAutoEod({ enabled: true }, autoEodSummary());
});
ae.time.addEventListener('change', () => {
  if (/^\d{2}:\d{2}$/.test(ae.time.value)) saveAutoEod({ time: ae.time.value }, autoEod.enabled ? autoEodSummary() : 'Saved');
  else renderAutoEod();
});
ae.weekdays.addEventListener('change', () => saveAutoEod({ weekdaysOnly: ae.weekdays.checked }, autoEod.enabled ? autoEodSummary() : 'Saved'));
ae.repos.addEventListener('change', () => {
  const repos = parseRepos(ae.repos.value);
  const relative = repos.find((r) => !r.startsWith('/'));
  if (relative) return showStatus(`Use full paths (starting with /): ${relative}`, true);
  saveAutoEod({ repos, ...(repos.length ? {} : { enabled: false }) }, `${repos.length} repo folder${repos.length === 1 ? '' : 's'} saved`);
});
ae.preview.addEventListener('click', () => runAutoEodFromPopup('previewAutoEod', ae.preview, 'Checking…'));
ae.run.addEventListener('click', () => runAutoEodFromPopup('runAutoEod', ae.run, 'Writing…'));

Promise.all([chrome.storage.sync.get(AUTO_EOD_KEY), chrome.storage.local.get(AUTO_EOD_LAST_KEY)]).then(([stored, local]) => {
  autoEod = { ...AUTO_EOD_DEFAULTS, ...stored[AUTO_EOD_KEY] };
  renderAutoEod();
  renderLastRun(local[AUTO_EOD_LAST_KEY]);
}, renderAutoEod);

// ---------- keyboard shortcuts ----------
// Bindings belong to Chrome (manifest "commands"); it saves changes and
// rejects keys already in use, leaving a conflicting default unset.

const SHORTCUT_LABELS = { 'open-standup': 'Add Standup (Planned Action)', 'open-eod': 'EOD list' };
const SHORTCUT_DEFAULTS = { 'open-standup': 'Ctrl+Shift+S', 'open-eod': 'Ctrl+Shift+E' };

function renderShortcuts(commands) {
  const list = document.querySelector('.keys');
  const order = Object.keys(SHORTCUT_LABELS);
  const ours = commands.filter((c) => SHORTCUT_LABELS[c.name]).sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
  list.replaceChildren(...ours.map((c) => {
    const li = document.createElement('li');
    const what = document.createElement('span');
    what.className = 'what';
    what.textContent = SHORTCUT_LABELS[c.name];
    const combo = document.createElement('span');
    combo.className = 'combo';
    if (c.shortcut) {
      // Chrome reports e.g. "Ctrl+Shift+S" (or "⇧⌘S" on macOS).
      const keys = c.shortcut.includes('+') ? c.shortcut.split('+') : [...c.shortcut];
      combo.append(...keys.map((k) => Object.assign(document.createElement('kbd'), { textContent: k })));
    } else {
      combo.append(Object.assign(document.createElement('span'), { className: 'unset', textContent: 'Not set' }));
      const warn = Object.assign(document.createElement('span'), {
        className: 'warn',
        textContent: `${SHORTCUT_DEFAULTS[c.name]} is taken by Chrome or another extension. Click Change to pick another.`,
      });
      what.append(warn);
    }
    li.append(what, combo);
    return li;
  }));
}

document.querySelector('#keys-change').addEventListener('click', () => {
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});
chrome.commands.getAll().then(renderShortcuts, () => {});

grid.append(...ButtonStyles.STYLES.map(card));
chrome.storage.sync.get(key).then(
  (v) => {
    const id = ButtonStyles.STYLES.some((s) => s.id === v[key]) ? v[key] : ButtonStyles.DEFAULT;
    select(id, false);
  },
  () => select(ButtonStyles.DEFAULT, false),
);

// ---------- tabs ----------

const tabs = [...document.querySelectorAll('.tab')];
function showTab(tab) {
  for (const t of tabs) {
    const on = t === tab;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
  }
  document.querySelector('.scroll').scrollTop = 0;
}
for (const t of tabs) {
  t.addEventListener('click', () => showTab(t));
  t.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const next = tabs[(tabs.indexOf(t) + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    next.focus();
    showTab(next);
  });
}

// ---------- EOD ----------

const eodUi = {
  list: document.querySelector('.eod-list'),
  status: document.querySelector('.eod-status'),
  progress: document.querySelector('.eod-progress'),
  count: document.querySelector('.tab-count'),
  refresh: document.querySelector('#eod-refresh'),
};
let eods = { status: 'loading', items: [], error: null };
let editing = null; // { id, textarea, saving, error }
let savedId = null;
const LINK_RE = /(https:\/\/standup\.webmavens\.dev\/[^\s,]*[^\s,.])/;

async function loadEods() {
  eods = { ...eods, status: 'loading' };
  renderEods();
  try {
    const res = await chrome.runtime.sendMessage({ type: 'fetchEods' });
    eods = res?.ok ? { status: 'ready', items: res.eods, error: null } : { status: 'error', items: [], error: res?.error || 'Could not load EODs.' };
  } catch (err) {
    eods = { status: 'error', items: [], error: err.message };
  }
  if (editing && !eods.items.some((e) => e.id === editing.id)) editing = null;
  renderEods();
}

function renderEods() {
  const { status, items, error } = eods;
  const pending = items.filter((e) => !e.update.trim()).length;
  eodUi.refresh.disabled = status === 'loading';
  eodUi.progress.hidden = status !== 'ready' || !items.length;
  eodUi.progress.classList.toggle('done', !pending);
  eodUi.progress.textContent = pending ? `${pending} pending` : 'All done ✓';
  eodUi.count.hidden = status !== 'ready' || !pending;
  eodUi.count.textContent = pending;

  if (status === 'loading' && !items.length) setEodStatus('Loading EODs…');
  else if (status === 'error') setEodStatus(error, true);
  else if (status === 'ready' && !items.length) setEodStatus('No EODs yet today. Add a standup from a Mantis ticket first.');
  else eodUi.status.hidden = true;

  const hadFocus = editing && document.activeElement === editing.textarea;
  eodUi.list.replaceChildren(...items.map(eodCard));
  if (hadFocus) editing.textarea.focus();
  document.dispatchEvent(new Event('eods-changed')); // Add Standup's duplicate notice
}

function setEodStatus(message, isError = false) {
  eodUi.status.className = `eod-status${isError ? ' err' : ''}`;
  eodUi.status.replaceChildren(...message.split(LINK_RE).map((part, i) =>
    i % 2 ? Object.assign(document.createElement('a'), { href: part, target: '_blank', rel: 'noopener', textContent: part }) : part));
  eodUi.status.hidden = false;
}

const make = (tag, className, text) => Object.assign(document.createElement(tag), className ? { className } : {}, text != null ? { textContent: text } : {});

function eodCard(eod) {
  const isEditing = editing?.id === eod.id;
  const li = make('li', `eod ${isEditing ? 'editing' : eod.update ? 'filled' : 'pending'}`);
  const top = make('div', 'eod-top');
  const id = make('div', 'eod-id');
  const ticket = eod.link ? make('a', '', `#${eod.ticket}`) : make('strong', '', `#${eod.ticket}`);
  if (eod.link) Object.assign(ticket, { href: eod.link, target: '_blank', rel: 'noopener' });
  id.append(ticket);
  if (eod.priority) id.append(make('span', `prio ${eod.priority.toLowerCase()}`, eod.priority));
  top.append(id, make('span', 'eod-time', /\d{2}:\d{2}/.exec(eod.createdAt)?.[0] || eod.createdAt));
  li.append(top, make('div', 'eod-action', eod.plannedAction));

  if (isEditing) {
    li.append(eodEditor());
    return li;
  }
  const row = make('div', 'eod-row');
  const edit = make('button', 'pill', eod.update ? 'Edit' : 'Add EOD');
  edit.type = 'button';
  edit.disabled = Boolean(editing?.saving);
  edit.addEventListener('click', () => startEdit(eod));
  row.append(make('span', `eod-update${eod.update ? '' : ' empty'}`, eod.update || 'EOD not filled yet'), edit);
  li.append(row);
  if (savedId === eod.id) li.append(make('div', 'eod-saved', '✓ EOD saved.'));
  return li;
}

function eodEditor() {
  const { textarea, saving, error } = editing;
  textarea.readOnly = saving;
  const box = make('div', 'eod-edit');
  const actions = make('div', 'eod-edit-actions');
  const buttons = make('div', 'buttons');
  const cancel = make('button', 'link', 'Cancel');
  const save = make('button', 'save', saving ? 'Saving…' : 'Save');
  cancel.type = save.type = 'button';
  cancel.disabled = save.disabled = saving;
  cancel.addEventListener('click', cancelEdit);
  save.addEventListener('click', saveEdit);
  buttons.append(cancel, save);
  actions.append(make('span', 'hint', 'Enter to save'), buttons);
  box.append(textarea, actions);
  if (error) box.append(make('div', 'eod-error', error));
  return box;
}

function startEdit(eod) {
  const textarea = make('textarea');
  textarea.value = eod.update;
  textarea.placeholder = 'What did you complete today?';
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault(); // the server field is single-line
      saveEdit();
    }
    if (e.key === 'Escape' && !editing?.saving) {
      e.preventDefault(); // cancel the edit rather than closing the popup
      cancelEdit();
    }
  });
  editing = { id: eod.id, textarea, saving: false, error: null };
  savedId = null;
  renderEods();
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
}

function cancelEdit() {
  if (editing?.saving) return;
  editing = null;
  renderEods();
}

async function saveEdit() {
  const edit = editing;
  if (!edit || edit.saving) return;
  edit.saving = true;
  edit.error = null;
  renderEods();
  try {
    const res = await chrome.runtime.sendMessage({ type: 'updateEod', payload: { id: edit.id, update: edit.textarea.value } });
    if (!res?.ok) throw new Error(res?.error || 'Unknown error; EOD may not have been saved.');
    eods = { status: 'ready', items: res.eods, error: null };
    editing = null;
    savedId = edit.id;
  } catch (err) {
    edit.saving = false;
    edit.error = err.message;
  }
  renderEods();
  if (editing === edit) edit.textarea.focus();
}

eodUi.refresh.addEventListener('click', loadEods);
loadEods();

// ---------- Add Standup ----------
// Works from any tab. Submits through background.js like the Mantis panel; on a
// Mantis ticket page the ticket, link and priority are pre-filled from the page.

const su = {
  form: document.querySelector('.standup-form'),
  ticket: document.querySelector('#su-ticket'),
  action: document.querySelector('#su-action'),
  link: document.querySelector('#su-link'),
  priority: document.querySelector('#su-priority'),
  est: document.querySelector('#su-est'),
  support: document.querySelector('#su-support'),
  blockers: document.querySelector('#su-blockers'),
  dup: document.querySelector('.dup-note'),
  submit: document.querySelector('#su-submit'),
  status: document.querySelector('.su-status'),
};
const SU_DEFAULTS = { est: '-', support: 'No', blockers: 'None' };
const ticketKey = (t) => String(t || '').trim().replace(/^#/, '');

function setSuStatus(message, isError = false) {
  su.status.textContent = message;
  su.status.classList.toggle('err', isError);
  su.status.hidden = !message;
}

// Warns (without blocking) when this ticket already has a standup today.
function renderSuDuplicate() {
  const ticket = ticketKey(su.ticket.value);
  const today = localDate(new Date());
  const same = ticket && eods.status === 'ready'
    ? eods.items.filter((e) => ticketKey(e.ticket) === ticket && (!/^\d{4}-\d{2}-\d{2}/.test(e.createdAt || '') || e.createdAt.startsWith(today)))
    : [];
  su.dup.hidden = !same.length;
  if (!same.length) return;
  const time = /\d{2}:\d{2}/.exec(same[0].createdAt)?.[0];
  su.dup.textContent = same.length === 1
    ? `Already added today${time ? ` at ${time}` : ''}. Adding again creates another entry.`
    : `${same.length} standups already added today for #${ticket}. Adding again creates another entry.`;
}

function localDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function submitStandup() {
  if (su.submit.disabled) return;
  const payload = {
    ticket: ticketKey(su.ticket.value),
    plannedAction: su.action.value.trim(),
    repoLink: su.link.value.trim(),
    priority: su.priority.value,
    estTime: su.est.value.trim() || '-',
    supportNeeded: su.support.value.trim() || SU_DEFAULTS.support,
    blockers: su.blockers.value.trim() || SU_DEFAULTS.blockers,
  };
  const missing = [[su.ticket, payload.ticket, 'the ticket #'], [su.action, payload.plannedAction, 'your planned action'], [su.link, payload.repoLink, 'the repo / issue link']]
    .filter(([el, value]) => (el.setAttribute('aria-invalid', String(!value)), !value));
  if (missing.length) {
    missing[0][0].focus();
    return setSuStatus(`Enter ${missing.map((m) => m[2]).join(', ')} first.`, true);
  }

  su.submit.disabled = true;
  su.submit.textContent = 'Sending…';
  setSuStatus('');
  try {
    const res = await chrome.runtime.sendMessage({ type: 'submitStandup', payload });
    if (!res?.ok) throw new Error(res?.error || 'Unknown error; standup may not have been saved.');
    su.action.value = '';
    su.est.value = SU_DEFAULTS.est;
    su.support.value = SU_DEFAULTS.support;
    su.blockers.value = SU_DEFAULTS.blockers;
    setSuStatus(`✓ Standup added for #${payload.ticket} (${payload.priority}).`);
    loadEods(); // the new standup is also a new EOD entry
  } catch (err) {
    setSuStatus(err.message, true);
  } finally {
    su.submit.disabled = false;
    su.submit.textContent = 'Add Standup';
  }
}

su.form.addEventListener('submit', (e) => {
  e.preventDefault();
  submitStandup();
});
su.form.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    submitStandup();
  }
});
for (const el of [su.ticket, su.action, su.link]) el.addEventListener('input', () => el.removeAttribute('aria-invalid'));
su.ticket.addEventListener('input', renderSuDuplicate);
document.addEventListener('eods-changed', renderSuDuplicate);

// Pre-fill from a Mantis ticket page (its content script answers); other sites
// leave the fields for the user to type.
async function prefillFromTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const info = tab?.id ? await chrome.tabs.sendMessage(tab.id, { type: 'ticketInfo' }) : null;
    if (!info?.ticket) return;
    if (!su.ticket.value) su.ticket.value = info.ticket;
    if (!su.link.value) su.link.value = info.link;
    if (info.priority) su.priority.value = info.priority;
    renderSuDuplicate();
  } catch {
    // Not a Mantis page (no content script there).
  }
}

function focusStandup() {
  showTab(document.querySelector('#tab-standup'));
  su.action.focus();
}

// Ctrl+Shift+S off a Mantis ticket page opens the popup on this tab (see background.js).
document.querySelector('#tab-standup').addEventListener('click', () => (su.ticket.value ? su.action : su.ticket).focus());
prefillFromTab();
chrome.storage.session?.get('popupTab').then(({ popupTab }) => {
  if (popupTab === 'mantis-ai') {
    chrome.storage.session.remove('popupTab');
    return showMantisAi();
  }
  if (popupTab !== 'standup') return;
  chrome.storage.session.remove('popupTab');
  focusStandup();
}, () => {});

// ---------- MantisAI ----------
// Setup for the chat on Mantis pages: the optional nativeMessaging permission,
// the helper installer (native-host/install.sh with this extension's id and the
// helper script appended) and a connection check through background.js.

const ai = {
  box: document.querySelector('#mantis-ai'),
  state: document.querySelector('.ai-state'),
  steps: Object.fromEntries([...document.querySelectorAll('.ai-steps li')].map((li) => [li.dataset.step, li])),
  allow: document.querySelector('#ai-allow'),
  download: document.querySelector('#ai-download'),
  copy: document.querySelector('#ai-copy'),
  cmd: document.querySelector('#ai-cmd'),
  check: document.querySelector('#ai-check'),
  error: document.querySelector('.ai-error'),
  model: document.querySelector('#ai-model'),
  reinstall: document.querySelector('#ai-reinstall'),
};
const AI_MODEL_KEY = 'mantisAiModel';
const AI_INSTALLER = 'mantis-ai-install.sh';

function renderAi({ status, claudeVersion, error }) {
  const labels = { ready: 'Ready', disabled: 'Not set up', 'not-installed': 'Helper not installed', forbidden: 'Reinstall needed', error: 'Not working', checking: 'Checking…' };
  const current = { disabled: 'allow', 'not-installed': 'install', forbidden: 'install', error: 'check' }[status];
  const order = ['allow', 'install', 'check'];
  for (const [name, li] of Object.entries(ai.steps)) {
    li.classList.toggle('current', name === current);
    li.classList.toggle('done', current != null && order.indexOf(name) < order.indexOf(current));
  }
  ai.box.classList.toggle('ready', status === 'ready');
  ai.state.className = `ai-state${status === 'ready' ? ' ready' : status === 'checking' ? '' : ' todo'}`;
  ai.state.textContent = status === 'ready' && claudeVersion ? `Ready · ${claudeVersion.replace(/\s*\(Claude Code\)/, '')}` : labels[status] || status;
  ai.state.title = claudeVersion || '';
  ai.error.hidden = !(error && status !== 'disabled');
  ai.error.textContent = error || '';
  ai.reinstall.hidden = status !== 'ready';
}

async function checkAi() {
  renderAi({ status: 'checking' });
  try {
    const res = await chrome.runtime.sendMessage({ type: 'mantisAiStatus' });
    renderAi(res?.ok ? res : { status: 'error', error: res?.error || 'Could not check MantisAI.' });
  } catch (err) {
    renderAi({ status: 'error', error: err.message });
  }
}

// The installer is the repo's install.sh with this extension's id filled in and
// the helper appended below its marker, so one file is all the user runs.
async function downloadInstaller() {
  try {
    const [script, helper] = await Promise.all(['native-host/install.sh', 'native-host/mantis-ai-host.mjs']
      .map((path) => fetch(chrome.runtime.getURL(path)).then((r) => r.text())));
    const installer = `${script.replace('__EXTENSION_ID__', chrome.runtime.id).trimEnd()}\n__MANTIS_AI_HOST__\n${helper}`;
    const url = URL.createObjectURL(new Blob([installer], { type: 'text/x-shellscript' }));
    Object.assign(document.createElement('a'), { href: url, download: AI_INSTALLER }).click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    showStatus('Installer downloaded · run the command below, then click Check');
  } catch (err) {
    showStatus(`Could not create the installer: ${err.message}`, true);
  }
}

function showMantisAi() {
  showTab(document.querySelector('#tab-settings'));
  ai.box.scrollIntoView({ block: 'start' });
}

// Asked straight from the click, like notifications (Chrome requires a user gesture).
ai.allow.addEventListener('click', () => {
  chrome.permissions.request({ permissions: ['nativeMessaging'] }).catch(() => false).then((granted) => {
    if (!granted) return showStatus('MantisAI needs this permission to reach the helper.', true);
    checkAi();
  });
});
ai.download.addEventListener('click', downloadInstaller);
ai.reinstall.addEventListener('click', () => {
  ai.box.classList.remove('ready');
  for (const li of Object.values(ai.steps)) li.classList.remove('done', 'current');
  ai.steps.install.classList.add('current');
});
ai.copy.addEventListener('click', () => {
  navigator.clipboard.writeText(ai.cmd.textContent).then(() => showStatus('Command copied'), () => showStatus('Could not copy', true));
});
ai.check.addEventListener('click', checkAi);
ai.model.addEventListener('change', () => {
  chrome.storage.sync.set({ [AI_MODEL_KEY]: ai.model.value }).then(
    () => showStatus(`MantisAI model: ${ai.model.selectedOptions[0].textContent}`),
    (err) => showStatus(`Could not save: ${err.message}`, true),
  );
});
chrome.storage.sync.get(AI_MODEL_KEY).then((v) => { ai.model.value = v[AI_MODEL_KEY] || ''; }, () => {});
checkAi(); // without the permission this answers "Not set up" without starting the helper

// ---------- Header ----------
// Which Mantis header tabs show, and their order (see header-layout.js and
// mantis-header.js). The tabs listed are the ones last seen on a Mantis page.

const hdr = {
  list: document.querySelector('.hdr-list'),
  empty: document.querySelector('.hdr-empty'),
  hint: document.querySelector('.hdr-hint'),
  reset: document.querySelector('#hdr-reset'),
};
let hdrItems = [];
let hdrLayout = null;
let hdrDragged = null;

function renderHeader() {
  const resolved = HeaderLayout.resolve(hdrItems, hdrLayout);
  hdr.empty.hidden = resolved.length > 0;
  hdr.hint.hidden = hdr.reset.hidden = resolved.length === 0;
  hdr.list.replaceChildren(...resolved.map((it) => {
    const li = el('li', 'hdr-item');
    li.dataset.key = it.key;
    li.classList.toggle('off', it.hidden);
    if (it.fixed) {
      li.classList.add('fixed');
      li.append(el('span', 'hdr-grip', ''));
    } else {
      li.draggable = true;
      const grip = el('button', 'hdr-grip', '☰');
      grip.type = 'button';
      grip.setAttribute('aria-label', `Move ${it.label} (up/down arrows)`);
      grip.addEventListener('keydown', (e) => moveByKey(e, li));
      li.append(grip);
    }
    const name = el('span', 'hdr-name', it.label);
    name.id = `hdr-${it.key}`;
    li.append(name);
    if (it.fixed) li.append(el('span', 'sub hdr-fixed', 'fixed place'));
    const sw = el('label', 'switch');
    sw.title = `Show or hide ${it.label}`;
    const box = el('input');
    box.type = 'checkbox';
    box.setAttribute('role', 'switch');
    box.setAttribute('aria-labelledby', name.id);
    box.checked = !it.hidden;
    box.addEventListener('change', () => {
      li.classList.toggle('off', !box.checked);
      saveHeader(`${it.label} ${box.checked ? 'shown' : 'hidden'}`);
    });
    const track = el('span', 'track');
    track.append(el('span', 'thumb'));
    sw.append(box, track);
    li.append(sw);
    return li;
  }));
}

function saveHeader(message) {
  const rows = [...hdr.list.children];
  hdrLayout = {
    order: rows.filter((li) => !li.classList.contains('fixed')).map((li) => li.dataset.key),
    hidden: rows.filter((li) => !li.querySelector('input').checked).map((li) => li.dataset.key),
  };
  chrome.storage.sync.set({ [HeaderLayout.STORAGE_KEY]: hdrLayout }).then(
    () => showStatus(`${message} · open Mantis tabs update instantly`),
    () => showStatus('Could not save the header', true),
  );
}

function moveByKey(e, li) {
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
  e.preventDefault();
  const other = e.key === 'ArrowUp' ? li.previousElementSibling : li.nextElementSibling;
  if (!other || other.classList.contains('fixed')) return;
  if (e.key === 'ArrowUp') other.before(li); else other.after(li);
  li.querySelector('.hdr-grip').focus();
  saveHeader(`${li.querySelector('.hdr-name').textContent} moved`);
}

hdr.list.addEventListener('dragstart', (e) => {
  hdrDragged = e.target.closest?.('.hdr-item[draggable="true"]');
  if (!hdrDragged) return;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', hdrDragged.dataset.key);
  requestAnimationFrame(() => hdrDragged?.classList.add('dragging'));
});
hdr.list.addEventListener('dragover', (e) => {
  if (!hdrDragged) return;
  e.preventDefault();
  const over = e.target.closest?.('.hdr-item');
  if (!over || over === hdrDragged || over.classList.contains('fixed')) return;
  const r = over.getBoundingClientRect();
  if (e.clientY < r.top + r.height / 2) over.before(hdrDragged); else over.after(hdrDragged);
});
hdr.list.addEventListener('drop', (e) => e.preventDefault());
hdr.list.addEventListener('dragend', () => {
  if (!hdrDragged) return;
  const moved = hdrDragged;
  hdrDragged = null;
  moved.classList.remove('dragging');
  const order = [...hdr.list.children].filter((li) => !li.classList.contains('fixed')).map((li) => li.dataset.key);
  if (order.join() !== HeaderLayout.resolve(hdrItems, hdrLayout).filter((it) => !it.fixed).map((it) => it.key).join()) {
    saveHeader(`${moved.querySelector('.hdr-name').textContent} moved`);
  }
});

hdr.reset.addEventListener('click', () => {
  hdrLayout = { order: [], hidden: [] };
  renderHeader();
  saveHeader('Header reset: every tab shown');
});

Promise.all([chrome.storage.local.get(HeaderLayout.ITEMS_KEY), chrome.storage.sync.get(HeaderLayout.STORAGE_KEY)]).then(
  ([local, sync]) => {
    hdrItems = local[HeaderLayout.ITEMS_KEY] || [];
    hdrLayout = sync[HeaderLayout.STORAGE_KEY] || null;
    renderHeader();
  },
  () => renderHeader(),
);
