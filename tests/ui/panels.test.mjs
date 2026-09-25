// The Standup and EOD panels on Mantis pages (content.js), in headless Chrome,
// with a fake background (see harness.html).

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { findChrome, launch } from '../helpers/browser.mjs';

const ROOT = new URL('../../', import.meta.url);
const HARNESS = fs.readFileSync(new URL('tests/ui/harness.html', ROOT), 'utf8');
const chromePath = findChrome();
let browser;

// Serves the harness at https://projects.webmavens.dev/<path>, plus the extension's scripts.
const routes = {
  'https://projects.webmavens.dev/': ({ url }) => {
    const file = new URL(url).pathname.slice(1);
    if (['content.js', 'button-styles.js'].includes(file)) {
      return { body: fs.readFileSync(new URL(file, ROOT)), headers: { 'Content-Type': 'text/javascript' } };
    }
    return { body: HARNESS };
  },
};

async function openMantis(path, options = {}) {
  const page = await browser.open(`https://projects.webmavens.dev/${path}`, { routes, ...options });
  // Ready once the extension UI exists and the EOD list has been requested.
  await page.eval(`(async () => { for (let i = 0; i < 100 && !(document.querySelector('mantis-quick-standup') && T.sent.includes('fetchEods')); i++) await T.wait(20); await T.wait(150); })()`);
  return page;
}

// Runs `fn` inside the page (it can use T and the extension's shadow root) and returns its result.
const run = (page, fn) => page.eval(`(${fn})()`);

describe('Mantis panels', { skip: !chromePath && 'no Chrome/Chromium found (set CHROME_PATH)' }, () => {
  before(async () => { browser = await launch(chromePath); });
  after(async () => { await browser?.close(); });

  test('Esc closes the EOD editor first, then the EOD popup', async () => {
    const page = await openMantis('tickets/123?n=4');
    const r = await run(page, async () => {
      const root = T.root(), out = {};
      root.querySelector('.fab-eod').click(); await T.wait(100);
      out.focusOnOpen = root.activeElement?.classList.contains('panel-eod');
      root.querySelector('.eod-update-row .link-btn').click();
      root.querySelector('.eod-edit textarea').value = 'draft';
      T.key('Escape');
      out.firstEsc = { editorOpen: !!root.querySelector('.eod-edit'), popupOpen: !root.querySelector('.panel-eod').hidden, title: root.querySelector('.eod-title').textContent };
      T.key('Escape');
      out.secondEscClosed = root.querySelector('.panel-eod').hidden;
      out.leaked = T.leaked;
      return out;
    });
    assert.deepEqual(r, { focusOnOpen: true, firstEsc: { editorOpen: false, popupOpen: true, title: 'EOD (4)' }, secondEscClosed: true, leaked: 0 });
    await page.close();
  });

  test('focus stays in the EOD popup (so Esc works) after refresh, save and cancel', async () => {
    const page = await openMantis('tickets/123?n=4');
    const r = await run(page, async () => {
      const root = T.root(), out = {};
      const open = async () => { root.querySelector('.fab-eod').click(); await T.wait(100); };
      await open();
      root.querySelector('.eod-update-row .link-btn').click();
      root.querySelector('.eod-edit textarea').value = 'kept draft';
      document.dispatchEvent(new Event('visibilitychange')); await T.wait(200); // background refresh
      out.afterRefresh = { draft: root.querySelector('.eod-edit textarea')?.value, focus: root.activeElement?.tagName };
      T.key('Enter'); await T.wait(400); // save
      out.afterSave = { saved: !!root.querySelector('.eod-saved'), focus: root.activeElement?.className };
      root.querySelector('.eod-update-row .link-btn').click();
      root.querySelector('.eod-edit .link-btn').click(); // Cancel
      out.afterCancel = root.activeElement?.className;
      T.key('Escape');
      out.closed = root.querySelector('.panel-eod').hidden;
      return out;
    });
    assert.deepEqual(r, {
      afterRefresh: { draft: 'kept draft', focus: 'TEXTAREA' },
      afterSave: { saved: true, focus: 'panel panel-eod' },
      afterCancel: 'panel panel-eod',
      closed: true,
    });
    await page.close();
  });

  test('a failed EOD save shows the error and keeps the draft', async () => {
    const page = await openMantis('tickets/123?n=2&saveerr=1');
    const r = await run(page, async () => {
      const root = T.root();
      root.querySelector('.fab-eod').click(); await T.wait(100);
      root.querySelector('.eod-update-row .link-btn').click();
      root.querySelector('.eod-edit textarea').value = 'Wrote tests';
      root.querySelector('.eod-edit .submit').click(); await T.wait(400);
      return { draft: root.querySelector('.eod-edit textarea')?.value, error: root.querySelector('.eod-edit .status')?.textContent };
    });
    assert.deepEqual(r, { draft: 'Wrote tests', error: 'Standup session expired. Reload standup.webmavens.dev and try again.' });
    await page.close();
  });

  test('EOD text from the server is shown as text, never as HTML', async () => {
    const page = await openMantis('tickets/123?n=2');
    const r = await run(page, async () => {
      const root = T.root();
      return { text: root.querySelectorAll('.eod-update')[1].textContent, bold: root.querySelectorAll('.eod-update b').length };
    });
    assert.deepEqual(r, { text: 'Done <b>1</b> & shipped', bold: 0 });
    await page.close();
  });

  test('Add Standup: Esc closes, Ctrl+Enter sends, keys never reach Mantis', async () => {
    const page = await openMantis('tickets/123');
    const r = await run(page, async () => {
      const root = T.root(), out = {};
      root.querySelector('.fab-standup').click();
      out.focus = root.activeElement?.id;
      T.key('Escape');
      out.closed = root.querySelector('.panel-standup').hidden;
      root.querySelector('.fab-standup').click();
      root.querySelector('#mqs-action').value = 'Fix login';
      T.key('Enter', { ctrlKey: true }); await T.wait(200);
      out.status = root.querySelector('.panel-standup .status').textContent;
      out.cleared = root.querySelector('#mqs-action').value;
      out.refreshedEods = T.sent.filter((s) => s === 'fetchEods').length >= 2;
      out.leaked = T.leaked;
      return out;
    });
    assert.deepEqual(r, { focus: 'mqs-action', closed: true, status: '✓ Standup added for #123 (Low).', cleared: '', refreshedEods: true, leaked: 0 });
    await page.close();
  });

  test('Est Time: defaults to "-", sends what you type, resets after adding', async () => {
    const page = await openMantis('tickets/123');
    const r = await run(page, async () => {
      const root = T.root(), est = root.querySelector('.m-est'), out = {};
      root.querySelector('.fab-standup').click();
      out.default = est.value;
      est.value = ' 2h '; root.querySelector('#mqs-action').value = 'A';
      est.focus(); T.key('Enter', { ctrlKey: true }); await T.wait(200);
      out.sent = T.payloads.find((p) => p?.plannedAction === 'A')?.estTime;
      out.reset = est.value;
      est.value = '   '; root.querySelector('#mqs-action').value = 'B';
      root.querySelector('.panel-standup .submit').click(); await T.wait(200);
      out.sentWhenEmpty = T.payloads.find((p) => p?.plannedAction === 'B')?.estTime;
      est.value = '30m'; root.querySelector('#mqs-action').value = '';
      root.querySelector('.panel-standup .submit').click(); await T.wait(50);
      out.keptOnError = est.value;
      est.focus(); T.key('Escape');
      out.escCloses = root.querySelector('.panel-standup').hidden;
      return out;
    });
    assert.deepEqual(r, { default: '-', sent: '2h', reset: '-', sentWhenEmpty: '-', keptOnError: '30m', escCloses: true });
    await page.close();
  });

  test('Priority follows the ticket until you pick one; your pick is sent', async () => {
    const page = await openMantis('tickets/124?prio=Medium');
    const r = await run(page, async () => {
      const root = T.root(), select = root.querySelector('.m-priority-select'), note = root.querySelector('.m-priority-note'), out = {};
      root.querySelector('.fab-standup').click();
      out.detected = [select.value, note.textContent];
      select.value = 'High'; select.dispatchEvent(new Event('change'));
      root.querySelector('#mqs-action').value = 'Prio test';
      root.querySelector('.panel-standup .submit').click(); await T.wait(200);
      out.sent = T.payloads.find((p) => p?.plannedAction === 'Prio test')?.priority;
      out.afterAdd = select.value;
      return out;
    });
    assert.deepEqual(r, { detected: ['Medium', ''], sent: 'High', afterAdd: 'Medium' });

    const noPriority = await openMantis('tickets/125');
    const fallback = await run(noPriority, async () => {
      T.root().querySelector('.fab-standup').click();
      return [T.root().querySelector('.m-priority-select').value, T.root().querySelector('.m-priority-note').textContent];
    });
    assert.deepEqual(fallback, ['Low', '(default — not set on ticket)']);
    await page.close();
    await noPriority.close();
  });

  test('warns when the ticket already has a standup today (without blocking)', async () => {
    const notice = async (query) => {
      const page = await openMantis(`tickets/123?${query}`);
      const text = await run(page, async () => {
        T.root().querySelector('.fab-standup').click();
        const note = T.root().querySelector('.dup-note');
        return note.hidden ? null : note.textContent;
      });
      await page.close();
      return text;
    };
    assert.equal(await notice('n=2'), null);
    assert.equal(await notice('n=2&dup=1'), 'Already added today at 09:10: “Investigating the login redirect loop on staging that happens after th…”. Adding again creates another entry.');
    assert.equal(await notice('n=2&dup=2'), '2 standups already added today for #123. Adding again creates another entry.');
  });

  test('EOD header shows pending count or "All done"', async () => {
    const chip = async (query) => {
      const page = await openMantis(`tickets/123?${query}`);
      const text = await run(page, async () => {
        const el = T.root().querySelector('.eod-progress');
        return el.hidden ? null : el.textContent;
      });
      await page.close();
      return text;
    };
    assert.equal(await chip('n=4'), '2 pending');
    assert.equal(await chip('n=2&allfilled=1'), 'All done ✓');
    assert.equal(await chip('n=0'), null);
    assert.equal(await chip('n=2&err=1'), null);
  });

  test('ticket pages show both buttons; other Mantis pages only EOD', async () => {
    const buttons = async (path) => {
      const page = await openMantis(path);
      const r = await run(page, async () => {
        const root = T.root(), visible = (sel) => getComputedStyle(root.querySelector(sel)).display !== 'none';
        return {
          standup: visible('.fab-standup'), eod: visible('.fab-eod'),
          scrollHint: getComputedStyle(root.querySelector('.fab-eod'), '::after').display !== 'none',
          standupShortcut: await T.shortcut('open-standup'),
          eodShortcut: await T.shortcut('open-eod'),
          eodOpen: !root.querySelector('.panel-eod').hidden,
        };
      });
      await page.close();
      return r;
    };
    assert.deepEqual(await buttons('tickets/123'), { standup: true, eod: true, scrollHint: true, standupShortcut: { handled: true }, eodShortcut: { handled: true }, eodOpen: true });
    assert.deepEqual(await buttons('dashboard'), { standup: false, eod: true, scrollHint: false, standupShortcut: { handled: false }, eodShortcut: { handled: true }, eodOpen: true });
  });

  test('the login link in errors is clickable', async () => {
    const page = await openMantis('tickets/123?err=1');
    const href = await run(page, async () => {
      T.root().querySelector('.fab-eod').click(); await T.wait(100);
      return T.root().querySelector('.panel-eod .status a')?.href;
    });
    assert.equal(href, 'https://standup.webmavens.dev/login');
    await page.close();
  });
});
