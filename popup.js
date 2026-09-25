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
  if (popupTab !== 'standup') return;
  chrome.storage.session.remove('popupTab');
  focusStandup();
}, () => {});
