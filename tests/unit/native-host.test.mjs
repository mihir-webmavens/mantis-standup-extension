// The MantisAI native helper (native-host/mantis-ai-host.mjs), driven over
// Chrome's native messaging framing with a fake Claude CLI (fixtures/fake-claude.mjs).

import { test, describe } from 'node:test';
import { isReadOnly, isDigestCall } from '../../native-host/mantis-ai-host.mjs';
import { makePdf } from '../helpers/pdf.mjs';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = new URL('../../', import.meta.url);
const HOST = new URL('native-host/mantis-ai-host.mjs', ROOT).pathname;
const FAKE_CLAUDE = new URL('tests/fixtures/fake-claude.mjs', ROOT).pathname;

// Starts the helper, sends `request`, and collects replies until done/error/pong.
// `onApproval(msg)` returns the user's answer (true/false) or undefined for none.
// `onPdfFetch(msg)` plays the extension's download: returns { bytes, filename } or { error } / { tooLarge, size }.
function talk(request, { mode = 'reply', claude = FAKE_CLAUDE, stopAfter, tool, mcp, onApproval, onPdfFetch, env = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mantis-ai-test-'));
  const log = path.join(dir, 'claude.json');
  const host = spawn(process.execPath, [HOST], {
    env: {
      ...process.env, MANTIS_AI_CLAUDE: claude, MANTIS_AI_HOME: dir, FAKE_CLAUDE_MODE: mode, FAKE_CLAUDE_LOG: log,
      FAKE_CLAUDE_TOOL: JSON.stringify(tool || {}), FAKE_CLAUDE_MCP: mcp || 'connected', ...env,
    },
  });
  const replies = [];
  let buf = Buffer.alloc(0);
  return new Promise((resolve) => {
    const end = () => {
      host.stdin.end();
      host.on('close', (code) => {
        const claudeRun = fs.existsSync(log) ? JSON.parse(fs.readFileSync(log, 'utf8')) : null;
        const hook = fs.existsSync(`${log}.hook`) ? JSON.parse(fs.readFileSync(`${log}.hook`, 'utf8')) : null;
        const pdf = fs.existsSync(`${log}.pdf`) ? JSON.parse(fs.readFileSync(`${log}.pdf`, 'utf8')) : null;
        fs.rmSync(dir, { recursive: true, force: true });
        resolve({ replies, claudeRun, hook, pdf, exitCode: code, dir });
      });
    };
    host.stdout.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 4 && buf.length >= 4 + buf.readUInt32LE(0)) {
        const len = buf.readUInt32LE(0);
        const msg = JSON.parse(buf.subarray(4, 4 + len).toString('utf8'));
        buf = buf.subarray(4 + len);
        replies.push(msg);
        if (msg.type === 'approval' && onApproval) {
          const allow = onApproval(msg);
          if (allow !== undefined) send({ type: 'approve', id: msg.id, allow });
        }
        if (msg.type === 'pdf_fetch' && onPdfFetch) {
          const file = onPdfFetch(msg);
          if (file.bytes) {
            for (let i = 0; i < file.bytes.length; i += 4096) send({ type: 'pdf_chunk', id: msg.id, data: file.bytes.subarray(i, i + 4096).toString('base64') });
            send({ type: 'pdf_end', id: msg.id, size: file.bytes.length, filename: file.filename });
          } else {
            send({ type: 'pdf_end', id: msg.id, ...file });
          }
        }
        if (['done', 'error', 'pong', 'commits', 'summary', 'tickets'].includes(msg.type) || msg.type === stopAfter) end();
      }
    });
    const send = (msg) => {
      const body = Buffer.from(JSON.stringify(msg));
      const header = Buffer.alloc(4);
      header.writeUInt32LE(body.length);
      host.stdin.write(Buffer.concat([header, body]));
    };
    send(request);
  });
}

describe('MantisAI helper', () => {
  test('ping reports the Claude CLI version', async () => {
    const { replies } = await talk({ type: 'ping' });
    assert.deepEqual(replies, [{ type: 'pong', hostVersion: '1.4.0', claudeVersion: '9.9.9 (Claude Code)' }]);
  });

  test('streams a reply and returns the conversation id', async () => {
    const { replies, claudeRun } = await talk({ type: 'chat', prompt: 'Summarize #123', system: 'You are MantisAI.\n<page>ticket</page>' });
    assert.deepEqual(replies, [
      { type: 'session', sessionId: '11111111-2222-4333-8444-555555555555' },
      { type: 'mantis', status: 'connected' },
      { type: 'delta', text: 'Hello ' },
      { type: 'delta', text: '**there**' },
      { type: 'done', sessionId: '11111111-2222-4333-8444-555555555555', text: 'Hello **there**' },
    ]);
    // The question goes over stdin, the system prompt through a file.
    assert.equal(claudeRun.stdin, 'Summarize #123');
    assert.equal(claudeRun.system, 'You are MantisAI.\n<page>ticket</page>');
    assert.ok(claudeRun.cwd.endsWith(`${path.sep}workspace`));
  });

  test('runs claude locked down: only the Mantis MCP server, behind the gate, nothing pre-allowed', async () => {
    const { claudeRun } = await talk({ type: 'chat', prompt: 'hi' });
    const { args } = claudeRun;
    assert.deepEqual(args.slice(0, 5), ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages']);
    assert.equal(args[args.indexOf('--tools') + 1], '');
    assert.equal(args[args.indexOf('--setting-sources') + 1], '');
    assert.ok(args.includes('--strict-mcp-config'));
    assert.ok(args.includes('--disable-slash-commands'));
    // Nothing is pre-allowed: a failing gate means the CLI refuses the call.
    assert.ok(!args.some((a) => /allowed-?tools|dangerously|permission-mode/i.test(a)));
    assert.ok(!args.includes('--resume') && !args.includes('--model'));
  });

  test('continues a conversation and passes a known model', async () => {
    const sessionId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const { claudeRun, replies } = await talk({ type: 'chat', prompt: 'and then?', sessionId, model: 'haiku' });
    assert.equal(claudeRun.args[claudeRun.args.indexOf('--resume') + 1], sessionId);
    assert.equal(claudeRun.args[claudeRun.args.indexOf('--model') + 1], 'haiku');
    assert.equal(replies.at(-1).sessionId, sessionId);
  });

  test('rejects bad requests without starting claude', async () => {
    const bad = await talk({ type: 'chat', prompt: 'hi', sessionId: '--dangerously-skip-permissions' });
    assert.deepEqual(bad.replies, [{ type: 'error', code: 'bad-request', error: 'Invalid conversation id.' }]);
    assert.equal(bad.claudeRun, null);
    const empty = await talk({ type: 'chat', prompt: '  ' });
    assert.equal(empty.replies[0].code, 'bad-request');
    const model = await talk({ type: 'chat', prompt: 'hi', model: '--tools default' });
    assert.ok(!model.claudeRun.args.includes('--model'));
  });

  test('explains a missing conversation, a logged-out CLI and a crash', async () => {
    const stale = await talk({ type: 'chat', prompt: 'hi', sessionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' }, { mode: 'stale' });
    assert.equal(stale.replies.at(-1).code, 'session-missing');
    const auth = await talk({ type: 'chat', prompt: 'hi' }, { mode: 'auth' });
    assert.deepEqual(auth.replies.at(-1), { type: 'error', code: 'auth', error: 'The Claude CLI is not logged in. Run `claude` in a terminal, log in, then try again.' });
    const crash = await talk({ type: 'chat', prompt: 'hi' }, { mode: 'crash' });
    assert.deepEqual(crash.replies.at(-1), { type: 'error', code: 'claude-error', error: 'Something broke badly' });
  });

  test('reports a missing Claude CLI', async () => {
    const { replies } = await talk({ type: 'ping' }, { claude: '/nonexistent/claude' });
    assert.equal(replies.length, 1);
    assert.equal(replies[0].code, 'claude-missing');
  });

  test('closing the port (Stop) ends claude and the helper', async () => {
    const started = Date.now();
    const { replies, exitCode } = await talk({ type: 'chat', prompt: 'hi' }, { mode: 'hang', stopAfter: 'session' });
    assert.deepEqual(replies.map((r) => r.code || r.type).filter((t) => t !== 'mantis'), ['session', 'stopped']);
    assert.equal(exitCode, 0);
    assert.ok(Date.now() - started < 5000);
  });
});

describe('MantisAI gate (Mantis tool calls)', () => {
  test('knows which actions only read', () => {
    const t = (tool, action) => isReadOnly(`mcp__webmavens-projects__${tool}`, { action });
    assert.ok(t('whoami') && t('lookups', 'list_users') && t('tickets', 'get') && t('tickets', 'list') && t('notes', 'timeline'));
    assert.ok(t('todos', 'list') && t('brief', 'get') && t('chat', 'search') && t('attachments', 'download'));
    for (const [tool, action] of [['tickets', 'change_status'], ['tickets', 'delete'], ['tickets', 'mark_read'], ['notes', 'create'], ['todos', 'toggle_creator'],
      ['brief', 'append'], ['chat', 'send'], ['chat', 'react'], ['attachments', 'upload'], ['tickets', undefined], ['constructor', 'get'], ['unknown', 'list']]) {
      assert.equal(t(tool, action), false, `${tool} ${action}`);
    }
    assert.equal(isReadOnly('mcp__other-server__tickets', { action: 'get' }), false);
  });

  test('a lookup runs without asking', async () => {
    const tool = { name: 'mcp__webmavens-projects__tickets', input: { action: 'get', ticket_id: 8361 } };
    const { replies, hook } = await talk({ type: 'chat', prompt: 'read it' }, { mode: 'tool', tool, onApproval: () => assert.fail('asked for approval') });
    assert.equal(hook.permissionDecision, 'allow');
    assert.deepEqual(replies.filter((r) => r.type.startsWith('tool')), [
      { type: 'tool', id: 'toolu_1', tool: 'tickets', input: { action: 'get', ticket_id: 8361 } },
      { type: 'tool_result', id: 'toolu_1', isError: false },
    ]);
    assert.equal(replies.at(-1).text, 'ran');
  });

  test('a change waits for the user: approved runs', async () => {
    const tool = { name: 'mcp__webmavens-projects__tickets', input: { action: 'change_status', ticket_id: 8361, status_key: 'resolved' } };
    const { replies, hook } = await talk({ type: 'chat', prompt: 'resolve it' }, { mode: 'tool', tool, onApproval: () => true });
    assert.deepEqual(replies.find((r) => r.type === 'approval'), { type: 'approval', id: 1, toolUseId: 'toolu_1', tool: 'tickets', input: tool.input });
    assert.equal(hook.permissionDecision, 'allow');
    assert.equal(replies.at(-1).text, 'ran');
  });

  test('a change waits for the user: denied is blocked', async () => {
    const tool = { name: 'mcp__webmavens-projects__notes', input: { action: 'create', ticket_id: 8361, body_markdown: 'Fixed.' } };
    const { replies, hook } = await talk({ type: 'chat', prompt: 'post it' }, { mode: 'tool', tool, onApproval: () => false });
    assert.equal(hook.permissionDecision, 'deny');
    assert.match(replies.at(-1).text, /^blocked: The user declined this change/);
    assert.deepEqual(replies.find((r) => r.type === 'tool_result'), { type: 'tool_result', id: 'toolu_1', isError: true });
  });

  test('an unanswered change is denied when it times out', async () => {
    const tool = { name: 'mcp__webmavens-projects__chat', input: { action: 'send', room_id: 1, body: 'hi' } };
    const { hook } = await talk({ type: 'chat', prompt: 'send it' }, { mode: 'tool', tool, env: { MANTIS_AI_APPROVAL_TIMEOUT_MS: '300' } });
    assert.equal(hook.permissionDecision, 'deny');
  });

  test('tools from anywhere else are refused', async () => {
    const tool = { name: 'Bash', input: { command: 'rm -rf ~' } };
    const { hook, replies } = await talk({ type: 'chat', prompt: 'x' }, { mode: 'tool', tool, onApproval: () => true });
    assert.equal(hook.permissionDecision, 'deny');
    assert.ok(!replies.some((r) => r.type === 'approval'));
  });

  test('reports when the Mantis connection is not signed in', async () => {
    const { replies } = await talk({ type: 'chat', prompt: 'hi' }, { mcp: 'needs-auth' });
    assert.deepEqual(replies.find((r) => r.type === 'mantis'), { type: 'mantis', status: 'needs-auth' });
  });
});

describe('MantisAI helper: EOD from commits', () => {
  // A throwaway repo with commits by the user and by a teammate, at fixed times.
  function repo() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mantis-ai-repo-'));
    const git = (args, env = {}) => spawnSync('git', ['-C', dir, ...args], { env: { ...process.env, ...env } });
    git(['init', '-q', '-b', 'main']);
    git(['config', 'user.email', 'Me@Example.com']);
    git(['config', 'user.name', 'Me']);
    const commit = (message, date, email = 'me@example.com') => git(['commit', '-q', '--allow-empty', '-m', message],
      { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date, GIT_AUTHOR_EMAIL: email });
    commit('Old work #8386', '2026-09-27T12:00:00Z');
    commit('Retry the job #8386\n\nWith a backoff.', '2026-09-28T09:00:00Z');
    commit('Teammate on #8386', '2026-09-28T10:00:00Z', 'mate@example.com');
    git(['checkout', '-q', '-b', 'feature']);
    commit('Feature branch work #8390', '2026-09-28T11:00:00Z');
    return dir;
  }
  const day = { since: '2026-09-28T00:00:00Z', until: '2026-09-29T00:00:00Z' };

  test('lists the user\'s own commits of the day on every branch', async () => {
    const dir = repo();
    const { replies } = await talk({ type: 'commits', repos: [dir, '/nonexistent/repo'], ...day }, { stopAfter: 'commits' });
    fs.rmSync(dir, { recursive: true, force: true });
    const [reply] = replies;
    assert.equal(reply.type, 'commits');
    assert.deepEqual(reply.commits.map((c) => c.message).sort(), ['Feature branch work #8390', 'Retry the job #8386\n\nWith a backoff.']);
    assert.ok(reply.commits.every((c) => c.repo === dir && /^[0-9a-f]{40}$/.test(c.hash)));
    assert.equal(reply.errors.length, 1);
    assert.equal(reply.errors[0].repo, '/nonexistent/repo');
  });

  test('refuses relative paths and bad times', async () => {
    const rel = await talk({ type: 'commits', repos: ['projects/app'], ...day });
    assert.equal(rel.replies[0].code, 'bad-request');
    const bad = await talk({ type: 'commits', repos: ['/tmp'], since: 'x', until: day.until });
    assert.equal(bad.replies[0].code, 'bad-request');
  });

  test('summarize runs claude with no tools, no MCP servers and no session in the chat workspace', async () => {
    const { replies, claudeRun } = await talk({ type: 'summarize', prompt: 'Ticket #8386 ...', system: 'Write the EOD.', model: 'haiku' }, { stopAfter: 'summary' });
    assert.deepEqual(replies, [{ type: 'summary', text: 'Hello **there**' }]);
    const { args } = claudeRun;
    assert.equal(args[args.indexOf('--tools') + 1], '');
    assert.ok(args.includes('--strict-mcp-config') && !args.includes('--mcp-config') && !args.includes('--settings'));
    assert.ok(!args.some((a) => /allowed-?tools|dangerously|permission-mode|resume/i.test(a)));
    assert.equal(args[args.indexOf('--model') + 1], 'haiku');
    assert.equal(claudeRun.stdin, 'Ticket #8386 ...');
    assert.equal(claudeRun.system, 'Write the EOD.');
    assert.ok(claudeRun.cwd.endsWith(`${path.sep}eod`));
  });

  test('summarize explains a logged-out CLI', async () => {
    const { replies } = await talk({ type: 'summarize', prompt: 'x', system: 'y' }, { mode: 'auth' });
    assert.equal(replies.at(-1).code, 'auth');
  });
});

describe('MantisAI helper: ticket digest', () => {
  const M = 'mcp__webmavens-projects__';
  const item = (id, status_key) => ({ id, status_key, title: `T${id}`, project_id: 1, updated_at: '2026-11-10T10:00:00+00:00', labels: [] });
  const list = (status_key, extra = {}) => ({ action: 'list', status_key, assignee_id: 200, limit: 100, ...extra });
  const WHO = { name: `${M}whoami`, input: {}, result: { user_id: 200, name: 'Dev', role: 'developer' } };
  const PROJECTS = { name: `${M}lookups`, input: { action: 'list_projects' }, result: { action: 'list_projects', data: [{ id: 1, name: 'App', slug: 'app' }] } };
  const page = (status, items, next = null, cursor) => ({ name: `${M}tickets`, input: list(status, cursor ? { cursor } : {}), result: { items, next_cursor: next } });
  const run = (calls) => talk({ type: 'tickets', model: 'haiku' }, { mode: 'calls', env: { FAKE_CLAUDE_CALLS: JSON.stringify(calls) } });

  test('only whoami, list_projects and tickets list pass the gate', () => {
    assert.ok(isDigestCall(`${M}whoami`, {}) && isDigestCall(`${M}lookups`, { action: 'list_projects' }) && isDigestCall(`${M}tickets`, { action: 'list' }));
    for (const [tool, action] of [['tickets', 'get'], ['tickets', 'change_status'], ['lookups', 'list_users'], ['notes', 'list'], ['chat', 'send']]) {
      assert.equal(isDigestCall(`${M}${tool}`, { action }), false, `${tool} ${action}`);
    }
    assert.equal(isDigestCall('mcp__other__tickets', { action: 'list' }), false);
  });

  test('returns every page of each status, read from the lookups themselves', async () => {
    const { replies, claudeRun, hook } = await run([
      WHO, PROJECTS,
      page('new', []),
      page('assigned', [item(1, 'assigned')], 'c2'),
      page('assigned', [item(2, 'assigned')], null, 'c2'),
      page('in_progress', [item(3, 'in_progress')]),
      { name: `${M}tickets`, input: { action: 'change_status', ticket_id: 3, status_key: 'resolved' }, result: {} },
    ]);
    const reply = replies.at(-1);
    assert.equal(reply.type, 'tickets', reply.error);
    assert.deepEqual(reply.user, { id: 200, name: 'Dev' });
    assert.deepEqual(reply.projects, [{ id: 1, name: 'App' }]);
    assert.deepEqual(reply.tickets.map((t) => t.id), [1, 2, 3]);
    assert.equal(hook.at(-1).permissionDecision, 'deny', 'a change is refused');
    assert.ok(hook.slice(0, -1).every((d) => d.permissionDecision === 'allow'));
    const { args } = claudeRun;
    assert.equal(args[args.indexOf('--tools') + 1], '');
    assert.ok(args.includes('--strict-mcp-config') && args.includes('--no-session-persistence'));
    assert.ok(!args.some((a) => /allowed-?tools|dangerously|permission-mode|resume/i.test(a)));
    assert.equal(args[args.indexOf('--model') + 1], 'haiku');
  });

  test('refuses a partial list: a page not fetched, a status missing, someone else\'s tickets', async () => {
    for (const calls of [
      [WHO, page('new', []), page('assigned', [item(1, 'assigned')], 'c2'), page('in_progress', [])],
      [WHO, page('new', []), page('in_progress', [])],
      [WHO, page('new', []), page('assigned', []), { ...page('in_progress', []), input: list('in_progress', { assignee_id: 7 }) }],
    ]) {
      const { replies } = await run(calls);
      assert.equal(replies.at(-1).code, 'incomplete', JSON.stringify(replies.at(-1)));
    }
    const { replies } = await run([page('new', [])]);
    assert.match(replies.at(-1).error, /whoami/);
  });
});

describe('MantisAI helper: PDF attachments (read_pdf)', () => {
  const hasPoppler = spawnSync('pdftoppm', ['-v']).status === 0;
  const pdfFile = makePdf({ pages: [
    { text: 'Login screen', annots: [{ subtype: 'Text', contents: 'Make button bigger', author: 'Rutu' }] },
    { shape: true },
  ] });

  test('the PDF tool is a read and passes the gate; other local tools still do not', () => {
    assert.equal(isReadOnly('mcp__mantis-pdf__read_pdf', { attachment_id: 1 }), true);
    assert.equal(isReadOnly('mcp__mantis-pdf__other', {}), false);
  });

  test('only an extension that can download PDFs gets the tool', async () => {
    const without = await talk({ type: 'chat', prompt: 'hi' });
    assert.deepEqual(without.claudeRun.mcpServers, ['webmavens-projects']);
    const { replies, pdf, claudeRun } = await talk({ type: 'chat', prompt: 'read it', features: ['pdf'] }, {
      mode: 'pdf', tool: { attachment_id: 6791 }, onPdfFetch: () => ({ error: 'stop here' }),
    });
    assert.equal(pdf.init.serverInfo.name, 'mantis-pdf');
    assert.deepEqual(pdf.tools.map((t) => t.name), ['read_pdf']);
    assert.match(pdf.tools[0].description, /page_from/);
    assert.equal(pdf.decision.permissionDecision, 'allow');
    assert.ok(replies.some((r) => r.type === 'tool' && r.tool === 'read_pdf'));
    assert.deepEqual(claudeRun.mcpServers, ['webmavens-projects', 'mantis-pdf']);
    assert.equal(claudeRun.maxMcpTokens, '100000'); // page images fit in one result
  });

  test('downloads through the extension and returns metadata, labelled page images, text and annotations', { skip: !hasPoppler && 'poppler-utils not installed' }, async () => {
    const fetches = [];
    const { replies, pdf } = await talk({ type: 'chat', prompt: 'read it', features: ['pdf'] }, {
      mode: 'pdf', tool: { attachment_id: 6791 }, onPdfFetch: (msg) => { fetches.push(msg); return { bytes: pdfFile, filename: 'phone app feedback.pdf' }; },
    });
    assert.deepEqual(fetches.map((m) => m.attachmentId), [6791]);
    const [meta, ...rest] = pdf.result.content;
    const item = JSON.parse(meta.text);
    assert.equal(item.id, 6791);
    assert.equal(item.filename, 'phone app feedback.pdf');
    assert.equal(item.mime, 'application/pdf');
    assert.equal(item.page_count, 2);
    assert.deepEqual(item.pages_returned, [1, 2]);
    assert.equal(item.has_more_pages, false);
    assert.equal(item.image_included, true);
    assert.match(item.text_content, /Login screen/);
    assert.deepEqual(item.annotations.map((a) => [a.page, a.type, a.author, a.text]), [[1, 'Text', 'Rutu', 'Make button bigger']]);
    assert.deepEqual(rest.map((c) => c.type === 'text' ? c.text : c.mimeType), ['Page 1 of 2', 'image/jpeg', 'Page 2 of 2', 'image/jpeg']);
    assert.ok(!pdf.result.isError);
    assert.equal(replies.at(-1).type, 'done');
  });

  test('a user Mantis refuses gets an error, not the file', async () => {
    const { pdf } = await talk({ type: 'chat', prompt: 'read it', features: ['pdf'] }, {
      mode: 'pdf', tool: { attachment_id: 42 }, onPdfFetch: () => ({ error: 'You do not have access to attachment 42 in Mantis (HTTP 403).' }),
    });
    assert.equal(pdf.result.isError, true);
    assert.match(pdf.result.content[0].text, /attachment 42.*HTTP 403/);
    assert.equal(pdf.result.content.length, 1);
  });

  test('a PDF over 50 MB is not converted', async () => {
    const { pdf } = await talk({ type: 'chat', prompt: 'read it', features: ['pdf'] }, {
      mode: 'pdf', tool: { attachment_id: 7 }, onPdfFetch: () => ({ tooLarge: true, size: 60 * 1024 * 1024, filename: 'big.pdf' }),
    });
    const item = JSON.parse(pdf.result.content[0].text);
    assert.match(item.preview_error, /larger than 50 MB/);
    assert.equal(item.image_included, false);
  });

  test('bad arguments are refused before anything is downloaded', async () => {
    let fetched = false;
    const { pdf } = await talk({ type: 'chat', prompt: 'read it', features: ['pdf'] }, {
      mode: 'pdf', tool: { attachment_id: 'abc' }, onPdfFetch: () => { fetched = true; return { error: 'no' }; },
    });
    assert.equal(pdf.result.isError, true);
    assert.equal(fetched, false);
  });
});
