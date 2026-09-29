// EOD from commits in background.js: matching empty EODs to the day's commits
// through the MantisAI helper, writing them with Claude, and the daily schedule.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadBackground, fakeStandupServer, settle, plain } from '../helpers/background.mjs';

const REPOS = ['/home/dev/app'];
const commit = (message, hash = message) => ({ repo: REPOS[0], hash, date: '2026-09-28T15:00:00+05:30', message });

// A helper that answers `commits` with `commits` and `summarize` with `summary`; records the requests.
function helper({ commits = [], errors = [], summary = 'Fixed the notification job.' } = {}) {
  const requests = [];
  const host = (request, reply) => {
    requests.push(plain(request));
    if (request.type === 'commits') return reply({ type: 'commits', commits, errors });
    if (request.type === 'summarize') return reply({ type: 'summary', text: summary });
    reply({ type: 'error', code: 'bad-request', error: `Unknown request "${request.type}".` });
  };
  return { host, requests };
}

function load({ commits, errors, summary, storage = {}, nativeMessaging = true, host } = {}) {
  const h = helper({ commits, errors, summary });
  const server = fakeStandupServer();
  const bg = loadBackground({
    server, nativeMessaging, nativeHost: host || h.host,
    storage: { autoEod: { enabled: true, time: '19:00', weekdaysOnly: false, repos: REPOS }, ...storage },
  });
  return { bg, server, requests: h.requests };
}

const eodText = (server, id) => new RegExp(`name="evening_updates\\[${id}\\]" value="([^"]*)"`).exec(server.page)[1];

describe('EOD from commits: matching', () => {
  test('ticket numbers and mentions', () => {
    const { bg } = load();
    assert.deepEqual(plain(bg.ctx.ticketNumbers('#8386, 8390')), ['8386', '8390']);
    assert.deepEqual(plain(bg.ctx.ticketNumbers('#8386 Update 2 pages')), ['8386'], 'numbers in the title do not count');
    assert.deepEqual(plain(bg.ctx.ticketNumbers('Ticket 8386')), ['8386']);
    for (const m of ['Fix #8386', '8386: fix', 'MT-8386 fix', 'fix (8386)', 'Refs 8386.', 'body\nCloses #8386']) assert.ok(bg.ctx.mentions(m, '8386'), m);
    for (const m of ['Fix #18386', 'v8386', 'width 8386px', 'bump 1.8386', '83861']) assert.equal(bg.ctx.mentions(m, '8386'), false, m);
  });

  test('fills an empty EOD whose ticket has commits today, from all of them', async () => {
    const commits = [commit('Retry the sign-up notification job #8386', 'a'), commit('8386: add a test for retries', 'b'), commit('Unrelated cleanup', 'c')];
    const { bg, server, requests } = load({ commits });
    const res = await bg.send('runAutoEod');
    assert.equal(res.ok, true, res.error);
    assert.equal(eodText(server, 10005), 'Fixed the notification job.');
    assert.equal(eodText(server, 10006), 'Reviewed &amp; merged'); // already filled: untouched
    assert.deepEqual(res.result.filled, [{ ticket: '8386', update: 'Fixed the notification job.', commits: 2 }]);

    const [git, claude] = requests;
    assert.deepEqual(git.repos, REPOS);
    const since = new Date(git.since);
    assert.equal(since.getHours() + since.getMinutes(), 0); // local midnight
    assert.equal(new Date(git.until) - since, 24 * 3600 * 1000);
    assert.equal(claude.type, 'summarize');
    assert.match(claude.prompt, /Ticket #8386/);
    assert.match(claude.prompt, /Retry the sign-up notification job #8386/);
    assert.match(claude.prompt, /add a test for retries/);
    assert.doesNotMatch(claude.prompt, /Unrelated cleanup/);
    assert.match(claude.system, /do not invent work/);
    assert.deepEqual(plain(bg.state.local.autoEodLastRun.filled), res.result.filled);
  });

  test('does nothing for an EOD without a matching commit', async () => {
    const { bg, server, requests } = load({ commits: [commit('Work on #9999')] });
    const res = await bg.send('runAutoEod');
    assert.deepEqual(res.result.filled, []);
    assert.equal(eodText(server, 10005), '');
    assert.deepEqual(requests.map((r) => r.type), ['commits']); // Claude never asked
    assert.equal(server.posts.length, 0);
  });

  test('skips git entirely when no EOD is empty', async () => {
    const { bg, server, requests } = load({ commits: [commit('#8386 fix')] });
    server.page = server.page.replace('name="evening_updates[10005]" value=""', 'name="evening_updates[10005]" value="Done by hand"');
    const res = await bg.send('runAutoEod');
    assert.equal(res.result.pending, 0);
    assert.deepEqual(requests, []);
  });

  test('keeps text typed in while Claude was writing', async () => {
    const server = fakeStandupServer();
    const h = helper({ commits: [commit('#8386 fix')] });
    const typed = (request, reply) => {
      if (request.type === 'summarize') server.page = server.page.replace('name="evening_updates[10005]" value=""', 'name="evening_updates[10005]" value="Mine"');
      h.host(request, reply);
    };
    const bg = loadBackground({ server, nativeMessaging: true, nativeHost: typed, storage: { autoEod: { enabled: true, repos: REPOS } } });
    const res = await bg.send('runAutoEod');
    assert.deepEqual(res.result.filled, []);
    assert.equal(eodText(server, 10005), 'Mine');
    assert.equal(server.posts.length, 0);
  });

  test('Preview lists the matches without asking Claude or saving', async () => {
    const { bg, server, requests } = load({ commits: [commit('Retry the job #8386\n\nDetails')] });
    const res = await bg.send('previewAutoEod');
    assert.deepEqual(res.result.matches, [{ ticket: '8386', commits: ['Retry the job #8386'] }]);
    assert.deepEqual(requests.map((r) => r.type), ['commits']);
    assert.equal(server.posts.length, 0);
    assert.equal(bg.state.local.autoEodLastRun, undefined);
  });

  test('reports repo problems, a failed summary, an old helper and missing setup', async () => {
    const repoErr = await load({ commits: [], errors: [{ repo: '/x', error: 'not a git repository' }] }).bg.send('runAutoEod');
    assert.deepEqual(repoErr.result.repoErrors, [{ repo: '/x', error: 'not a git repository' }]);

    const failing = (request, reply) => (request.type === 'commits'
      ? reply({ type: 'commits', commits: [commit('#8386 fix')], errors: [] })
      : reply({ type: 'error', code: 'auth', error: 'The Claude CLI is not logged in.' }));
    const summaryErr = await load({ host: failing }).bg.send('runAutoEod');
    assert.deepEqual(summaryErr.result.errors, [{ ticket: '8386', error: 'The Claude CLI is not logged in.' }]);

    const old = await load({ host: (req, reply) => reply({ type: 'error', code: 'bad-request', error: `Unknown request "${req.type}".` }) }).bg.send('runAutoEod');
    assert.match(old.error, /out of date.*Reinstall helper/);

    const noPermission = await load({ nativeMessaging: false }).bg.send('runAutoEod');
    assert.match(noPermission.error, /MantisAI is not set up yet/);

    const noRepos = await load({ storage: { autoEod: { enabled: true, repos: [] } } }).bg.send('runAutoEod');
    assert.match(noRepos.error, /repo folder/);
  });
});

describe('EOD from commits: schedule', () => {
  test('scheduled at 19:00 only while enabled with repo folders', async () => {
    const { bg } = load({ storage: { autoEod: { enabled: false, repos: REPOS } } });
    await bg.events.installed.fire();
    await settle();
    assert.equal(bg.state.alarms['auto-eod'], undefined);

    bg.storage.autoEod = { enabled: true, repos: REPOS };
    await bg.events.storage.fire({ autoEod: {} }, 'sync');
    await settle();
    const when = new Date(bg.state.alarms['auto-eod'].when);
    assert.equal(`${when.getHours()}:${when.getMinutes()}`, '19:0');

    bg.storage.autoEod = { enabled: true, repos: [] };
    await bg.events.storage.fire({ autoEod: {} }, 'sync');
    await settle();
    assert.equal(bg.state.alarms['auto-eod'], undefined);
  });

  test('the alarm fills EODs, notifies, and schedules the next day', async () => {
    const { bg, server } = load({ commits: [commit('#8386 fix')] });
    await bg.grantNotifications();
    await bg.fireAlarm('auto-eod');
    await settle();
    assert.equal(eodText(server, 10005), 'Fixed the notification job.');
    assert.equal(bg.state.notes['auto-eod'].title, '1 EOD filled from commits');
    assert.equal(typeof bg.state.alarms['auto-eod'].when, 'number');
    await bg.events.noteClicked.fire('auto-eod');
    assert.deepEqual(bg.state.tabs, ['https://standup.webmavens.dev/admin/standups/edit-standups']);
  });

  test('stays silent when nothing matched, and drops a run missed while Chrome was closed', async () => {
    const quiet = load({ commits: [] });
    await quiet.bg.grantNotifications();
    await quiet.bg.fireAlarm('auto-eod');
    await settle();
    assert.deepEqual(quiet.bg.state.notes, {});

    const missed = load({ commits: [commit('#8386 fix')] });
    await missed.bg.fireAlarm('auto-eod', Date.now() - 4 * 3600 * 1000);
    await settle();
    assert.deepEqual(missed.requests, []);
    assert.equal(typeof missed.bg.state.alarms['auto-eod'].when, 'number');
  });
});
