// Adds a small "Standup" overlay to Mantis ticket pages
// (https://projects.webmavens.dev/tickets/{id}).

(() => {
  const TICKET_PATH_RE = /^\/tickets\/(\d+)\/?$/;
  const LEVELS = ['High', 'Medium', 'Low'];

  let host = null;
  let ui = null;
  let currentTicket = null;

  // ---------- ticket + priority detection ----------

  function ticketIdFromUrl() {
    const m = TICKET_PATH_RE.exec(location.pathname);
    return m ? m[1] : null;
  }

  // Returns 'High' | 'Medium' | 'Low' only when exactly one level appears,
  // so a dropdown listing all three options is never misread.
  function levelFromText(text) {
    if (!text || text.length > 60) return null;
    const found = LEVELS.filter((l) => new RegExp(`\\b${l}\\b`, 'i').test(text));
    return found.length === 1 ? found[0] : null;
  }

  function valueText(el) {
    const select = el.matches('select') ? el : el.querySelector('select');
    if (select) return select.selectedOptions[0]?.textContent ?? '';
    return el.textContent;
  }

  function isOurs(el) {
    return host && (el === host || host.contains(el));
  }

  function detectPriority() {
    const leaves = [...document.body.querySelectorAll('*')].filter(
      (el) => !isOurs(el) && el.children.length === 0 && /priority/i.test(el.textContent),
    );

    for (const leaf of leaves) {
      const text = leaf.textContent.trim();

      // "Priority: High" in a single element
      const inline = /^priority\s*:?\s*(high|medium|low)$/i.exec(text);
      if (inline) return levelFromText(inline[1]);

      // A "Priority" label followed by its value
      if (/^priority\s*:?$/i.test(text)) {
        let node = leaf;
        for (let depth = 0; depth < 3 && node; depth++, node = node.parentElement) {
          const sib = node.nextElementSibling;
          if (sib) {
            const level = levelFromText(valueText(sib).trim());
            if (level) return level;
          }
        }
      }
    }

    // Badges such as <span class="priority-high">High</span> or title="Priority: High"
    const tagged = document.querySelectorAll(
      '[data-priority],[class*="priority" i],[title*="priority" i],[aria-label*="priority" i]',
    );
    for (const el of tagged) {
      if (isOurs(el)) continue;
      const candidates = [el.dataset.priority, el.getAttribute('title'), el.getAttribute('aria-label'), valueText(el)];
      for (const c of candidates) {
        const level = levelFromText(c?.replace(/priority\s*:?/i, '').trim());
        if (level) return level;
      }
    }

    return null;
  }

  // ---------- UI ----------

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
    .fab {
      position: fixed; right: 20px; bottom: 20px; z-index: 2147483646;
      background: #2563eb; color: #fff; border: 0; border-radius: 999px;
      padding: 10px 16px; font-size: 14px; font-weight: 600; cursor: pointer;
      box-shadow: 0 4px 14px rgba(0,0,0,.2);
    }
    .fab:hover { background: #1d4ed8; }
    .panel {
      position: fixed; right: 20px; bottom: 70px; z-index: 2147483647;
      width: 340px; max-width: calc(100vw - 32px);
      background: #fff; color: #111827; border: 1px solid #e5e7eb; border-radius: 10px;
      box-shadow: 0 10px 30px rgba(0,0,0,.18); padding: 14px; font-size: 13px;
    }
    .panel[hidden] { display: none; }
    .head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
    .head h2 { margin: 0; font-size: 15px; }
    .close { background: none; border: 0; font-size: 18px; cursor: pointer; color: #6b7280; line-height: 1; }
    .meta { display: grid; grid-template-columns: auto 1fr; gap: 3px 10px; margin-bottom: 10px; color: #374151; }
    .meta dt { color: #6b7280; }
    .meta dd { margin: 0; word-break: break-all; }
    label { display: block; font-weight: 600; margin-bottom: 4px; }
    textarea {
      width: 100%; min-height: 90px; resize: vertical; padding: 8px;
      border: 1px solid #d1d5db; border-radius: 6px; font-size: 13px; color: #111827; background: #fff;
    }
    textarea:focus { outline: 2px solid #93c5fd; border-color: #2563eb; }
    .actions { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; gap: 8px; }
    .hint { color: #9ca3af; font-size: 11px; }
    .submit {
      background: #2563eb; color: #fff; border: 0; border-radius: 6px;
      padding: 8px 14px; font-size: 13px; font-weight: 600; cursor: pointer;
    }
    .submit:disabled { background: #93c5fd; cursor: default; }
    .status { margin-top: 10px; padding: 8px; border-radius: 6px; font-size: 12px; }
    .status[hidden] { display: none; }
    .status.ok { background: #dcfce7; color: #166534; }
    .status.err { background: #fee2e2; color: #991b1b; }
  `;

  function buildUi() {
    host = document.createElement('mantis-quick-standup');
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>${CSS}</style>
      <button class="fab" type="button">+ Standup</button>
      <div class="panel" hidden>
        <div class="head">
          <h2>Add Standup</h2>
          <button class="close" type="button" aria-label="Close">&times;</button>
        </div>
        <dl class="meta">
          <dt>Ticket</dt><dd class="m-ticket"></dd>
          <dt>Link</dt><dd class="m-link"></dd>
          <dt>Priority</dt><dd class="m-priority"></dd>
          <dt>Est Time</dt><dd>-</dd>
        </dl>
        <label for="mqs-action">Planned Action</label>
        <textarea id="mqs-action" placeholder="Working on the notification issue..."></textarea>
        <div class="actions">
          <span class="hint">Ctrl+Enter to send</span>
          <button class="submit" type="button">Add Standup</button>
        </div>
        <div class="status" hidden></div>
      </div>
    `;
    document.documentElement.appendChild(host);

    ui = {
      fab: root.querySelector('.fab'),
      panel: root.querySelector('.panel'),
      close: root.querySelector('.close'),
      ticket: root.querySelector('.m-ticket'),
      link: root.querySelector('.m-link'),
      priority: root.querySelector('.m-priority'),
      text: root.querySelector('textarea'),
      submit: root.querySelector('.submit'),
      status: root.querySelector('.status'),
    };

    ui.fab.addEventListener('click', () => (ui.panel.hidden ? openPanel() : closePanel()));
    ui.close.addEventListener('click', closePanel);
    ui.submit.addEventListener('click', submit);
    ui.text.addEventListener('keydown', (e) => {
      e.stopPropagation(); // keep Mantis keyboard shortcuts from firing while typing
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit();
      if (e.key === 'Escape') closePanel();
    });
  }

  function ticketUrl(id) {
    return `${location.origin}/tickets/${id}`;
  }

  // Tickets without a priority in Mantis are submitted as Low.
  const DEFAULT_PRIORITY = 'Low';

  function refreshMeta() {
    const detected = detectPriority();
    ui.ticket.textContent = `#${currentTicket}`;
    ui.link.textContent = ticketUrl(currentTicket);
    ui.priority.textContent = detected || `${DEFAULT_PRIORITY} (default — not set on ticket)`;
    return detected || DEFAULT_PRIORITY;
  }

  function openPanel() {
    refreshMeta();
    ui.panel.hidden = false;
    ui.text.focus();
  }

  function closePanel() {
    ui.panel.hidden = true;
  }

  function showStatus(kind, message) {
    ui.status.className = `status ${kind}`;
    ui.status.textContent = message;
    ui.status.hidden = false;
  }

  async function submit() {
    if (ui.submit.disabled) return;

    const ticket = currentTicket;
    const plannedAction = ui.text.value.trim();
    // Re-read at submit time: Livewire may have updated the page since opening.
    const priority = refreshMeta();

    if (!plannedAction) return showStatus('err', 'Enter your planned action first.');

    ui.submit.disabled = true;
    ui.submit.textContent = 'Sending…';
    ui.status.hidden = true;

    try {
      const res = await chrome.runtime.sendMessage({
        type: 'submitStandup',
        payload: { ticket, plannedAction, repoLink: ticketUrl(ticket), priority },
      });
      if (res?.ok) {
        ui.text.value = '';
        showStatus('ok', `✓ Standup added for #${ticket} (${priority}).`);
      } else {
        showStatus('err', res?.error || 'Unknown error; standup may not have been saved.');
      }
    } catch (err) {
      const msg = /context invalidated/i.test(err.message)
        ? 'The extension was reloaded. Refresh this page and try again.'
        : err.message;
      showStatus('err', msg);
    } finally {
      ui.submit.disabled = false;
      ui.submit.textContent = 'Add Standup';
    }
  }

  // ---------- page tracking ----------
  // Mantis uses Livewire, which can change pages without a full reload,
  // so watch the URL instead of relying on the content script re-running.

  function sync() {
    const id = ticketIdFromUrl();
    if (id && !host) buildUi();
    if (!host) return;

    host.style.display = id ? '' : 'none';
    if (id !== currentTicket) {
      currentTicket = id;
      ui.text.value = '';
      ui.status.hidden = true;
      if (id && !ui.panel.hidden) refreshMeta();
      if (!id) closePanel();
    }
  }

  sync();
  setInterval(sync, 1000);
})();
