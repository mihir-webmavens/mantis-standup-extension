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

// One end of a runtime port: what the other side sent is in `received`.
function fakePort(name) {
  const port = {
    name, received: [], disconnected: false, onMessage: event(), onDisconnect: event(),
    postMessage: (msg) => {
      if (port.disconnected) throw new Error('Attempting to use a disconnected port object');
      port.received.push(JSON.parse(JSON.stringify(msg)));
    },
    disconnect: () => { port.disconnected = true; },
  };
  return port;
}

/**
 * Loads background.js. `notifications: true` means the optional permission is granted.
 * MantisAI: `nativeMessaging: true` grants that permission; `nativeHost(request, reply)`
 * plays the helper (reply(msg) sends to the extension); `hostError` makes connecting fail
 * the way Chrome reports it (e.g. 'Specified native messaging host not found.').
 */
export function loadBackground({ server = fakeStandupServer(), storage = {}, notifications = false, tabMessage, nativeMessaging = false, nativeHost, hostError } = {}) {
  const state = { badge: { text: '', title: '', color: null }, alarms: {}, notes: {}, tabs: [], popupOpened: 0, tabMessages: [], session: {}, local: {}, nativePorts: [] };
  const events = {
    message: event(), installed: event(), startup: event(), alarm: event(), storage: event(),
    permAdded: event(), command: event(), noteClicked: event(), noteButton: event(), connect: event(),
  };
  const notificationsApi = {
    create: (id, options) => { state.notes[id] = options; },
    clear: (id) => { delete state.notes[id]; },
    onClicked: events.noteClicked,
    onButtonClicked: events.noteButton,
  };
  const connectNative = (name) => {
    const port = fakePort(name);
    port.postMessage = (msg) => {
      port.received.push(JSON.parse(JSON.stringify(msg)));
      setTimeout(() => {
        if (hostError) {
          chrome.runtime.lastError = { message: hostError };
          port.onDisconnect.fire();
          delete chrome.runtime.lastError;
          return;
        }
        nativeHost?.(msg, (reply) => { if (!port.disconnected) port.onMessage.fire(reply); });
      });
    };
    state.nativePorts.push(port);
    return port;
  };
  const chrome = {
    runtime: {
      onMessage: events.message, onInstalled: events.installed, onStartup: events.startup, onConnect: events.connect,
      connectNative: nativeMessaging ? connectNative : undefined,
    },
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
      local: { get: async (key) => ({ [key]: state.local[key] }), set: async (items) => { Object.assign(state.local, plain(items)); } },
      onChanged: events.storage,
    },
    permissions: {
      onAdded: events.permAdded,
      contains: async ({ permissions }) => permissions.every((p) => (p === 'nativeMessaging' ? nativeMessaging : p === 'notifications' ? notifications : false)),
    },
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
    // Opens a 'mantis-ai' port the way the chat panel does and sends `msg`;
    // resolves with everything received once a done/error arrives (or after `wait` ms).
    chat: (msg, { wait = 500, disconnectAfter } = {}) => new Promise((resolve) => {
      const port = fakePort('mantis-ai');
      const finish = () => resolve(port.received);
      const timer = setTimeout(finish, wait);
      port.postMessage = (reply) => {
        port.received.push(JSON.parse(JSON.stringify(reply)));
        if (reply.type === disconnectAfter) {
          port.onDisconnect.fire();
          setTimeout(() => { clearTimeout(timer); finish(); }, 20);
        } else if (reply.type === 'done' || reply.type === 'error') {
          clearTimeout(timer);
          finish();
        }
      };
      events.connect.fire(port);
      port.onMessage.fire(msg);
    }),
  };
  return bg;
}

export const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
