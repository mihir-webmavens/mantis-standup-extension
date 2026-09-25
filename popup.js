// Toolbar popup: EOD reminder settings and the corner button's look. Both are
// saved in chrome.storage.sync; background.js schedules the reminder and
// content.js restyles open Mantis tabs.

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

// ---------- EOD reminder ----------

const REMINDER_KEY = 'eodReminder';
const REMINDER_DEFAULTS = { enabled: false, time: '18:30', weekdaysOnly: true };
const rem = {
  box: document.querySelector('.reminder'),
  enabled: document.querySelector('#rem-enabled'),
  time: document.querySelector('#rem-time'),
  weekdays: document.querySelector('#rem-weekdays'),
  preview: document.querySelector('#rem-preview'),
};
let reminder = { ...REMINDER_DEFAULTS };

function renderReminder() {
  rem.enabled.checked = reminder.enabled;
  rem.time.value = reminder.time;
  rem.weekdays.checked = reminder.weekdaysOnly;
  rem.box.classList.toggle('on', reminder.enabled);
}

function reminderSummary() {
  const [h, m] = reminder.time.split(':').map(Number);
  const at = new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `EOD reminder on · ${at} ${reminder.weekdaysOnly ? 'on weekdays' : 'every day'}`;
}

async function saveReminder(changes) {
  reminder = { ...reminder, ...changes };
  renderReminder();
  try {
    await chrome.storage.sync.set({ [REMINDER_KEY]: reminder });
    showStatus(reminder.enabled ? reminderSummary() : 'EOD reminder off');
  } catch (err) {
    showStatus(`Could not save: ${err.message}`, true);
  }
}

// Notifications are an optional permission; Chrome only lets us ask for it
// straight from a click, so request it before any other await.
function askForNotifications() {
  return chrome.permissions.request({ permissions: ['notifications'] }).catch(() => false);
}

rem.enabled.addEventListener('change', () => {
  if (!rem.enabled.checked) return saveReminder({ enabled: false });
  askForNotifications().then((granted) => {
    if (granted) return saveReminder({ enabled: true });
    rem.enabled.checked = false;
    showStatus('Allow notifications to use the EOD reminder.', true);
  });
});
rem.time.addEventListener('change', () => {
  if (/^\d{2}:\d{2}$/.test(rem.time.value)) saveReminder({ time: rem.time.value });
  else renderReminder();
});
rem.weekdays.addEventListener('change', () => saveReminder({ weekdaysOnly: rem.weekdays.checked }));
rem.preview.addEventListener('click', () => {
  askForNotifications().then(async (granted) => {
    if (!granted) return showStatus('Allow notifications to preview the reminder.', true);
    const res = await chrome.runtime.sendMessage({ type: 'previewReminder' }).catch((err) => ({ ok: false, error: err.message }));
    if (!res?.ok) showStatus(res?.error || 'Could not show the preview.', true);
    else if (!res.shown) showStatus(res.reason || 'Could not show the preview.', true);
    else showStatus('Preview notification sent');
  });
});

Promise.all([chrome.storage.sync.get(REMINDER_KEY), chrome.permissions.contains({ permissions: ['notifications'] })]).then(
  ([stored, granted]) => {
    reminder = { ...REMINDER_DEFAULTS, ...stored[REMINDER_KEY] };
    // Notifications blocked since it was turned on: show it as off until re-enabled.
    if (reminder.enabled && !granted) reminder.enabled = false;
    renderReminder();
  },
  renderReminder,
);

grid.append(...ButtonStyles.STYLES.map(card));
chrome.storage.sync.get(key).then(
  (v) => {
    const id = ButtonStyles.STYLES.some((s) => s.id === v[key]) ? v[key] : ButtonStyles.DEFAULT;
    select(id, false);
  },
  () => select(ButtonStyles.DEFAULT, false),
);
