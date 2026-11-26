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
//   in   chat with features: ['pdf'] adds the read_pdf tool; while it runs:
//   out  { type: 'pdf_fetch', id, attachmentId }   (the Mantis tab downloads the attachment)
//   in   { type: 'pdf_chunk', id, data } … { type: 'pdf_end', id, size, filename? | error | tooLarge }
//   in   { type: 'commits', repos, since, until }   (EOD from commits: full repo paths, ISO times)
//   out  { type: 'commits', commits: [{ repo, hash, date, message }], errors: [{ repo, error }] }
//   in   { type: 'summarize', prompt, system, model? }
//   out  { type: 'summary', text }
//   in   { type: 'tickets', model? }   (ticket digest: the user's open tickets)
//   out  { type: 'tickets', user: { id, name }, projects: [{ id, name }], tickets: [ticket list items] }
//   out  { type: 'error', code, error } at any point
// When Chrome closes the port, stdin ends: the running claude is stopped and we exit.
//
// Claude runs with no built-in tools, no settings, hooks or slash commands of the
// user's, in an empty working directory. Its only tools are the user's Mantis MCP
// server (projects.webmavens.dev, signed in through the CLI as usual) and, for an
// extension that can download attachments, the local read-only read_pdf tool. Every tool
// call passes a PreToolUse gate (this file, run with --approve-hook): read actions
// go through, anything else waits for the user's Approve/Deny in the panel. No tool
// is pre-allowed, so when the gate fails or times out the CLI refuses the call.
//
// For EODs written from commits, `commits` runs read-only `git log` in the folders
// the user listed (their own commits only, by the repo's user.email) and
// `summarize` runs claude with no tools and no MCP servers at all.
//
// For the ticket digest, `tickets` runs claude with only the Mantis MCP server and a
// gate (--digest-hook) that allows nothing but whoami, lookups list_projects and
// tickets list. The tickets are read from the tool results themselves, never from
// Claude's answer, and only a complete set (every page of every status) is returned.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HOST_VERSION = '1.4.0';
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

// PDF attachments: a local MCP server (this file, run with --pdf-mcp) whose one tool
// renders a PDF the browser downloaded through the user's Mantis session.
const PDF_SERVER = 'mantis-pdf';
const PDF_TOOL = `mcp__${PDF_SERVER}__read_pdf`;

export function isReadOnly(toolName, input) {
  if (toolName === PDF_TOOL) return true;
  if (!toolName.startsWith(MANTIS_PREFIX)) return false;
  const tool = toolName.slice(MANTIS_PREFIX.length);
  if (!Object.hasOwn(READ_ACTIONS, tool)) return false;
  return READ_ACTIONS[tool] === null || READ_ACTIONS[tool].includes(input?.action);
}

// Run directly: by Chrome as the helper, or by claude as the gate. Imported (tests): neither.
const direct = Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(HOST_FILE);
if (direct && process.argv[2] === '--approve-hook') approveHook(process.argv[3]);
else if (direct && process.argv[2] === '--digest-hook') digestHook();
else if (direct && process.argv[2] === '--pdf-mcp') pdfMcpServer(process.argv[3]);
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
    if (toolName === PDF_TOOL) return decide(true, 'Read-only PDF preview.');
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
let receivePdf = null; // (pdf_chunk / pdf_end message) while a chat is running

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
  if (msg?.type === 'pdf_chunk' || msg?.type === 'pdf_end') return receivePdf?.(msg);
  if (msg?.type === 'commits') return commits(msg);
  if (msg?.type === 'summarize') return summarize(msg);
  if (msg?.type === 'tickets') return tickets(msg);
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

// Tool names as the panel shows them: without the MCP server prefix.
function shortToolName(name) {
  return String(name).replace(MANTIS_PREFIX, '').replace(`mcp__${PDF_SERVER}__`, '');
}

function chat({ prompt, system, sessionId, model, features }) {
  if (typeof prompt !== 'string' || !prompt.trim()) return fail('bad-request', 'Empty message.');
  if (sessionId != null && !UUID_RE.test(sessionId)) return fail('bad-request', 'Invalid conversation id.');
  // Only an extension that can download attachments for us gets the PDF tool.
  const pdf = Array.isArray(features) && features.includes('pdf');

  fs.mkdirSync(WORKSPACE, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mantis-ai-'));
  const file = (name, content) => {
    const p = path.join(tmp, name);
    fs.writeFileSync(p, content);
    return p;
  };
  const socketPath = path.join(tmp, 'gate.sock');
  const pdfSocketPath = path.join(tmp, 'pdf.sock');
  const hook = `${JSON.stringify(process.execPath)} ${JSON.stringify(HOST_FILE)} --approve-hook ${JSON.stringify(socketPath)}`;
  const mcpServers = { [MANTIS_SERVER]: { type: 'http', url: MANTIS_URL } };
  if (pdf) mcpServers[PDF_SERVER] = { type: 'stdio', command: process.execPath, args: [HOST_FILE, '--pdf-mcp', pdfSocketPath] };
  const args = [
    '-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--tools', '', '--setting-sources', '', '--disable-slash-commands',
    '--strict-mcp-config', '--mcp-config', file('mcp.json', JSON.stringify({ mcpServers })),
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

  // PDFs: the PDF tool connects, the extension downloads the file through the
  // user's Mantis session (so Mantis decides who may read it), we render it.
  const downloads = new Map(); // id -> (pdf_chunk / pdf_end message)
  let nextDownload = 1;
  let busyPdfs = 0;
  receivePdf = (msg) => downloads.get(msg.id)?.(msg);
  const download = (attachmentId) => new Promise((resolve, reject) => {
    const id = nextDownload++;
    const chunks = [];
    let size = 0;
    const done = (err, value) => {
      if (!downloads.has(id)) return;
      downloads.delete(id);
      clearTimeout(expiry);
      if (err) reject(err);
      else resolve(value);
    };
    const expiry = setTimeout(() => done(new Error('The browser took too long to download the attachment.')), PDF_DOWNLOAD_TIMEOUT_MS);
    downloads.set(id, (msg) => {
      if (msg.type === 'pdf_chunk') {
        const chunk = Buffer.from(String(msg.data || ''), 'base64');
        size += chunk.length;
        if (size > PDF_MAX_BYTES) return done(null, { tooLarge: true, size });
        chunks.push(chunk);
      } else if (msg.tooLarge) {
        done(null, { tooLarge: true, size: Number(msg.size) || 0 });
      } else if (msg.error) {
        done(new Error(String(msg.error).slice(0, 300)));
      } else {
        done(null, { bytes: Buffer.concat(chunks), filename: typeof msg.filename === 'string' ? msg.filename.slice(0, 255) : undefined });
      }
    });
    send({ type: 'pdf_fetch', id, attachmentId });
  });
  const readPdf = async (input) => {
    const opts = pdfOptions(input);
    if (opts.error) return pdfToolError(opts.error);
    busyPdfs++;
    clearTimeout(timer); // downloading and rendering is not Claude being slow
    try {
      const file = await download(opts.attachmentId);
      const preview = file.tooLarge
        ? { size: file.size, preview_error: `This PDF is larger than ${PDF_MAX_BYTES / 1024 / 1024} MB, so it was not converted.` }
        : await pdfPreview(file.bytes, { ...opts, cacheDir: path.join(HOME, 'pdf-cache') });
      return pdfToolResult(opts.attachmentId, file.filename, preview);
    } catch (err) {
      return pdfToolError(`Could not read attachment ${opts.attachmentId}: ${err.message}`);
    } finally {
      busyPdfs--;
      if (!finished) resetTimer();
    }
  };
  const pdfServer = net.createServer((conn) => {
    let buf = '';
    conn.on('error', () => {});
    conn.on('data', (d) => {
      buf += d;
      const nl = buf.indexOf('\n');
      if (nl < 0) return;
      let input;
      try {
        input = JSON.parse(buf.slice(0, nl));
      } catch {
        input = null;
      }
      buf = '';
      Promise.resolve(input ? readPdf(input) : pdfToolError('MantisAI could not read this request.'))
        .then((result) => conn.end(`${JSON.stringify(result)}\n`));
    });
  });

  const finish = (msg) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    for (const id of [...approvals.keys()]) answer(id, false);
    for (const settle of [...downloads.values()]) settle({ type: 'pdf_end', error: 'The chat ended.' });
    send(msg);
  };
  const resetTimer = () => {
    clearTimeout(timer);
    if (approvals.size || busyPdfs) return;
    timer = setTimeout(() => {
      finish({ type: 'error', code: 'timeout', error: 'Claude took too long to answer. Try again.' });
      child?.kill('SIGTERM');
    }, IDLE_TIMEOUT_MS);
  };
  const cleanup = () => {
    gate.close();
    if (pdf) pdfServer.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  };

  let child;
  gate.listen(socketPath, () => (pdf ? pdfServer.listen(pdfSocketPath, start) : start()));
  for (const server of [gate, pdfServer]) {
    server.on('error', (err) => {
      cleanup();
      finish({ type: 'error', code: 'claude-error', error: `MantisAI could not start its approval gate: ${err.message}` });
    });
  }

  function start() {
    try {
      // Page images are large; let them through to Claude.
      const env = pdf ? { ...process.env, MAX_MCP_OUTPUT_TOKENS: process.env.MAX_MCP_OUTPUT_TOKENS || '100000' } : process.env;
      child = spawn(CLAUDE, args, { cwd: WORKSPACE, env, stdio: ['pipe', 'pipe', 'pipe'] });
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
        if (block.type === 'tool_use') send({ type: 'tool', id: block.id, tool: shortToolName(block.name), input: block.input });
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

// ---------- ticket digest ----------

export const DIGEST_STATUSES = ['new', 'assigned', 'in_progress'];

// The digest's whole tool set: anything else is refused by --digest-hook.
export function isDigestCall(toolName, input) {
  const tool = String(toolName).startsWith(MANTIS_PREFIX) ? toolName.slice(MANTIS_PREFIX.length) : '';
  if (tool === 'whoami') return true;
  if (tool === 'lookups') return input?.action === 'list_projects';
  if (tool === 'tickets') return input?.action === 'list';
  return false;
}

function digestHook() {
  let raw = '';
  process.stdin.on('data', (d) => { raw += d; });
  process.stdin.on('end', () => {
    let ev = {};
    try {
      ev = JSON.parse(raw);
    } catch { /* refused below */ }
    const allow = isDigestCall(String(ev.tool_name || ''), ev.tool_input);
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: allow ? 'allow' : 'deny',
        permissionDecisionReason: allow ? 'Read-only lookup for the ticket digest.' : 'Only whoami, lookups list_projects and tickets list are available here.',
      },
    }));
    process.exit(0);
  });
}

const DIGEST_SYSTEM = [
  'You fetch data from Mantis for a ticket digest. You only make tool calls; your text answer is ignored.',
  '1. Call whoami.',
  '2. Call lookups with action list_projects.',
  `3. For each status_key in ${DIGEST_STATUSES.join(', ')}: call tickets with action list, that status_key, assignee_id set to the user id from whoami and limit 100. While a result has a next_cursor, call it again with the same arguments plus cursor set to that next_cursor.`,
  'Make no other calls. When every page is fetched, answer "done".',
].join('\n');

// MCP tool results arrive as a string or as text blocks.
function toolResultJson(block) {
  const text = typeof block.content === 'string'
    ? block.content
    : (Array.isArray(block.content) ? block.content : []).filter((c) => c?.type === 'text').map((c) => c.text).join('');
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// From the lookups Claude made: the user, their projects and every page of their open tickets.
export function collectDigest(calls) {
  const ok = calls.filter((c) => c.result && !c.isError);
  const who = ok.find((c) => c.tool === 'whoami')?.result;
  if (!Number.isInteger(who?.user_id)) return { error: 'Could not find out who you are in Mantis (whoami).' };

  const projectsResult = ok.find((c) => c.tool === 'lookups' && c.input?.action === 'list_projects')?.result;
  const projects = (Array.isArray(projectsResult?.data) ? projectsResult.data : []).map((p) => ({ id: p.id, name: String(p.name ?? '') }));

  const tickets = new Map();
  const missing = [];
  for (const status of DIGEST_STATUSES) {
    const pages = ok.filter((c) => c.tool === 'tickets' && c.input?.action === 'list' && c.input.status_key === status
      && c.input.assignee_id === who.user_id && !c.input.q && !c.input.project_id && !c.input.label_id && Array.isArray(c.result.items));
    const asked = new Set(pages.map((c) => c.input.cursor || ''));
    const complete = asked.has('') && pages.every((c) => !c.result.next_cursor || asked.has(c.result.next_cursor));
    if (!complete) missing.push(status);
    for (const page of pages) {
      for (const t of page.result.items) if (Number.isInteger(t?.id) && t.status_key === status) tickets.set(t.id, t);
    }
  }
  if (missing.length) return { error: `Not every page of your tickets was fetched (${missing.join(', ')}). Try again.` };
  return { user: { id: who.user_id, name: String(who.name ?? '') }, projects, tickets: [...tickets.values()] };
}

function tickets({ model }) {
  fs.mkdirSync(WORKSPACE, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mantis-ai-'));
  const file = (name, content) => {
    const p = path.join(tmp, name);
    fs.writeFileSync(p, content);
    return p;
  };
  const hook = `${JSON.stringify(process.execPath)} ${JSON.stringify(HOST_FILE)} --digest-hook`;
  const args = [
    '-p', '--output-format', 'stream-json', '--verbose', '--no-session-persistence',
    '--tools', '', '--setting-sources', '', '--disable-slash-commands',
    '--strict-mcp-config', '--mcp-config', file('mcp.json', JSON.stringify({ mcpServers: { [MANTIS_SERVER]: { type: 'http', url: MANTIS_URL } } })),
    '--settings', file('settings.json', JSON.stringify({ hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: hook, timeout: 30 }] }] } })),
    '--system-prompt-file', file('system.txt', DIGEST_SYSTEM),
  ];
  if (MODELS.has(model)) args.push('--model', model);

  const uses = new Map(); // tool_use id -> { tool, input }
  const calls = [];
  let mantis = 'missing';
  let finished = false;
  let stderr = '';
  let lineBuf = '';
  let child;
  const finish = (msg) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    fs.rmSync(tmp, { recursive: true, force: true });
    send(msg);
  };
  const timer = setTimeout(() => {
    finish({ type: 'error', code: 'timeout', error: 'Fetching your tickets took too long. Try again.' });
    child?.kill('SIGTERM');
  }, IDLE_TIMEOUT_MS);

  const onEvent = (line) => {
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      return;
    }
    if (ev.type === 'system' && ev.subtype === 'init') {
      mantis = (ev.mcp_servers || []).find((s) => s.name === MANTIS_SERVER)?.status || 'missing';
    } else if (ev.type === 'assistant') {
      for (const block of ev.message?.content || []) {
        if (block.type === 'tool_use') uses.set(block.id, { tool: String(block.name).replace(MANTIS_PREFIX, ''), input: block.input });
      }
    } else if (ev.type === 'user') {
      for (const block of Array.isArray(ev.message?.content) ? ev.message.content : []) {
        const use = block.type === 'tool_result' && uses.get(block.tool_use_id);
        if (use) calls.push({ ...use, isError: Boolean(block.is_error), result: toolResultJson(block) });
      }
    } else if (ev.type === 'result') {
      if (ev.is_error) return finish({ type: 'error', ...classify([...(ev.errors || []), ev.result].filter(Boolean).join(' ') || stderr) });
      if (mantis !== 'connected' && !calls.length) {
        return finish({ type: 'error', code: 'mantis', error: 'The Claude CLI could not connect to Mantis. Run `claude` in a terminal and check /mcp for webmavens-projects.' });
      }
      const digest = collectDigest(calls);
      finish(digest.error ? { type: 'error', code: 'incomplete', error: digest.error } : { type: 'tickets', ...digest });
    }
  };

  try {
    child = spawn(CLAUDE, args, { cwd: WORKSPACE, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (err) {
    return finish({ type: 'error', code: 'claude-missing', error: claudeMissing(err) });
  }
  children.add(child);
  child.stdin.on('error', () => {});
  child.stdin.end('Fetch the data for my ticket digest.');
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
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
    finish({ type: 'error', code: 'claude-missing', error: claudeMissing(err) });
  });
  child.on('close', (code, signal) => {
    children.delete(child);
    if (lineBuf.trim()) onEvent(lineBuf.trim());
    if (signal) return finish({ type: 'error', code: 'stopped', error: 'Stopped.' });
    finish({ type: 'error', ...classify(stderr || `claude exited with code ${code}.`) });
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
  if (/rate limit|usage limit|limit reached|overloaded|out of usage credits/i.test(text)) {
    return { code: 'limit', error: `Claude is unavailable right now: ${text}` };
  }
  return { code: 'claude-error', error: text || 'Claude stopped without answering.' };
}

// ---------- PDF attachments ----------
// read_pdf: page images (pdftoppm), text (pdftotext -layout) and annotations
// (read from the PDF's /Annots here, without a dependency) for one attachment.
// poppler-utils does the rendering: it is a packaged, sandbox-free command-line
// tool with no Ghostscript or ImageMagick policy files to configure. Each run gets
// a memory cap (prlimit, when present) and shares one deadline per call; files are
// passed as arguments, never through a shell. Results are cached by the file's
// SHA-256, but the file itself is downloaded through the user's Mantis session
// on every call, so Mantis decides each time whether they may read it.

export const PDF_MAX_BYTES = 50 * 1024 * 1024;
export const PDF_MAX_PAGES = 200;
const PDF_PAGES_PER_CALL = 10;
const PDF_TEXT_LIMIT = 50000;
const PDF_DPI = 150;
const PDF_MAX_WIDTH = 1600;
const PDF_JPEG_QUALITY = 80;
const PDF_DEADLINE_MS = Number(process.env.MANTIS_AI_PDF_TIMEOUT_MS) || 30 * 1000;
const PDF_DOWNLOAD_TIMEOUT_MS = 2 * 60 * 1000;
const PDF_MEMORY_BYTES = 1024 * 1024 * 1024;
const PDF_CACHE_DAYS = 7;
const PDF_ANNOTATION_LIMIT = 500;
const PRLIMIT = ['/usr/bin/prlimit', '/bin/prlimit'].find((p) => fs.existsSync(p));
const POPPLER = {
  pdfinfo: process.env.MANTIS_AI_PDFINFO || 'pdfinfo',
  pdftoppm: process.env.MANTIS_AI_PDFTOPPM || 'pdftoppm',
  pdftotext: process.env.MANTIS_AI_PDFTOTEXT || 'pdftotext',
};

const PDF_TOOL_DEF = {
  name: 'read_pdf',
  description: [
    'Read a PDF attachment from Mantis: page images, the text and the PDF\'s annotations (sticky notes, comments, highlights, free text).',
    'Use it for any attachment whose mime is application/pdf (attachments download only returns a link for PDFs).',
    `Returns at most ${PDF_PAGES_PER_CALL} pages per call: when has_more_pages is true, call again with page_from set to next_page_from.`,
    'text_content and annotations cover the returned pages. Each page image follows a "Page N of M" label.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      attachment_id: { type: 'integer', description: 'The attachment id (from attachments list / download)' },
      page_from: { type: 'integer', minimum: 1, description: 'First page to return (default 1)' },
      page_to: { type: 'integer', minimum: 1, description: `Last page to return (default page_from + ${PDF_PAGES_PER_CALL - 1}; at most ${PDF_PAGES_PER_CALL} pages per call)` },
      include_pages: { type: 'boolean', description: 'Return page images (default true)' },
      include_text: { type: 'boolean', description: 'Return the extracted text (default true)' },
    },
    required: ['attachment_id'],
  },
};

// The tool's arguments, checked; page_to is capped to ten pages from page_from.
export function pdfOptions(input = {}) {
  const int = (v) => (typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v);
  const attachmentId = int(input.attachment_id);
  if (!Number.isInteger(attachmentId) || attachmentId <= 0) return { error: 'attachment_id must be a positive whole number.' };
  const pageFrom = input.page_from == null ? 1 : int(input.page_from);
  if (!Number.isInteger(pageFrom) || pageFrom < 1) return { error: 'page_from must be 1 or more.' };
  const pageTo = input.page_to == null ? pageFrom + PDF_PAGES_PER_CALL - 1 : int(input.page_to);
  if (!Number.isInteger(pageTo) || pageTo < pageFrom) return { error: 'page_to must be a whole number no smaller than page_from.' };
  for (const key of ['include_pages', 'include_text']) {
    if (input[key] != null && typeof input[key] !== 'boolean') return { error: `${key} must be true or false.` };
  }
  return {
    attachmentId,
    pageFrom,
    pageTo: Math.min(pageTo, pageFrom + PDF_PAGES_PER_CALL - 1),
    includePages: input.include_pages !== false,
    includeText: input.include_text !== false,
  };
}

function pdfToolError(message) {
  return { content: [{ type: 'text', text: message }], isError: true };
}

// MCP content: the metadata as JSON, then a label and an image per page.
export function pdfToolResult(attachmentId, filename, preview) {
  const { pages = [], ...meta } = preview;
  const item = { id: attachmentId, ...(filename ? { filename } : {}), mime: 'application/pdf', ...meta, image_included: pages.length > 0 };
  const content = [{ type: 'text', text: JSON.stringify(item) }];
  for (const page of pages) {
    content.push({ type: 'text', text: `Page ${page.page} of ${meta.page_count}` });
    content.push({ type: 'image', data: page.jpeg.toString('base64'), mimeType: 'image/jpeg' });
  }
  return { content };
}

// Renders one PDF. Never throws for a bad PDF: problems come back as preview_error.
export async function pdfPreview(bytes, { pageFrom = 1, pageTo, includePages = true, includeText = true, cacheDir }) {
  const size = bytes.length;
  if (size > PDF_MAX_BYTES) return { size, preview_error: `This PDF is larger than ${PDF_MAX_BYTES / 1024 / 1024} MB, so it was not converted.` };
  if (!bytes.subarray(0, 1024).includes('%PDF-')) return { size, preview_error: 'This attachment is not a PDF. Use attachments download for other files.' };

  const deadline = Date.now() + PDF_DEADLINE_MS;
  const dir = pdfCacheDir(cacheDir, bytes);
  const source = path.join(dir, 'source.pdf');
  if (!fs.existsSync(source)) fs.writeFileSync(source, bytes, { mode: 0o600 });

  let info;
  try {
    info = await cached(path.join(dir, 'info.json'), async () => parsePdfInfo((await runTool(POPPLER.pdfinfo, [source], deadline)).stdout.toString('utf8')));
  } catch (err) {
    return { size, preview_error: pdfErrorText(err) };
  }
  const pageCount = info.pages;
  if (!pageCount) return { size, page_count: 0, preview_error: 'This PDF has no pages.' };
  if (pageCount > PDF_MAX_PAGES) return { size, page_count: pageCount, preview_error: `This PDF has ${pageCount} pages; PDFs over ${PDF_MAX_PAGES} pages are not converted.` };
  if (pageFrom > pageCount) return { size, page_count: pageCount, preview_error: `page_from ${pageFrom} is past the last page (${pageCount}).` };

  const from = pageFrom;
  const to = Math.min(pageTo ?? from + PDF_PAGES_PER_CALL - 1, from + PDF_PAGES_PER_CALL - 1, pageCount);
  const result = {
    size,
    page_count: pageCount,
    pages_returned: [from, to],
    has_more_pages: to < pageCount,
    ...(to < pageCount ? { next_page_from: to + 1 } : {}),
  };
  if (info.encrypted) result.encrypted = true;
  const errors = [];

  if (includeText) {
    try {
      const text = await cached(path.join(dir, `text-${from}-${to}.txt`), async () => {
        const out = (await runTool(POPPLER.pdftotext, ['-layout', '-enc', 'UTF-8', '-f', String(from), '-l', String(to), source, '-'], deadline)).stdout.toString('utf8');
        return out.split('\f').slice(0, to - from + 1)
          .map((pageText, i) => (pageText.trim() ? `--- Page ${from + i} ---\n${pageText.replace(/\s+$/, '')}` : ''))
          .filter(Boolean).join('\n\n');
      }, 'text');
      result.text_content = text.slice(0, PDF_TEXT_LIMIT);
      result.text_truncated = text.length > PDF_TEXT_LIMIT;
      if (!text.trim()) result.text_note = 'No text layer on these pages (scanned or image-only); read the page images.';
    } catch (err) {
      result.text_content = '';
      result.text_truncated = false;
      errors.push(`Text: ${pdfErrorText(err)}`);
    }
  }

  try {
    const all = await cached(path.join(dir, 'annotations.json'), async () => pdfAnnotations(bytes));
    result.annotations = all.filter((a) => a.page >= from && a.page <= to);
  } catch {
    result.annotations = [];
  }

  const pages = [];
  if (includePages) {
    let sizes = {};
    try {
      sizes = (await cached(path.join(dir, `sizes-${from}-${to}.json`), async () => parsePdfInfo(
        (await runTool(POPPLER.pdfinfo, ['-f', String(from), '-l', String(to), source], deadline)).stdout.toString('utf8'),
      ))).sizes;
    } catch { /* falls back to page 1's size */ }
    for (let page = from; page <= to; page++) {
      const out = path.join(dir, `page-${page}`);
      try {
        if (!fs.existsSync(`${out}.jpg`)) {
          const width = pageWidthPx(sizes[page] || info.sizes[1]);
          const scale = width > PDF_MAX_WIDTH ? ['-scale-to-x', String(PDF_MAX_WIDTH), '-scale-to-y', '-1'] : ['-r', String(PDF_DPI)];
          await runTool(POPPLER.pdftoppm, ['-jpeg', '-jpegopt', `quality=${PDF_JPEG_QUALITY}`, ...scale, '-f', String(page), '-l', String(page), '-singlefile', source, `${out}.tmp`], deadline);
          fs.renameSync(`${out}.tmp.jpg`, `${out}.jpg`);
        }
        pages.push({ page, jpeg: fs.readFileSync(`${out}.jpg`) });
      } catch (err) {
        errors.push(`Page ${page}: ${pdfErrorText(err)}`);
        if (err.code === 'timeout' || err.code === 'missing') break;
      }
    }
  }
  if (errors.length) result.preview_error = errors.join(' ');
  return { ...result, pages };
}

// A folder per distinct file; folders unused for a week are removed.
function pdfCacheDir(cacheDir, bytes) {
  fs.mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
  const cutoff = Date.now() - PDF_CACHE_DAYS * 24 * 60 * 60 * 1000;
  for (const name of fs.readdirSync(cacheDir)) {
    const p = path.join(cacheDir, name);
    try {
      if (fs.statSync(p).mtimeMs < cutoff) fs.rmSync(p, { recursive: true, force: true });
    } catch { /* already gone */ }
  }
  const dir = path.join(cacheDir, createHash('sha256').update(bytes).digest('hex'));
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const now = new Date();
  fs.utimesSync(dir, now, now);
  return dir;
}

// Reads a cached result, or makes and stores it.
async function cached(file, make, kind = 'json') {
  if (fs.existsSync(file)) {
    const raw = fs.readFileSync(file, 'utf8');
    return kind === 'json' ? JSON.parse(raw) : raw;
  }
  const value = await make();
  fs.writeFileSync(file, kind === 'json' ? JSON.stringify(value) : value);
  return value;
}

export function parsePdfInfo(out) {
  const info = { pages: 0, encrypted: false, sizes: {} };
  const pages = /^Pages:\s+(\d+)/m.exec(out);
  if (pages) info.pages = Number(pages[1]);
  info.encrypted = /^Encrypted:\s+yes/m.test(out);
  // "Page size:" without -f/-l (page 1), "Page   N size:" with them; widths as shown (after rotation).
  const rots = {};
  for (const [, n, deg] of out.matchAll(/^Page\s+(\d+)?\s*rot:\s+(\d+)/gm)) rots[n || 1] = Number(deg);
  for (const [, n, w, h] of out.matchAll(/^Page\s+(\d+)?\s*size:\s+([\d.]+) x ([\d.]+) pts/gm)) {
    const page = Number(n || 1);
    info.sizes[page] = Number((rots[page] || 0) % 180 === 90 ? h : w);
  }
  return info;
}

function pageWidthPx(widthPts) {
  return widthPts ? Math.round((widthPts / 72) * PDF_DPI) : 0;
}

function pdfErrorText(err) {
  if (err.code === 'timeout' || err.code === 'missing') return err.message;
  const text = String(err.stderr || err.message || '');
  if (/incorrect password|encrypted/i.test(text)) return 'This PDF is password-protected, so it cannot be read.';
  if (/copying of text .* not allowed/i.test(text)) return 'This PDF does not allow its text to be copied.';
  if (/syntax error|couldn't|may not be a pdf|damaged|xref|trailer/i.test(text)) return 'This PDF looks damaged and could not be read.';
  return (text.trim().split('\n').pop() || 'The PDF could not be read.').slice(0, 200);
}

// Runs a poppler tool without a shell, under the call's deadline and a memory cap.
function runTool(cmd, args, deadline) {
  return new Promise((resolve, reject) => {
    const left = deadline - Date.now();
    if (left <= 0) return reject(Object.assign(new Error('Converting the PDF took too long.'), { code: 'timeout' }));
    const [bin, argv] = PRLIMIT ? [PRLIMIT, [`--as=${PDF_MEMORY_BYTES}`, '--', cmd, ...args]] : [cmd, args];
    const missing = () => Object.assign(new Error(`${cmd} is not installed. Install poppler-utils (sudo apt install poppler-utils, or brew install poppler).`), { code: 'missing' });
    let child;
    try {
      child = spawn(bin, argv, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      return reject(missing());
    }
    const out = [];
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, left);
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-2000); });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err.code === 'ENOENT' ? missing() : err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) return reject(Object.assign(new Error('Converting the PDF took too long.'), { code: 'timeout' }));
      if (code === 0) return resolve({ stdout: Buffer.concat(out), stderr });
      if (PRLIMIT && /failed to execute/i.test(stderr)) return reject(missing());
      reject(Object.assign(new Error(stderr.trim() || `${cmd} exited with code ${code}.`), { exitCode: code, stderr }));
    });
  });
}

// ----- PDF annotations: a small reader for the objects that hold them -----

class PdfRef {
  constructor(num) { this.num = num; }
}
class PdfString {
  constructor(bytes) { this.bytes = bytes; } // a latin1 string of raw bytes
}

const PDF_WS = new Set([' ', '\t', '\n', '\r', '\f', '\0']);
const PDF_DELIM = new Set(['(', ')', '<', '>', '[', ']', '{', '}', '/', '%']);

function skipWs(s, i) {
  while (i < s.length) {
    if (PDF_WS.has(s[i])) i++;
    else if (s[i] === '%') while (i < s.length && s[i] !== '\n' && s[i] !== '\r') i++;
    else break;
  }
  return i;
}

// One PDF value at s[i]: returns [value, next index]. Names are plain strings.
function parsePdfValue(s, i, depth = 0) {
  if (depth > 64) throw new Error('nested too deeply');
  i = skipWs(s, i);
  const c = s[i];
  if (c === undefined) throw new Error('unexpected end');
  if (c === '<' && s[i + 1] === '<') {
    const dict = Object.create(null);
    i += 2;
    for (;;) {
      i = skipWs(s, i);
      if (s[i] === '>' && s[i + 1] === '>') return [dict, i + 2];
      if (s[i] !== '/') throw new Error('bad dictionary key');
      const [key, afterKey] = parsePdfValue(s, i, depth + 1);
      const [value, afterValue] = parsePdfValue(s, afterKey, depth + 1);
      dict[key] = value;
      i = afterValue;
    }
  }
  if (c === '[') {
    const arr = [];
    i++;
    for (;;) {
      i = skipWs(s, i);
      if (s[i] === ']') return [arr, i + 1];
      const [value, next] = parsePdfValue(s, i, depth + 1);
      arr.push(value);
      i = next;
    }
  }
  if (c === '<') {
    const end = s.indexOf('>', i);
    if (end < 0) throw new Error('unterminated hex string');
    let hex = s.slice(i + 1, end).replace(/[^0-9a-fA-F]/g, '');
    if (hex.length % 2) hex += '0';
    return [new PdfString(Buffer.from(hex, 'hex').toString('latin1')), end + 1];
  }
  if (c === '(') return parseLiteralString(s, i);
  if (c === '/') {
    let j = i + 1;
    while (j < s.length && !PDF_WS.has(s[j]) && !PDF_DELIM.has(s[j])) j++;
    return [s.slice(i + 1, j).replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))), j];
  }
  const num = /^[+-]?(\d+\.?\d*|\.\d+)/.exec(s.slice(i, i + 32));
  if (num) {
    const ref = /^(\d+)\s+(\d+)\s+R(?![A-Za-z])/.exec(s.slice(i, i + 40));
    if (ref) return [new PdfRef(Number(ref[1])), i + ref[0].length];
    return [Number(num[0]), i + num[0].length];
  }
  for (const [word, value] of [['true', true], ['false', false], ['null', null]]) {
    if (s.startsWith(word, i)) return [value, i + word.length];
  }
  throw new Error(`unexpected "${c}"`);
}

function parseLiteralString(s, i) {
  let out = '';
  let depth = 0;
  const escapes = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' };
  for (i++; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') {
      const n = s[++i];
      if (n in escapes) out += escapes[n];
      else if (n >= '0' && n <= '7') {
        let oct = n;
        while (oct.length < 3 && s[i + 1] >= '0' && s[i + 1] <= '7') oct += s[++i];
        out += String.fromCharCode(parseInt(oct, 8) & 0xff);
      } else if (n === '\r') {
        if (s[i + 1] === '\n') i++;
      } else if (n !== '\n') out += n;
    } else if (c === '(') {
      depth++;
      out += c;
    } else if (c === ')') {
      if (!depth) return [new PdfString(out), i + 1];
      depth--;
      out += c;
    } else out += c;
  }
  throw new Error('unterminated string');
}

function pdfText(value) {
  if (!(value instanceof PdfString)) return '';
  const b = value.bytes;
  if (b.startsWith('\xfe\xff')) {
    let buf = Buffer.from(b.slice(2), 'latin1');
    if (buf.length % 2) buf = buf.subarray(0, buf.length - 1);
    return Buffer.from(buf).swap16().toString('utf16le').replace(/\0+$/, '');
  }
  if (b.startsWith('\xef\xbb\xbf')) return Buffer.from(b.slice(3), 'latin1').toString('utf8');
  return b;
}

// D:YYYYMMDDHHmmSS+HH'mm' → ISO 8601, or null.
export function pdfDate(value) {
  const m = /^(?:D:)?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(?:([Zz])|([+-])(\d{2})'?(\d{2})?'?)?/.exec((typeof value === 'string' ? value : pdfText(value)).trim());
  if (!m) return null;
  const [, y, mo = '01', d = '01', h = '00', mi = '00', se = '00', z, sign, oh, om = '00'] = m;
  const offset = sign ? `${sign}${oh}:${om}` : 'Z';
  const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${se}${z ? 'Z' : offset}`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function inflateStream(dict, data) {
  const filter = Array.isArray(dict.Filter) ? dict.Filter : (dict.Filter ? [dict.Filter] : []);
  if (filter.length === 0) return data;
  if (filter.length === 1 && filter[0] === 'FlateDecode' && !dict.DecodeParms) {
    return zlib.inflateSync(data, { finishFlush: zlib.constants.Z_SYNC_FLUSH });
  }
  return null; // other filters never hold annotations in practice
}

// Every object in the file, including those packed into object streams.
function pdfObjects(src) {
  const objects = new Map();
  const re = /(?<![\d])(\d+)\s+(\d+)\s+obj\b/g;
  let m;
  while ((m = re.exec(src))) {
    const num = Number(m[1]);
    const start = m.index + m[0].length;
    let value;
    let pos;
    try {
      [value, pos] = parsePdfValue(src, start);
    } catch {
      continue;
    }
    const after = skipWs(src, pos);
    if (src.startsWith('stream', after) && value && typeof value === 'object' && !Array.isArray(value)) {
      let dataStart = after + 6;
      if (src[dataStart] === '\r') dataStart++;
      if (src[dataStart] === '\n') dataStart++;
      const len = typeof value.Length === 'number' ? value.Length : -1;
      let dataEnd = len >= 0 && src.startsWith('endstream', skipWs(src, dataStart + len)) ? dataStart + len : src.indexOf('endstream', dataStart);
      if (dataEnd < 0) break;
      if (value.Type === 'ObjStm') {
        try {
          const data = inflateStream(value, Buffer.from(src.slice(dataStart, dataEnd), 'latin1'));
          if (data) unpackObjectStream(value, data.toString('latin1'), objects);
        } catch { /* skip a damaged object stream */ }
      }
      objects.set(num, value);
      re.lastIndex = dataEnd + 9;
    } else {
      objects.set(num, value);
      re.lastIndex = pos;
    }
  }
  return objects;
}

function unpackObjectStream(dict, text, objects) {
  const first = Number(dict.First);
  const count = Number(dict.N);
  if (!Number.isInteger(first) || !Number.isInteger(count)) return;
  const header = text.slice(0, first).trim().split(/\s+/).map(Number);
  for (let k = 0; k < count && 2 * k + 1 < header.length; k++) {
    const num = header[2 * k];
    try {
      const [value] = parsePdfValue(text, first + header[2 * k + 1]);
      if (!objects.has(num)) objects.set(num, value);
    } catch { /* skip one bad object */ }
  }
}

const SKIPPED_ANNOTATIONS = new Set(['Link', 'Popup', 'Widget', 'PrinterMark', 'TrapNet', 'Watermark']);

// [{ page, type, author, text, created_at }] for the comments, notes and markup in a PDF.
export function pdfAnnotations(bytes) {
  const src = bytes.toString('latin1');
  if (/\/Encrypt\s*(\d+\s+\d+\s+R|<<)/.test(src)) return []; // strings would be ciphertext
  const objects = pdfObjects(src);
  const resolve = (v, seen = 0) => (v instanceof PdfRef && seen < 32 ? resolve(objects.get(v.num), seen + 1) : v);
  const isDict = (v) => v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof PdfString) && !(v instanceof PdfRef);

  // Pages in reading order, from the catalog's page tree.
  const pages = [];
  const visited = new Set();
  const walk = (node) => {
    const ref = node instanceof PdfRef ? node.num : null;
    if (ref != null) {
      if (visited.has(ref)) return;
      visited.add(ref);
    }
    const dict = resolve(node);
    if (!isDict(dict) || pages.length > PDF_MAX_PAGES * 10) return;
    if (dict.Type === 'Pages' || Array.isArray(resolve(dict.Kids))) for (const kid of resolve(dict.Kids) || []) walk(kid);
    else pages.push(dict);
  };
  const catalog = [...objects.values()].filter((o) => isDict(o) && o.Type === 'Catalog').pop();
  if (catalog) walk(catalog.Pages);
  if (!pages.length) for (const o of objects.values()) if (isDict(o) && o.Type === 'Page') pages.push(o);

  const annotations = [];
  pages.forEach((page, index) => {
    for (const item of resolve(page.Annots) || []) {
      const annot = resolve(item);
      if (!isDict(annot) || SKIPPED_ANNOTATIONS.has(annot.Subtype)) continue;
      if (annotations.length >= PDF_ANNOTATION_LIMIT) return;
      const rich = pdfText(resolve(annot.RC)).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      annotations.push({
        page: index + 1,
        type: String(annot.Subtype || 'Unknown'),
        author: pdfText(resolve(annot.T)) || null,
        text: pdfText(resolve(annot.Contents)) || rich || '',
        created_at: pdfDate(resolve(annot.CreationDate)) || pdfDate(resolve(annot.M)),
      });
    }
  });
  return annotations;
}

// ----- the PDF tool's MCP server (stdio, run by claude with --pdf-mcp <socket>) -----
// It only relays: each call goes to the helper over the socket, which downloads
// the file through the extension and renders it.

function pdfMcpServer(socketPath) {
  let buf = '';
  const write = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => {
    buf += d;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) onLine(line);
    }
  });
  process.stdin.on('end', () => process.exit(0));

  function onLine(line) {
    let req;
    try {
      req = JSON.parse(line);
    } catch {
      return write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    }
    if (req.id === undefined || req.id === null) return; // a notification
    const ok = (result) => write({ jsonrpc: '2.0', id: req.id, result });
    if (req.method === 'initialize') {
      return ok({ protocolVersion: req.params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: PDF_SERVER, version: HOST_VERSION } });
    }
    if (req.method === 'ping') return ok({});
    if (req.method === 'tools/list') return ok({ tools: [PDF_TOOL_DEF] });
    if (req.method === 'tools/call' && req.params?.name === PDF_TOOL_DEF.name) return askHelper(socketPath, req.params.arguments || {}).then(ok);
    write({ jsonrpc: '2.0', id: req.id, error: { code: -32601, message: `Unknown method ${req.method}` } });
  }
}

function askHelper(socketPath, input) {
  return new Promise((resolve) => {
    const chunks = [];
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const conn = net.connect(socketPath);
    conn.on('connect', () => conn.write(`${JSON.stringify(input)}\n`));
    conn.on('data', (d) => chunks.push(d));
    conn.on('end', () => {
      try {
        done(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        done(pdfToolError('MantisAI could not read the PDF result.'));
      }
    });
    conn.on('error', () => done(pdfToolError('MantisAI could not reach its helper to read the PDF.')));
  });
}
