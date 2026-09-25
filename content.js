// Adds a small "Standup" overlay, plus an "EOD" list of today's standups
// whose EOD updates can be edited, to Mantis ticket pages (https://projects.webmavens.dev/tickets/{id}).

(() => {
  const TICKET_PATH_RE = /^\/tickets\/(\d+)\/?$/;
  const LEVELS = ['High', 'Medium', 'Low'];

  let host = null;
  let ui = null;
  let currentTicket = null;
  // Single source for both the EOD button count and the EOD list.
  let eodState = { status: 'idle', eods: [], error: null };
  let eodRequest = 0;
  let eodEdit = null; // { id, textarea, saving, error } for the entry being edited
  let eodSavedId = null; // briefly marks the entry that was just saved

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
    /* One button shows at a time; scroll (or use the dots) to switch. */
    .fabs {
      position: fixed; right: 20px; bottom: 20px; z-index: 2147483646;
      display: flex; align-items: center; gap: 6px;
    }
    .fab-scroll {
      display: grid; grid-auto-rows: 40px; height: 40px;
      overflow-y: auto; overscroll-behavior: contain; scroll-snap-type: y mandatory;
      scrollbar-width: none; border-radius: 999px; box-shadow: 0 4px 14px rgba(0,0,0,.2);
    }
    .fab-scroll::-webkit-scrollbar { display: none; }
    .fab {
      scroll-snap-align: start; width: 100%; height: 40px;
      background: #2563eb; color: #fff; border: 0; border-radius: 999px;
      padding: 0 16px; font-size: 14px; font-weight: 600; cursor: pointer; white-space: nowrap;
    }
    .fab:hover { background: #1d4ed8; }
    .dots { display: flex; flex-direction: column; gap: 5px; }
    .dot {
      width: 8px; height: 8px; padding: 0; border-radius: 50%; cursor: pointer;
      border: 1px solid #2563eb; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.2);
    }
    .dot.active { background: #2563eb; }
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
    .status.info { background: #f3f4f6; color: #374151; }
    .head-actions { display: flex; align-items: center; gap: 8px; }
    .refresh { background: none; border: 0; padding: 0; font-size: 12px; color: #2563eb; cursor: pointer; }
    .refresh:disabled { color: #9ca3af; cursor: default; }
    .eod-list { list-style: none; margin: 0; padding: 0; max-height: min(420px, calc(100vh - 190px)); overflow-y: auto; }
    .eod-list[hidden] { display: none; }
    .eod { border: 1px solid #e5e7eb; border-radius: 8px; padding: 8px 10px; }
    .eod + .eod { margin-top: 8px; }
    .eod-top { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 4px; }
    .eod-top a, .eod-top strong { font-weight: 600; color: #2563eb; text-decoration: none; }
    .eod-top a:hover { text-decoration: underline; }
    .eod-sub { color: #6b7280; font-size: 11px; white-space: nowrap; }
    .eod-action { color: #111827; word-break: break-word; }
    .eod-update { margin-top: 4px; font-size: 12px; color: #166534; word-break: break-word; }
    .eod-update.empty { color: #9ca3af; font-style: italic; }
    .eod-update-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
    .link-btn { background: none; border: 0; padding: 0; font-size: 12px; color: #2563eb; cursor: pointer; white-space: nowrap; margin-top: 4px; }
    .link-btn:disabled { color: #9ca3af; cursor: default; }
    .eod-saved { margin-top: 4px; font-size: 11px; color: #166534; }
    .eod-edit { margin-top: 6px; }
    .eod-edit textarea { min-height: 60px; }
    .eod-edit .actions { margin-top: 6px; }
    .eod-edit .submit { padding: 5px 10px; font-size: 12px; }
    .eod-edit .status { margin-top: 6px; }
    .eod-foot { margin-top: 10px; font-size: 12px; }
    .eod-foot a { color: #2563eb; }
  `;

  function buildUi() {
    host = document.createElement('mantis-quick-standup');
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>${CSS}</style>
      <div class="fabs">
        <div class="dots" aria-hidden="true">
          <button class="dot active" type="button" tabindex="-1"></button>
          <button class="dot" type="button" tabindex="-1"></button>
        </div>
        <div class="fab-scroll">
          <button class="fab fab-standup" type="button">+ Standup</button>
          <button class="fab fab-eod" type="button">EOD</button>
        </div>
      </div>
      <div class="panel panel-standup" hidden>
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
      <div class="panel panel-eod" hidden>
        <div class="head">
          <h2 class="eod-title">EOD</h2>
          <div class="head-actions">
            <button class="refresh" type="button">Refresh</button>
            <button class="close" type="button" aria-label="Close">&times;</button>
          </div>
        </div>
        <div class="status eod-status" hidden></div>
        <ul class="eod-list" hidden></ul>
        <div class="eod-foot"><a href="${EOD_PAGE_URL}" target="_blank" rel="noopener">Fill in EODs on standup.webmavens.dev ↗</a></div>
      </div>
    `;
    document.documentElement.appendChild(host);

    ui = {
      fab: root.querySelector('.fab-standup'),
      panel: root.querySelector('.panel-standup'),
      close: root.querySelector('.panel-standup .close'),
      ticket: root.querySelector('.m-ticket'),
      link: root.querySelector('.m-link'),
      priority: root.querySelector('.m-priority'),
      text: root.querySelector('textarea'),
      submit: root.querySelector('.submit'),
      status: root.querySelector('.panel-standup .status'),
      fabScroll: root.querySelector('.fab-scroll'),
      dots: [...root.querySelectorAll('.dot')],
      eodFab: root.querySelector('.fab-eod'),
      eodPanel: root.querySelector('.panel-eod'),
      eodClose: root.querySelector('.panel-eod .close'),
      eodTitle: root.querySelector('.eod-title'),
      eodRefresh: root.querySelector('.refresh'),
      eodStatus: root.querySelector('.eod-status'),
      eodList: root.querySelector('.eod-list'),
    };

    ui.fab.addEventListener('click', () => (ui.panel.hidden ? openPanel() : closePanel()));
    ui.close.addEventListener('click', closePanel);
    ui.submit.addEventListener('click', submit);
    ui.text.addEventListener('keydown', (e) => {
      e.stopPropagation(); // keep Mantis keyboard shortcuts from firing while typing
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit();
      if (e.key === 'Escape') closePanel();
    });

    ui.eodFab.addEventListener('click', () => (ui.eodPanel.hidden ? openEodPanel() : closeEodPanel()));
    ui.eodClose.addEventListener('click', closeEodPanel);
    ui.eodRefresh.addEventListener('click', loadEods);
    ui.eodPanel.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') closeEodPanel();
    });
    ui.fabScroll.addEventListener('scroll', syncDots, { passive: true });
    ui.dots.forEach((dot, i) =>
      dot.addEventListener('click', () => ui.fabScroll.scrollTo({ top: i * ui.fabScroll.clientHeight, behavior: 'smooth' })),
    );

    loadEods();
  }

  function syncDots() {
    const index = Math.round(ui.fabScroll.scrollTop / ui.fabScroll.clientHeight);
    ui.dots.forEach((dot, i) => dot.classList.toggle('active', i === index));
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
    closeEodPanel();
    refreshMeta();
    ui.panel.hidden = false;
    ui.text.focus();
  }

  function closePanel() {
    ui.panel.hidden = true;
  }

  function showStatus(kind, message, target = ui.status) {
    target.className = `status ${kind}`;
    target.textContent = message;
    target.hidden = false;
  }

  function extensionError(err) {
    return /context invalidated/i.test(err.message)
      ? 'The extension was reloaded. Refresh this page and try again.'
      : err.message;
  }

  // ---------- EOD ----------

  const EOD_PAGE_URL = 'https://standup.webmavens.dev/admin/standups/edit-standups';

  function openEodPanel() {
    closePanel();
    ui.eodPanel.hidden = false;
    loadEods();
  }

  function closeEodPanel() {
    ui.eodPanel.hidden = true;
  }

  async function loadEods() {
    const request = ++eodRequest;
    eodState = { ...eodState, status: 'loading', error: null };
    renderEods();

    let next;
    try {
      const res = await chrome.runtime.sendMessage({ type: 'fetchEods' });
      next = res?.ok
        ? { status: 'ready', eods: res.eods, error: null }
        : { status: 'error', eods: [], error: res?.error || 'Could not load EODs.' };
    } catch (err) {
      next = { status: 'error', eods: [], error: extensionError(err) };
    }
    if (request !== eodRequest) return; // a newer load superseded this one
    eodState = next;
    renderEods();
  }

  // Count and list are both drawn from eodState so they never disagree.
  function renderEods() {
    const { status, eods, error } = eodState;
    const count = status === 'ready' ? `(${eods.length})` : status === 'loading' ? '(…)' : status === 'error' ? '(!)' : '';
    ui.eodFab.textContent = `EOD ${count}`.trim();
    ui.eodFab.title = status === 'error' ? error : '';
    ui.eodTitle.textContent = status === 'ready' ? `EOD (${eods.length})` : 'EOD';
    ui.eodRefresh.disabled = status === 'loading';

    if (status === 'loading' && !ui.eodList.childElementCount) showStatus('info', 'Loading EODs…', ui.eodStatus);
    else if (status === 'error') showStatus('err', error, ui.eodStatus);
    else if (status === 'ready' && !eods.length) showStatus('info', 'No EODs available.', ui.eodStatus);
    else if (status !== 'loading') ui.eodStatus.hidden = true;

    // While loading, eods still holds the previous list, so it stays visible.
    if (eodEdit && status === 'ready' && !eods.some((e) => e.id === eodEdit.id)) eodEdit = null;
    const refocus = eodEdit && ui.eodList.getRootNode().activeElement === eodEdit.textarea;
    ui.eodList.replaceChildren(...eods.map(eodItem));
    ui.eodList.hidden = !eods.length;
    if (refocus) eodEdit.textarea.focus();
  }

  function eodItem(eod) {
    const li = el('li', 'eod');
    const top = el('div', 'eod-top');
    const ticket = eod.link ? el('a', '', `#${eod.ticket}`) : el('strong', '', `#${eod.ticket}`);
    if (eod.link) Object.assign(ticket, { href: eod.link, target: '_blank', rel: 'noopener' });
    top.append(ticket, el('span', 'eod-sub', [eod.priority, eod.createdAt].filter(Boolean).join(' · ')));
    li.append(top, el('div', 'eod-action', eod.plannedAction));

    if (eodEdit?.id === eod.id) {
      li.append(eodEditor());
      return li;
    }
    const row = el('div', 'eod-update-row');
    const update = el('div', `eod-update${eod.update ? '' : ' empty'}`, eod.update ? `EOD: ${eod.update}` : 'EOD not filled yet');
    const edit = el('button', 'link-btn', eod.update ? 'Edit' : 'Add EOD');
    edit.type = 'button';
    edit.disabled = Boolean(eodEdit?.saving);
    edit.addEventListener('click', () => startEodEdit(eod));
    row.append(update, edit);
    li.append(row);
    if (eodSavedId === eod.id) li.append(el('div', 'eod-saved', '✓ EOD saved.'));
    return li;
  }

  // The textarea is kept across re-renders so a background refresh never
  // loses the draft or the cursor position.
  function eodEditor() {
    const { textarea, saving, error } = eodEdit;
    textarea.disabled = saving;
    const box = el('div', 'eod-edit');
    const actions = el('div', 'actions');
    const cancel = el('button', 'link-btn', 'Cancel');
    const save = el('button', 'submit', saving ? 'Saving…' : 'Save');
    cancel.type = save.type = 'button';
    cancel.disabled = save.disabled = saving;
    cancel.addEventListener('click', cancelEodEdit);
    save.addEventListener('click', saveEod);
    const buttons = el('div', 'head-actions');
    buttons.append(cancel, save);
    actions.append(el('span', 'hint', 'Enter to save · Esc to cancel'), buttons);
    box.append(textarea, actions);
    if (error) {
      const status = el('div');
      showStatus('err', error, status);
      box.append(status);
    }
    return box;
  }

  function startEodEdit(eod) {
    const textarea = el('textarea');
    textarea.value = eod.update;
    textarea.placeholder = 'What did you complete today?';
    textarea.addEventListener('keydown', (e) => {
      e.stopPropagation(); // keep Mantis shortcuts and the panel's Esc handler out of it
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault(); // the server field is single-line
        saveEod();
      }
      if (e.key === 'Escape') cancelEodEdit();
    });
    eodEdit = { id: eod.id, textarea, saving: false, error: null };
    eodSavedId = null;
    renderEods();
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }

  function cancelEodEdit() {
    if (eodEdit?.saving) return;
    eodEdit = null;
    renderEods();
  }

  async function saveEod() {
    const edit = eodEdit;
    if (!edit || edit.saving) return;
    edit.saving = true;
    edit.error = null;
    renderEods();

    try {
      const res = await chrome.runtime.sendMessage({ type: 'updateEod', payload: { id: edit.id, update: edit.textarea.value } });
      if (!res?.ok) throw new Error(res?.error || 'Unknown error; EOD may not have been saved.');
      eodRequest++; // the saved page is newer than any load still in flight
      eodState = { status: 'ready', eods: res.eods, error: null };
      eodEdit = null;
      eodSavedId = edit.id;
      setTimeout(() => {
        if (eodSavedId !== edit.id) return;
        eodSavedId = null;
        renderEods();
      }, 4000);
    } catch (err) {
      edit.saving = false;
      edit.error = extensionError(err);
    }
    renderEods();
    if (eodEdit === edit) edit.textarea.focus();
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
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
        loadEods(); // the new standup is also a new EOD entry
      } else {
        showStatus('err', res?.error || 'Unknown error; standup may not have been saved.');
      }
    } catch (err) {
      showStatus('err', extensionError(err));
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
      if (!id) {
        closePanel();
        closeEodPanel();
      }
    }
  }

  sync();
  setInterval(sync, 1000);
  // Pick up EODs added or filled in from another tab.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && host && currentTicket) loadEods();
  });
})();
