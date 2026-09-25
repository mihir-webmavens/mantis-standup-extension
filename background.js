// Submits the standup to standup.webmavens.dev using the user's existing
// browser session. Runs in the service worker so the cross-origin request
// is covered by host_permissions (content scripts are bound by page CORS).

const STANDUP_ORIGIN = 'https://standup.webmavens.dev';
const CREATE_URL = `${STANDUP_ORIGIN}/admin/standups/create`;
const LOGIN_URL = `${STANDUP_ORIGIN}/login`;
const INDEX_PATH = '/admin/standups';
const EOD_URL = `${STANDUP_ORIGIN}/admin/standups/edit-standups`;
const EOD_FORM_PATH = '/admin/standups/update-standups';

const HANDLERS = {
  submitStandup: (payload) => submitStandup(payload).then(() => ({})),
  fetchEods: () => withBadge(fetchEods()).then((eods) => ({ eods })),
  updateEod: (payload) => updateEod(payload).then((eods) => (showPendingBadge(eods), { eods })),
  previewReminder: (payload) => remind(payload?.kind || 'eod', { preview: true }),
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = HANDLERS[msg?.type];
  if (!handler) return;
  handler(msg.payload).then(
    (data) => sendResponse({ ok: true, ...data }),
    (err) => sendResponse({ ok: false, error: err.message || String(err) }),
  );
  return true; // keep the channel open for the async response
});

async function submitStandup({ ticket, plannedAction, repoLink, priority, estTime, supportNeeded, blockers }) {
  if (!ticket || !plannedAction || !repoLink || !priority) {
    throw new Error('Missing standup data; nothing was submitted.');
  }

  // 1. Load the create form to get a fresh CSRF token, user_id and the
  //    form's own defaults for support_needed / blockers_challenges.
  const createRes = await fetchCreateForm();
  const form = parseForm(await createRes.text(), INDEX_PATH);
  if (!form) throw new Error('Could not find the standup form on standup.webmavens.dev.');
  if (!form.fields._token) throw new Error('Standup form has no CSRF token; cannot submit.');
  if (!form.fields.user_id) throw new Error('Standup form has no user_id; cannot submit.');

  // 2. Keep every default the form ships with (_token, user_id,
  //    support_needed, blockers_challenges) and fill only our fields.
  const body = new URLSearchParams(form.fields);
  body.set('ticket', ticket);
  body.set('planned_action', plannedAction);
  body.set('repo_link', repoLink);
  body.set('priority', priority);
  body.set('est_time', estTime?.trim() || '-'); // the server requires a value; '-' was the old fixed one
  // Only the toolbar popup's form sends these; otherwise the form's defaults stay.
  if (supportNeeded?.trim()) body.set('support_needed', supportNeeded.trim());
  if (blockers?.trim()) body.set('blockers_challenges', blockers.trim());

  // Redirects are not followed: the server redirects to http:// URLs, and
  // Chrome blocks the resulting https -> http -> https chain with a CORS error
  // even though the standup was saved.
  const res = await fetch(form.action, { method: 'POST', credentials: 'include', body, redirect: 'manual' });

  if (res.status === 419) throw new Error('Standup session expired. Reload standup.webmavens.dev and try again.');
  if (res.type !== 'opaqueredirect') {
    const errors = res.ok ? extractErrors(await res.text()) : [];
    throw new Error(errors.length
      ? `Standup not saved: ${errors.join(' ')}`
      : `Standup not saved (unexpected HTTP ${res.status} response).`);
  }

  // 3. A redirect means the POST was accepted, but Laravel also redirects back
  //    to /create on validation failure, flashing the errors into the session.
  //    Reload the form: any errors shown there mean the standup was not saved.
  const errors = extractErrors(await (await fetchCreateForm()).text());
  if (errors.length) throw new Error(`Standup not saved: ${errors.join(' ')}`);
}

// When logged in the create form is a plain 200; any redirect means the
// session is gone and the server is sending us to /login.
function fetchCreateForm() {
  return fetchStandupPage(CREATE_URL, 'the standup form');
}

async function fetchStandupPage(url, what) {
  const res = await fetch(url, { credentials: 'include', redirect: 'manual' });
  if (res.type === 'opaqueredirect') {
    throw new Error(`You are not logged into standup.webmavens.dev. Log in at ${LOGIN_URL}, then try again.`);
  }
  if (!res.ok) throw new Error(`Could not open ${what} (HTTP ${res.status}).`);
  return res;
}

// Each EOD is a row of the update-standups form that carries an
// evening_updates[<id>] input; columns are located by their header text.
async function fetchEods() {
  return parseEods(await (await fetchStandupPage(EOD_URL, 'the EOD page')).text());
}

function parseEods(html) {
  const form = [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)].find(([, attrs]) => {
    const action = attr(attrs, 'action');
    return action && new URL(action, STANDUP_ORIGIN).pathname.replace(/\/$/, '') === EOD_FORM_PATH;
  });
  if (!form) throw new Error('Could not find the EOD list on standup.webmavens.dev.');

  const headers = [...(/<thead\b[^>]*>([\s\S]*?)<\/thead>/i.exec(form[2])?.[1] ?? '').matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)]
    .map(([, inner]) => cellText(inner));
  const col = (re) => headers.findIndex((h) => re.test(h));
  const cols = {
    ticket: col(/ticket/i),
    plannedAction: col(/planned/i),
    link: col(/link/i),
    priority: col(/priority/i),
    estTime: col(/est/i),
    createdAt: col(/created/i),
  };

  const tbody = /<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i.exec(form[2])?.[1] ?? '';
  const eods = [];
  for (const [, row] of tbody.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const input = [...row.matchAll(/<input\b[^>]*>/gi)].map(([tag]) => tag)
      .find((tag) => /^evening_updates\[\d+\]$/.test(attr(tag, 'name') || ''));
    if (!input) continue;

    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(([, inner]) => inner);
    const text = (i) => (i >= 0 && cells[i] != null ? cellText(cells[i]) : '');
    const anchor = cols.link >= 0 && cells[cols.link] ? /<a\b[^>]*>/i.exec(cells[cols.link]) : null;
    const href = anchor ? attr(anchor[0], 'href') : null;

    eods.push({
      id: /\[(\d+)\]/.exec(attr(input, 'name'))[1],
      ticket: text(cols.ticket),
      plannedAction: text(cols.plannedAction),
      link: href && /^https?:\/\//i.test(href) ? href : null,
      priority: text(cols.priority),
      estTime: text(cols.estTime),
      createdAt: text(cols.createdAt),
      update: attr(input, 'value') ?? '',
    });
  }
  return eods;
}

// The EOD page saves every row in one form, so resend all rows exactly as the
// server rendered them and change only the one being edited.
async function updateEod({ id, update }) {
  if (!/^\d+$/.test(String(id)) || typeof update !== 'string') throw new Error('Invalid EOD update; nothing was saved.');
  const field = `evening_updates[${id}]`;
  const value = update.replace(/\s+/g, ' ').trim(); // the server field is a single-line input

  const form = parseForm(await (await fetchStandupPage(EOD_URL, 'the EOD page')).text(), EOD_FORM_PATH);
  if (!form) throw new Error('Could not find the EOD form on standup.webmavens.dev.');
  if (!form.fields._token) throw new Error('EOD form has no CSRF token; cannot save.');
  if (!(field in form.fields)) throw new Error('This EOD is no longer on the EOD page. Refresh the list.');

  const body = new URLSearchParams(form.fields);
  body.set(field, value);
  body.set('submit', 'Submit'); // the form's named submit button

  // Redirects are not followed; see submitStandup.
  const res = await fetch(form.action, { method: 'POST', credentials: 'include', body, redirect: 'manual' });
  if (res.status === 419) throw new Error('Standup session expired. Reload standup.webmavens.dev and try again.');
  if (res.type !== 'opaqueredirect') {
    const errors = res.ok ? extractErrors(await res.text()) : [];
    throw new Error(errors.length
      ? `EOD not saved: ${errors.join(' ')}`
      : `EOD not saved (unexpected HTTP ${res.status} response).`);
  }

  // Confirm against a fresh copy of the page rather than trusting the redirect.
  const html = await (await fetchStandupPage(EOD_URL, 'the EOD page')).text();
  const errors = extractErrors(html);
  if (errors.length) throw new Error(`EOD not saved: ${errors.join(' ')}`);
  const eods = parseEods(html);
  const saved = eods.find((e) => e.id === String(id));
  if (saved && saved.update.trim() !== value) {
    throw new Error('The server did not keep the new EOD text. Check the EOD page and try again.');
  }
  return eods;
}

function cellText(html) {
  return decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

// DOMParser is not available in MV3 service workers, so parse with regexes.
// The forms are server-rendered Blade, which keeps this predictable.
// Returns the first form posting to `path`, with the values it would submit.
function parseForm(html, path) {
  const formMatch = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
  let m;
  while ((m = formMatch.exec(html))) {
    const action = attr(m[1], 'action');
    if (!action || new URL(action, STANDUP_ORIGIN).pathname.replace(/\/$/, '') !== path) continue;

    const inner = m[2];
    const fields = {};

    for (const [tag] of inner.matchAll(/<input\b[^>]*>/gi)) {
      const name = attr(tag, 'name');
      const type = (attr(tag, 'type') || 'text').toLowerCase();
      if (!name || ['submit', 'button', 'file', 'reset', 'image'].includes(type)) continue;
      if ((type === 'checkbox' || type === 'radio') && !/\schecked\b/i.test(tag)) continue;
      fields[name] = attr(tag, 'value') ?? '';
    }

    for (const [, attrs, content] of inner.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/gi)) {
      const name = attr(attrs, 'name');
      if (name) fields[name] = decodeEntities(content);
    }

    for (const [, attrs, content] of inner.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
      const name = attr(attrs, 'name');
      const selected = /<option\b([^>]*\sselected\b[^>]*)>/i.exec(content);
      if (name && selected && !/\sdisabled\b/i.test(selected[1])) fields[name] = attr(selected[1], 'value') ?? '';
    }

    return { action: new URL(action, STANDUP_ORIGIN).href, fields };
  }
  return null;
}

function attr(tag, name) {
  const re = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const m = re.exec(tag);
  return m ? decodeEntities(m[1] ?? m[2] ?? m[3]) : null;
}

function decodeEntities(s) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function extractErrors(html) {
  const errors = new Set();
  const patterns = [
    /<(?:span|div)[^>]*class="[^"]*(?:help-block|invalid-feedback|text-danger)[^"]*"[^>]*>([\s\S]*?)<\/(?:span|div)>/gi,
    /<div[^>]*class="[^"]*alert-danger[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
  ];
  for (const re of patterns) {
    for (const [, inner] of html.matchAll(re)) {
      const text = decodeEntities(inner.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
      if (text) errors.add(text);
    }
  }
  return [...errors];
}

// ---------- toolbar badge + reminders ----------
// The toolbar icon shows how many EODs still have no update. Two optional daily
// notifications (settings in the toolbar popup): a standup reminder when none has
// been added today, and an EOD reminder when EODs are still empty.

const BADGE_ALARM = 'eod-badge';
const MANTIS_URL = 'https://projects.webmavens.dev/';
const MISSED_GRACE_MS = 3 * 60 * 60 * 1000; // a reminder missed while Chrome was closed is dropped after this
const TITLE = 'Mantis Quick Standup';

const pendingEods = (eods) => eods.filter((e) => !e.update.trim());
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function localDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// The EOD page lists standups; entries without a readable date count as today's.
function todaysStandups(eods) {
  const today = localDate(new Date());
  return eods.filter((e) => {
    const date = /^\d{4}-\d{2}-\d{2}/.exec(e.createdAt || '')?.[0];
    return !date || date === today;
  });
}

// What each reminder checks. Returns the notification plus the count it is
// about (shown by the popup's Preview), or null when there is nothing to say.
function eodReminderNote(eods, preview) {
  const pending = pendingEods(eods);
  if (!pending.length && !preview) return null;
  const tickets = pending.slice(0, 4).map((e) => `#${e.ticket}`).join(', ') + (pending.length > 4 ? '…' : '');
  return pending.length
    ? { title: `${plural(pending.length, 'EOD')} still to fill in`, message: `${tickets}. Click to open the EOD page.`, count: pending.length }
    : { title: 'No pending EODs', message: 'All EODs are filled in. This is how the reminder will look.', count: 0 };
}

function standupReminderNote(eods, preview) {
  const added = todaysStandups(eods).length;
  if (added && !preview) return null;
  return added
    ? { title: `${plural(added, 'standup')} added today`, message: 'Nothing to do. This is how the reminder will look.', count: added }
    : { title: 'No standup added yet today', message: 'Open a Mantis ticket and use + Standup (Ctrl+Shift+S). Click to open Mantis.', count: 0 };
}

const REMINDERS = {
  eod: {
    label: 'EOD reminder', subject: 'EODs', key: 'eodReminder', defaults: { enabled: false, time: '18:30', weekdaysOnly: true },
    alarm: 'eod-reminder', snooze: 'eod-snooze', notifyId: 'eod-reminder', loginId: 'eod-reminder-login', url: EOD_URL,
    note: eodReminderNote, countKey: 'pending',
  },
  standup: {
    label: 'Standup reminder', subject: 'standups', key: 'standupReminder', defaults: { enabled: false, time: '11:00', weekdaysOnly: true },
    alarm: 'standup-reminder', snooze: 'standup-snooze', notifyId: 'standup-reminder', loginId: 'standup-reminder-login', url: MANTIS_URL,
    note: standupReminderNote, countKey: 'added',
  },
};

function showPendingBadge(eods) {
  const n = pendingEods(eods).length;
  chrome.action.setBadgeBackgroundColor({ color: '#7c3aed' });
  chrome.action.setBadgeText({ text: n ? String(n) : '' });
  chrome.action.setTitle({ title: n ? `${TITLE}: ${plural(n, 'EOD')} pending` : `${TITLE}: no pending EODs` });
}

// Stay quiet when the count is unknown (e.g. logged out): no badge, reason in the tooltip.
function withBadge(promise) {
  return promise.then(
    (eods) => (showPendingBadge(eods), eods),
    (err) => {
      chrome.action.setBadgeText({ text: '' });
      chrome.action.setTitle({ title: `${TITLE}: ${err.message}` });
      throw err;
    },
  );
}

const refreshBadge = () => withBadge(fetchEods()).catch(() => {});

async function getReminder(kind) {
  const { key, defaults } = REMINDERS[kind];
  const stored = (await chrome.storage.sync.get(key))[key];
  return { ...defaults, ...stored };
}

function nextReminderTime({ time, weekdaysOnly }, from = new Date()) {
  const [h, m] = String(time).split(':').map(Number);
  const next = new Date(from);
  next.setHours(Number.isFinite(h) ? h : 18, Number.isFinite(m) ? m : 30, 0, 0);
  if (next <= from) next.setDate(next.getDate() + 1);
  while (weekdaysOnly && (next.getDay() === 0 || next.getDay() === 6)) next.setDate(next.getDate() + 1);
  return next.getTime();
}

// One at a time per reminder, and create() replaces in place, so the alarm never
// briefly disappears while settings are being saved.
const scheduling = {};
function scheduleReminder(kind) {
  const run = async () => {
    const { alarm } = REMINDERS[kind];
    const reminder = await getReminder(kind);
    if (reminder.enabled) await chrome.alarms.create(alarm, { when: nextReminderTime(reminder) });
    else await chrome.alarms.clear(alarm);
  };
  scheduling[kind] = (scheduling[kind] || Promise.resolve()).then(run, run);
  return scheduling[kind];
}

async function remind(kind, { preview = false } = {}) {
  const r = REMINDERS[kind];
  if (!r) return { shown: false, reason: 'Unknown reminder.' };
  if (!chrome.notifications) return { shown: false, reason: 'Notifications are not allowed for this extension.' };
  let eods;
  try {
    eods = await withBadge(fetchEods());
  } catch (err) {
    notify(r.loginId, r.label, `Couldn't check your ${r.subject}. ${err.message}`);
    return { shown: true, [r.countKey]: null };
  }
  const note = r.note(eods, preview);
  if (!note) return { shown: false, [r.countKey]: r.note(eods, true).count };
  notify(r.notifyId, note.title, note.message);
  return { shown: true, [r.countKey]: note.count };
}

function notify(id, title, message) {
  chrome.notifications.create(id, {
    type: 'basic', iconUrl: 'icons/icon128.png', title, message, priority: 1, requireInteraction: true,
    buttons: [{ title: 'Remind me in 30 min' }],
  });
}

async function onAlarm(alarm) {
  if (alarm.name === BADGE_ALARM) return refreshBadge();
  for (const [kind, r] of Object.entries(REMINDERS)) {
    if (alarm.name === r.snooze) return remind(kind);
    if (alarm.name !== r.alarm) continue;
    const reminder = await getReminder(kind);
    if (reminder.enabled && Date.now() - alarm.scheduledTime < MISSED_GRACE_MS) await remind(kind);
    return scheduleReminder(kind);
  }
}

function setup() {
  chrome.alarms.create(BADGE_ALARM, { periodInMinutes: 15 });
  refreshBadge();
  for (const kind of Object.keys(REMINDERS)) scheduleReminder(kind);
}

const reminderForNotification = (id) => Object.values(REMINDERS).find((r) => r.notifyId === id || r.loginId === id);

// Notification listeners exist only once the optional permission is granted.
let notificationsWired = false;
function wireNotifications() {
  if (notificationsWired || !chrome.notifications) return;
  notificationsWired = true;
  chrome.notifications.onClicked.addListener((id) => {
    const r = reminderForNotification(id);
    if (!r) return;
    chrome.tabs.create({ url: id === r.loginId ? LOGIN_URL : r.url });
    chrome.notifications.clear(id);
  });
  chrome.notifications.onButtonClicked.addListener((id) => {
    const r = reminderForNotification(id);
    if (!r) return;
    chrome.alarms.create(r.snooze, { delayInMinutes: 30 });
    chrome.notifications.clear(id);
  });
}

chrome.runtime.onInstalled.addListener(setup);
chrome.runtime.onStartup.addListener(setup);
chrome.alarms.onAlarm.addListener(onAlarm);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  for (const [kind, r] of Object.entries(REMINDERS)) if (changes[r.key]) scheduleReminder(kind);
});
chrome.permissions.onAdded.addListener(wireNotifications);
wireNotifications();

// ---------- keyboard shortcuts ----------
// Chrome owns the key bindings (manifest "commands"): users change them at
// chrome://extensions/shortcuts, Chrome keeps them and refuses keys already in
// use. The Mantis tab's content script opens the matching panel; elsewhere
// the toolbar popup opens on the matching tab.

const SHORTCUT_COMMANDS = ['open-standup', 'open-eod'];

async function handleCommand(command, tab) {
  if (!SHORTCUT_COMMANDS.includes(command)) return;
  let handled = false;
  if (tab?.id) {
    try {
      handled = (await chrome.tabs.sendMessage(tab.id, { type: 'shortcut', command }))?.handled;
    } catch {
      // Not a Mantis page (no content script there).
    }
  }
  if (handled) return;
  // Off Mantis ticket pages both live in the toolbar popup; it reads (and clears) this once.
  if (command === 'open-standup') await chrome.storage.session?.set({ popupTab: 'standup' }).catch(() => {});
  chrome.action.openPopup?.().catch(() => {});
}

chrome.commands.onCommand.addListener(handleCommand);
