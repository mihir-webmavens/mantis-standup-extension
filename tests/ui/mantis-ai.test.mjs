// The MantisAI chat panel (mantis-ai.js) on a stand-in Mantis page, in headless
// Chrome. background.js and the helper are faked in harness.html (?ai=…).

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { findChrome, launch } from '../helpers/browser.mjs';

const ROOT = new URL('../../', import.meta.url);
const HARNESS = fs.readFileSync(new URL('tests/ui/harness.html', ROOT), 'utf8');
const chromePath = findChrome();
let browser;

// Attachment downloads for read_pdf: a PDF, one the user may not open, a login redirect, one too large,
// a redirect to the stored file on another host (no CORS, like Mantis), and a page instead of the file.
const PDF_BYTES = Buffer.from(`%PDF-1.4\n${'x'.repeat(1500000)}\n%%EOF\n`, 'latin1');
const SMALL_PDF = Buffer.from('%PDF-1.4\nsmall\n%%EOF\n', 'latin1');
const htmlPage = { body: '<html>Mantis</html>', headers: { 'Content-Type': 'text/html; charset=utf-8' } };
const attachments = {
  55: () => ({ status: 302, body: '', headers: { Location: 'https://files.storage.test/55.pdf?signature=abc' } }),
  66: () => htmlPage,
  6791: () => ({ body: PDF_BYTES, headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': "attachment; filename=\"phone app feedback.pdf\"; filename*=UTF-8''phone%20app%20feedback.pdf" } }),
  42: () => ({ status: 403, body: 'Forbidden' }),
  9: () => ({ status: 302, body: '', headers: { Location: 'https://projects.webmavens.dev/login' } }),
  77: () => ({ body: '', headers: { 'Content-Type': 'application/pdf', 'Content-Length': String(60 * 1024 * 1024) } }),
};

const routes = {
  'https://files.storage.test/': () => ({ body: SMALL_PDF, headers: { 'Content-Type': 'application/pdf' } }),
  'https://projects.webmavens.dev/attachments/': ({ url }) => {
    const id = /\/attachments\/(\d+)\/download$/.exec(new URL(url).pathname)?.[1];
    return (attachments[id] || (() => ({ status: 404, body: 'Not found' })))();
  },
  'https://projects.webmavens.dev/': ({ url }) => {
    const file = new URL(url).pathname.slice(1);
    if (['content.js', 'button-styles.js', 'mantis-ai.js'].includes(file)) {
      return { body: fs.readFileSync(new URL(file, ROOT)), headers: { 'Content-Type': 'text/javascript' } };
    }
    if (file === 'mantis-header.css') return { body: fs.readFileSync(new URL(file, ROOT)), headers: { 'Content-Type': 'text/css' } };
    return { body: HARNESS };
  },
};

async function openMantis(path) {
  const page = await browser.open(`https://projects.webmavens.dev/${path}`, { routes });
  await page.eval(`(async () => { for (let i = 0; i < 100 && !(document.querySelector('mantis-ai') && document.querySelector('mantis-quick-standup')); i++) await T.wait(20); await T.wait(150); })()`);
  return page;
}

const run = (page, fn) => page.eval(`(${fn})()`);

describe('MantisAI panel', { skip: !chromePath && 'no Chrome/Chromium found (set CHROME_PATH)' }, () => {
  before(async () => { browser = await launch(chromePath); });
  after(async () => { await browser?.close(); });

  test('the MantisAI button sits in the header\'s right-hand group; without a header, a tab on the edge', async () => {
    const withHeader = await openMantis('tickets/123?header=1');
    const r = await run(withHeader, async () => {
      const launcher = document.querySelector('mantis-ai-launcher');
      return {
        parent: launcher?.parentElement.className, nextIs: launcher?.nextElementSibling?.textContent,
        label: launcher?.shadowRoot.querySelector('button').textContent, edgeTab: !T.ai().querySelector('.edge-tab').hidden,
      };
    });
    assert.deepEqual(r, { parent: 'right', nextIs: 'Bell', label: 'MantisAI', edgeTab: false });

    // Livewire re-rendering the header drops our button; it is back before the next frame is drawn.
    const back = await run(withHeader, async () => {
      document.querySelector('mantis-ai-launcher').remove();
      await new Promise((r) => requestAnimationFrame(r));
      return document.querySelector('header mantis-ai-launcher') !== null;
    });
    assert.equal(back, true);
    await withHeader.close();

    const noHeader = await openMantis('tickets/123');
    const edge = await run(noHeader, async () => ({ launcher: !!document.querySelector('mantis-ai-launcher'), edgeTab: !T.ai().querySelector('.edge-tab').hidden }));
    assert.deepEqual(edge, { launcher: false, edgeTab: true });
    await noHeader.close();
  });

  test('opens with ticket suggestions and focus in the message box; one panel at a time', async () => {
    const page = await openMantis('tickets/123?header=1');
    const r = await run(page, async () => {
      const ai = T.ai(), out = {};
      T.root().querySelector('.fab-standup').click();
      document.querySelector('mantis-ai-launcher').shadowRoot.querySelector('button').click(); await T.wait(100);
      out.open = !ai.querySelector('.drawer').hidden;
      out.standupClosed = T.root().querySelector('.panel-standup').hidden;
      out.focus = ai.activeElement?.tagName;
      out.title = ai.querySelector('.empty-title').textContent;
      out.suggestions = [...ai.querySelectorAll('.suggestion')].map((b) => b.textContent);
      out.chip = ai.querySelector('.ctx').textContent;
      out.sendDisabled = ai.querySelector('.send').disabled;
      T.root().querySelector('.fab-eod').click(); await T.wait(50);
      out.closedByEod = ai.querySelector('.drawer').hidden;
      return out;
    });
    assert.deepEqual(r, {
      open: true, standupClosed: true, focus: 'TEXTAREA', title: 'How can I help with #123?',
      suggestions: ['Summarize this ticket', 'Suggest next steps', 'Draft a reply', 'Write my standup'],
      chip: 'Ticket #123 content included', sendDisabled: true, closedByEod: true,
    });
    await page.close();
  });

  test('sends with Enter, shows typing, streams Markdown safely and continues the conversation', async () => {
    const page = await openMantis('tickets/123');
    const r = await run(page, async () => {
      const ai = T.ai(), out = {};
      ai.querySelector('.edge-tab').click(); await T.wait(50);
      const input = ai.querySelector('textarea');
      input.value = 'What is wrong?'; input.dispatchEvent(new Event('input'));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true, composed: true })); // typing never reaches Mantis's shortcuts
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true, cancelable: true }));
      await T.wait(10);
      out.typing = !!ai.querySelector('.dots');
      out.stopButton = ai.querySelector('.send').getAttribute('aria-label');
      await T.wait(250);
      out.user = ai.querySelector('.msg.user .bubble').textContent;
      out.strong = ai.querySelector('.msg.assistant .body strong')?.textContent;
      out.items = [...ai.querySelectorAll('.msg.assistant .body ol li')].map((li) => li.textContent);
      out.code = ai.querySelector('.msg.assistant .body pre code')?.textContent;
      out.injected = ai.querySelectorAll('.msg.assistant .body b').length;
      out.cleared = input.value;
      const first = T.aiPorts[0].sent[0];
      out.context = { ticket: first.context.ticket, hasBody: first.context.text.includes('the login page loops'), sessionId: first.sessionId };
      out.saved = T.local.mantisAiChats['ticket-123'].sessionId;
      // A follow-up continues the same Claude conversation.
      input.value = 'And then?'; input.dispatchEvent(new Event('input'));
      ai.querySelector('.send').click(); await T.wait(250);
      out.followUpSession = T.aiPorts[1].sent[0].sessionId;
      out.messages = [...ai.querySelectorAll('.msg')].map((m) => m.classList[1]);
      out.leaked = T.leaked;
      return out;
    });
    assert.deepEqual(r, {
      typing: true, stopButton: 'Stop', user: 'What is wrong?', strong: 'the plan', items: ['Fix login', 'Ship it'],
      code: 'const a = "<b>";', injected: 0, cleared: '',
      context: { ticket: '123', hasBody: true, sessionId: null }, saved: '11111111-2222-4333-8444-555555555555',
      followUpSession: '11111111-2222-4333-8444-555555555555', messages: ['user', 'assistant', 'user', 'assistant'], leaked: 0,
    });
    await page.close();
  });

  test('ticket content can be left out', async () => {
    const page = await openMantis('tickets/123');
    const context = await run(page, async () => {
      const ai = T.ai();
      ai.querySelector('.edge-tab').click(); await T.wait(50);
      ai.querySelector('.ctx').click();
      ai.querySelector('.suggestion').click(); await T.wait(50);
      return { chip: ai.querySelector('.ctx').getAttribute('aria-pressed'), ...T.aiPorts[0].sent[0].context };
    });
    assert.equal(context.chip, 'false');
    assert.equal(context.text, undefined);
    assert.equal(context.url, 'https://projects.webmavens.dev/tickets/123');
    await page.close();
  });

  test('Esc stops a reply (keeping what arrived), then closes the panel', async () => {
    const page = await openMantis('tickets/123?ai=slow');
    const r = await run(page, async () => {
      const ai = T.ai(), out = {};
      ai.querySelector('.edge-tab').click(); await T.wait(50);
      ai.querySelector('.suggestion').click(); await T.wait(550);
      out.partial = ai.querySelector('.msg.assistant .body strong')?.textContent;
      T.aiKey = (key) => ai.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, composed: true }));
      T.aiKey('Escape'); await T.wait(50);
      out.portClosed = T.aiPorts[0].disconnected;
      out.stopped = ai.querySelector('.stopped-note')?.textContent;
      out.open = !ai.querySelector('.drawer').hidden;
      out.sendLabel = ai.querySelector('.send').getAttribute('aria-label');
      await T.wait(700); // late pieces from the helper are ignored
      out.stillPartial = !ai.querySelector('.msg.assistant pre');
      T.aiKey('Escape');
      out.closed = ai.querySelector('.drawer').hidden;
      out.leaked = T.leaked;
      return out;
    });
    assert.deepEqual(r, { partial: 'the plan', portClosed: true, stopped: 'Stopped', open: true, sendLabel: 'Send', stillPartial: true, closed: true, leaked: 0 });
    await page.close();
  });

  test('errors explain themselves and offer Retry or setup', async () => {
    const auth = await openMantis('tickets/123?ai=error');
    const r = await run(auth, async () => {
      const ai = T.ai();
      ai.querySelector('.edge-tab').click(); await T.wait(50);
      ai.querySelector('.suggestion').click(); await T.wait(150);
      const error = ai.querySelector('.error');
      const out = { text: error.firstChild.textContent + error.querySelector('code').textContent, buttons: [...error.querySelectorAll('button')].map((b) => b.textContent) };
      error.querySelector('button').click(); await T.wait(150); // Retry
      out.retried = T.aiPorts.length;
      out.userMessages = ai.querySelectorAll('.msg.user').length;
      return out;
    });
    assert.deepEqual(r, { text: 'The Claude CLI is not logged in. Run claude', buttons: ['Retry'], retried: 2, userMessages: 1 });
    await auth.close();

    const setup = await openMantis('dashboard?ai=setup');
    const buttons = await run(setup, async () => {
      const ai = T.ai();
      ai.querySelector('.edge-tab').click(); await T.wait(50);
      ai.querySelector('.suggestion').click(); await T.wait(150);
      return { title: ai.querySelector('.empty').hidden, buttons: [...ai.querySelectorAll('.error button')].map((b) => b.textContent), chip: ai.querySelector('.ctx').hidden };
    });
    assert.deepEqual(buttons, { title: true, buttons: ['Open setup', 'Retry'], chip: true });
    await setup.close();
  });

  test('history is kept per ticket; New chat starts over', async () => {
    const page = await openMantis('tickets/123');
    const r = await run(page, async () => {
      const ai = T.ai(), out = {};
      ai.querySelector('.edge-tab').click(); await T.wait(50);
      ai.querySelector('.suggestion').click(); await T.wait(250);
      ai.querySelector('.close').click();
      ai.querySelector('.edge-tab').click(); await T.wait(50);
      out.reopened = ai.querySelectorAll('.msg').length;
      ai.querySelector('.new-chat').click(); await T.wait(50);
      out.afterNew = { messages: ai.querySelectorAll('.msg').length, empty: !ai.querySelector('.empty').hidden, stored: 'ticket-123' in T.local.mantisAiChats };
      ai.querySelector('.suggestion').click(); await T.wait(250);
      out.freshSession = T.aiPorts.at(-1).sent[0].sessionId;
      return out;
    });
    assert.deepEqual(r, { reopened: 2, afterNew: { messages: 0, empty: true, stored: false }, freshSession: null });
    await page.close();
  });

  test('Mantis lookups show as steps; a change waits for Approve and sends the answer', async () => {
    const page = await openMantis('tickets/123?ai=approve');
    const r = await run(page, async () => {
      const ai = T.ai(), out = {};
      ai.querySelector('.edge-tab').click(); await T.wait(50);
      ai.querySelector('.suggestion').click(); await T.wait(200);
      out.step = [...ai.querySelectorAll('.step')].map((s) => [s.textContent, s.className]);
      const card = ai.querySelector('.approval');
      out.card = { title: card.querySelector('.approval-title').textContent, fields: [...card.querySelectorAll('dt, dd')].map((n) => n.textContent) };
      out.dotsWhileWaiting = !!ai.querySelector('.dots');
      card.querySelector('.approve').click(); await T.wait(100);
      out.answer = T.aiPorts[0].sent.find((m) => m.type === 'approve');
      out.after = ai.querySelector('.approval').textContent;
      out.text = ai.querySelector('.msg.assistant .body').textContent;
      out.stored = T.local.mantisAiChats['ticket-123'].messages[1].steps.map((s) => [s.tool, s.status, s.approval?.state ?? null]);
      return out;
    });
    assert.deepEqual(r, {
      step: [['Read ticket #123', 'step done']],
      card: { title: 'Needs approvalChange #123 status to Resolved', fields: ['Ticket', '123', 'Status', 'Resolved'] },
      dotsWhileWaiting: false,
      answer: { type: 'approve', id: 7, allow: true },
      after: 'ApprovedChange #123 status to Resolved',
      text: 'I will resolve it. Done.',
      stored: [['tickets', 'done', null], ['tickets', 'done', 'approved']],
    });
    await page.close();
  });

  test('Deny sends a refusal; stopping leaves an unanswered card as "Not answered"', async () => {
    const page = await openMantis('tickets/123?ai=approve');
    const r = await run(page, async () => {
      const ai = T.ai(), out = {};
      ai.querySelector('.edge-tab').click(); await T.wait(50);
      ai.querySelector('.suggestion').click(); await T.wait(200);
      ai.querySelector('.deny').click(); await T.wait(100);
      out.answer = T.aiPorts[0].sent.find((m) => m.type === 'approve');
      out.denied = ai.querySelector('.approval .tag').textContent;
      ai.querySelector('textarea').value = 'again'; ai.querySelector('textarea').dispatchEvent(new Event('input'));
      ai.querySelector('.send').click(); await T.wait(200);
      ai.querySelector('.send').click(); await T.wait(50); // Stop while the card waits
      out.expired = [...ai.querySelectorAll('.approval .tag')].map((t) => t.textContent);
      out.helperClosed = T.aiPorts[1].disconnected;
      return out;
    });
    assert.deepEqual(r, { answer: { type: 'approve', id: 7, allow: false }, denied: 'Denied', expired: ['Denied', 'Not answered'], helperClosed: true });
    await page.close();
  });

  test('says how to sign in when the Mantis connection is not signed in', async () => {
    const page = await openMantis('tickets/123?ai=noauth');
    const notice = await run(page, async () => {
      const ai = T.ai();
      ai.querySelector('.edge-tab').click(); await T.wait(50);
      ai.querySelector('.suggestion').click(); await T.wait(250);
      return ai.querySelector('.notice')?.textContent;
    });
    assert.match(notice, /isn't signed in to it\. In a terminal run claude, type \/mcp, and sign in to webmavens-projects/);
    await page.close();
  });

  test('read_pdf: the page downloads attachments with the user\'s session and sends them back in chunks', async () => {
    const page = await openMantis('tickets/123?ai=pdf');
    const r = await run(page, async () => {
      const ai = T.ai();
      ai.querySelector('.edge-tab').click(); await T.wait(50);
      ai.querySelector('.suggestion').click(); await T.wait(1500);
      const sent = T.aiPorts[0].sent.filter((m) => m.type.startsWith('pdf_'));
      const chunks = sent.filter((m) => m.type === 'pdf_chunk' && m.id === 1);
      const bytes = chunks.map((m) => atob(m.data)).join('');
      return {
        step: [...ai.querySelectorAll('.step')].map((s) => s.textContent),
        chunkCount: chunks.length,
        size: bytes.length,
        start: bytes.slice(0, 8),
        ends: Object.fromEntries(sent.filter((m) => m.type === 'pdf_end').map(({ id, type, ...rest }) => [id, rest])),
        otherChunks: sent.filter((m) => m.type === 'pdf_chunk' && m.id !== 1).length,
        downloads: sent.filter((m) => m.type === 'pdf_download').map(({ id, attachmentId }) => ({ id, attachmentId })).sort((a, b) => a.id - b.id),
      };
    });
    assert.deepEqual(r.step, ['Read PDF attachment 6791 from page 11']);
    assert.equal(r.chunkCount, 2); // 1 MB per chunk
    assert.equal(r.size, PDF_BYTES.length);
    assert.equal(r.start, '%PDF-1.4');
    assert.deepEqual(r.ends[1], { size: PDF_BYTES.length, filename: 'phone app feedback.pdf' });
    assert.match(r.ends[2].error, /do not have access to attachment 42 .*HTTP 403/);
    assert.match(r.ends[3].error, /login page: log in to Mantis/);
    assert.deepEqual(r.ends[4], { tooLarge: true, size: 60 * 1024 * 1024 });
    // The browser blocks the cross-host redirect, and a page is not the file: the extension downloads those.
    assert.deepEqual(r.downloads, [{ id: 5, attachmentId: 55 }, { id: 6, attachmentId: 66 }]);
    assert.equal(r.ends[5], undefined);
    assert.equal(r.ends[6], undefined);
    assert.equal(r.otherChunks, 0);
    await page.close();
  });
});
