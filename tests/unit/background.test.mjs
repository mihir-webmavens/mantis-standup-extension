import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { FIXTURE, withEod, plain, fakeStandupServer, loadBackground, settle } from '../helpers/background.mjs';

const EOD_URL = 'https://standup.webmavens.dev/admin/standups/edit-standups';
const LOGIN_URL = 'https://standup.webmavens.dev/login';
const standup = { ticket: '123', plannedAction: 'Fix login', repoLink: 'https://projects.webmavens.dev/tickets/123', priority: 'High' };

describe('reading the EOD page', () => {
  test('parses every EOD row with decoded text', async () => {
    const res = await loadBackground().send('fetchEods');
    assert.equal(res.ok, true);
    assert.deepEqual(res.eods, [
      { id: '10005', ticket: '8386', plannedAction: 'Fixing the notification job for new sign-ups.', link: 'https://projects.webmavens.dev/tickets/8386',
        priority: 'Low', estTime: '-', createdAt: '2026-09-25 10:01:24', update: '' },
      { id: '10006', ticket: '8390', plannedAction: 'Reviewing the billing export & CSV format.', link: 'https://projects.webmavens.dev/tickets/8390',
        priority: 'High', estTime: '2h', createdAt: '2026-09-25 11:30:02', update: 'Reviewed & merged' },
    ]);
  });

  test('ignores table rows without an EOD input (e.g. an empty-table row)', async () => {
    const page = FIXTURE.replace(/<tbody>[\s\S]*?<\/tbody>/, '<tbody><tr><td colspan="8">No data available</td></tr></tbody>');
    const res = await loadBackground({ server: fakeStandupServer({ page }) }).send('fetchEods');
    assert.deepEqual(res, { ok: true, eods: [] });
  });

  test('explains how to log in when the session is gone', async () => {
    const res = await loadBackground({ server: fakeStandupServer({ loggedIn: false }) }).send('fetchEods');
    assert.equal(res.ok, false);
    assert.match(res.error, /not logged into standup\.webmavens\.dev/);
    assert.ok(res.error.includes(LOGIN_URL));
  });

  test('reports a page without the EOD form', async () => {
    const res = await loadBackground({ server: fakeStandupServer({ page: '<html><body>Maintenance</body></html>' }) }).send('fetchEods');
    assert.equal(res.ok, false);
    assert.match(res.error, /Could not find the EOD list/);
  });
});

describe('adding a standup', () => {
  test('posts the create form with its defaults plus our fields', async () => {
    const bg = loadBackground();
    const res = await bg.send('submitStandup', { ...standup, estTime: ' 1.5 hrs ' });
    assert.deepEqual(res, { ok: true });
    const [post] = bg.server.posts;
    assert.equal(post.path, '/admin/standups');
    assert.deepEqual(Object.fromEntries(post.body), {
      _token: 'test-csrf-token', user_id: '7', ticket: '123', planned_action: 'Fix login', repo_link: standup.repoLink,
      est_time: '1.5 hrs', support_needed: 'No', blockers_challenges: 'none', priority: 'High',
    });
  });

  test('sends "-" as Est Time when it is empty or missing', async () => {
    for (const estTime of ['', '   ', undefined]) {
      const bg = loadBackground();
      await bg.send('submitStandup', { ...standup, estTime });
      assert.equal(bg.server.posts[0].body.get('est_time'), '-');
    }
  });

  test('refuses incomplete data without posting', async () => {
    const bg = loadBackground();
    const res = await bg.send('submitStandup', { ...standup, plannedAction: '' });
    assert.equal(res.ok, false);
    assert.equal(bg.server.posts.length, 0);
  });

  test('reports an expired session (419)', async () => {
    const res = await loadBackground({ server: fakeStandupServer({ postStatus: 419 }) }).send('submitStandup', standup);
    assert.match(res.error, /session expired/);
  });

  test('reports validation errors the server flashed back', async () => {
    const res = await loadBackground({ server: fakeStandupServer({ flashErrors: ['The ticket field is required.'] }) }).send('submitStandup', standup);
    assert.equal(res.ok, false);
    assert.match(res.error, /Standup not saved: The ticket field is required\./);
  });
});

describe('saving an EOD', () => {
  test('changes only the edited row and resends the others as they are', async () => {
    const bg = loadBackground();
    const res = await bg.send('updateEod', { id: '10005', update: '  Fixed\n and "deployed" ' });
    assert.equal(res.ok, true);
    assert.deepEqual(Object.fromEntries(bg.server.posts[0].body), {
      _token: 'test-csrf-token', 'evening_updates[10005]': 'Fixed and "deployed"', 'evening_updates[10006]': 'Reviewed & merged', submit: 'Submit',
    });
    assert.deepEqual(res.eods.map((e) => e.update), ['Fixed and "deployed"', 'Reviewed & merged']);
    assert.deepEqual(bg.server.requests, ['GET /admin/standups/edit-standups', 'POST /admin/standups/update-standups', 'GET /admin/standups/edit-standups']);
  });

  test('does not claim success when the server kept the old text', async () => {
    const res = await loadBackground({ server: fakeStandupServer({ keepUpdates: false }) }).send('updateEod', { id: '10005', update: 'Done' });
    assert.equal(res.ok, false);
    assert.match(res.error, /did not keep the new EOD text/);
  });

  test('rejects an EOD that is no longer on the page', async () => {
    const bg = loadBackground();
    const res = await bg.send('updateEod', { id: '99999', update: 'Done' });
    assert.match(res.error, /no longer on the EOD page/);
    assert.equal(bg.server.posts.length, 0);
  });

  test('reports an expired session (419)', async () => {
    const res = await loadBackground({ server: fakeStandupServer({ postStatus: 419 }) }).send('updateEod', { id: '10005', update: 'Done' });
    assert.match(res.error, /session expired/);
  });
});

describe('toolbar badge', () => {
  test('shows the number of EODs without an update', async () => {
    const bg = loadBackground();
    await bg.send('fetchEods');
    assert.equal(bg.state.badge.text, '1');
    assert.equal(bg.state.badge.title, 'Mantis Quick Standup: 1 EOD pending');
  });

  test('hides when everything is filled in, and after saving the last EOD', async () => {
    const bg = loadBackground();
    await bg.send('updateEod', { id: '10005', update: 'Done' });
    assert.equal(bg.state.badge.text, '');
    assert.equal(bg.state.badge.title, 'Mantis Quick Standup: no pending EODs');
  });

  test('stays quiet when logged out, with the reason in the tooltip', async () => {
    const bg = loadBackground({ server: fakeStandupServer({ loggedIn: false }) });
    await bg.send('fetchEods');
    assert.equal(bg.state.badge.text, '');
    assert.match(bg.state.badge.title, /not logged into/);
  });

  test('refreshes every 15 minutes from install', async () => {
    const bg = loadBackground();
    await bg.events.installed.fire();
    await settle();
    assert.equal(bg.state.alarms['eod-badge'].periodInMinutes, 15);
    assert.equal(bg.state.badge.text, '1');
  });
});

describe('EOD reminder', () => {
  const at = (bg, time, weekdaysOnly, from) => new Date(bg.ctx.nextReminderTime({ time, weekdaysOnly }, from)).toString().slice(0, 21);
  const friday7pm = new Date(2026, 8, 25, 19, 0);

  test('schedules the next weekday, skipping weekends', () => {
    const bg = loadBackground();
    assert.equal(at(bg, '18:30', true, friday7pm), 'Mon Sep 28 2026 18:30');
    assert.equal(at(bg, '18:30', false, friday7pm), 'Sat Sep 26 2026 18:30');
    assert.equal(at(bg, '18:30', true, new Date(2026, 8, 25, 10, 0)), 'Fri Sep 25 2026 18:30');
    assert.equal(at(bg, '18:30', false, new Date(2026, 8, 25, 18, 30)), 'Sat Sep 26 2026 18:30');
  });

  test('is only scheduled while enabled', async () => {
    const bg = loadBackground();
    await bg.events.installed.fire();
    await settle();
    assert.equal(bg.state.alarms['eod-reminder'], undefined);
    await bg.setReminder({ enabled: true, time: '18:30', weekdaysOnly: true });
    await settle();
    assert.equal(typeof bg.state.alarms['eod-reminder'].when, 'number');
    await bg.setReminder({ enabled: false, time: '18:30', weekdaysOnly: true });
    await settle();
    assert.equal(bg.state.alarms['eod-reminder'], undefined);
  });

  test('does nothing without the notifications permission, but keeps the schedule', async () => {
    const bg = loadBackground({ storage: { eodReminder: { enabled: true, time: '18:30', weekdaysOnly: false } } });
    await bg.fireAlarm('eod-reminder');
    await settle();
    assert.deepEqual(bg.state.notes, {});
    assert.equal(typeof bg.state.alarms['eod-reminder'].when, 'number');
  });

  test('notifies about pending EODs; click opens the EOD page; snooze re-notifies', async () => {
    const bg = loadBackground({ storage: { eodReminder: { enabled: true, time: '18:30', weekdaysOnly: false } } });
    await bg.grantNotifications();
    await bg.fireAlarm('eod-reminder');
    await settle();
    assert.equal(bg.state.notes['eod-reminder'].title, '1 EOD still to fill in');
    assert.equal(bg.state.notes['eod-reminder'].message, '#8386. Click to open the EOD page.');

    await bg.events.noteButton.fire('eod-reminder');
    assert.equal(bg.state.alarms['eod-snooze'].delayInMinutes, 30);
    assert.equal(bg.state.notes['eod-reminder'], undefined);
    await bg.fireAlarm('eod-snooze');
    await settle();
    assert.ok(bg.state.notes['eod-reminder']);

    await bg.events.noteClicked.fire('eod-reminder');
    assert.deepEqual(plain(bg.state.tabs), [EOD_URL]);
  });

  test('drops a reminder missed while Chrome was closed', async () => {
    const bg = loadBackground({ storage: { eodReminder: { enabled: true, time: '18:30', weekdaysOnly: false } } });
    await bg.grantNotifications();
    await bg.fireAlarm('eod-reminder', Date.now() - 4 * 3600e3);
    await settle();
    assert.deepEqual(bg.state.notes, {});
  });

  test('stays silent when everything is filled in; preview still shows', async () => {
    const bg = loadBackground({ server: fakeStandupServer({ page: withEod(FIXTURE, '10005', 'Done') }), storage: { eodReminder: { enabled: true, time: '18:30', weekdaysOnly: false } } });
    await bg.grantNotifications();
    await bg.fireAlarm('eod-reminder');
    await settle();
    assert.deepEqual(bg.state.notes, {});
    const res = await bg.send('previewReminder');
    assert.deepEqual(res, { ok: true, shown: true, pending: 0 });
    assert.equal(bg.state.notes['eod-reminder'].title, 'No pending EODs');
  });

  test('asks you to log in when it cannot check; click opens the login page', async () => {
    const bg = loadBackground({ server: fakeStandupServer({ loggedIn: false }), storage: { eodReminder: { enabled: true, time: '18:30', weekdaysOnly: false } } });
    await bg.grantNotifications();
    await bg.fireAlarm('eod-reminder');
    await settle();
    assert.match(bg.state.notes['eod-reminder-login'].message, /not logged into/);
    await bg.events.noteClicked.fire('eod-reminder-login');
    assert.deepEqual(plain(bg.state.tabs), [LOGIN_URL]);
  });
});

describe('standup reminder', () => {
  const pad = (n) => String(n).padStart(2, '0');
  const day = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  // The fixture's two standups, dated today or yesterday.
  const datedPage = (date) => FIXTURE.replaceAll('2026-09-25', day(date));
  const today = () => datedPage(new Date());
  const yesterday = () => datedPage(new Date(Date.now() - 864e5));
  const enabled = { standupReminder: { enabled: true } };

  test('defaults to 11:00 on weekdays and is scheduled independently of the EOD reminder', async () => {
    const bg = loadBackground({ storage: { ...enabled } });
    await bg.events.installed.fire();
    await settle();
    assert.equal(new Date(bg.state.alarms['standup-reminder'].when).toTimeString().slice(0, 5), '11:00');
    assert.ok(![0, 6].includes(new Date(bg.state.alarms['standup-reminder'].when).getDay()));
    assert.equal(bg.state.alarms['eod-reminder'], undefined);
    await bg.events.storage.fire({ standupReminder: {} }, 'sync'); // changing it reschedules only itself
    await settle();
    assert.equal(bg.state.alarms['eod-reminder'], undefined);
  });

  test('notifies when no standup was added today; click opens Mantis', async () => {
    const bg = loadBackground({ server: fakeStandupServer({ page: yesterday() }), storage: { ...enabled } });
    await bg.grantNotifications();
    await bg.fireAlarm('standup-reminder');
    await settle();
    assert.equal(bg.state.notes['standup-reminder'].title, 'No standup added yet today');
    assert.match(bg.state.notes['standup-reminder'].message, /\+ Standup \(Ctrl\+Shift\+S\)/);
    await bg.events.noteClicked.fire('standup-reminder');
    assert.deepEqual(plain(bg.state.tabs), ['https://projects.webmavens.dev/']);
    assert.equal(typeof bg.state.alarms['standup-reminder'].when, 'number', 'rescheduled for the next day');
  });

  test('also notifies when the EOD page is empty', async () => {
    const page = FIXTURE.replace(/<tbody>[\s\S]*?<\/tbody>/, '<tbody></tbody>');
    const bg = loadBackground({ server: fakeStandupServer({ page }), storage: { ...enabled } });
    await bg.grantNotifications();
    await bg.fireAlarm('standup-reminder');
    await settle();
    assert.ok(bg.state.notes['standup-reminder']);
  });

  test('stays silent once a standup was added today; preview still shows', async () => {
    const bg = loadBackground({ server: fakeStandupServer({ page: today() }), storage: { ...enabled } });
    await bg.grantNotifications();
    await bg.fireAlarm('standup-reminder');
    await settle();
    assert.deepEqual(bg.state.notes, {});
    assert.deepEqual(await bg.send('previewReminder', { kind: 'standup' }), { ok: true, shown: true, added: 2 });
    assert.equal(bg.state.notes['standup-reminder'].title, '2 standups added today');
  });

  test('snoozes for 30 minutes and reminds again', async () => {
    const bg = loadBackground({ server: fakeStandupServer({ page: yesterday() }), storage: { ...enabled } });
    await bg.grantNotifications();
    await bg.fireAlarm('standup-reminder');
    await settle();
    await bg.events.noteButton.fire('standup-reminder');
    assert.equal(bg.state.alarms['standup-snooze'].delayInMinutes, 30);
    assert.equal(bg.state.alarms['eod-snooze'], undefined);
    assert.equal(bg.state.notes['standup-reminder'], undefined);
    await bg.fireAlarm('standup-snooze');
    await settle();
    assert.ok(bg.state.notes['standup-reminder']);
  });

  test('asks you to log in when it cannot check', async () => {
    const bg = loadBackground({ server: fakeStandupServer({ loggedIn: false }), storage: { ...enabled } });
    await bg.grantNotifications();
    await bg.fireAlarm('standup-reminder');
    await settle();
    assert.equal(bg.state.notes['standup-reminder-login'].title, 'Standup reminder');
    assert.match(bg.state.notes['standup-reminder-login'].message, /^Couldn't check your standups\. You are not logged into/);
    await bg.events.noteClicked.fire('standup-reminder-login');
    assert.deepEqual(plain(bg.state.tabs), [LOGIN_URL]);
  });

  test('drops a reminder missed while Chrome was closed', async () => {
    const bg = loadBackground({ server: fakeStandupServer({ page: yesterday() }), storage: { ...enabled } });
    await bg.grantNotifications();
    await bg.fireAlarm('standup-reminder', Date.now() - 4 * 3600e3);
    await settle();
    assert.deepEqual(bg.state.notes, {});
  });
});

describe('keyboard shortcuts', () => {
  test('relay the command to the Mantis tab', async () => {
    const bg = loadBackground({ tabMessage: async () => ({ handled: true }) });
    await bg.events.command.fire('open-standup', { id: 4 });
    await bg.events.command.fire('open-eod', { id: 4 });
    assert.deepEqual(plain(bg.state.tabMessages), [
      { tabId: 4, type: 'shortcut', command: 'open-standup' },
      { tabId: 4, type: 'shortcut', command: 'open-eod' },
    ]);
    assert.equal(bg.state.popupOpened, 0);
  });

  test('off Mantis, the EOD shortcut opens the toolbar popup; the Standup one does nothing', async () => {
    const bg = loadBackground(); // no content script answers
    await bg.events.command.fire('open-eod', { id: 9 });
    assert.equal(bg.state.popupOpened, 1);
    await bg.events.command.fire('open-standup', { id: 9 });
    assert.equal(bg.state.popupOpened, 1);
  });

  test('on a Mantis page that is not a ticket, only EOD is handled there', async () => {
    const bg = loadBackground({ tabMessage: async (_tab, msg) => ({ handled: msg.command === 'open-eod' }) });
    await bg.events.command.fire('open-eod', { id: 2 });
    await bg.events.command.fire('open-standup', { id: 2 });
    assert.equal(bg.state.popupOpened, 0);
  });
});
