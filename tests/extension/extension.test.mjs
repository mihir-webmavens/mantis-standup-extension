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
const EXTENSION_FILES = ['manifest.json', 'background.js', 'content.js', 'button-styles.js', 'mantis-ai.js', 'mantis-header.css', 'mantis-header.js', 'header-layout.js', 'themes.js', 'mantis-theme.js', 'playground-events.js', 'playground.js', 'native-host', 'popup.html', 'popup.js', 'popup.css', 'preview.html', 'preview.css', 'preview.js', 'themes.html', 'themes.css', 'themes-gallery.js', 'icons'];
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

// A Mantis-like page (Flux header markup) that records what the first frame would show.
const HEADER_PAGE = `<!doctype html><html><head><meta charset="utf-8">
      <style>header { display: flex; align-items: center; height: 56px; } nav, .right { display: flex; gap: 8px; }</style></head>
      <body style="margin:0"><div class="layout">
      <header data-flux-header><a href="/dashboard">Mantis</a>
        <nav data-flux-navbar><a href="https://projects.webmavens.dev/tickets">Tickets</a><a href="https://projects.webmavens.dev/my-work">My Work</a>
          <a href="https://projects.webmavens.dev/tickets?unassigned=1">Unassigned</a><a href="https://projects.webmavens.dev/todos">Todos</a>
          <ui-dropdown><button type="button">GitHub</button><ui-menu><a href="https://projects.webmavens.dev/github/activity">Activity</a></ui-menu></ui-dropdown></nav>
        <div style="flex:1"></div>
        <div class="right"><ui-dropdown><button type="button" aria-label="Switch project">All projects</button></ui-dropdown><span>Mihir</span></div>
      </header>
      <script>requestAnimationFrame(() => {
        window.firstFrame = {
          visible: [...document.querySelectorAll('header nav > a, header nav > ui-dropdown > button, header ui-dropdown > button[aria-label]')].filter((el) => el.offsetParent !== null).sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left).map((el) => el.textContent),
          launcher: !!document.querySelector('header mantis-ai-launcher'),
        };
      });</script>
      <main><h1>Ticket</h1></main></div></body></html>`;
const headerRoutes = { 'https://projects.webmavens.dev/': () => ({ body: HEADER_PAGE }) };

const mantisRoutes = { 'https://projects.webmavens.dev/': () => ({ body: MANTIS_PAGE }) };

// A Mantis page that records the look on <html> when the first frame is drawn.
const LOOK_PAGE = `<!doctype html><html><head><meta charset="utf-8"></head><body>
      <script>requestAnimationFrame(() => { window.firstTheme = document.documentElement.dataset.msqTheme ?? null; });</script>
      <main><h1>Tickets</h1></main></body></html>`;
const lookRoutes = { 'https://projects.webmavens.dev/': () => ({ body: LOOK_PAGE }) };
const LOOK_IDS = ['classic', 'kinetic', 'aurora', 'graphite', 'paper', 'pop', 'neon'];

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

  test('Add Standup from any page: the shortcut opens the popup form, which submits', async () => {
    // What handleCommand leaves for the popup when no Mantis ticket page handles Ctrl+Shift+S.
    await ext.sw.eval(`chrome.storage.session.set({ popupTab: 'standup' })`);
    const popup = await ext.browser.open(ext.popupUrl, { width: 400, height: 580 });
    await popup.until(`document.activeElement?.id === 'su-action'`, { message: 'Planned Action was not focused' });
    assert.equal(await popup.eval(`document.querySelector('.tab[aria-selected=true]').id`), 'tab-standup');
    assert.deepEqual(await popup.eval(`['su-ticket', 'su-link', 'su-priority', 'su-est', 'su-support', 'su-blockers'].map((id) => document.getElementById(id).value)`),
      ['', '', 'Low', '-', 'No', 'None']);
    assert.equal(await popup.eval(`chrome.storage.session.get('popupTab').then((v) => v.popupTab ?? null)`), null, 'the flag is used once');
    assert.equal(await popup.eval('document.documentElement.scrollWidth - document.documentElement.clientWidth'), 0);

    const before = server.posts.length;
    await popup.eval(`document.getElementById('su-action').value = 'Fix the invoice export'`);
    await popup.click(`document.getElementById('su-submit')`);
    assert.match(await popup.eval(`document.querySelector('.su-status').textContent`), /ticket #.*repo \/ issue link/);
    assert.equal(server.posts.length, before, 'nothing is sent without a ticket and link');

    await popup.eval(`document.getElementById('su-ticket').value = '#456';
      document.getElementById('su-link').value = 'https://github.com/acme/app/issues/456';
      document.getElementById('su-priority').value = 'Medium';
      document.getElementById('su-blockers').value = 'Waiting on API keys'`);
    await popup.key('Enter', { ctrl: true });
    await popup.until(`document.querySelector('.su-status').textContent.startsWith('✓')`, { message: 'standup was not added' });
    assert.equal(await popup.eval(`document.querySelector('.su-status').textContent`), '✓ Standup added for #456 (Medium).');
    const body = Object.fromEntries(server.posts.at(-1).body);
    assert.equal(server.posts.at(-1).path, '/admin/standups');
    assert.deepEqual([body.ticket, body.planned_action, body.repo_link, body.priority, body.est_time, body.support_needed, body.blockers_challenges],
      ['456', 'Fix the invoice export', 'https://github.com/acme/app/issues/456', 'Medium', '-', 'No', 'Waiting on API keys']);
    assert.equal(await popup.eval(`document.getElementById('su-action').value + '|' + document.getElementById('su-blockers').value`), '|None');
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

  test('Settings → Mantis look: live previews, restyles open Mantis tabs and is kept', async () => {
    const mantis = await ext.browser.open('https://projects.webmavens.dev/tickets', { routes: lookRoutes });
    const look = () => mantis.eval(`JSON.stringify({
      theme: document.documentElement.dataset.msqTheme ?? null,
      css: document.getElementById('msq-theme')?.isConnected ?? false,
      dark: document.documentElement.classList.contains('dark'),
    })`).then(JSON.parse);
    await mantis.until(`document.readyState === 'complete'`);
    assert.deepEqual(await look(), { theme: null, css: false, dark: false }, 'Classic until a look is chosen');

    let popup = await ext.browser.open(ext.popupUrl, { width: 400, height: 580 });
    await popup.click(`document.querySelector('#tab-settings')`);
    assert.deepEqual(await popup.eval(`[...document.querySelectorAll('.look')].map((l) => l.dataset.id)`), LOOK_IDS);
    await popup.until(`document.querySelector('.look.selected')?.dataset.id === 'classic'`);
    // Every card renders its look on the stand-in page.
    await popup.until(`[...document.querySelectorAll('.look')].every((l) => {
      const doc = l.querySelector('iframe').contentDocument;
      return doc?.readyState === 'complete' && (doc.documentElement.dataset.msqTheme ?? 'classic') === l.dataset.id;
    })`, { timeout: 10000, message: 'look previews did not render' });
    assert.equal(await popup.eval('document.documentElement.scrollWidth - document.documentElement.clientWidth'), 0);

    await popup.eval(`document.querySelector('.look[data-id="neon"]').click()`);
    await popup.until(`chrome.storage.sync.get('mantisTheme').then((v) => v.mantisTheme === 'neon')`);
    await mantis.until(`document.documentElement.dataset.msqTheme === 'neon'`, { message: 'open tab was not restyled' });
    assert.deepEqual(await look(), { theme: 'neon', css: true, dark: true }, 'Neon is always dark');
    assert.equal(await popup.eval(`document.documentElement.dataset.look`), 'neon');

    // Kinetic, the motion look: featured card; its stylesheet brings the motion machinery.
    assert.equal(await popup.eval(`document.querySelector('.look.featured')?.dataset.id`), 'kinetic');
    await popup.eval(`document.querySelector('.look[data-id="kinetic"]').click()`);
    await mantis.until(`document.documentElement.dataset.msqTheme === 'kinetic'`);
    assert.deepEqual(await look(), { theme: 'kinetic', css: true, dark: false }, 'dark mode is handed back');
    assert.deepEqual(await mantis.eval(`(() => { const css = document.getElementById('msq-theme').textContent;
      return ['@property --msq-angle', 'animation-timeline: scroll(root)', 'view-transition-new(root)'].filter((s) => !css.includes(s)); })()`), []);
    await mantis.until(`!document.documentElement.hasAttribute('data-msq-switching')`, { message: 'switch reveal flag was not cleared' });

    await popup.eval(`document.querySelector('.look[data-id="aurora"]').click()`);
    await mantis.until(`document.documentElement.dataset.msqTheme === 'aurora'`);
    assert.deepEqual(await look(), { theme: 'aurora', css: true, dark: false });
    await popup.close();

    // A new tab has the look before its first frame (no flash of Classic).
    const second = await ext.browser.open('https://projects.webmavens.dev/my-work', { routes: lookRoutes });
    await second.until(`'firstTheme' in window`);
    assert.equal(await second.eval('window.firstTheme'), 'aurora');
    await second.close();

    popup = await ext.browser.open(ext.popupUrl, { width: 400, height: 580 });
    await popup.until(`document.querySelector('.look.selected')?.dataset.id === 'aurora'`);
    await popup.eval(`document.querySelector('.look[data-id="classic"]').click()`);
    await mantis.until(`!document.documentElement.hasAttribute('data-msq-theme')`);
    assert.deepEqual(await look(), { theme: null, css: false, dark: false });
    await popup.close();
    await mantis.close();
  });

  test('look gallery: previews each look full size and switches Mantis to it', async () => {
    const gallery = await ext.browser.open(`chrome-extension://${ext.id}/themes.html`, { width: 1280, height: 800 });
    await gallery.until(`document.querySelectorAll('.item').length === 7 && document.querySelector('.item.current')`);
    assert.equal(await gallery.eval(`document.querySelector('.item.current').dataset.id`), 'classic');
    assert.equal(await gallery.eval(`document.querySelector('.item[data-id="kinetic"] .motion')?.textContent`), 'Motion');
    await gallery.click(`document.querySelector('.item[data-id="pop"]')`);
    await gallery.until(`document.getElementById('frame').contentDocument?.documentElement.dataset.msqTheme === 'pop'`, { message: 'preview did not switch' });
    assert.equal(await gallery.eval(`document.getElementById('look-name').textContent`), 'Pop');
    assert.equal(await gallery.eval(`document.getElementById('use').textContent`), 'Use Pop');

    await gallery.key('ArrowDown');
    await gallery.until(`document.getElementById('frame').contentDocument?.documentElement.dataset.msqTheme === 'neon'`);
    assert.equal(await gallery.eval(`document.getElementById('frame').contentDocument.documentElement.classList.contains('dark')`), true);
    assert.equal(await gallery.eval(`document.getElementById('mode-light').disabled`), true);

    await gallery.click(`document.getElementById('use')`);
    await gallery.until(`chrome.storage.sync.get('mantisTheme').then((v) => v.mantisTheme === 'neon')`);
    await gallery.until(`document.querySelector('.item.current')?.dataset.id === 'neon' && document.getElementById('use').disabled`);
    await gallery.eval(`chrome.storage.sync.set({ mantisTheme: 'classic' })`);
    await gallery.close();
  });

  test('Kinetic playground: bugs to squash, secrets, stats in Settings, and an off switch', async () => {
    let popup = await ext.browser.open(ext.popupUrl, { width: 400, height: 580 });
    await popup.eval(`chrome.storage.sync.set({ mantisTheme: 'kinetic' })`);
    const mantis = await ext.browser.open('https://projects.webmavens.dev/tickets', { routes: lookRoutes });
    await mantis.until(`document.querySelector('mantis-playground')`, { message: 'playground did not start with Kinetic' });
    const shadow = `document.querySelector('mantis-playground').shadowRoot`;
    const stats = () => popup.eval(`chrome.storage.local.get('playStats').then((v) => v.playStats ?? null)`);

    // A bug appears (the popup's "Release bugs" uses the same swarm) and squashing it counts.
    await mantis.eval(`document.dispatchEvent(new CustomEvent('msq-play', { detail: 'swarm' }))`);
    await mantis.until(`${shadow}.querySelectorAll('.bug').length >= 1`);
    await mantis.eval(`${shadow}.querySelector('.bug').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }))`);
    await popup.until(`chrome.storage.local.get('playStats').then((v) => v.playStats?.squashed === 1)`, { message: 'squash was not counted' });
    assert.equal(await mantis.eval(`!!${shadow}.querySelector('.splat')`), true);

    // Keys typed into a field never count; the Konami code and "bugs" elsewhere are secrets.
    const keys = (target, list) => mantis.eval(`(() => { const t = ${target};
      for (const key of ${JSON.stringify(list)}) t.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, composed: true })); })()`);
    await mantis.eval(`document.body.append(Object.assign(document.createElement('input'), { id: 'field' }))`);
    await keys(`document.getElementById('field')`, ['b', 'u', 'g', 's']);
    await keys(`document.body`, ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a']);
    await popup.until(`chrome.storage.local.get('playStats').then((v) => v.playStats?.secrets?.length === 1)`);
    assert.deepEqual((await stats()).secrets, ['konami']);
    assert.ok(await mantis.eval(`${shadow}.querySelectorAll('.c').length > 20`), 'Konami confetti');
    await keys(`document.body`, ['b', 'u', 'g', 's']);
    await popup.until(`chrome.storage.local.get('playStats').then((v) => v.playStats?.secrets?.includes('bugs'))`);

    await popup.close();
    popup = await ext.browser.open(ext.popupUrl, { width: 400, height: 580 });
    await popup.click(`document.querySelector('#tab-settings')`);
    await popup.until(`document.getElementById('ps-squashed').textContent === '1'`);
    assert.equal(await popup.eval(`document.getElementById('ps-secrets').textContent`), '2/12');
    assert.equal(await popup.eval(`document.querySelectorAll('.play-secrets li.found').length`), 2);
    assert.equal(await popup.eval(`document.getElementById('play-release').disabled`), false);

    await popup.click(`document.getElementById('play-enabled')`);
    await mantis.until(`!document.querySelector('mantis-playground')`, { message: 'switching the playground off did not remove it' });
    assert.equal(await popup.eval(`document.getElementById('play-release').disabled`), true);
    await popup.eval(`chrome.storage.sync.set({ playground: true, mantisTheme: 'classic' }).then(() => chrome.storage.local.remove('playStats'))`);
    await popup.close();
    await mantis.close();
  });

  test('Kinetic playground random events: mantis, UFO, golden bug, secrets, discoveries in Settings', async () => {
    let popup = await ext.browser.open(ext.popupUrl, { width: 400, height: 580 });
    await popup.eval(`chrome.storage.sync.set({ mantisTheme: 'kinetic' }).then(() => chrome.storage.local.remove('playStats'))`);
    const mantis = await ext.browser.open('https://projects.webmavens.dev/tickets', { routes: lookRoutes });
    await mantis.until(`document.querySelector('mantis-playground')`, { message: 'playground did not start with Kinetic' });
    const shadow = `document.querySelector('mantis-playground').shadowRoot`;
    const play = (what) => mantis.eval(`document.dispatchEvent(new CustomEvent('msq-play', { detail: '${what}' }))`);
    const poke = (sel) => mantis.eval(`${shadow}.querySelector('${sel}').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }))`);
    const has = (key, id) => popup.until(`chrome.storage.local.get('playStats').then((v) => v.playStats?.${key}?.includes('${id}'))`, { message: `${key}: ${id}` });

    // A mantis walks by; saying hi is a secret with the "You found a secret!" card, and the event is discovered.
    await play('wave');
    await mantis.until(`${shadow}.querySelector('.mantis')`);
    await poke('.mantis');
    await mantis.until(`${shadow}.querySelector('.found')?.textContent.includes('You found a secret!')`);
    await has('secrets', 'walker');
    await has('seen', 'wave');

    // The UFO beams up a bug that is out; clicking it is a secret.
    await play('swarm');
    await mantis.until(`${shadow}.querySelectorAll('.bug').length >= 1`);
    await play('ufo');
    await mantis.until(`${shadow}.querySelector('.ufo.beaming')`, { timeout: 15000, message: 'UFO did not beam' });
    await poke('.ufo');
    await has('secrets', 'ufo');

    // A golden bug is a secret when squashed; the ??? thing says you weren't supposed to find it.
    await play('golden');
    await mantis.until(`${shadow}.querySelector('.bug.gold')`);
    await poke('.bug.gold');
    await has('secrets', 'golden');
    await play('mystery');
    await mantis.until(`${shadow}.querySelector('.thing.q')`);
    await poke('.thing.q');
    await mantis.until(`${shadow}.querySelector('.found')?.textContent.includes("You weren't supposed to find this.")`);
    await has('secrets', 'mystery');

    // Ctrl+Shift+M plays a random event at once (and is kept from the browser); other combos are left alone.
    const key = (mods) => mantis.eval(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'M', code: 'KeyM', ${mods}, bubbles: true, cancelable: true }))`);
    const shown = () => mantis.eval(`${shadow}.children.length + document.body.getAnimations().length`);
    const before = await shown();
    assert.equal(await key('ctrlKey: true, shiftKey: true'), false);
    assert.ok(await shown() > before, 'Ctrl+Shift+M did not start an event');
    assert.equal(await key('ctrlKey: true'), true);
    assert.equal(await key('shiftKey: true, altKey: true'), true);

    // Every event plays without breaking (each one counts as discovered once it has run).
    const ids = await popup.eval(`Object.keys(MantisPlayEvents.LIST)`);
    for (const id of ids) await play(id);
    await popup.until(`chrome.storage.local.get('playStats').then((v) => v.playStats?.seen?.length === ${ids.length})`, { message: 'not every event ran' });
    assert.ok(await mantis.eval(`${shadow}.querySelectorAll('.c').length > 20`), 'confetti from the celebration');

    await popup.close();
    popup = await ext.browser.open(ext.popupUrl, { width: 400, height: 580 });
    await popup.click(`document.querySelector('#tab-settings')`);
    await popup.until(`document.getElementById('ps-events').textContent === '${ids.length}/${ids.length}'`);
    assert.equal(await popup.eval(`document.getElementById('ps-secrets').textContent`), '4/12');
    assert.equal(await popup.eval(`document.querySelectorAll('.play-seen li').length`), ids.length);

    await popup.eval(`chrome.storage.sync.set({ mantisTheme: 'classic' }).then(() => chrome.storage.local.remove('playStats'))`);
    await mantis.until(`!document.querySelector('mantis-playground')`);
    await popup.close();
    await mantis.close();
  });

  test('fresh install shows every header tab; the Header tab hides and reorders them', async () => {
    assert.deepEqual(await ext.sw.eval(`chrome.storage.sync.get('headerLayout').then((v) => v.headerLayout)`), { order: [], hidden: [] });
    const mantis = await ext.browser.open('https://projects.webmavens.dev/tickets/8815', { routes: headerRoutes });
    const shown = () => mantis.eval(`[...document.querySelectorAll('header nav > *, header ui-dropdown:has(> button[aria-label])')]
      .filter((el) => el.offsetParent !== null).sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)
      .map((el) => el.getAttribute('data-msq-tab'))`);
    await ext.sw.until(`chrome.storage.local.get('headerItems').then((v) => v.headerItems?.length === 6)`);
    assert.deepEqual(await shown(), ['tickets', 'my-work', 'unassigned', 'todos', 'github', 'project-switcher']);

    let popup = await ext.browser.open(ext.popupUrl, { width: 400, height: 580 });
    await popup.eval(`document.querySelector('#tab-header').click()`);
    await popup.until(`document.querySelectorAll('.hdr-item').length === 6`);
    const rows = () => popup.eval(`[...document.querySelectorAll('.hdr-item')].map((li) => li.querySelector('.hdr-name').textContent + (li.querySelector('input').checked ? '' : ' (off)'))`);
    assert.deepEqual(await rows(), ['Tickets', 'My Work', 'Unassigned', 'Todos', 'GitHub', 'Project switcher']);

    // Hide Todos and the project switcher.
    await popup.eval(`['todos', 'project-switcher'].forEach((k) => document.querySelector('.hdr-item[data-key="' + k + '"] input').click())`);
    await mantis.until(`!document.querySelector('[data-msq-tab="todos"]').offsetParent && !document.querySelector('[data-msq-tab="project-switcher"]').offsetParent`);
    // Keyboard: My Work up. Drag and drop: GitHub onto the top half of My Work.
    await popup.eval(`document.querySelector('.hdr-item[data-key="my-work"] .hdr-grip').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))`);
    await popup.eval(`(() => {
      const drag = (type, target, y) => target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, clientY: y, dataTransfer: new DataTransfer() }));
      const github = document.querySelector('.hdr-item[data-key="github"]');
      const myWork = document.querySelector('.hdr-item[data-key="my-work"]');
      drag('dragstart', github, 0);
      drag('dragover', myWork, myWork.getBoundingClientRect().top + 2);
      drag('dragend', github, 0);
    })()`);
    const expected = ['GitHub', 'My Work', 'Tickets', 'Unassigned', 'Todos (off)', 'Project switcher (off)'];
    assert.deepEqual(await rows(), expected);
    await mantis.until(`document.querySelector('[data-msq-tab="github"]').getBoundingClientRect().left < document.querySelector('[data-msq-tab="tickets"]').getBoundingClientRect().left`);
    assert.deepEqual(await shown(), ['github', 'my-work', 'tickets', 'unassigned']);

    // Kept after reopening the popup and reloading Mantis.
    await popup.close();
    popup = await ext.browser.open(ext.popupUrl, { width: 400, height: 580 });
    await popup.until(`document.querySelectorAll('.hdr-item').length === 6`);
    assert.deepEqual(await rows(), expected);
    await mantis.close();
    const reloaded = await ext.browser.open('https://projects.webmavens.dev/tickets/8815', { routes: headerRoutes });
    await reloaded.until(`window.firstFrame`);
    assert.deepEqual(await reloaded.eval(`window.firstFrame.visible`), ['GitHub', 'My Work', 'Tickets', 'Unassigned']);

    // Reset shows every tab in Mantis's order.
    await popup.eval(`document.querySelector('#hdr-reset').click()`);
    await reloaded.until(`document.querySelector('[data-msq-tab="todos"]').offsetParent !== null`);
    assert.deepEqual(await rows(), ['Tickets', 'My Work', 'Unassigned', 'Todos', 'GitHub', 'Project switcher']);
    await popup.close();
    await reloaded.close();
  });

  test('no flicker: header items are hidden and MantisAI is in the header before the first frame is drawn', async () => {
    // Existing users (no saved header layout) keep the pre-1.8 hidden items. The
    // first visit may still carry an older layout in the page's mirror; the second
    // shows what a normal page load draws.
    await ext.sw.eval(`chrome.storage.sync.remove('headerLayout')`);
    const first = await ext.browser.open('https://projects.webmavens.dev/tickets/8815', { routes: headerRoutes });
    await first.until(`localStorage.getItem('msq-header-layout') === '{"layout":null}'`);
    await first.close();
    const mantis = await ext.browser.open('https://projects.webmavens.dev/tickets/8815', { routes: headerRoutes });
    await mantis.until(`window.firstFrame`);
    assert.deepEqual(await mantis.eval(`window.firstFrame`), { visible: ['Tickets', 'My Work'], launcher: true });
    await mantis.close();
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
    // What the popup's Add Standup form pre-fills from this ticket.
    assert.deepEqual(await ext.sw.eval(`chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => chrome.tabs.sendMessage(tab.id, { type: 'ticketInfo' }))`),
      { ticket: '123', link: 'https://projects.webmavens.dev/tickets/123', priority: 'High' });
    await mantis.close();
  });

  test('Settings → MantisAI: not set up yet; the installer carries this extension id and the helper', async () => {
    const popup = await ext.browser.open(ext.popupUrl, { width: 400, height: 580 });
    await popup.click(`document.querySelector('#tab-settings')`);
    await popup.until(`document.querySelector('.ai-state').textContent !== 'Checking…'`);
    const view = await popup.eval(`JSON.stringify({
      state: document.querySelector('.ai-state').textContent,
      current: document.querySelector('.ai-steps li.current')?.dataset.step,
    })`).then(JSON.parse);
    assert.deepEqual(view, { state: 'Not set up', current: 'allow' });

    // Capture the download instead of saving it.
    await popup.eval(`(() => { window.blobs = []; URL.createObjectURL = (b) => { window.blobs.push(b); return 'blob:test'; }; })()`);
    await popup.eval(`document.querySelector('#ai-download').click()`);
    await popup.until(`window.blobs.length === 1`);
    const installer = await popup.eval(`window.blobs[0].text()`);
    assert.ok(installer.startsWith('#!/usr/bin/env bash'));
    assert.ok(installer.includes(`EXT_ID="\${1:-${ext.id}}"`));
    const helper = fs.readFileSync(path.join(REPO, 'native-host/mantis-ai-host.mjs'), 'utf8');
    assert.ok(installer.endsWith(`\n__MANTIS_AI_HOST__\n${helper}`));
    await popup.close();
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

  test('MantisAI with the permission but no helper installed says so', async () => {
    const popup = await ext.browser.open(ext.popupUrl, { width: 400, height: 580 });
    await popup.until(`!['Checking…', 'Not set up'].includes(document.querySelector('.ai-state').textContent)`);
    assert.deepEqual(await popup.eval(`JSON.stringify([document.querySelector('.ai-state').textContent, document.querySelector('.ai-steps li.current')?.dataset.step])`).then(JSON.parse),
      ['Helper not installed', 'install']);
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
