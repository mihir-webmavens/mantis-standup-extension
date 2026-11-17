// Ticket digest and time tracker in background.js: building the digest from the
// helper's tickets, the daily schedule and notification, and counting focused-tab
// time per Mantis ticket / site.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadBackground, settle, plain } from '../helpers/background.mjs';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date(2026, 10, 17, 11, 0).getTime(); // Tue 17 Nov 2026, 11:00 local

const ticket = (id, daysAgo, extra = {}) => ({
  id, project_id: 184, title: `Ticket ${id}`, priority: null, status_key: 'in_progress',
  created_at: new Date(NOW - 40 * DAY).toISOString(), updated_at: new Date(NOW - daysAgo * DAY - 60000).toISOString(), labels: [], ...extra,
});
const TESTING = { id: 5, name: 'Completed - Needs testing' };

function helper(answer) {
  const requests = [];
  return {
    requests,
    host: (request, reply) => {
      requests.push(plain(request));
      if (request.type === 'tickets') return reply(answer ?? { type: 'tickets', user: { id: 200, name: 'Dev' }, projects: [{ id: 184, name: 'socialsync' }], tickets: [] });
      reply({ type: 'error', code: 'bad-request', error: `Unknown request "${request.type}".` });
    },
  };
}

describe('ticket digest', () => {
  test('active excludes tickets waiting for testing; stale after the set days, oldest first', (t) => {
    t.mock.method(Date, 'now', () => NOW);
    const bg = loadBackground();
    const digest = plain(bg.ctx.buildDigest({
      user: { id: 200 }, projects: [{ id: 184, name: 'socialsync' }],
      tickets: [
        ticket(1, 0),
        ticket(2, 5, { priority: 'high' }),
        ticket(3, 21),
        ticket(4, 9, { labels: [TESTING] }),
        ticket(6, 1, { labels: [{ id: 9, name: '[Testing Done]' }] }),
        ticket(7, 3),
      ],
    }, 3, NOW));
    assert.deepEqual(digest.active.map((x) => [x.id, x.idleDays, x.stale]), [[3, 21, true], [2, 5, true], [7, 3, true], [1, 0, false]]);
    assert.deepEqual(digest.testing.map((x) => x.id), [4, 6]);
    assert.equal(digest.stale, 3);
    assert.equal(digest.active[0].project, 'socialsync');
    assert.equal(digest.active[1].priority, 'high');
  });

  test('Refresh asks the helper with the lookup model and keeps the result', async () => {
    const h = helper({ type: 'tickets', user: { id: 200, name: 'Dev' }, projects: [], tickets: [ticket(9436, 21), ticket(9746, 0, { labels: [TESTING] })] });
    const bg = loadBackground({ nativeMessaging: true, nativeHost: h.host, storage: { ticketDigest: { staleDays: 5 } } });
    const res = await bg.send('runDigest');
    assert.equal(res.ok, true, res.error);
    assert.deepEqual(h.requests, [{ type: 'tickets', model: 'haiku' }]);
    assert.equal(res.digest.staleDays, 5);
    assert.deepEqual(res.digest.active.map((x) => x.id), [9436]);
    assert.deepEqual(bg.state.local.ticketDigestLast.active.map((x) => x.id), [9436]);
  });

  test('two Refresh clicks share one lookup', async () => {
    const h = helper();
    const bg = loadBackground({ nativeMessaging: true, nativeHost: h.host });
    const [a, b] = await Promise.all([bg.send('runDigest'), bg.send('runDigest')]);
    assert.equal(a.ok && b.ok, true);
    assert.equal(h.requests.length, 1);
  });

  test('explains a missing MantisAI setup and an old helper', async () => {
    let res = await loadBackground().send('runDigest');
    assert.equal(res.ok, false);
    assert.match(res.error, /MantisAI is not set up/);
    const old = (request, reply) => reply({ type: 'error', code: 'bad-request', error: 'Unknown request "tickets".' });
    res = await loadBackground({ nativeMessaging: true, nativeHost: old }).send('runDigest');
    assert.match(res.error, /out of date/);
  });

  test('the daily run notifies with the stale tickets and opens Insights on click', async () => {
    const h = helper({ type: 'tickets', user: { id: 200 }, projects: [], tickets: [ticket(1, 0), ticket(2, 4), ticket(3, 12)] });
    const bg = loadBackground({ nativeMessaging: true, notifications: true, nativeHost: h.host, storage: { ticketDigest: { enabled: true, time: '10:00', weekdaysOnly: true } } });
    await bg.events.installed.fire();
    await settle();
    assert.ok(bg.state.alarms['ticket-digest']?.when > Date.now());
    await bg.fireAlarm('ticket-digest');
    await settle();
    const note = bg.state.notes['ticket-digest'];
    assert.equal(note.title, '3 active tickets · 2 stale');
    assert.match(note.message, /#3 \(12 days\), #2 \(4 days\)/);
    await bg.events.noteClicked.fire('ticket-digest');
    assert.match(bg.state.tabs.at(-1), /insights\.html$/);
  });

  test('a failed daily run says why', async () => {
    const failing = (request, reply) => reply({ type: 'error', code: 'limit', error: 'Claude is unavailable right now.' });
    const bg = loadBackground({ nativeMessaging: true, notifications: true, nativeHost: failing, storage: { ticketDigest: { enabled: true } } });
    await bg.fireAlarm('ticket-digest');
    await settle();
    assert.equal(bg.state.notes['ticket-digest'].title, 'Ticket digest failed');
    assert.match(bg.state.local.ticketDigestLast.error, /unavailable/);
  });

  test('turned off: no alarm', async () => {
    const bg = loadBackground({ storage: { ticketDigest: { enabled: false } } });
    await bg.events.installed.fire();
    await settle();
    assert.equal(bg.state.alarms['ticket-digest'], undefined);
  });
});

describe('time tracker', () => {
  const MANTIS_TICKET = { url: 'https://projects.webmavens.dev/tickets/9436', title: '#9436 Create App : SocialSync - Mantis' };
  const SITE = { url: 'https://www.github.com/acme/app/pull/12?secret=1', title: 'Private PR title' };

  // Advances the clock and runs a check, the way the minute alarm does.
  async function tick(bg, clock, ms, event = () => bg.fireAlarm('time-tracker')) {
    clock.now += ms;
    await event();
    await settle();
  }

  function load(t, opts = {}) {
    const clock = { now: NOW };
    t.mock.method(Date, 'now', () => clock.now);
    const bg = loadBackground({ tracking: true, storage: { timeTracker: { enabled: true } }, browser: { tab: MANTIS_TICKET }, ...opts });
    return { bg, clock };
  }

  test('counts the focused Mantis ticket by number and other sites by host only', async (t) => {
    const { bg, clock } = load(t);
    await bg.events.installed.fire();
    await settle();
    assert.deepEqual(plain(bg.state.alarms['time-tracker']), { periodInMinutes: 1 });
    await tick(bg, clock, 60000);
    await tick(bg, clock, 60000);
    bg.state.browser.tab = SITE;
    await tick(bg, clock, 30000, () => bg.events.tabActivated.fire({ tabId: 2 }));
    await tick(bg, clock, 60000);

    const day = bg.state.local.timeLog['2026-11-17'];
    assert.deepEqual(day, { tickets: { 9436: 150000 }, sites: { 'github.com': 60000 } });
    assert.deepEqual(bg.state.local.timeTicketTitles, { 9436: 'Create App : SocialSync' });
    assert.ok(!JSON.stringify(bg.state.local).includes('secret'), 'no paths or titles of other sites are kept');
  });

  test('nothing is counted while Chrome is in the background or on browser pages', async (t) => {
    const { bg, clock } = load(t);
    await bg.events.installed.fire();
    bg.state.browser.focused = false;
    await tick(bg, clock, 60000, () => bg.events.focusChanged.fire(-1));
    await tick(bg, clock, 60000);
    bg.state.browser.focused = true;
    bg.state.browser.tab = { url: 'chrome://extensions/' };
    await tick(bg, clock, 60000, () => bg.events.focusChanged.fire(7));
    await tick(bg, clock, 60000);
    assert.deepEqual(bg.state.local.timeLog?.['2026-11-17'] ?? { tickets: {}, sites: {} }, { tickets: { 9436: 60000 }, sites: {} });
  });

  test('going idle takes back the idle stretch; long unobserved gaps are dropped', async (t) => {
    const { bg, clock } = load(t);
    await bg.events.installed.fire();
    await settle();
    // Last input at 1 min; the minute checks keep counting until Chrome reports idle at 4 min.
    for (let i = 0; i < 3; i++) await tick(bg, clock, 60000);
    assert.equal(bg.state.local.timeLog['2026-11-17'].tickets[9436], 3 * 60000);
    await tick(bg, clock, 60000, () => { bg.state.browser.idle = 'idle'; return bg.events.idleChanged.fire('idle'); });
    assert.equal(bg.state.local.timeLog['2026-11-17'].tickets[9436], 60000, 'only the minute before the 3 idle minutes');
    await tick(bg, clock, 60000); // still idle
    assert.equal(bg.state.local.timeLog['2026-11-17'].tickets[9436], 60000);

    bg.state.browser.idle = 'active';
    await tick(bg, clock, 1000, () => bg.events.idleChanged.fire('active'));
    await tick(bg, clock, 10 * 60000); // e.g. the computer slept
    assert.equal(bg.state.local.timeLog['2026-11-17'].tickets[9436], 60000);
    await tick(bg, clock, 60000);
    assert.equal(bg.state.local.timeLog['2026-11-17'].tickets[9436], 2 * 60000, 'counting resumes after the gap');
  });

  test('going idle right after switching tabs takes nothing back from the previous tab', async (t) => {
    const { bg, clock } = load(t);
    await bg.events.installed.fire();
    await settle();
    await tick(bg, clock, 5 * 60000 / 5);
    bg.state.browser.tab = SITE;
    await tick(bg, clock, 60000, () => bg.events.tabActivated.fire({ tabId: 2 }));
    await tick(bg, clock, 60000, () => { bg.state.browser.idle = 'idle'; return bg.events.idleChanged.fire('idle'); });
    assert.deepEqual(plain(bg.state.local.timeLog['2026-11-17']), { tickets: { 9436: 2 * 60000 }, sites: {} });
  });

  test('a stretch over midnight is split between the days', async (t) => {
    const clock = { now: new Date(2026, 10, 17, 23, 59, 30).getTime() };
    t.mock.method(Date, 'now', () => clock.now);
    const bg = loadBackground({ tracking: true, storage: { timeTracker: { enabled: true } }, browser: { tab: MANTIS_TICKET } });
    await bg.events.installed.fire();
    await settle();
    await tick(bg, clock, 60000);
    assert.equal(bg.state.local.timeLog['2026-11-17'].tickets[9436], 30000);
    assert.equal(bg.state.local.timeLog['2026-11-18'].tickets[9436], 30000);
  });

  test('off, or without the permissions: nothing is counted and no alarm runs', async (t) => {
    for (const opts of [{ storage: { timeTracker: { enabled: false } } }, { tracking: false }]) {
      const { bg, clock } = load(t, opts);
      await bg.events.installed.fire();
      await settle();
      assert.equal(bg.state.alarms['time-tracker'], undefined);
      await tick(bg, clock, 60000, () => bg.events.tabActivated.fire({ tabId: 1 }));
      assert.equal(bg.state.local.timeLog, undefined);
      t.mock.restoreAll();
    }
  });

  test('days older than 90 are dropped', (t) => {
    t.mock.method(Date, 'now', () => NOW);
    const bg = loadBackground();
    const log = { '2026-08-01': {}, '2026-08-20': {}, '2026-11-17': {} };
    bg.ctx.pruneTimeLog(log, NOW);
    assert.deepEqual(Object.keys(log), ['2026-08-20', '2026-11-17']);
  });
});
