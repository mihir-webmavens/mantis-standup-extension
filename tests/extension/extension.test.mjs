// The real, unpacked extension in Chromium: toolbar popup (EOD tab, settings),
// the content script on Mantis pages, and background.js talking to a fake
// standup.webmavens.dev (the same one the unit tests use).

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findExtensionChromium, launch, sleep } from '../helpers/browser.mjs';
import { fakeStandupServer } from '../helpers/background.mjs';

const REPO = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const EXTENSION_FILES = ['manifest.json', 'background.js', 'content.js', 'button-styles.js', 'popup.html', 'popup.js', 'popup.css', 'icons'];
const chromium = findExtensionChromium();
const MANTIS_PAGE = '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;height:100vh"><h1>Mantis</h1><div><span>Priority</span><span>High</span></div></body></html>';

// Chrome derives an unpacked extension's id from its absolute path.
const extensionId = (dir) => [...crypto.createHash('sha256').update(dir).digest('hex').slice(0, 32)]
  .map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');

// Answers the service worker's requests from a fakeStandupServer.
function standupRoutes(server) {
  return {
    'https://standup.webmavens.dev/': async ({ url, method, postData }) => {
      const res = await server.fetch(url, { method, body: postData });
      if (res.type === 'opaqueredirect') return { status: 302, headers: { Location: 'http://standup.webmavens.dev/admin/standups/edit-standups' } };
      return { status: res.status, body: await res.text() };
    },
  };
}

async function startExtension(dir, server) {
  const browser = await launch(chromium, { extension: dir });
  const id = extensionId(dir);
  // Attach to the service worker (which keeps it alive) and route its requests.
  let worker;
  for (let i = 0; i < 50 && !worker; i++) {
    worker = (await browser.targets()).find((t) => t.url === `chrome-extension://${id}/background.js`);
    if (!worker) await sleep(200);
  }
  assert.ok(worker, 'extension service worker did not start');
  const sw = await browser.attach(worker.id);
  await sw.route(standupRoutes(server));
  return { browser, id, sw, popupUrl: `chrome-extension://${id}/popup.html` };
}

const mantisRoutes = { 'https://projects.webmavens.dev/': () => ({ body: MANTIS_PAGE }) };

describe('extension in Chromium', { skip: !chromium && 'no extension-capable Chromium found (set CHROMIUM_PATH)' }, () => {
  let ext, server;
  before(async () => {
    server = fakeStandupServer();
    ext = await startExtension(REPO, server);
  });
  after(async () => { await ext?.browser.close(); });

  test('toolbar popup opens on the EOD tab and saves an EOD', async () => {
    const popup = await ext.browser.open(ext.popupUrl, { width: 400, height: 580 });
    await popup.until(`document.querySelectorAll('.eod').length === 2`);
    const view = () => popup.eval(`JSON.stringify({
      tab: document.querySelector('.tab[aria-selected=true]').id,
      count: document.querySelector('.tab-count').hidden ? null : document.querySelector('.tab-count').textContent,
      progress: document.querySelector('.eod-progress').hidden ? null : document.querySelector('.eod-progress').textContent,
      updates: [...document.querySelectorAll('.eod-update')].map((u) => u.textContent),
    })`).then(JSON.parse);
    assert.deepEqual(await view(), { tab: 'tab-eod', count: '1', progress: '1 pending', updates: ['EOD not filled yet', 'Reviewed & merged'] });
    assert.equal(await popup.eval('chrome.action.getBadgeText({})'), '1');
    assert.equal(await popup.eval('document.documentElement.scrollWidth - document.documentElement.clientWidth'), 0);

    await popup.click(`document.querySelector('.eod.pending .pill')`);
    await popup.until(`document.activeElement.tagName === 'TEXTAREA'`, { message: 'Add EOD did not focus the text box' });
    await popup.eval(`document.activeElement.value = 'Fixed the job & deployed'`);
    await popup.key('Enter');
    await popup.until(`document.querySelector('.eod-saved')`, { message: 'EOD was not saved' });

    const posted = server.posts.at(-1);
    assert.equal(posted.path, '/admin/standups/update-standups');
    assert.equal(posted.body.get('evening_updates[10005]'), 'Fixed the job & deployed');
    assert.equal(posted.body.get('evening_updates[10006]'), 'Reviewed & merged');
    assert.deepEqual(await view(), { tab: 'tab-eod', count: null, progress: 'All done ✓', updates: ['Fixed the job & deployed', 'Reviewed & merged'] });
    assert.equal(await popup.eval(`document.querySelector('.eod-saved')?.textContent`), '✓ EOD saved.');
    assert.equal(await popup.eval('chrome.action.getBadgeText({})'), '');

    // Esc cancels an edit instead of closing the popup.
    await popup.click(`document.querySelector('.eod .pill')`);
    await popup.until(`document.querySelector('.eod-edit textarea') === document.activeElement`);
    await popup.key('Escape');
    assert.equal(await popup.eval(`!document.querySelector('.eod-edit')`), true);
    await popup.close();
  });

  test('Settings tab: style picker saves and restyles open Mantis tabs', async () => {
    const mantis = await ext.browser.open('https://projects.webmavens.dev/tickets/123', { routes: mantisRoutes });
    await mantis.until(`document.querySelector('mantis-quick-standup')`);
    const fabStyle = () => mantis.eval(`(() => {
      const css = document.querySelector('mantis-quick-standup').shadowRoot.querySelector('.fab-style').textContent;
      return ['aurora-glow', 'neon-line', 'candy-bob'].find((k) => css.includes(k));
    })()`);
    assert.equal(await fabStyle(), 'aurora-glow');

    let popup = await ext.browser.open(ext.popupUrl, { width: 400, height: 580 });
    await popup.click(`document.querySelector('#tab-settings')`);
    assert.equal(await popup.eval(`document.querySelectorAll('.card').length`), 10);
    await popup.until(`document.querySelector('.card.selected')`); // set once the saved style is read
    assert.equal(await popup.eval(`document.querySelector('.card.selected').dataset.id`), 'aurora');
    await popup.eval(`document.querySelector('.card[data-id="neon"]').click()`);
    await popup.until(`chrome.storage.sync.get('buttonStyle').then((v) => v.buttonStyle === 'neon')`);
    await mantis.until(`document.querySelector('mantis-quick-standup').shadowRoot.querySelector('.fab-style').textContent.includes('neon-line')`,
      { message: 'open tab was not restyled without reload' });
    await popup.close();

    popup = await ext.browser.open(ext.popupUrl, { width: 400, height: 580 });
    await popup.until(`document.querySelector('.card.selected')`);
    assert.equal(await popup.eval(`document.querySelector('.card.selected').dataset.id`), 'neon');
    await popup.eval(`document.querySelector('.card[data-id="aurora"]').click()`);
    await popup.until(`chrome.storage.sync.get('buttonStyle').then((v) => v.buttonStyle === 'aurora')`);
    await popup.close();
    await mantis.close();
  });

  test('Settings tab lists the keyboard shortcuts Chrome assigned', async () => {
    const popup = await ext.browser.open(ext.popupUrl, { width: 400, height: 580 });
    await popup.until(`document.querySelectorAll('.keys li').length === 2`);
    const rows = await popup.eval(`[...document.querySelectorAll('.keys li')].map((li) => [li.querySelector('.what').textContent, [...li.querySelectorAll('kbd')].map((k) => k.textContent).join('+')])`);
    assert.deepEqual(rows, [['Add Standup (Planned Action)', 'Ctrl+Shift+S'], ['EOD list', 'Ctrl+Shift+E']]);
    await popup.close();
  });

  test('keyboard shortcuts open the panels on a Mantis ticket page', async () => {
    const mantis = await ext.browser.open('https://projects.webmavens.dev/tickets/123', { routes: mantisRoutes });
    await mantis.until(`document.querySelector('mantis-quick-standup')`);
    await ext.browser.send('Target.activateTarget', { targetId: mantis.targetId });
    const fire = async (command) => {
      await ext.sw.eval(`chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => handleCommand('${command}', tab))`);
      const panel = command === 'open-standup' ? '.panel-standup' : '.panel-eod';
      await mantis.until(`!document.querySelector('mantis-quick-standup').shadowRoot.querySelector('${panel}').hidden`);
      return mantis.eval(`(() => { const r = document.querySelector('mantis-quick-standup').shadowRoot;
        return { standup: !r.querySelector('.panel-standup').hidden, eod: !r.querySelector('.panel-eod').hidden, focus: r.activeElement?.id || r.activeElement?.className || null }; })()`);
    };
    assert.deepEqual(await fire('open-standup'), { standup: true, eod: false, focus: 'mqs-action' });
    assert.deepEqual(await fire('open-eod'), { standup: false, eod: true, focus: 'panel panel-eod' });
    assert.equal(await mantis.eval(`document.querySelector('mantis-quick-standup').shadowRoot.querySelector('.m-priority-select').value`), 'High');
    await mantis.close();
  });
});

// The reminder's notifications permission is optional (Chrome asks when it is
// switched on), which a headless browser cannot answer; this copy grants it up front.
describe('EOD reminder settings (notifications granted)', { skip: !chromium && 'no extension-capable Chromium found (set CHROMIUM_PATH)' }, () => {
  let ext, dir;
  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mqs-ext-'));
    for (const file of EXTENSION_FILES) fs.cpSync(path.join(REPO, file), path.join(dir, file), { recursive: true });
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    manifest.permissions.push(...manifest.optional_permissions);
    delete manifest.optional_permissions;
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
    ext = await startExtension(dir, fakeStandupServer());
  });
  after(async () => {
    await ext?.browser.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('switching the reminder on schedules it; changes reschedule; off clears it', async () => {
    const popup = await ext.browser.open(ext.popupUrl, { width: 400, height: 580 });
    await popup.click(`document.querySelector('#tab-settings')`);
    const state = () => popup.eval(`(async () => {
      const alarm = await chrome.alarms.get('eod-reminder');
      return { on: document.querySelector('#rem-enabled').checked, stored: (await chrome.storage.sync.get('eodReminder')).eodReminder,
        alarm: alarm ? new Date(alarm.scheduledTime).toTimeString().slice(0, 5) : null };
    })()`);
    assert.deepEqual(await state(), { on: false, alarm: null });

    await popup.click(`document.querySelector('[data-reminder="eod"] .switch')`);
    await popup.until(`chrome.alarms.get('eod-reminder')`);
    assert.deepEqual(await state(), { on: true, stored: { enabled: true, time: '18:30', weekdaysOnly: true }, alarm: '18:30' });

    await popup.eval(`(() => { const t = document.querySelector('#rem-time'); t.value = '17:45'; t.dispatchEvent(new Event('change')); })()`);
    await popup.eval(`document.querySelector('#rem-weekdays').click()`);
    await popup.until(`chrome.storage.sync.get('eodReminder').then((v) => v.eodReminder.weekdaysOnly === false && v.eodReminder.time === '17:45')`);
    await popup.until(`chrome.alarms.get('eod-reminder').then((a) => a && new Date(a.scheduledTime).toTimeString().startsWith('17:45'))`);
    assert.deepEqual(await state(), { on: true, stored: { enabled: true, time: '17:45', weekdaysOnly: false }, alarm: '17:45' });

    await popup.click(`document.querySelector('#rem-preview')`);
    await popup.until(`document.querySelector('.status').textContent === 'Preview notification sent'`);
    assert.equal(await popup.eval(`document.querySelector('.status').textContent`), 'Preview notification sent');
    assert.deepEqual(Object.keys(await popup.eval('new Promise((r) => chrome.notifications.getAll(r))')), ['eod-reminder']);

    await popup.eval(`document.querySelector('#rem-enabled').click()`);
    await popup.until(`chrome.alarms.get('eod-reminder').then((a) => !a)`);
    assert.deepEqual(await state(), { on: false, stored: { enabled: false, time: '17:45', weekdaysOnly: false }, alarm: null });
    await popup.close();
  });

  test('the standup reminder is its own switch, 11:00 by default', async () => {
    const popup = await ext.browser.open(ext.popupUrl, { width: 400, height: 580 });
    await popup.click(`document.querySelector('#tab-settings')`);
    const state = () => popup.eval(`(async () => {
      const alarm = await chrome.alarms.get('standup-reminder');
      return { on: document.querySelector('#sr-enabled').checked, time: document.querySelector('#sr-time').value,
        stored: (await chrome.storage.sync.get('standupReminder')).standupReminder,
        alarm: alarm ? new Date(alarm.scheduledTime).toTimeString().slice(0, 5) : null, eodAlarm: !!(await chrome.alarms.get('eod-reminder')) };
    })()`);
    assert.deepEqual(await state(), { on: false, time: '11:00', alarm: null, eodAlarm: false });

    await popup.click(`document.querySelector('[data-reminder="standup"] .switch')`);
    await popup.until(`chrome.alarms.get('standup-reminder')`);
    assert.deepEqual(await state(), { on: true, time: '11:00', stored: { enabled: true, time: '11:00', weekdaysOnly: true }, alarm: '11:00', eodAlarm: false });
    assert.match(await popup.eval(`document.querySelector('.status').textContent`), /^Standup reminder on · 11:00 (AM )?on weekdays$/);

    await popup.click(`document.querySelector('#sr-preview')`);
    await popup.until(`document.querySelector('.status').textContent === 'Preview notification sent'`);
    assert.equal(await popup.eval(`document.querySelector('.status').textContent`), 'Preview notification sent');
    assert.ok(Object.keys(await popup.eval('new Promise((r) => chrome.notifications.getAll(r))')).includes('standup-reminder'));

    await popup.eval(`document.querySelector('#sr-enabled').click()`);
    await popup.until(`chrome.alarms.get('standup-reminder').then((a) => !a)`);
    assert.equal((await state()).alarm, null);
    await popup.close();
  });
});
