#!/usr/bin/env node
// Stands in for the Claude CLI in the native host tests. Records its arguments
// and stdin to $FAKE_CLAUDE_LOG, then behaves as $FAKE_CLAUDE_MODE says:
//   reply (default)  streams "Hello **there**" and succeeds
//   stale            the --resume session does not exist
//   auth             not logged in
//   hang             never answers (to test stopping)
//   crash            exits 3 with a message on stderr
//   tool             first calls the tool in $FAKE_CLAUDE_TOOL ({ name, input }) through the
//                    PreToolUse hook from --settings, exactly as Claude Code would, then replies
//                    "ran" or "blocked: <reason>"
//   calls            makes every call in $FAKE_CLAUDE_CALLS ([{ name, input, result }]) through the
//                    hook; an allowed call gets `result` as its MCP text result. Decisions go to
//                    $FAKE_CLAUDE_LOG.hook as a list
//   pdf              calls read_pdf on the mantis-pdf MCP server from --mcp-config (input in
//                    $FAKE_CLAUDE_TOOL) through the hook; logs to $FAKE_CLAUDE_LOG.pdf
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';

const args = process.argv.slice(2);
if (args[0] === '--version') {
  console.log('9.9.9 (Claude Code)');
  process.exit(0);
}
const mode = process.env.FAKE_CLAUDE_MODE || 'reply';
const session = args.includes('--resume') ? args[args.indexOf('--resume') + 1] : '11111111-2222-4333-8444-555555555555';
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);

let stdin = '';
process.stdin.on('data', (d) => { stdin += d; });
process.stdin.on('end', () => {
  const systemFile = args[args.indexOf('--system-prompt-file') + 1];
  const mcpFile = args.includes('--mcp-config') ? args[args.indexOf('--mcp-config') + 1] : null;
  fs.writeFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({
    args, stdin, cwd: process.cwd(), system: fs.readFileSync(systemFile, 'utf8'),
    mcpServers: mcpFile ? Object.keys(JSON.parse(fs.readFileSync(mcpFile, 'utf8')).mcpServers) : [], maxMcpTokens: process.env.MAX_MCP_OUTPUT_TOKENS || null,
  }));
  if (mode === 'stale') {
    out({ type: 'result', is_error: true, errors: [`No conversation found with session ID: ${session}`], session_id: session });
    process.exit(1);
  }
  if (mode === 'auth') {
    out({ type: 'result', is_error: true, result: 'Not logged in · Please run /login', session_id: session });
    process.exit(1);
  }
  if (mode === 'crash') {
    process.stderr.write('Something broke badly\n');
    process.exit(3);
  }
  out({ type: 'system', subtype: 'init', session_id: session, tools: [], mcp_servers: [{ name: 'webmavens-projects', status: process.env.FAKE_CLAUDE_MCP || 'connected' }] });
  if (mode === 'tool') {
    const { name, input } = JSON.parse(process.env.FAKE_CLAUDE_TOOL);
    const settings = JSON.parse(fs.readFileSync(args[args.indexOf('--settings') + 1], 'utf8'));
    const { command } = settings.hooks.PreToolUse[0].hooks[0];
    out({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'toolu_1', name, input }] }, session_id: session });
    const hook = spawnSync('sh', ['-c', command], { input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: name, tool_input: input, tool_use_id: 'toolu_1' }) });
    const decision = JSON.parse(hook.stdout.toString() || '{}').hookSpecificOutput || {};
    const ran = decision.permissionDecision === 'allow';
    fs.writeFileSync(`${process.env.FAKE_CLAUDE_LOG}.hook`, JSON.stringify(decision));
    out({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', is_error: !ran }] }, session_id: session });
    const text = ran ? 'ran' : `blocked: ${decision.permissionDecisionReason}`;
    out({ type: 'stream_event', event: { type: 'message_start' }, session_id: session });
    out({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }, session_id: session });
    out({ type: 'result', subtype: 'success', is_error: false, result: text, session_id: session });
    return;
  }
  if (mode === 'calls') {
    const calls = JSON.parse(process.env.FAKE_CLAUDE_CALLS || '[]');
    const settings = JSON.parse(fs.readFileSync(args[args.indexOf('--settings') + 1], 'utf8'));
    const { command } = settings.hooks.PreToolUse[0].hooks[0];
    const decisions = [];
    calls.forEach(({ name, input, result }, i) => {
      const id = `toolu_${i + 1}`;
      out({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] }, session_id: session });
      const hook = spawnSync('sh', ['-c', command], { input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: name, tool_input: input, tool_use_id: id }) });
      const decision = JSON.parse(hook.stdout.toString() || '{}').hookSpecificOutput || {};
      decisions.push(decision);
      const ran = decision.permissionDecision === 'allow';
      out({
        type: 'user', session_id: session,
        message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: !ran, content: ran ? [{ type: 'text', text: JSON.stringify(result) }] : decision.permissionDecisionReason }] },
      });
    });
    fs.writeFileSync(`${process.env.FAKE_CLAUDE_LOG}.hook`, JSON.stringify(decisions));
    out({ type: 'result', subtype: 'success', is_error: false, result: 'done', session_id: session });
    return;
  }
  if (mode === 'pdf') {
    // Calls read_pdf ($FAKE_CLAUDE_TOOL is its input) on the mantis-pdf server from
    // --mcp-config, through the gate, and logs tools/list + the result to $FAKE_CLAUDE_LOG.pdf.
    const { mcpServers } = JSON.parse(fs.readFileSync(args[args.indexOf('--mcp-config') + 1], 'utf8'));
    const settings = JSON.parse(fs.readFileSync(args[args.indexOf('--settings') + 1], 'utf8'));
    const input = JSON.parse(process.env.FAKE_CLAUDE_TOOL);
    const name = 'mcp__mantis-pdf__read_pdf';
    out({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'toolu_1', name, input }] }, session_id: session });
    const hook = spawnSync('sh', ['-c', settings.hooks.PreToolUse[0].hooks[0].command], { input: JSON.stringify({ tool_name: name, tool_input: input, tool_use_id: 'toolu_1' }) });
    const decision = JSON.parse(hook.stdout.toString() || '{}').hookSpecificOutput || {};
    const server = mcpServers['mantis-pdf'];
    const mcp = spawn(server.command, server.args, { stdio: ['pipe', 'pipe', 'inherit'] });
    const pending = new Map();
    let buf = '';
    mcp.stdout.setEncoding('utf8');
    mcp.stdout.on('data', (d) => {
      buf += d;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const msg = JSON.parse(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
        pending.get(msg.id)?.(msg);
      }
    });
    let nextId = 1;
    const rpc = (method, params) => new Promise((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      mcp.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
    (async () => {
      const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fake', version: '1' } });
      mcp.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
      const list = await rpc('tools/list', {});
      const call = decision.permissionDecision === 'allow' ? await rpc('tools/call', { name: 'read_pdf', arguments: input }) : null;
      mcp.stdin.end();
      fs.writeFileSync(`${process.env.FAKE_CLAUDE_LOG}.pdf`, JSON.stringify({ decision, init: init.result, tools: list.result.tools, result: call?.result }));
      out({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', is_error: Boolean(!call || call.result.isError) }] }, session_id: session });
      out({ type: 'result', subtype: 'success', is_error: false, result: 'read', session_id: session });
    })();
    return;
  }
  if (mode === 'hang') {
    setInterval(() => {}, 1000);
    return;
  }
  for (const text of ['Hello ', '**there**']) {
    out({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }, session_id: session });
  }
  out({ type: 'result', subtype: 'success', is_error: false, result: 'Hello **there**', session_id: session });
});
