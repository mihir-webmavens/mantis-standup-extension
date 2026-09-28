// MantisAI native messaging host. Chrome starts this (through the wrapper that
// install.sh writes) when the extension calls chrome.runtime.connectNative.
// It runs the user's own `claude` CLI in print mode and streams the reply back.
//
// Messages (Chrome's native messaging framing: 4-byte little-endian length + JSON):
//   in   { type: 'ping' }
//   out  { type: 'pong', hostVersion, claudeVersion }
//   in   { type: 'chat', prompt, system, sessionId?, model? }
//   out  { type: 'session', sessionId }, { type: 'mantis', status }, { type: 'delta', text },
//        { type: 'tool', id, tool, input }, { type: 'tool_result', id, isError },
//        { type: 'approval', id, toolUseId, tool, input } … then { type: 'done', sessionId, text }
//   in   { type: 'approve', id, allow }   (the user's answer to an approval)
//   in   { type: 'commits', repos, since, until }   (EOD from commits: full repo paths, ISO times)
//   out  { type: 'commits', commits: [{ repo, hash, date, message }], errors: [{ repo, error }] }
//   in   { type: 'summarize', prompt, system, model? }
//   out  { type: 'summary', text }
//   out  { type: 'error', code, error } at any point
// When Chrome closes the port, stdin ends: the running claude is stopped and we exit.
//
// Claude runs with no built-in tools, no settings, hooks or slash commands of the
// user's, in an empty working directory. Its only tools are the user's Mantis MCP
// server (projects.webmavens.dev, signed in through the CLI as usual). Every tool
// call passes a PreToolUse gate (this file, run with --approve-hook): read actions
// go through, anything else waits for the user's Approve/Deny in the panel. No tool
// is pre-allowed, so when the gate fails or times out the CLI refuses the call.
//
// For EODs written from commits, `commits` runs read-only `git log` in the folders
// the user listed (their own commits only, by the repo's user.email) and
// `summarize` runs claude with no tools and no MCP servers at all.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST_VERSION = '1.2.0';
const HOST_FILE = fileURLToPath(import.meta.url);
const CLAUDE = process.env.MANTIS_AI_CLAUDE || 'claude';
const GIT = process.env.MANTIS_AI_GIT || 'git';
const HOME = process.env.MANTIS_AI_HOME || path.join(os.homedir(), '.local', 'share', 'mantis-ai');
const WORKSPACE = path.join(HOME, 'workspace'); // sessions are stored per directory, so it must stay the same
const IDLE_TIMEOUT_MS = Number(process.env.MANTIS_AI_TIMEOUT_MS) || 5 * 60 * 1000;
const APPROVAL_TIMEOUT_MS = Number(process.env.MANTIS_AI_APPROVAL_TIMEOUT_MS) || 10 * 60 * 1000;
const MODELS = new Set(['sonnet', 'opus', 'haiku', 'fable']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MANTIS_SERVER = 'webmavens-projects';
const MANTIS_URL = process.env.MANTIS_AI_MCP_URL || 'https://projects.webmavens.dev/mcp';
const MANTIS_PREFIX = `mcp__${MANTIS_SERVER}__`;
// Actions that only read. null: every action of that tool reads.
const READ_ACTIONS = {
  whoami: null,
  lookups: null,
  tickets: ['list', 'get'],
  notes: ['list', 'get', 'timeline', 'list_approvals'],
  todos: ['list', 'get'],
  brief: ['get', 'history'],
  chat: ['rooms', 'messages', 'updates', 'wait', 'search'],
  attachments: ['list', 'download'],
};

export function isReadOnly(toolName, input) {
  if (!toolName.startsWith(MANTIS_PREFIX)) return false;
  const tool = toolName.slice(MANTIS_PREFIX.length);
  if (!Object.hasOwn(READ_ACTIONS, tool)) return false;
  return READ_ACTIONS[tool] === null || READ_ACTIONS[tool].includes(input?.action);
}

// Run directly: by Chrome as the helper, or by claude as the gate. Imported (tests): neither.
const direct = Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(HOST_FILE);
if (direct && process.argv[2] === '--approve-hook') approveHook(process.argv[3]);
else if (direct) main();

// ---------- the gate (a PreToolUse hook, run by claude) ----------

function approveHook(socketPath) {
  let raw = '';
  const decide = (allow, reason) => {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: allow ? 'allow' : 'deny', permissionDecisionReason: reason },
    }));
    process.exit(0);
  };
  process.stdin.on('data', (d) => { raw += d; });
  process.stdin.on('end', () => {
    let ev;
    try {
      ev = JSON.parse(raw);
    } catch {
      return decide(false, 'MantisAI could not read this tool call.');
    }
    const toolName = String(ev.tool_name || '');
    if (!toolName.startsWith(MANTIS_PREFIX)) return decide(false, 'Only the Mantis tools are available in MantisAI.');
    if (isReadOnly(toolName, ev.tool_input)) return decide(true, 'Read-only Mantis lookup.');

    // A change: ask the helper, which asks the user in the panel.
    const conn = net.connect(socketPath);
    let buf = '';
    conn.on('connect', () => conn.write(`${JSON.stringify({ tool: toolName, input: ev.tool_input, toolUseId: ev.tool_use_id })}\n`));
    conn.on('data', (d) => {
      buf += d;
      const nl = buf.indexOf('\n');
      if (nl < 0) return;
      let answer = {};
      try {
        answer = JSON.parse(buf.slice(0, nl));
      } catch { /* treated as a denial */ }
      decide(answer.allow === true, answer.allow === true
        ? 'The user approved this change in MantisAI.'
        : 'The user declined this change in MantisAI. Do not retry it; tell the user it was not made and ask how they want to proceed.');
    });
    conn.on('error', () => decide(false, 'MantisAI could not ask the user for approval.'));
    conn.on('close', () => decide(false, 'No approval from the user.'));
  });
}

// ---------- the helper (a native messaging host, run by Chrome) ----------

let answerApproval = null; // (id, allow) while a chat is running

function main() {
  let pending = Buffer.alloc(0);
  process.stdin.on('data', (chunk) => {
    pending = Buffer.concat([pending, chunk]);
    while (pending.length >= 4) {
      const length = pending.readUInt32LE(0);
      if (pending.length < 4 + length) break;
      const raw = pending.subarray(4, 4 + length).toString('utf8');
      pending = pending.subarray(4 + length);
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        fail('bad-request', 'MantisAI helper received an unreadable message.');
        continue;
      }
      handle(msg);
    }
  });
  process.stdin.on('end', shutdown);
  process.on('SIGTERM', shutdown);
}

const children = new Set();

function send(msg) {
  const body = Buffer.from(JSON.stringify(msg), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([header, body]));
}

function fail(code, error) {
  send({ type: 'error', code, error });
}

function shutdown() {
  for (const child of children) child.kill('SIGTERM');
  // Give claude a moment to exit before we do.
  setTimeout(() => process.exit(0), children.size ? 300 : 0);
}

function handle(msg) {
  if (msg?.type === 'ping') return ping();
  if (msg?.type === 'chat') return chat(msg);
  if (msg?.type === 'approve') return answerApproval?.(msg.id, msg.allow === true);
  if (msg?.type === 'commits') return commits(msg);
  if (msg?.type === 'summarize') return summarize(msg);
  fail('bad-request', `Unknown request "${msg?.type}".`);
}

// ---------- ping ----------

function ping() {
  let out = '';
  let child;
  try {
    child = spawn(CLAUDE, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    return fail('claude-missing', claudeMissing(err));
  }
  let failed = false;
  child.stdout.on('data', (d) => { out += d; });
  child.on('error', (err) => {
    failed = true;
    fail('claude-missing', claudeMissing(err));
  });
  child.on('close', (code) => {
    if (failed) return;
    if (code === 0) send({ type: 'pong', hostVersion: HOST_VERSION, claudeVersion: out.trim() });
    else fail('claude-error', `claude --version exited with code ${code}.`);
  });
}

function claudeMissing(err) {
  return `Could not start the Claude CLI (${CLAUDE}): ${err.code || err.message}. Re-run the MantisAI installer after installing Claude Code.`;
}

// ---------- chat ----------

function chat({ prompt, system, sessionId, model }) {
  if (typeof prompt !== 'string' || !prompt.trim()) return fail('bad-request', 'Empty message.');
  if (sessionId != null && !UUID_RE.test(sessionId)) return fail('bad-request', 'Invalid conversation id.');

  fs.mkdirSync(WORKSPACE, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mantis-ai-'));
  const file = (name, content) => {
    const p = path.join(tmp, name);
    fs.writeFileSync(p, content);
    return p;
  };
  const socketPath = path.join(tmp, 'gate.sock');
  const hook = `${JSON.stringify(process.execPath)} ${JSON.stringify(HOST_FILE)} --approve-hook ${JSON.stringify(socketPath)}`;
  const args = [
    '-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--tools', '', '--setting-sources', '', '--disable-slash-commands',
    '--strict-mcp-config', '--mcp-config', file('mcp.json', JSON.stringify({ mcpServers: { [MANTIS_SERVER]: { type: 'http', url: MANTIS_URL } } })),
    '--settings', file('settings.json', JSON.stringify({ hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: hook, timeout: APPROVAL_TIMEOUT_MS / 1000 + 60 }] }] } })),
    '--system-prompt-file', file('system.txt', typeof system === 'string' && system.trim() ? system : 'You are MantisAI, a helpful assistant.'),
  ];
  if (sessionId) args.push('--resume', sessionId);
  if (MODELS.has(model)) args.push('--model', model);

  let finished = false;
  let text = '';
  let stderr = '';
  let lineBuf = '';
  let timer = null;
  const approvals = new Map(); // id -> { conn, expiry }
  let nextApproval = 1;

  // Approvals: the gate connects, we ask the extension, the user answers.
  const gate = net.createServer((conn) => {
    let buf = '';
    conn.on('error', () => {});
    conn.on('data', (d) => {
      buf += d;
      const nl = buf.indexOf('\n');
      if (nl < 0) return;
      let req;
      try {
        req = JSON.parse(buf.slice(0, nl));
      } catch {
        return conn.end(`${JSON.stringify({ allow: false })}\n`);
      }
      buf = '';
      const id = nextApproval++;
      approvals.set(id, { conn, expiry: setTimeout(() => answer(id, false), APPROVAL_TIMEOUT_MS) });
      clearTimeout(timer); // waiting for the user is not Claude being slow
      send({ type: 'approval', id, toolUseId: req.toolUseId, tool: String(req.tool).slice(MANTIS_PREFIX.length), input: req.input });
    });
  });
  const answer = (id, allow) => {
    const approval = approvals.get(id);
    if (!approval) return;
    approvals.delete(id);
    clearTimeout(approval.expiry);
    approval.conn.end(`${JSON.stringify({ allow })}\n`);
    if (!finished) resetTimer();
  };
  answerApproval = answer;

  const finish = (msg) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    for (const id of [...approvals.keys()]) answer(id, false);
    send(msg);
  };
  const resetTimer = () => {
    clearTimeout(timer);
    if (approvals.size) return;
    timer = setTimeout(() => {
      finish({ type: 'error', code: 'timeout', error: 'Claude took too long to answer. Try again.' });
      child?.kill('SIGTERM');
    }, IDLE_TIMEOUT_MS);
  };
  const cleanup = () => {
    gate.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  };

  let child;
  gate.listen(socketPath, start);
  gate.on('error', (err) => {
    cleanup();
    finish({ type: 'error', code: 'claude-error', error: `MantisAI could not start its approval gate: ${err.message}` });
  });

  function start() {
    try {
      child = spawn(CLAUDE, args, { cwd: WORKSPACE, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      cleanup();
      return finish({ type: 'error', code: 'claude-missing', error: claudeMissing(err) });
    }
    children.add(child);
    resetTimer();
    child.stdin.on('error', () => {}); // claude may exit before reading everything
    child.stdin.end(prompt);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      resetTimer();
      lineBuf += chunk;
      let nl;
      while ((nl = lineBuf.indexOf('\n')) >= 0) {
        const line = lineBuf.slice(0, nl).trim();
        lineBuf = lineBuf.slice(nl + 1);
        if (line) onEvent(line);
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-4000); });

    child.on('error', (err) => {
      children.delete(child);
      cleanup();
      finish({ type: 'error', code: 'claude-missing', error: claudeMissing(err) });
    });
    child.on('close', (code, signal) => {
      children.delete(child);
      if (lineBuf.trim()) onEvent(lineBuf.trim());
      cleanup();
      if (signal) return finish({ type: 'error', code: 'stopped', error: 'Stopped.' });
      finish({ type: 'error', ...classify(stderr || `claude exited with code ${code}.`, sessionId) });
    });
  }

  function onEvent(line) {
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      return;
    }
    if (ev.type === 'system' && ev.subtype === 'init') {
      if (ev.session_id) send({ type: 'session', sessionId: ev.session_id }); // lets a stopped reply still be continued
      const server = (ev.mcp_servers || []).find((s) => s.name === MANTIS_SERVER);
      send({ type: 'mantis', status: server?.status || 'missing' });
    } else if (ev.type === 'stream_event' && ev.event?.type === 'message_start' && text && !text.endsWith('\n\n')) {
      // Claude answers in several messages around lookups; keep them apart.
      const gap = text.endsWith('\n') ? '\n' : '\n\n';
      text += gap;
      send({ type: 'delta', text: gap });
    } else if (ev.type === 'stream_event' && ev.event?.type === 'content_block_delta' && ev.event.delta?.type === 'text_delta') {
      text += ev.event.delta.text;
      send({ type: 'delta', text: ev.event.delta.text });
    } else if (ev.type === 'assistant') {
      for (const block of ev.message?.content || []) {
        if (block.type === 'tool_use') send({ type: 'tool', id: block.id, tool: String(block.name).replace(MANTIS_PREFIX, ''), input: block.input });
      }
    } else if (ev.type === 'user') {
      for (const block of Array.isArray(ev.message?.content) ? ev.message.content : []) {
        if (block.type === 'tool_result') send({ type: 'tool_result', id: block.tool_use_id, isError: Boolean(block.is_error) });
      }
    } else if (ev.type === 'result') {
      if (ev.is_error) {
        const detail = [...(ev.errors || []), ev.result].filter(Boolean).join(' ') || stderr;
        finish({ type: 'error', ...classify(detail, sessionId) });
      } else {
        // The streamed text includes what Claude said before its lookups; the result only the last part.
        finish({ type: 'done', sessionId: ev.session_id, text: text.trim() ? text : String(ev.result || '') });
      }
    }
  }
}

// ---------- EOD from commits: today's commits ----------

// %x1f between fields, %x1e after each commit (messages may contain newlines).
const LOG_FORMAT = '--format=%H%x1f%ae%x1f%aI%x1f%B%x1e';

function commits({ repos, since, until }) {
  if (!Array.isArray(repos) || !repos.length || !repos.every((r) => typeof r === 'string' && path.isAbsolute(r))) {
    return fail('bad-request', 'List your repo folders as full paths.');
  }
  const from = new Date(since);
  const to = new Date(until);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) return fail('bad-request', 'Invalid time range.');

  Promise.all([...new Set(repos)].map((repo) => repoCommits(repo, from, to).then(
    (list) => ({ list }),
    (err) => ({ error: { repo, error: err.message } }),
  ))).then((results) => {
    const seen = new Set(); // the same commit can be in two listed clones
    const list = results.flatMap((r) => r.list || []).filter((c) => !seen.has(c.hash) && seen.add(c.hash));
    send({ type: 'commits', commits: list, errors: results.filter((r) => r.error).map((r) => r.error) });
  });
}

// The user's own commits authored in [from, to), on any branch. --since filters by
// commit date, which is never before the author date, so it only narrows the search.
async function repoCommits(repo, from, to) {
  let email;
  try {
    email = (await git(repo, ['config', 'user.email'])).trim().toLowerCase();
  } catch (err) {
    if (err.exitCode === 1) throw new Error('No git user.email is set for this repo, so your commits cannot be told apart.');
    throw err;
  }
  const out = await git(repo, ['log', '--all', '--no-merges', `--since=${from.toISOString()}`, LOG_FORMAT]);
  return out.split('\x1e').map((entry) => entry.replace(/^\n/, '')).filter(Boolean).map((entry) => {
    const [hash, author, date, message = ''] = entry.split('\x1f');
    return { repo, hash, author: author.toLowerCase(), date, message: message.trim() };
  }).filter((c) => {
    const at = new Date(c.date);
    return c.author === email && at >= from && at < to;
  }).map(({ author, ...c }) => c);
}

function git(repo, args) {
  return new Promise((resolve, reject) => {
    let out = '';
    let err = '';
    let child;
    try {
      child = spawn(GIT, ['-C', repo, '--no-pager', ...args], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
    } catch (e) {
      return reject(e);
    }
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
    child.on('error', (e) => reject(new Error(e.code === 'ENOENT' ? `git was not found (${GIT}).` : e.message)));
    child.on('close', (code) => {
      if (code === 0) return resolve(out);
      reject(Object.assign(new Error(err.trim().split('\n')[0] || `git exited with code ${code}.`), { exitCode: code }));
    });
  });
}

// ---------- EOD from commits: the summary ----------

// One answer, no tools, no MCP servers, no settings of the user's; kept out of the chat workspace.
function summarize({ prompt, system, model }) {
  if (typeof prompt !== 'string' || !prompt.trim()) return fail('bad-request', 'Empty message.');
  const cwd = path.join(HOME, 'eod');
  fs.mkdirSync(cwd, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mantis-ai-'));
  const systemFile = path.join(tmp, 'system.txt');
  fs.writeFileSync(systemFile, typeof system === 'string' && system.trim() ? system : 'Summarize the work described.');
  const args = [
    '-p', '--output-format', 'json',
    '--tools', '', '--setting-sources', '', '--disable-slash-commands', '--strict-mcp-config',
    '--system-prompt-file', systemFile,
  ];
  if (MODELS.has(model)) args.push('--model', model);

  let finished = false;
  let out = '';
  let stderr = '';
  let child;
  const finish = (msg) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    fs.rmSync(tmp, { recursive: true, force: true });
    send(msg);
  };
  const timer = setTimeout(() => {
    finish({ type: 'error', code: 'timeout', error: 'Claude took too long to answer. Try again.' });
    child?.kill('SIGTERM');
  }, IDLE_TIMEOUT_MS);

  try {
    child = spawn(CLAUDE, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (err) {
    return finish({ type: 'error', code: 'claude-missing', error: claudeMissing(err) });
  }
  children.add(child);
  child.stdin.on('error', () => {});
  child.stdin.end(prompt);
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-4000); });
  child.on('error', (err) => {
    children.delete(child);
    finish({ type: 'error', code: 'claude-missing', error: claudeMissing(err) });
  });
  child.on('close', (code, signal) => {
    children.delete(child);
    if (signal) return finish({ type: 'error', code: 'stopped', error: 'Stopped.' });
    const result = out.split('\n').map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    }).find((ev) => ev?.type === 'result');
    if (result && !result.is_error && String(result.result || '').trim()) return finish({ type: 'summary', text: String(result.result).trim() });
    const detail = result ? [...(result.errors || []), result.result].filter(Boolean).join(' ') : '';
    finish({ type: 'error', ...classify(detail || stderr || `claude exited with code ${code}.`) });
  });
}

// Turns CLI error text into a code the extension can explain.
function classify(detail, sessionId) {
  const text = String(detail).trim().slice(0, 600);
  if (sessionId && /no conversation found/i.test(text)) {
    return { code: 'session-missing', error: 'This conversation is no longer in Claude\'s history, so it can\'t be continued. Start a new chat.' };
  }
  if (/not logged in|please run \/login|invalid api key/i.test(text)) {
    return { code: 'auth', error: 'The Claude CLI is not logged in. Run `claude` in a terminal, log in, then try again.' };
  }
  if (/rate limit|usage limit|limit reached|overloaded/i.test(text)) {
    return { code: 'limit', error: `Claude is unavailable right now: ${text}` };
  }
  return { code: 'claude-error', error: text || 'Claude stopped without answering.' };
}
