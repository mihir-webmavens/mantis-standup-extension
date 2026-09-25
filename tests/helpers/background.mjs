// Runs background.js in a Node vm with a fake `chrome` API and a fake
// standup.webmavens.dev built from tests/fixtures/edit-standups.html.

import fs from 'node:fs';
import vm from 'node:vm';

const ROOT = new URL('../../', import.meta.url);
export const FIXTURE = fs.readFileSync(new URL('tests/fixtures/edit-standups.html', ROOT), 'utf8');
const BACKGROUND = fs.readFileSync(new URL('background.js', ROOT), 'utf8');

const escapeAttr = (v) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

// Sets the EOD text of one row, the way the server renders it.
export function withEod(html, id, value) {
  return html.replace(new RegExp(`(name="evening_updates\\[${id}\\]" value=")[^"]*`), `$1${escapeAttr(value)}`);
}

// Values cross the vm boundary with another realm's prototypes; compare plain copies.
export const plain = (value) => JSON.parse(JSON.stringify(value));

/**
 * Fake standup.webmavens.dev. Options:
 *  loggedIn      false -> every GET redirects (to /login)
 *  postStatus    'redirect' (default, success) | a number, e.g. 419 or 200
 *  keepUpdates   false -> the server ignores EOD updates
 *  flashErrors   validation messages rendered on the page after a POST
 */
export function fakeStandupServer({ page = FIXTURE, loggedIn = true, postStatus = 'redirect', keepUpdates = true, flashErrors = [] } = {}) {
  const server = { page, requests: [], posts: [] };
  let flashed = [];
  const htmlResponse = (html, status = 200) => ({ type: 'basic', ok: status < 400, status, text: async () => html });
  const redirect = () => ({ type: 'opaqueredirect', ok: false, status: 0, text: async () => '' });

  server.fetch = async (url, { method = 'GET', body } = {}) => {
    const path = new URL(url).pathname;
    server.requests.push(`${method} ${path}`);
    if (!loggedIn) return redirect();
    if (method === 'POST') {
      server.posts.push({ path, body: new URLSearchParams(body) });
      if (postStatus !== 'redirect') return htmlResponse(server.page, postStatus);
      if (keepUpdates && path.endsWith('/update-standups')) {
        for (const [name, value] of new URLSearchParams(body)) {
          const m = /^evening_updates\[(\d+)\]$/.exec(name);
          if (m) server.page = withEod(server.page, m[1], value);
        }
      }
      flashed = flashErrors;
      return redirect();
    }
    // Laravel shows flashed validation errors once, on the next page load.
    const errors = flashed.map((e) => `<span class="help-block">${e}</span>`).join('');
    flashed = [];
    return htmlResponse(server.page.replace('</form>', `${errors}</form>`));
  };
  return server;
}

function event() {
  const listeners = [];
  return { addListener: (f) => listeners.push(f), fire: (...args) => Promise.all(listeners.map((f) => f(...args))), listeners };
}

/** Loads background.js. `notifications: true` means the optional permission is granted. */
export function loadBackground({ server = fakeStandupServer(), storage = {}, notifications = false, tabMessage } = {}) {
  const state = { badge: { text: '', title: '', color: null }, alarms: {}, notes: {}, tabs: [], popupOpened: 0, tabMessages: [], session: {} };
  const events = {
    message: event(), installed: event(), startup: event(), alarm: event(), storage: event(),
    permAdded: event(), command: event(), noteClicked: event(), noteButton: event(),
  };
  const notificationsApi = {
    create: (id, options) => { state.notes[id] = options; },
    clear: (id) => { delete state.notes[id]; },
    onClicked: events.noteClicked,
    onButtonClicked: events.noteButton,
  };
  const chrome = {
    runtime: { onMessage: events.message, onInstalled: events.installed, onStartup: events.startup },
    action: {
      setBadgeText: ({ text }) => { state.badge.text = text; },
      setBadgeBackgroundColor: ({ color }) => { state.badge.color = color; },
      setTitle: ({ title }) => { state.badge.title = title; },
      openPopup: async () => { state.popupOpened++; },
    },
    alarms: {
      create: (name, info) => { state.alarms[name] = info; },
      clear: async (name) => delete state.alarms[name],
      onAlarm: events.alarm,
    },
    storage: {
      sync: { get: async (key) => ({ [key]: storage[key] }) },
      session: { set: async (items) => { Object.assign(state.session, items); } },
      onChanged: events.storage,
    },
    permissions: { onAdded: events.permAdded },
    tabs: {
      create: ({ url }) => { state.tabs.push(url); },
      sendMessage: async (tabId, msg) => {
        state.tabMessages.push({ tabId, ...msg });
        if (!tabMessage) throw new Error('Could not establish connection. Receiving end does not exist.');
        return tabMessage(tabId, msg);
      },
    },
    commands: { onCommand: events.command },
    notifications: notifications ? notificationsApi : undefined,
  };
  const context = vm.createContext({ chrome, fetch: server.fetch, URL, URLSearchParams, console, setTimeout, clearTimeout });
  vm.runInContext(BACKGROUND, context, { filename: 'background.js' });

  const bg = {
    ctx: context, chrome, server, state, storage, events,
    // Sends a runtime message the way content.js / popup.js do.
    send: (type, payload) => new Promise((resolve) => {
      const keepOpen = events.message.listeners.map((f) => f({ type, payload }, {}, (res) => resolve(plain(res))));
      if (!keepOpen.includes(true)) resolve(undefined);
    }),
    grantNotifications: () => { chrome.notifications = notificationsApi; return events.permAdded.fire(); },
    setReminder: async (reminder) => { storage.eodReminder = reminder; await events.storage.fire({ eodReminder: {} }, 'sync'); },
    fireAlarm: (name, scheduledTime = Date.now()) => events.alarm.fire({ name, scheduledTime }),
  };
  return bg;
}

export const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
