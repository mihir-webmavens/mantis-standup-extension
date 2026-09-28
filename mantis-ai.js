// MantisAI: a chat panel on Mantis pages that talks to the user's local Claude
// CLI (through background.js and the native helper in native-host/). Opened from
// a "MantisAI" button placed in the Mantis header, or from a tab on the right
// edge of the page when no header is found. On ticket pages the ticket's visible
// content is sent along. Claude can look things up in Mantis through the user's
// Mantis MCP connection; each lookup shows as a step, and any change waits for
// the user's Approve / Deny on a card in the reply. Conversations are kept per
// ticket in chrome.storage.local.
// Runs at document_start (see manifest) so the header button is in place before
// the page is first drawn; content.js later calls MantisAI.init() and closes this
// panel when it opens its own.

const MantisAI = (() => {
  const STORE_KEY = 'mantisAiChats';
  const MAX_CHATS = 40; // oldest conversations are dropped beyond this
  const PAGE_TEXT_LIMIT = 40000;
  const TICKET_PATH_RE = /^\/tickets\/(\d+)\/?$/;
  const SETUP_CODES = ['permission', 'not-installed', 'forbidden'];

  const ICONS = {
    spark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l1.9 5.6 5.6 1.9-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.9L12 2.5z" fill="currentColor"/><path d="M19 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z" fill="currentColor" opacity=".7"/></svg>',
    send: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5.5 11.5L12 5l6.5 6.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor"/></svg>',
    newChat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    doc: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5z M14 3v5h5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  };

  const SUGGESTIONS = {
    ticket: [
      ['Summarize this ticket', 'Summarize this ticket: the problem, what has been discussed so far (read its notes), and what is still open.'],
      ['Suggest next steps', 'Suggest concrete next steps to resolve this ticket, in order.'],
      ['Draft a reply', 'Draft a short, clear reply to the latest comment on this ticket.'],
      ['Write my standup', 'Write a one-line standup "planned action" for today based on this ticket.'],
    ],
    general: [
      ['My active tickets', 'List my active tickets, grouped by priority, with their status.'],
      ['Plan my day', 'Look at my open tickets and suggest what I should work on today, in order, with a one-line reason each.'],
      ['Waiting on me', 'Which of my tickets have new client replies or activity I have not answered yet?'],
      ['Write an EOD update', 'Help me write a short end-of-day update. Ask me what I worked on.'],
    ],
  };

  const CSS = `
    :host {
      all: initial;
      color-scheme: light;
      --accent: #7c3aed; --accent-2: #db2777; --accent-strong: #6d28d9;
      --gradient: linear-gradient(120deg, var(--accent) 0%, var(--accent-2) 100%);
      --accent-soft: #f5f3ff; --accent-border: #ddd6fe; --accent-ring: rgba(124,58,237,.2);
      --surface: #fdfcfb; --card: #fff; --user-bubble: #f1eefb; --code-bg: #f6f5f4; --inline-code: #efedf3;
      --text: #1f1d24; --text-2: #3f3b48; --muted: #6b6775; --faint: #9c98a6;
      --border: #e8e5ee; --input-border: #dcd8e4;
      --shadow: -18px 0 50px rgba(20,12,40,.16), -1px 0 0 rgba(20,12,40,.06);
      --err-bg: #fef2f2; --err-border: #fecaca; --err-text: #991b1b;
    }
    @media (prefers-color-scheme: dark) {
      :host {
        color-scheme: dark;
        --accent-soft: rgba(167,139,250,.14); --accent-border: rgba(167,139,250,.38); --accent-ring: rgba(167,139,250,.3);
        --surface: #17151d; --card: #1f1c27; --user-bubble: #2a2536; --code-bg: #120f18; --inline-code: #2c2838;
        --text: #f3f2f6; --text-2: #d6d3de; --muted: #a09bab; --faint: #6f6a7a;
        --border: #2d2938; --input-border: #3a3547;
        --shadow: -18px 0 50px rgba(0,0,0,.55), -1px 0 0 rgba(167,139,250,.1);
        --err-bg: rgba(239,68,68,.12); --err-border: rgba(239,68,68,.35); --err-text: #fca5a5;
      }
    }
    * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
    svg { width: 18px; height: 18px; display: block; }
    button { font: inherit; }
    [hidden] { display: none !important; }

    /* Right-edge tab, only when the Mantis header could not be found. */
    .edge-tab {
      position: fixed; right: 0; top: 42%; z-index: 2147483645;
      display: flex; align-items: center; gap: 6px; padding: 10px 8px;
      writing-mode: vertical-rl; transform: rotate(180deg);
      border: 0; border-radius: 0 10px 10px 0; background: var(--gradient); color: #fff;
      font-size: 12px; font-weight: 700; letter-spacing: .04em; cursor: pointer;
      box-shadow: 0 6px 18px rgba(124,58,237,.35);
    }
    .edge-tab svg { width: 14px; height: 14px; transform: rotate(90deg); }
    .edge-tab:focus-visible { outline: 2px solid #fff; outline-offset: -4px; }

    .drawer {
      position: fixed; top: 0; right: 0; bottom: 0; z-index: 2147483647;
      width: 440px; max-width: 100vw; display: flex; flex-direction: column;
      background: var(--surface); color: var(--text); box-shadow: var(--shadow);
      font-size: 14px; line-height: 1.6;
      animation: slide-in .22s cubic-bezier(.2,.8,.2,1);
    }
    @keyframes slide-in { from { transform: translateX(24px); opacity: 0; } to { transform: none; opacity: 1; } }
    .drawer:focus { outline: none; }

    .top {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      padding: 14px 14px 12px 18px; border-bottom: 1px solid var(--border);
    }
    .brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .logo {
      flex: none; width: 32px; height: 32px; border-radius: 10px; display: grid; place-items: center;
      background: var(--gradient); color: #fff; box-shadow: 0 4px 12px rgba(124,58,237,.3);
    }
    .brand h2 { margin: 0; font-size: 15px; font-weight: 700; line-height: 1.2; }
    .brand p { margin: 1px 0 0; font-size: 12px; color: var(--muted); line-height: 1.3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .top-actions { display: flex; gap: 2px; }
    .icon-btn {
      width: 34px; height: 34px; display: grid; place-items: center; border: 0; border-radius: 8px;
      background: none; color: var(--muted); cursor: pointer;
    }
    .icon-btn:hover:not(:disabled) { background: var(--accent-soft); color: var(--text); }
    .icon-btn:disabled { opacity: .4; cursor: default; }
    .icon-btn:focus-visible, .chip:focus-visible, .suggestion:focus-visible, .msg-action:focus-visible, .ctx:focus-visible {
      outline: 2px solid var(--accent); outline-offset: 1px;
    }

    .thread { flex: 1; overflow-y: auto; overscroll-behavior: contain; padding: 20px 18px 8px; scroll-behavior: smooth; }
    .empty { display: flex; flex-direction: column; align-items: center; text-align: center; padding: 48px 8px 12px; }
    .empty .logo { width: 44px; height: 44px; border-radius: 14px; margin-bottom: 14px; }
    .empty .logo svg { width: 24px; height: 24px; }
    .empty h3 { margin: 0 0 4px; font-size: 20px; font-weight: 650; letter-spacing: -.01em; }
    .empty p { margin: 0 0 20px; color: var(--muted); font-size: 13px; }
    .suggestions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; width: 100%; }
    .suggestion {
      text-align: left; padding: 10px 12px; border: 1px solid var(--border); border-radius: 12px;
      background: var(--card); color: var(--text-2); font-size: 13px; line-height: 1.35; cursor: pointer;
      transition: border-color .15s ease, background .15s ease;
    }
    .suggestion:hover { border-color: var(--accent-border); background: var(--accent-soft); }

    .msg { margin: 0 0 18px; }
    .msg.user { display: flex; justify-content: flex-end; }
    .msg.user .bubble {
      max-width: 85%; padding: 9px 14px; border-radius: 16px 16px 4px 16px;
      background: var(--user-bubble); color: var(--text); white-space: pre-wrap; word-break: break-word;
    }
    .msg.assistant { display: grid; grid-template-columns: 26px 1fr; gap: 10px; }
    .msg.assistant .avatar {
      width: 26px; height: 26px; border-radius: 8px; display: grid; place-items: center;
      background: var(--gradient); color: #fff; margin-top: 1px;
    }
    .msg.assistant .avatar svg { width: 15px; height: 15px; }
    .body { min-width: 0; color: var(--text); word-break: break-word; }
    .stopped-note { color: var(--faint); font-size: 12px; font-style: italic; }
    .msg-actions { display: flex; gap: 4px; margin-top: 4px; opacity: 0; transition: opacity .15s ease; }
    .msg.assistant:hover .msg-actions, .msg-actions:focus-within { opacity: 1; }
    .msg-action {
      border: 0; background: none; color: var(--muted); font-size: 12px; padding: 3px 6px; border-radius: 6px; cursor: pointer;
    }
    .msg-action:hover { background: var(--accent-soft); color: var(--text); }

    /* Markdown */
    .body > :first-child { margin-top: 0; }
    .body > :last-child { margin-bottom: 0; }
    .body p { margin: 0 0 10px; }
    .body h3, .body h4, .body h5, .body h6 { margin: 16px 0 6px; line-height: 1.3; }
    .body h3 { font-size: 16px; } .body h4 { font-size: 15px; } .body h5, .body h6 { font-size: 14px; }
    .body ul, .body ol { margin: 0 0 10px; padding-left: 22px; }
    .body li { margin: 3px 0; }
    .body li > ul, .body li > ol { margin: 3px 0 0; }
    .body a { color: var(--accent); text-underline-offset: 2px; }
    .body strong { font-weight: 650; }
    .body blockquote { margin: 0 0 10px; padding: 2px 12px; border-left: 3px solid var(--accent-border); color: var(--text-2); }
    .body hr { border: 0; border-top: 1px solid var(--border); margin: 14px 0; }
    .body code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12.5px; }
    .body :not(pre) > code { padding: 1px 5px; border-radius: 5px; background: var(--inline-code); }
    .code { margin: 0 0 12px; border: 1px solid var(--border); border-radius: 10px; overflow: hidden; background: var(--code-bg); }
    .code-head { display: flex; justify-content: space-between; align-items: center; padding: 4px 6px 4px 12px; border-bottom: 1px solid var(--border); font-size: 11px; color: var(--muted); }
    .code pre { margin: 0; padding: 10px 12px; overflow-x: auto; line-height: 1.5; }
    .table-wrap { overflow-x: auto; margin: 0 0 12px; }
    .body table { border-collapse: collapse; font-size: 13px; }
    .body th, .body td { border: 1px solid var(--border); padding: 5px 9px; text-align: left; vertical-align: top; }
    .body th { background: var(--code-bg); font-weight: 600; }

    .dots { display: inline-flex; gap: 4px; padding: 9px 0; }
    .dots span { width: 7px; height: 7px; border-radius: 50%; background: var(--faint); animation: blink 1.2s infinite ease-in-out; }
    .dots span:nth-child(2) { animation-delay: .15s; } .dots span:nth-child(3) { animation-delay: .3s; }
    @keyframes blink { 0%, 80%, 100% { opacity: .25; transform: translateY(0); } 40% { opacity: 1; transform: translateY(-3px); } }
    .cursor::after { content: ""; display: inline-block; width: 7px; height: 15px; margin-left: 2px; vertical-align: -2px; border-radius: 2px; background: var(--accent); animation: caret 1s steps(2) infinite; }
    @keyframes caret { 50% { opacity: 0; } }

    .error {
      margin: 0 0 18px 36px; padding: 10px 12px; border-radius: 10px;
      background: var(--err-bg); border: 1px solid var(--err-border); color: var(--err-text); font-size: 13px; line-height: 1.45;
    }
    .error code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
    .error-actions { display: flex; gap: 8px; margin-top: 8px; }
    .chip {
      border: 1px solid currentColor; background: none; color: inherit; border-radius: 999px;
      padding: 3px 12px; font-size: 12px; font-weight: 600; cursor: pointer;
    }
    .chip:hover { background: rgba(127,127,127,.1); }

    .composer-wrap { padding: 8px 14px 12px; }
    .ctx {
      display: inline-flex; align-items: center; gap: 6px; max-width: 100%; margin: 0 0 8px 2px; padding: 3px 10px 3px 8px;
      border: 1px solid var(--accent-border); border-radius: 999px; background: var(--accent-soft); color: var(--accent);
      font-size: 12px; font-weight: 600; cursor: pointer;
    }
    .ctx svg { width: 14px; height: 14px; flex: none; }
    .ctx span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ctx[aria-pressed="false"] { border-style: dashed; border-color: var(--input-border); background: none; color: var(--faint); }
    .ctx[aria-pressed="false"] span { text-decoration: line-through; }
    .composer {
      border: 1px solid var(--input-border); border-radius: 18px; background: var(--card);
      box-shadow: 0 2px 10px rgba(20,12,40,.06); padding: 10px 10px 8px 14px;
      transition: border-color .15s ease, box-shadow .15s ease;
    }
    .composer:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-ring); }
    .composer textarea {
      display: block; width: 100%; min-height: 24px; max-height: 200px; resize: none; overflow-y: auto;
      border: 0; outline: 0; padding: 2px 0; background: none; color: var(--text); font-size: 14px; line-height: 1.5;
    }
    .composer textarea::placeholder { color: var(--faint); }
    .composer-bar { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 6px; }
    .hint { color: var(--faint); font-size: 11px; }
    .send {
      flex: none; width: 34px; height: 34px; border: 0; border-radius: 10px; display: grid; place-items: center;
      background: var(--gradient); color: #fff; cursor: pointer; transition: filter .15s ease, transform .1s ease;
    }
    .send:hover:not(:disabled) { filter: brightness(1.08); }
    .send:active:not(:disabled) { transform: scale(.94); }
    .send:disabled { filter: grayscale(.6) opacity(.4); cursor: default; }
    .send:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .send.stop { background: var(--text); color: var(--surface); }
    .disclaimer { margin: 8px 0 0; text-align: center; color: var(--faint); font-size: 11px; }

    /* Mantis lookups and changes, shown above the reply text */
    .steps { display: grid; gap: 4px; margin: 2px 0 8px; }
    .step { display: flex; align-items: center; gap: 7px; color: var(--muted); font-size: 12.5px; line-height: 1.4; }
    .step::before {
      content: ""; flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--faint);
    }
    .step.running::before { background: var(--accent); animation: blink 1.2s infinite ease-in-out; }
    .step.done::before { background: #22c55e; }
    .step.error::before, .step.denied::before { background: #ef4444; }
    .step.denied { text-decoration: line-through; }
    .approval {
      margin: 4px 0 6px; padding: 12px; border-radius: 12px; border: 1px solid var(--accent-border);
      background: var(--accent-soft); color: var(--text); font-size: 13px;
    }
    .approval-title { display: flex; align-items: center; gap: 8px; font-weight: 650; margin-bottom: 8px; }
    .approval-title .tag {
      padding: 1px 8px; border-radius: 999px; font-size: 10px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase;
      background: var(--card); color: var(--accent); border: 1px solid var(--accent-border);
    }
    .approval dl { display: grid; grid-template-columns: auto 1fr; gap: 3px 10px; margin: 0 0 10px; font-size: 12.5px; }
    .approval dt { color: var(--muted); }
    .approval dd { margin: 0; min-width: 0; word-break: break-word; }
    .approval .long {
      grid-column: 1 / -1; max-height: 180px; overflow-y: auto; white-space: pre-wrap; padding: 8px 10px;
      border-radius: 8px; background: var(--card); border: 1px solid var(--border);
    }
    .approval-actions { display: flex; gap: 8px; align-items: center; }
    .approve, .deny {
      padding: 6px 14px; border-radius: 8px; font-size: 13px; font-weight: 650; cursor: pointer;
    }
    .approve { border: 0; background: var(--gradient); color: #fff; }
    .deny { border: 1px solid var(--input-border); background: var(--card); color: var(--text); }
    .approve:focus-visible, .deny:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .approval-note { color: var(--muted); font-size: 11.5px; margin-left: auto; }
    .approval.answered { background: none; border-style: dashed; padding: 8px 12px; }
    .approval.answered .approval-title { margin: 0; font-weight: 600; }
    .notice {
      margin: 0 0 16px; padding: 10px 12px; border-radius: 10px; font-size: 12.5px; line-height: 1.45;
      background: var(--accent-soft); border: 1px solid var(--accent-border); color: var(--text-2);
    }
    .notice code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }

    @media (max-width: 480px) { .drawer { width: 100vw; } .suggestions { grid-template-columns: 1fr; } }
    @media (prefers-reduced-motion: reduce) {
      .drawer, .dots span, .cursor::after { animation: none !important; }
      .thread { scroll-behavior: auto; }
    }
  `;

  // Header button, in its own shadow root so Mantis's styles can't reach it.
  const LAUNCHER_CSS = `
    :host { all: initial; display: inline-flex; align-items: center; flex: none; margin: 0 8px; }
    button {
      display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 12px 0 10px;
      border: 1px solid transparent; border-radius: 999px; cursor: pointer;
      background: linear-gradient(#fff, #fff) padding-box, linear-gradient(120deg, #7c3aed, #db2777) border-box;
      color: #6d28d9; font: 600 13px/1 system-ui, -apple-system, "Segoe UI", sans-serif; white-space: nowrap;
      transition: color .15s ease, box-shadow .15s ease;
    }
    button:hover, button[aria-expanded="true"] {
      background: linear-gradient(120deg, #7c3aed, #db2777) padding-box, linear-gradient(120deg, #7c3aed, #db2777) border-box;
      color: #fff; box-shadow: 0 4px 14px rgba(124,58,237,.35);
    }
    button:focus-visible { outline: 2px solid #7c3aed; outline-offset: 2px; }
    svg { width: 16px; height: 16px; display: block; }
    @media (prefers-color-scheme: dark) {
      button:not(:hover):not([aria-expanded="true"]) {
        background: linear-gradient(#1f1c27, #1f1c27) padding-box, linear-gradient(120deg, #a78bfa, #f472b6) border-box; color: #ddd6fe;
      }
    }
  `;

  let opts = { getTicketInfo: () => ({}), onOpen: () => {} };
  let host = null;
  let ui = null;
  let launcher = null;
  let launcherButton = null;
  let chats = {}; // key -> { key, label, sessionId, messages: [{ role, text, stopped? }], updatedAt }
  let chat = null; // the conversation shown
  const streams = new Map(); // chat key -> { port, message } while a reply streams
  let includeContext = true;
  let renderQueued = false;

  // ---------- conversations ----------

  function chatKey() {
    const ticket = TICKET_PATH_RE.exec(location.pathname)?.[1];
    return ticket ? `ticket-${ticket}` : 'general';
  }

  function currentTicket() {
    return TICKET_PATH_RE.exec(location.pathname)?.[1] || null;
  }

  function chatFor(key) {
    if (!chats[key]) {
      const ticket = /^ticket-(\d+)$/.exec(key)?.[1];
      chats[key] = { key, label: ticket ? `#${ticket}` : 'General', sessionId: null, messages: [], updatedAt: 0 };
    }
    return chats[key];
  }

  async function loadChats() {
    try {
      const stored = (await chrome.storage.local.get(STORE_KEY))[STORE_KEY] || {};
      // Keep conversations that are streaming here; take everything else from storage.
      for (const [key, value] of Object.entries(stored)) if (!streams.has(key)) chats[key] = value;
    } catch {
      // Extension reloaded under this page; keep what is in memory.
    }
  }

  // Writes one conversation, leaving the others as stored (another tab may have changed them).
  async function saveChat(c) {
    try {
      const stored = (await chrome.storage.local.get(STORE_KEY))[STORE_KEY] || {};
      // A reply that has not started yet is left out, so a reload never shows an empty answer.
      const messages = c.messages.filter((m) => m.role === 'user' || m.text || m.stopped || m.steps?.length);
      if (messages.length) stored[c.key] = { ...c, messages, error: undefined, notice: undefined };
      else delete stored[c.key];
      const keep = Object.values(stored).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_CHATS);
      await chrome.storage.local.set({ [STORE_KEY]: Object.fromEntries(keep.map((c) => [c.key, c])) });
    } catch {
      // Not saved (e.g. the extension was reloaded); the conversation still works in this tab.
    }
  }

  // ---------- page content ----------

  function pageContext() {
    const ticket = currentTicket();
    const info = opts.getTicketInfo() || {};
    const title = (document.querySelector('h1')?.innerText || document.title || '').trim().slice(0, 300);
    if (!ticket || !includeContext) return { url: location.href, title };
    const root = document.querySelector('main, [role="main"]') || document.body;
    const text = (root.innerText || '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .slice(0, PAGE_TEXT_LIMIT);
    return { ticket, url: location.href, title, priority: info.priority || null, text };
  }

  // ---------- UI ----------

  function buildUi() {
    host = document.createElement('mantis-ai');
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>${CSS}</style>
      <button class="edge-tab" type="button" hidden aria-label="Open MantisAI">${ICONS.spark}MantisAI</button>
      <section class="drawer" role="dialog" aria-label="MantisAI" tabindex="-1" hidden>
        <header class="top">
          <div class="brand">
            <div class="logo">${ICONS.spark}</div>
            <div><h2>MantisAI</h2><p class="subtitle"></p></div>
          </div>
          <div class="top-actions">
            <button class="icon-btn new-chat" type="button" title="New chat" aria-label="New chat">${ICONS.newChat}</button>
            <button class="icon-btn close" type="button" title="Close (Esc)" aria-label="Close">${ICONS.close}</button>
          </div>
        </header>
        <div class="thread">
          <div class="empty">
            <div class="logo">${ICONS.spark}</div>
            <h3 class="empty-title"></h3>
            <p class="empty-sub"></p>
            <div class="suggestions"></div>
          </div>
          <div class="messages" role="log" aria-live="polite"></div>
        </div>
        <footer class="composer-wrap">
          <button class="ctx" type="button" aria-pressed="true" hidden>${ICONS.doc}<span></span></button>
          <div class="composer">
            <textarea rows="1" aria-label="Message MantisAI"></textarea>
            <div class="composer-bar">
              <span class="hint">Enter to send · Shift+Enter for a new line</span>
              <button class="send" type="button" aria-label="Send" disabled>${ICONS.send}</button>
            </div>
          </div>
          <p class="disclaimer">Claude through your Claude CLI · reads Mantis as you · changes need your approval</p>
        </footer>
      </section>
    `;
    document.documentElement.appendChild(host);

    ui = {
      edgeTab: root.querySelector('.edge-tab'),
      drawer: root.querySelector('.drawer'),
      subtitle: root.querySelector('.subtitle'),
      newChat: root.querySelector('.new-chat'),
      close: root.querySelector('.close'),
      thread: root.querySelector('.thread'),
      empty: root.querySelector('.empty'),
      emptyTitle: root.querySelector('.empty-title'),
      emptySub: root.querySelector('.empty-sub'),
      suggestions: root.querySelector('.suggestions'),
      messages: root.querySelector('.messages'),
      ctx: root.querySelector('.ctx'),
      input: root.querySelector('textarea'),
      send: root.querySelector('.send'),
    };

    ui.edgeTab.addEventListener('click', toggle);
    ui.close.addEventListener('click', close);
    ui.newChat.addEventListener('click', newChat);
    ui.send.addEventListener('click', () => (streams.has(chat.key) ? stop() : sendFromInput()));
    ui.ctx.addEventListener('click', () => {
      includeContext = !includeContext;
      renderContextChip();
    });
    ui.input.addEventListener('input', () => {
      autosize();
      renderSendButton();
    });
    ui.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        if (!streams.has(chat.key)) sendFromInput();
      }
    });
    // Keys stay away from Mantis's own shortcuts; Esc stops a reply, then closes.
    ui.drawer.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key !== 'Escape') return;
      if (streams.has(chat.key)) stop();
      else close();
    });
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function button(className, text, onClick) {
    const b = el('button', className, text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  function autosize() {
    ui.input.style.height = 'auto';
    ui.input.style.height = `${Math.min(ui.input.scrollHeight, 200)}px`;
  }

  function renderSendButton() {
    const streaming = streams.has(chat.key);
    ui.send.classList.toggle('stop', streaming);
    ui.send.innerHTML = streaming ? ICONS.stop : ICONS.send;
    ui.send.setAttribute('aria-label', streaming ? 'Stop' : 'Send');
    ui.send.title = streaming ? 'Stop (Esc)' : 'Send (Enter)';
    ui.send.disabled = !streaming && !ui.input.value.trim();
  }

  function renderContextChip() {
    const ticket = currentTicket();
    ui.ctx.hidden = !ticket;
    ui.ctx.setAttribute('aria-pressed', String(includeContext));
    ui.ctx.title = includeContext ? 'The ticket\'s content is sent with each message. Click to leave it out.' : 'Click to include the ticket\'s content again.';
    ui.ctx.querySelector('span').textContent = includeContext ? `Ticket #${ticket} content included` : `Ticket #${ticket} content not included`;
    ui.input.placeholder = ticket ? `Ask about ticket #${ticket}…` : 'Message MantisAI…';
  }

  function render() {
    if (!ui || ui.drawer.hidden) return;
    const ticket = currentTicket();
    ui.subtitle.textContent = ticket ? `Ticket #${ticket} · Claude on your computer` : 'Claude on your computer';
    ui.newChat.disabled = !chat.messages.length && !chat.error;
    renderContextChip();
    renderSendButton();

    const empty = !chat.messages.length && !chat.error;
    ui.empty.hidden = !empty;
    if (empty) {
      ui.emptyTitle.textContent = ticket ? `How can I help with #${ticket}?` : 'How can I help today?';
      ui.emptySub.textContent = ticket
        ? 'I can read this ticket and look things up in Mantis. Ask a question or pick a starting point.'
        : 'I can look things up in Mantis for you. Ask anything, or pick a starting point.';
      ui.suggestions.replaceChildren(...SUGGESTIONS[ticket ? 'ticket' : 'general'].map(([label, prompt]) =>
        button('suggestion', label, () => send(prompt))));
    }

    const nearBottom = ui.thread.scrollHeight - ui.thread.scrollTop - ui.thread.clientHeight < 80;
    ui.messages.replaceChildren(...chat.messages.map(messageNode));
    if (chat.notice) ui.messages.prepend(noticeNode(chat.notice));
    const stream = streams.get(chat.key);
    if (stream && !stream.message.text && !stream.message.steps?.length) ui.messages.append(typingNode());
    if (chat.error) ui.messages.append(errorNode(chat.error));
    if (nearBottom || stream) ui.thread.scrollTop = ui.thread.scrollHeight;
  }

  // Streaming updates arrive in small pieces; redraw at most once per frame.
  function queueRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      render();
    });
  }

  function messageNode(m) {
    if (m.role === 'user') {
      const wrap = el('div', 'msg user');
      wrap.append(el('div', 'bubble', m.text));
      return wrap;
    }
    const streaming = streams.get(chat.key)?.message === m;
    if (!m.text && !m.steps?.length && streaming) return document.createDocumentFragment(); // typing dots instead
    const wrap = el('div', 'msg assistant');
    const avatar = el('div', 'avatar');
    avatar.innerHTML = ICONS.spark;
    const col = el('div');
    if (m.steps?.length) col.append(stepsNode(m, streaming));
    const body = el('div', 'body');
    body.append(renderMarkdown(m.text));
    if (streaming && m.text) (body.lastElementChild || body).classList.add('cursor');
    if (m.stopped) body.append(el('p', 'stopped-note', 'Stopped'));
    if (m.text || m.stopped) col.append(body);
    const waiting = m.steps?.some((st) => st.approval?.state === 'pending');
    if (streaming && !m.text && !waiting) {
      const dots = el('div', 'dots');
      dots.append(el('span'), el('span'), el('span'));
      col.append(dots);
    }
    if (!streaming && m.text) {
      const actions = el('div', 'msg-actions');
      actions.append(copyButton(() => m.text, 'msg-action'));
      col.append(actions);
    }
    wrap.append(avatar, col);
    return wrap;
  }

  // ---------- Mantis steps and approvals ----------

  const STATUS_NAMES = { new: 'New', assigned: 'Assigned', in_progress: 'In progress', awaiting_client_reply: 'Awaiting client reply', resolved: 'Resolved', closed: 'Closed' };

  // A short sentence for one Mantis tool call.
  function describeTool(tool, input = {}) {
    const t = input.ticket_id ? `#${input.ticket_id}` : '';
    const a = input.action;
    const known = {
      whoami: () => 'Checked who you are in Mantis',
      lookups: () => ({ list_projects: 'Listed projects', list_labels: 'Listed labels', list_statuses: 'Listed statuses', list_users: 'Listed users' })[a],
      tickets: () => ({
        list: `Searched tickets${input.q ? ` for “${input.q}”` : ''}${input.status_key ? ` (${STATUS_NAMES[input.status_key] || input.status_key})` : ''}`,
        get: `Read ticket ${t}`,
        create: `Create a ticket “${input.title || ''}”`,
        update: `Edit ticket ${t}`,
        change_status: `Change ${t} status to ${STATUS_NAMES[input.status_key] || input.status_key}`,
        change_priority: `Set ${t} priority to ${input.priority ?? 'none'}`,
        change_visibility: `Change ${t} visibility to ${input.visibility}`,
        assign: `Assign ${t} to user ${input.assignee_id}`,
        unassign: `Unassign user ${input.assignee_id} from ${t}`,
        attach_label: `Add label ${input.label_id} to ${t}`,
        detach_label: `Remove label ${input.label_id} from ${t}`,
        reopen: `Reopen ${t}`, lock: `Lock ${t}`, unlock: `Unlock ${t}`, duplicate: `Duplicate ${t}`,
        mark_read: `Mark ${t} as read`, mark_unread: `Mark ${t} as unread`, delete: `Delete ticket ${t}`,
      })[a],
      notes: () => ({
        list: `Read notes on ${t}`, timeline: `Read the history of ${t}`, get: `Read note ${input.note_id}`,
        list_approvals: 'Listed notes waiting for approval', create: `Post a note on ${t}`, update: `Edit note ${input.note_id}`,
        change_visibility: `Change note ${input.note_id} visibility`, approve: `Approve note ${input.approval_id}`, reject: `Reject note ${input.approval_id}`,
      })[a],
      todos: () => ({ list: 'Listed your todos', get: `Read todo ${input.todo_id}`, create: 'Create a todo', update: `Edit todo ${input.todo_id}`,
        delete: `Delete todo ${input.todo_id}`, toggle_creator: `Tick todo ${input.todo_id}`, toggle_subject: `Tick todo ${input.todo_id}`, add_note: `Add a note to todo ${input.todo_id}` })[a],
      brief: () => ({ get: `Read the project ${input.project_id} brief`, history: 'Read brief history', append: `Add to the project ${input.project_id} brief`, update: `Rewrite part of the project ${input.project_id} brief` })[a],
      chat: () => ({ rooms: 'Listed chat rooms', messages: 'Read chat messages', updates: 'Checked new chat messages', wait: 'Waited for chat replies',
        search: `Searched chat for “${input.query || ''}”`, send: 'Send a chat message', start_dm: 'Start a direct message', mark_read: 'Mark chat as read', react: `React ${input.emoji || ''} to a chat message` })[a],
      attachments: () => ({ list: `Listed attachments${t ? ` on ${t}` : ''}`, download: 'Opened attachments', upload: 'Upload a file', request_upload: 'Upload a file', attach: 'Attach files' })[a],
    };
    return known[tool]?.() || `${tool}${a ? ` · ${a}` : ''}${t ? ` ${t}` : ''}`;
  }

  // Field names in an approval card; long text fields get their own box.
  const FIELD_LABELS = {
    ticket_id: 'Ticket', project_id: 'Project', note_id: 'Note', todo_id: 'Todo', title: 'Title', status_key: 'Status',
    priority: 'Priority', visibility: 'Visibility', assignee_id: 'User', label_id: 'Label', room_id: 'Room', user_id: 'User', email: 'Email',
    section_key: 'Section', expected_completed_at: 'Due', subject_user_id: 'Assignee', emoji: 'Emoji',
  };
  const LONG_FIELDS = ['body_markdown', 'description_markdown', 'body', 'edited_body', 'reply_body', 'reason'];

  function approvalNode(step, stream) {
    const { approval } = step;
    const box = el('div', `approval${approval.state === 'pending' ? '' : ' answered'}`);
    const title = el('div', 'approval-title');
    if (approval.state === 'pending') {
      title.append(el('span', 'tag', 'Needs approval'), describeTool(step.tool, step.input));
      box.append(title);
      const fields = el('dl');
      for (const [key, value] of Object.entries(step.input || {})) {
        if (key === 'action' || value == null || value === '') continue;
        if (LONG_FIELDS.includes(key)) {
          fields.append(el('dd', 'long', String(value)));
        } else if (FIELD_LABELS[key]) {
          fields.append(el('dt', '', FIELD_LABELS[key]), el('dd', '', key === 'status_key' ? STATUS_NAMES[value] || value : String(value)));
        }
      }
      if (fields.childElementCount) box.append(fields);
      const actions = el('div', 'approval-actions');
      const answer = (allow) => {
        approval.state = allow ? 'approved' : 'denied';
        try {
          stream.port.postMessage({ type: 'approve', id: approval.id, allow });
        } catch {
          approval.state = 'expired';
        }
        render();
        ui.input.focus();
      };
      actions.append(button('approve', 'Approve', () => answer(true)), button('deny', 'Deny', () => answer(false)),
        el('span', 'approval-note', 'Runs in Mantis as you'));
      box.append(actions);
    } else {
      const label = { approved: 'Approved', denied: 'Denied', expired: 'Not answered' }[approval.state];
      title.append(el('span', 'tag', label), describeTool(step.tool, step.input));
      box.append(title);
    }
    return box;
  }

  function stepsNode(m, streaming) {
    const list = el('div', 'steps');
    const stream = streaming ? streams.get(chat.key) : null;
    for (const step of m.steps) {
      if (step.approval) {
        if (step.approval.state === 'pending' && !stream) step.approval.state = 'expired'; // the reply ended first
        list.append(approvalNode(step, stream));
        continue;
      }
      const state = step.status === 'error' && step.approval?.state === 'denied' ? 'denied' : step.status;
      const line = el('div', `step ${state}`, describeTool(step.tool, step.input));
      if (step.status === 'error') line.title = 'This lookup failed';
      list.append(line);
    }
    return list;
  }

  function noticeNode({ status }) {
    const box = el('div', 'notice');
    box.setAttribute('role', 'note');
    const text = status === 'needs-auth'
      ? 'MantisAI can\'t reach Mantis: your Claude CLI isn\'t signed in to it. In a terminal run `claude`, type `/mcp`, and sign in to webmavens-projects. Until then I can only answer from the page.'
      : 'MantisAI couldn\'t connect to Mantis for this reply, so it answered from the page only. If this keeps happening, check that `claude` can reach projects.webmavens.dev.';
    for (const [i, part] of text.split('`').entries()) box.append(i % 2 ? el('code', '', part) : part);
    return box;
  }

  function copyButton(getText, className) {
    const b = button(className, 'Copy', async () => {
      try {
        await navigator.clipboard.writeText(getText());
        b.textContent = 'Copied';
      } catch {
        b.textContent = 'Copy failed';
      }
      setTimeout(() => { b.textContent = 'Copy'; }, 1500);
    });
    return b;
  }

  function typingNode() {
    const wrap = el('div', 'msg assistant');
    const avatar = el('div', 'avatar');
    avatar.innerHTML = ICONS.spark;
    const dots = el('div', 'dots');
    dots.setAttribute('aria-label', 'MantisAI is thinking');
    dots.append(el('span'), el('span'), el('span'));
    wrap.append(avatar, dots);
    return wrap;
  }

  function errorNode({ code, error }) {
    const box = el('div', 'error');
    box.setAttribute('role', 'alert');
    // `code` spans in messages (e.g. `claude`) are shown as code.
    for (const [i, part] of error.split('`').entries()) box.append(i % 2 ? el('code', '', part) : part);
    const actions = el('div', 'error-actions');
    if (SETUP_CODES.includes(code)) actions.append(button('chip', 'Open setup', openSetup));
    if (code === 'session-missing') actions.append(button('chip', 'Start new chat', newChat));
    else if (chat.messages.some((m) => m.role === 'user')) actions.append(button('chip', 'Retry', retry));
    box.append(actions);
    return box;
  }

  async function openSetup() {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'openMantisAiSetup' });
      if (res?.ok && res.opened) return;
    } catch {
      // Fall through to the written hint.
    }
    chat.error = { code: 'setup-hint', error: 'Click the Mantis Quick Standup icon in Chrome\'s toolbar, then open Settings → MantisAI.' };
    render();
  }

  // ---------- sending ----------

  function sendFromInput() {
    const text = ui.input.value.trim();
    if (!text) return;
    ui.input.value = '';
    autosize();
    send(text);
  }

  function send(text) {
    if (streams.has(chat.key)) return;
    chat.messages.push({ role: 'user', text });
    request(chat, text);
  }

  // Sends the last question again after an error.
  function retry() {
    const last = [...chat.messages].reverse().find((m) => m.role === 'user');
    if (last && !streams.has(chat.key)) request(chat, last.text);
  }

  function request(target, prompt) {
    target.error = null;
    target.updatedAt = Date.now();
    const message = { role: 'assistant', text: '', steps: [] };
    target.messages.push(message);

    let port;
    try {
      port = chrome.runtime.connect({ name: 'mantis-ai' });
    } catch (err) {
      target.messages.pop();
      target.error = { code: 'extension', error: /context invalidated/i.test(err.message) ? 'The extension was reloaded. Refresh this page and try again.' : err.message };
      return render();
    }
    streams.set(target.key, { port, message });

    const finish = (error) => {
      if (streams.get(target.key)?.port !== port) return;
      streams.delete(target.key);
      try { port.disconnect(); } catch { /* already closed */ }
      for (const step of message.steps) if (step.approval?.state === 'pending') step.approval.state = 'expired';
      if (!message.text && !message.stopped && !message.steps.length) target.messages.splice(target.messages.indexOf(message), 1);
      if (error) target.error = error;
      target.updatedAt = Date.now();
      saveChat(target);
      render();
      if (target === chat && !ui.drawer.hidden) ui.input.focus();
    };

    port.onMessage.addListener((msg) => {
      if (msg.type === 'session') {
        target.sessionId = msg.sessionId;
      } else if (msg.type === 'mantis') {
        target.notice = ['needs-auth', 'failed'].includes(msg.status) ? { status: msg.status } : null;
      } else if (msg.type === 'delta') {
        message.text += msg.text;
        if (target === chat) queueRender();
      } else if (msg.type === 'tool') {
        message.steps.push({ id: msg.id, tool: msg.tool, input: msg.input, status: 'running' });
        if (target === chat) queueRender();
      } else if (msg.type === 'tool_result') {
        const step = message.steps.find((st) => st.id === msg.id);
        if (step) step.status = msg.isError ? 'error' : 'done';
        if (target === chat) queueRender();
      } else if (msg.type === 'approval') {
        let step = message.steps.find((st) => st.id === msg.toolUseId);
        if (!step) message.steps.push(step = { id: msg.toolUseId, tool: msg.tool, input: msg.input, status: 'running' });
        step.approval = { id: msg.id, state: 'pending' };
        if (target === chat) render();
      } else if (msg.type === 'done') {
        target.sessionId = msg.sessionId || target.sessionId;
        if (msg.text) message.text = msg.text;
        finish(null);
      } else if (msg.type === 'error') {
        if (msg.code === 'session-missing') target.sessionId = null;
        finish({ code: msg.code, error: msg.error || 'Something went wrong.' });
      }
    });
    port.onDisconnect.addListener(() => finish({ code: 'disconnected', error: 'Lost the connection to the extension. Try again.' }));
    port.postMessage({ type: 'send', prompt, sessionId: target.sessionId, context: pageContext() });
    saveChat(target);
    render();
  }

  // Stops the shown conversation's reply, keeping what arrived so far.
  function stop() {
    const stream = streams.get(chat.key);
    if (!stream) return;
    stream.message.stopped = true;
    streams.delete(chat.key);
    try { stream.port.disconnect(); } catch { /* already closed */ }
    chat.updatedAt = Date.now();
    saveChat(chat);
    render();
    ui.input.focus();
  }

  function newChat() {
    stop();
    chat.messages = [];
    chat.sessionId = null;
    chat.error = null;
    chat.notice = null;
    includeContext = true;
    saveChat(chat);
    render();
    ui.input.focus();
  }

  // ---------- open / close ----------

  async function open() {
    if (!host) buildUi();
    opts.onOpen();
    await loadChats();
    chat = chatFor(chatKey());
    ui.drawer.hidden = false;
    launcherButton?.setAttribute('aria-expanded', 'true');
    render();
    ui.thread.scrollTop = ui.thread.scrollHeight;
    ui.input.focus();
  }

  function close() {
    if (!ui || ui.drawer.hidden) return;
    ui.drawer.hidden = true;
    launcherButton?.setAttribute('aria-expanded', 'false');
    const { activeElement } = ui.drawer.getRootNode();
    if (activeElement && ui.drawer.contains(activeElement)) (launcher?.isConnected ? launcherButton : ui.edgeTab).focus();
  }

  function toggle() {
    return isOpen() ? close() : open();
  }

  function isOpen() {
    return Boolean(ui && !ui.drawer.hidden);
  }

  // ---------- header button ----------
  // Mantis's header markup is not ours, so find it by shape: a wide bar at the
  // top of the page. Our button goes into its right-hand group of items. Livewire
  // can re-render the header, so this is re-checked every second.

  function findHeaderSlot() {
    const bars = [...document.querySelectorAll('header, [role="banner"], nav')].filter((bar) => {
      if (bar.closest('mantis-ai, mantis-quick-standup')) return false;
      const r = bar.getBoundingClientRect();
      return r.width >= innerWidth * 0.5 && r.height >= 28 && r.height <= 140 && r.top > -10 && r.top < 90;
    });
    const bar = bars[0];
    // While the page is still loading, wait until the header is complete, or items
    // parsed after our button would end up to its right.
    if (!bar || (!bar.nextElementSibling && document.readyState === 'loading')) return null;
    const barWidth = bar.getBoundingClientRect().width;
    const rows = [bar, ...bar.querySelectorAll('div, ul, nav')].filter((node) => {
      const cs = getComputedStyle(node);
      return /flex/.test(cs.display) && !cs.flexDirection.startsWith('column') && node.children.length >= 2
        && node.getBoundingClientRect().width >= barWidth * 0.6;
    });
    const row = rows.at(-1);
    if (!row) return null;
    const last = row.lastElementChild;
    const lastIsGroup = last && /flex/.test(getComputedStyle(last).display) && last.children.length > 0;
    return lastIsGroup ? { parent: last, before: last.firstElementChild } : { parent: row, before: last };
  }

  function placeLauncher() {
    if (launcher?.isConnected) return true;
    const slot = findHeaderSlot();
    if (!slot) return false;
    if (!launcher) {
      launcher = document.createElement('mantis-ai-launcher');
      const root = launcher.attachShadow({ mode: 'open' });
      root.innerHTML = `<style>${LAUNCHER_CSS}</style><button type="button" aria-haspopup="dialog" aria-expanded="false" title="Open MantisAI">${ICONS.spark}MantisAI</button>`;
      launcherButton = root.querySelector('button');
      launcherButton.addEventListener('click', toggle);
      launcherButton.addEventListener('keydown', (e) => e.stopPropagation());
    }
    launcherButton.setAttribute('aria-expanded', String(isOpen()));
    slot.parent.insertBefore(launcher, slot.before);
    return true;
  }

  // Places the button as early as possible so the header never jumps: every frame
  // while the page loads (before it is drawn), and straight after any DOM change,
  // such as Livewire redrawing the header.
  function watchHeader() {
    const check = () => {
      if (launcher?.isConnected) return;
      const placed = placeLauncher();
      if (ui) ui.edgeTab.hidden = placed;
    };
    new MutationObserver(check).observe(document.documentElement, { childList: true, subtree: true });
    const frame = () => {
      check();
      if (document.readyState !== 'complete') requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  // ---------- page tracking ----------

  let lastKey = null;
  function sync() {
    if (!host) buildUi();
    ui.edgeTab.hidden = placeLauncher();
    const key = chatKey();
    if (key === lastKey) return;
    lastKey = key;
    includeContext = true;
    if (isOpen()) {
      loadChats().then(() => {
        chat = chatFor(chatKey());
        render();
      });
    }
  }

  function init(options = {}) {
    opts = { ...opts, ...options };
    sync();
    setInterval(sync, 1000);
  }

  // ---------- Markdown ----------
  // A small renderer for Claude's replies. Builds DOM nodes (never innerHTML),
  // so reply text can't inject markup; links are limited to http(s).

  const FENCE_RE = /^\s*(`{3,}|~{3,})\s*([\w+#.-]*)\s*$/;
  const ITEM_RE = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
  const HEADING_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
  const HR_RE = /^\s*([-*_])(\s*\1){2,}\s*$/;
  const TABLE_SEP_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
  const indentOf = (line) => /^\s*/.exec(line)[0].length;

  function isBlockStart(line, next) {
    return FENCE_RE.test(line) || HEADING_RE.test(line) || /^\s*>/.test(line) || ITEM_RE.test(line) || HR_RE.test(line)
      || (line.includes('|') && next != null && TABLE_SEP_RE.test(next));
  }

  function renderMarkdown(src) {
    const frag = document.createDocumentFragment();
    const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }

      const fence = FENCE_RE.exec(line);
      if (fence) {
        const code = [];
        i++;
        while (i < lines.length && !(lines[i].trim().startsWith(fence[1]) && !lines[i].trim().slice(fence[1].length).trim())) code.push(lines[i++]);
        i++; // the closing fence (missing while a reply is still streaming)
        frag.append(codeBlock(code.join('\n'), fence[2]));
        continue;
      }

      const heading = HEADING_RE.exec(line);
      if (heading) {
        frag.append(inline(el(`h${Math.min(heading[1].length + 2, 6)}`), heading[2]));
        i++;
        continue;
      }

      if (HR_RE.test(line)) {
        frag.append(el('hr'));
        i++;
        continue;
      }

      if (/^\s*>/.test(line)) {
        const quoted = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) quoted.push(lines[i++].replace(/^\s*>\s?/, ''));
        const quote = el('blockquote');
        quote.append(renderMarkdown(quoted.join('\n')));
        frag.append(quote);
        continue;
      }

      if (line.includes('|') && TABLE_SEP_RE.test(lines[i + 1] ?? '')) {
        const cells = (row) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
        const table = el('table');
        const head = el('tr');
        for (const c of cells(line)) head.append(inline(el('th'), c));
        const thead = el('thead');
        thead.append(head);
        const tbody = el('tbody');
        i += 2;
        while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
          const tr = el('tr');
          for (const c of cells(lines[i++])) tr.append(inline(el('td'), c));
          tbody.append(tr);
        }
        table.append(thead, tbody);
        const wrap = el('div', 'table-wrap');
        wrap.append(table);
        frag.append(wrap);
        continue;
      }

      const item = ITEM_RE.exec(line);
      if (item) {
        i = list(lines, i, frag);
        continue;
      }

      const para = [line];
      i++;
      while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i], lines[i + 1])) para.push(lines[i++]);
      frag.append(inline(el('p'), para.join('\n')));
    }
    return frag;
  }

  // Renders the list starting at lines[start]; returns the index after it.
  function list(lines, start, frag) {
    const first = ITEM_RE.exec(lines[start]);
    const base = first[1].length;
    const ordered = /\d/.test(first[2]);
    const listEl = el(ordered ? 'ol' : 'ul');
    if (ordered && parseInt(first[2], 10) !== 1) listEl.start = parseInt(first[2], 10);
    let i = start;
    while (i < lines.length) {
      const m = ITEM_RE.exec(lines[i]);
      if (!m || m[1].length !== base || /\d/.test(m[2]) !== ordered) break;
      const body = [m[3]];
      const contentIndent = base + m[2].length + 1;
      i++;
      while (i < lines.length) {
        const l = lines[i];
        if (!l.trim()) {
          const next = lines[i + 1];
          if (next != null && next.trim() && indentOf(next) > base) { body.push(''); i++; continue; }
          break;
        }
        const nested = ITEM_RE.exec(l);
        if (nested && nested[1].length <= base) break;
        if (indentOf(l) > base || !isBlockStart(l, lines[i + 1])) {
          body.push(l.slice(Math.min(indentOf(l), contentIndent)));
          i++;
          continue;
        }
        break;
      }
      const li = el('li');
      const content = renderMarkdown(body.join('\n'));
      // A single paragraph sits directly in the item.
      if (content.childNodes.length === 1 && content.firstChild.tagName === 'P') li.append(...content.firstChild.childNodes);
      else li.append(content);
      listEl.append(li);
      // A blank line between items of the same list keeps the list going.
      if (!lines[i]?.trim() && ITEM_RE.exec(lines[i + 1] ?? '')?.[1].length === base) i++;
    }
    frag.append(listEl);
    return i;
  }

  function codeBlock(code, lang) {
    const box = el('div', 'code');
    const head = el('div', 'code-head');
    head.append(el('span', '', lang || 'code'), copyButton(() => code, 'msg-action'));
    const pre = el('pre');
    pre.append(el('code', '', code));
    box.append(head, pre);
    return box;
  }

  const INLINE_RE = /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)|\*\*(?=\S)([\s\S]*?\S)\*\*|__(?=\S)([\s\S]*?\S)__|\*(?=[^\s*])([\s\S]*?[^\s*])\*|(?<![\w])_(?=\S)([\s\S]*?\S)_(?![\w])|~~(?=\S)([\s\S]*?\S)~~|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"*_])/g;

  // Appends `text` with inline Markdown to `parent` and returns it.
  function inline(parent, text) {
    let last = 0;
    const plain = (s) => {
      const parts = s.split('\n');
      parts.forEach((p, i) => {
        if (i) parent.append(el('br'));
        if (p) parent.append(p);
      });
    };
    for (const m of text.matchAll(INLINE_RE)) {
      plain(text.slice(last, m.index));
      last = m.index + m[0].length;
      if (m[2] != null) parent.append(el('code', '', m[2].trim() ? m[2].replace(/^ (.*) $/, '$1') : m[2]));
      else if (m[3] != null || m[4] != null) parent.append(inline(el('strong'), m[3] ?? m[4]));
      else if (m[5] != null || m[6] != null) parent.append(inline(el('em'), m[5] ?? m[6]));
      else if (m[7] != null) parent.append(inline(el('s'), m[7]));
      else {
        const href = m[9] ?? m[10];
        const a = el('a');
        Object.assign(a, { href, target: '_blank', rel: 'noopener noreferrer' });
        if (m[8] != null) inline(a, m[8]);
        else a.textContent = href;
        parent.append(a);
      }
    }
    plain(text.slice(last));
    return parent;
  }

  watchHeader();

  return { init, open, close, toggle, isOpen, renderMarkdown };
})();
