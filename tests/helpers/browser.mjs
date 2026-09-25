// Minimal headless Chrome driver over the DevTools protocol (no dependencies;
// needs Node 22+ for the global WebSocket).

import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function which(name) {
  try {
    return execFileSync('which', [name], { encoding: 'utf8' }).trim() || null;
  } catch {
    return null;
  }
}

// Playwright's Chromium: unlike branded Chrome 137+, it still honours --load-extension.
function playwrightChromium() {
  const base = path.join(os.homedir(), '.cache', 'ms-playwright');
  if (!fs.existsSync(base)) return null;
  for (const dir of fs.readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()) {
    for (const sub of ['chrome-linux64/chrome', 'chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-win/chrome.exe']) {
      const file = path.join(base, dir, sub);
      if (fs.existsSync(file)) return file;
    }
  }
  return null;
}

/** Browser for page tests: CHROME_PATH, else any installed Chrome/Chromium. */
export function findChrome() {
  return process.env.CHROME_PATH || process.env.CHROMIUM_PATH || playwrightChromium()
    || ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].map(which).find(Boolean) || null;
}

/** Browser that can load an unpacked extension: CHROMIUM_PATH, else Playwright's or distro Chromium. */
export function findExtensionChromium() {
  return process.env.CHROMIUM_PATH || playwrightChromium() || ['chromium', 'chromium-browser'].map(which).find(Boolean) || null;
}

export async function launch(executable, { extension } = {}) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mqs-test-'));
  const args = ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', `--user-data-dir=${userDataDir}`];
  if (extension) args.push(`--disable-extensions-except=${extension}`, `--load-extension=${extension}`);
  const proc = spawn(executable, [...args, 'about:blank'], { stdio: 'ignore' });

  const portFile = path.join(userDataDir, 'DevToolsActivePort');
  let port;
  for (let i = 0; i < 100 && !port; i++) {
    await sleep(100);
    if (fs.existsSync(portFile)) port = Number(fs.readFileSync(portFile, 'utf8').split('\n')[0]) || undefined;
  }
  if (!port) {
    proc.kill();
    throw new Error(`Could not start ${executable}`);
  }
  const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const ws = new WebSocket(webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  return new Browser({ proc, ws, port, userDataDir });
}

class Browser {
  constructor({ proc, ws, port, userDataDir }) {
    Object.assign(this, { proc, ws, port, userDataDir });
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = [];
    ws.onmessage = ({ data }) => {
      const msg = JSON.parse(data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject, method } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${method}: ${msg.error.message}`));
        else resolve(msg.result);
      } else {
        for (const listener of this.listeners) listener(msg);
      }
    };
  }

  send(method, params = {}, sessionId) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }

  /** Targets as listed by the HTTP endpoint (includes extension service workers). */
  async targets() {
    return (await fetch(`http://127.0.0.1:${this.port}/json`)).json();
  }

  async attach(targetId) {
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    return new Session(this, sessionId, targetId);
  }

  /**
   * Opens a page. `routes` maps a URL prefix to a function (request) -> { status, body, headers }
   * and serves those requests from the test instead of the network.
   */
  async open(url, { width = 1000, height = 700, colorScheme, routes } = {}) {
    // Start blank so size, colour scheme and routes apply before the real page loads.
    const { targetId } = await this.send('Target.createTarget', { url: 'about:blank' });
    const page = await this.attach(targetId);
    await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    if (colorScheme) await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: colorScheme }] });
    if (routes) await page.route(routes);
    await page.send('Page.enable');
    const loaded = page.waitFor('Page.loadEventFired');
    const { errorText } = await page.send('Page.navigate', { url });
    if (errorText) throw new Error(`Could not open ${url}: ${errorText}`);
    await loaded;
    return page;
  }

  // Shuts Chrome down cleanly (all helper processes), then removes its profile.
  async close() {
    const exited = new Promise((resolve) => {
      if (this.proc.exitCode !== null) return resolve();
      this.proc.once('exit', resolve);
      setTimeout(() => { this.proc.kill('SIGKILL'); resolve(); }, 5000);
    });
    try { await this.send('Browser.close'); } catch {}
    await exited;
    try { this.ws.close(); } catch {}
    // A helper process (e.g. crashpad) can still write to the profile just after exit.
    for (let i = 0; i < 10 && fs.existsSync(this.userDataDir); i++) {
      if (i) await sleep(200);
      fs.rmSync(this.userDataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  }
}

class Session {
  constructor(browser, sessionId, targetId) {
    Object.assign(this, { browser, sessionId, targetId });
  }

  send(method, params = {}) {
    return this.browser.send(method, params, this.sessionId);
  }

  waitFor(method, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), timeout);
      const listener = (msg) => {
        if (msg.sessionId !== this.sessionId || msg.method !== method) return;
        clearTimeout(timer);
        this.browser.listeners.splice(this.browser.listeners.indexOf(listener), 1);
        resolve(msg.params);
      };
      this.browser.listeners.push(listener);
    });
  }

  /** Serves matching requests (by URL prefix) from handlers: (request) -> { status, body, headers }. */
  async route(routes) {
    this.browser.listeners.push(async (msg) => {
      if (msg.method !== 'Fetch.requestPaused' || msg.sessionId !== this.sessionId) return;
      const { requestId, request } = msg.params;
      const handler = Object.entries(routes).find(([prefix]) => request.url.startsWith(prefix))?.[1];
      if (!handler) return this.send('Fetch.continueRequest', { requestId });
      const { status = 200, body = '', headers = { 'Content-Type': 'text/html; charset=utf-8' } } = await handler(request);
      await this.send('Fetch.fulfillRequest', {
        requestId, responseCode: status,
        responseHeaders: Object.entries(headers).map(([name, value]) => ({ name, value })),
        body: Buffer.from(body).toString('base64'),
      });
    });
    await this.send('Fetch.enable', { patterns: Object.keys(routes).map((prefix) => ({ urlPattern: `${prefix}*` })) });
  }

  /** Evaluates an expression (awaited) and returns its JSON value; throws on page errors. */
  async eval(expression) {
    const { result, exceptionDetails } = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
    return result.value;
  }

  /** Waits until `expression` is truthy in the page (instead of guessing a delay). */
  async until(expression, { timeout = 5000, message } = {}) {
    const deadline = Date.now() + timeout;
    for (;;) {
      try {
        if (await this.eval(`Boolean(${expression})`)) return;
      } catch {
        // not there yet (e.g. element missing)
      }
      if (Date.now() > deadline) throw new Error(message || `Timed out waiting for: ${expression}`);
      await sleep(50);
    }
  }

  /** A real (trusted) key press. */
  async key(key, { ctrl = false, shift = false } = {}) {
    const codes = { Enter: 13, Escape: 27, ArrowRight: 39, ArrowLeft: 37 };
    const modifiers = (ctrl ? 2 : 0) | (shift ? 8 : 0);
    for (const type of ['rawKeyDown', 'keyUp']) {
      await this.send('Input.dispatchKeyEvent', { type, key, code: key, windowsVirtualKeyCode: codes[key] ?? key.toUpperCase().charCodeAt(0), modifiers });
    }
  }

  /** A real mouse click at the centre of the element matched by `selectorExpression` (a JS expression). */
  async click(elementExpression) {
    const { x, y } = await this.eval(`(r => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 }))((${elementExpression}).getBoundingClientRect())`);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await this.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
    }
  }

  async screenshot(file) {
    await this.browser.send('Target.activateTarget', { targetId: this.targetId });
    await sleep(200);
    const { data } = await this.send('Page.captureScreenshot');
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
  }

  close() {
    return this.browser.send('Target.closeTarget', { targetId: this.targetId });
  }
}

export { sleep };
