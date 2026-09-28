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
import { spawnSync } from 'node:child_process';
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
  fs.writeFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({ args, stdin, cwd: process.cwd(), system: fs.readFileSync(systemFile, 'utf8') }));
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
  if (mode === 'hang') {
    setInterval(() => {}, 1000);
    return;
  }
  for (const text of ['Hello ', '**there**']) {
    out({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }, session_id: session });
  }
  out({ type: 'result', subtype: 'success', is_error: false, result: 'Hello **there**', session_id: session });
});
