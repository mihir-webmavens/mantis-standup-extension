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
    :host {
      all: initial;
      color-scheme: light;
      --accent: #7c3aed; --accent-2: #db2777; --accent-strong: #6d28d9;
      --gradient: linear-gradient(120deg, var(--accent) 0%, var(--accent-2) 50%, var(--accent) 100%);
      --link: #7c3aed; --accent-soft: #f5f3ff; --accent-border: #ddd6fe; --accent-ring: rgba(124,58,237,.18);

      --surface: #fff; --card: #fff; --text: #111827; --text-2: #374151; --muted: #6b7280; --faint: #9ca3af;
      --border: #e5e7eb; --input-border: #d1d5db; --panel-shadow: 0 10px 30px rgba(0,0,0,.18);
      --ok-bg: #dcfce7; --ok-text: #166534; --err-bg: #fee2e2; --err-text: #991b1b; --info-bg: #f3f4f6; --info-text: #374151;
      --filled-bg: #f0fdf4; --filled-border: #dcfce7; --filled-text: #166534;
      --pending-bg: #fffbeb; --pending-border: #fcd34d; --pending-text: #92400e;
      --low-bg: #f3f4f6; --low-text: #4b5563; --low-border: #e5e7eb;
      --high-bg: #fee2e2; --high-text: #b91c1c; --high-border: #fecaca;
      --medium-bg: #fef3c7; --medium-text: #b45309; --medium-border: #fde68a;
    }
    /* Dark mode follows the browser / OS setting. */
    @media (prefers-color-scheme: dark) {
      :host {
        color-scheme: dark;
        --link: #c4b5fd; --accent-soft: rgba(167,139,250,.14); --accent-border: rgba(167,139,250,.4); --accent-ring: rgba(167,139,250,.28);

        --surface: #16141f; --card: #1e1b29; --text: #f4f4f5; --text-2: #d4d4d8; --muted: #a1a1aa; --faint: #71717a;
        --border: #2e2a3d; --input-border: #3f3a52; --panel-shadow: 0 14px 40px rgba(0,0,0,.6), 0 0 0 1px rgba(167,139,250,.08);
        --ok-bg: rgba(34,197,94,.14); --ok-text: #86efac; --err-bg: rgba(239,68,68,.16); --err-text: #fca5a5;
        --info-bg: rgba(255,255,255,.06); --info-text: #d4d4d8;
        --filled-bg: rgba(34,197,94,.08); --filled-border: rgba(34,197,94,.28); --filled-text: #86efac;
        --pending-bg: rgba(245,158,11,.08); --pending-border: rgba(245,158,11,.45); --pending-text: #fcd34d;
        --low-bg: rgba(255,255,255,.06); --low-text: #d4d4d8; --low-border: rgba(255,255,255,.14);
        --high-bg: rgba(239,68,68,.16); --high-text: #fca5a5; --high-border: rgba(239,68,68,.4);
        --medium-bg: rgba(245,158,11,.16); --medium-text: #fcd34d; --medium-border: rgba(245,158,11,.4);
      }
      textarea::placeholder, .m-est::placeholder { color: var(--faint); }
    }
    * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }

    /* One button shows at a time; scroll over it to switch (the ↕ hints at that).
       Its look comes from button-styles.js, chosen in the toolbar popup. */
    .fabs { position: fixed; right: 20px; bottom: 20px; z-index: 2147483646; }
    .panel {
      position: fixed; right: 20px; bottom: 76px; z-index: 2147483647;
      width: 340px; max-width: calc(100vw - 32px);
      background: var(--surface); color: var(--text); border: 1px solid var(--border); border-radius: 10px;
      box-shadow: var(--panel-shadow); padding: 14px; font-size: 13px;
    }
    .panel::before {
      content: ""; position: absolute; top: -1px; left: -1px; right: -1px; height: 4px;
      border-radius: 10px 10px 0 0; background: var(--gradient); background-size: 200% 100%;
    }
    .panel[hidden] { display: none; }
    .panel:focus { outline: none; }
    .head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
    .head h2 { margin: 0; font-size: 15px; color: var(--text); }
    .close { background: none; border: 0; font-size: 18px; cursor: pointer; color: var(--muted); line-height: 1; }
    .meta { display: grid; grid-template-columns: auto 1fr; gap: 3px 10px; margin-bottom: 10px; color: var(--text-2); }
    .meta dt { color: var(--muted); }
    .meta dd { margin: 0; word-break: break-all; }
    .meta .dt-label { display: inline; font-weight: inherit; margin: 0; color: inherit; }
    .meta dt:has(.dt-label) { align-self: center; }
    .m-est {
      width: 140px; max-width: 100%; height: 26px; padding: 2px 8px;
      border: 1px solid var(--input-border); border-radius: 6px; font-size: 13px; color: var(--text); background: var(--card);
    }
    .dup-note {
      margin: -2px 0 10px; padding: 7px 9px; border-radius: 6px; font-size: 12px; line-height: 1.4;
      background: var(--pending-bg); color: var(--pending-text); border: 1px solid var(--pending-border);
    }
    .dup-note[hidden] { display: none; }
    .dup-note strong { font-weight: 700; }
    .m-est:focus { outline: 3px solid var(--accent-ring); border-color: var(--accent); }
    label { display: block; font-weight: 600; margin-bottom: 4px; }
    textarea {
      width: 100%; min-height: 90px; resize: vertical; padding: 8px;
      border: 1px solid var(--input-border); border-radius: 6px; font-size: 13px; color: var(--text); background: var(--card);
    }
    textarea:focus { outline: 3px solid var(--accent-ring); border-color: var(--accent); }
    .actions { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; gap: 8px; }
    .hint { color: var(--faint); font-size: 11px; }
    .submit {
      background: var(--gradient); background-size: 200% 100%; color: #fff; border: 0; border-radius: 6px;
      transition: background-position .4s ease, filter .2s ease;
      padding: 8px 14px; font-size: 13px; font-weight: 600; cursor: pointer;
    }
    .submit:hover:not(:disabled) { background-position: 100% 0; }
    .submit:disabled { filter: grayscale(.4) opacity(.55); cursor: default; }
    .status { margin-top: 10px; padding: 8px; border-radius: 6px; font-size: 12px; }
    .status[hidden] { display: none; }
    .status.ok { background: var(--ok-bg); color: var(--ok-text); }
    .status.err { background: var(--err-bg); color: var(--err-text); }
    .status a { color: inherit; font-weight: 600; }
    .status.info { background: var(--info-bg); color: var(--info-text); }
    .head-actions { display: flex; align-items: center; gap: 8px; }
    .refresh { background: none; border: 0; padding: 0; font-size: 12px; color: var(--link); cursor: pointer; }
    .refresh:disabled { color: var(--faint); cursor: default; }
    .eod-list { list-style: none; margin: 0; padding: 0; max-height: min(420px, calc(100vh - 190px)); overflow-y: auto; }
    .eod-list[hidden] { display: none; }
    /* Card: coloured left edge shows the state (green filled, amber pending, blue editing). */
    .eod {
      border: 1px solid var(--border); border-left: 4px solid #f59e0b; border-radius: 8px;
      padding: 10px 12px; background: var(--card);
    }
    .eod.filled { border-left-color: #22c55e; }
    .eod.editing { border-left-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-ring); }
    .eod + .eod { margin-top: 8px; }
    .eod-top { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 6px; }
    .eod-id { display: flex; align-items: center; gap: 6px; min-width: 0; }
    .eod-top a, .eod-top strong { font-weight: 700; font-size: 13px; color: var(--link); text-decoration: none; }
    .eod-top a:hover { text-decoration: underline; }
    .eod-sub { color: var(--faint); font-size: 11px; white-space: nowrap; }
    .badge {
      display: inline-block; padding: 1px 7px; border-radius: 999px; border: 1px solid transparent;
      font-size: 10px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; line-height: 16px;
      background: var(--low-bg); color: var(--low-text); border-color: var(--low-border);
    }
    .badge.high { background: var(--high-bg); color: var(--high-text); border-color: var(--high-border); }
    .badge.medium { background: var(--medium-bg); color: var(--medium-text); border-color: var(--medium-border); }
    .eod-action { color: var(--text-2); line-height: 1.45; word-break: break-word; }
    .eod-update-row {
      display: flex; justify-content: space-between; align-items: center; gap: 8px;
      margin-top: 8px; padding: 6px 8px; border-radius: 6px; background: var(--filled-bg); border: 1px solid var(--filled-border);
    }
    .eod.pending .eod-update-row { background: var(--pending-bg); border: 1px dashed var(--pending-border); }
    .eod-update { font-size: 12px; line-height: 1.4; color: var(--filled-text); word-break: break-word; }
    .eod-update::before { content: "✓ "; font-weight: 700; }
    .eod-update.empty { color: var(--pending-text); font-style: italic; }
    .eod-update.empty::before { content: "● "; font-style: normal; font-size: 9px; vertical-align: 1px; }
    .eod-update-row .link-btn {
      margin-top: 0; padding: 2px 10px; border: 1px solid var(--accent-border); border-radius: 999px;
      background: var(--card); font-weight: 600; font-size: 11px;
    }
    .eod-update-row .link-btn:hover:not(:disabled) { background: var(--accent-soft); border-color: var(--accent); }
    .link-btn { background: none; border: 0; padding: 0; font-size: 12px; color: var(--link); cursor: pointer; white-space: nowrap; margin-top: 4px; }
    .link-btn:disabled { color: var(--faint); cursor: default; }
    .eod-saved { margin-top: 4px; font-size: 11px; color: var(--ok-text); }
    .eod-edit { margin-top: 6px; }
    .eod-edit textarea { min-height: 60px; }
    .eod-edit .actions { margin-top: 6px; }
    .eod-edit .submit { padding: 5px 10px; font-size: 12px; }
    .eod-edit .status { margin-top: 6px; }
    .eod-foot { margin-top: 10px; font-size: 12px; }
    .eod-foot a { color: var(--link); }
  `;

  function buildUi() {
    host = document.createElement('mantis-quick-standup');
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>${CSS}</style>
      <style class="fab-style">${ButtonStyles.css(ButtonStyles.DEFAULT)}</style>
      <div class="fabs">
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
          <dt><label class="dt-label" for="mqs-est">Est Time</label></dt>
          <dd><input id="mqs-est" class="m-est" type="text" value="-" autocomplete="off" aria-label="Est Time"></dd>
        </dl>
        <div class="dup-note" role="note" hidden></div>
        <label for="mqs-action">Planned Action</label>
        <textarea id="mqs-action" placeholder="Working on the notification issue..."></textarea>
        <div class="actions">
          <span class="hint">Ctrl+Enter to send</span>
          <button class="submit" type="button">Add Standup</button>
        </div>
        <div class="status" hidden></div>
      </div>
      <div class="panel panel-eod" tabindex="-1" hidden>
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
      estTime: root.querySelector('.m-est'),
      dupNote: root.querySelector('.dup-note'),
      submit: root.querySelector('.submit'),
      status: root.querySelector('.panel-standup .status'),
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
    for (const field of [ui.text, ui.estTime]) {
      closeOnEscape(field, closePanel);
      field.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit();
      });
    }

    ui.eodFab.addEventListener('click', () => (ui.eodPanel.hidden ? openEodPanel() : closeEodPanel()));
    ui.eodClose.addEventListener('click', closeEodPanel);
    ui.eodRefresh.addEventListener('click', loadEods);
    // On the whole panel: Esc first closes an open EOD editor, then the popup.
    closeOnEscape(ui.eodPanel, () => (eodEdit ? cancelEodEdit() : closeEodPanel()));

    watchButtonStyle(root.querySelector('.fab-style'));
    loadEods();
  }

  // Applies the style picked in the toolbar popup, now and whenever it changes.
  function watchButtonStyle(styleEl) {
    const key = ButtonStyles.STORAGE_KEY;
    const apply = (id) => { styleEl.textContent = ButtonStyles.css(id); };
    try {
      chrome.storage.sync.get(key).then((v) => apply(v[key]), () => {});
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'sync' && changes[key]) apply(changes[key].newValue);
      });
    } catch {
      // Extension reloaded under this page; keep the current look.
    }
  }

  // Esc closes the popup; other keys stay away from Mantis keyboard shortcuts.
  function closeOnEscape(target, close) {
    target.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') close();
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
    closeEodPanel();
    refreshMeta();
    renderDuplicateNotice();
    ui.panel.hidden = false;
    ui.text.focus();
  }

  function closePanel() {
    ui.panel.hidden = true;
  }

  // Links to the standup site (e.g. its login page) in messages become clickable.
  const STANDUP_LINK_RE = /(https:\/\/standup\.webmavens\.dev\/[^\s,]*[^\s,.])/;

  function showStatus(kind, message, target = ui.status) {
    target.className = `status ${kind}`;
    target.replaceChildren(...message.split(STANDUP_LINK_RE).map((part, i) => {
      if (i % 2 === 0) return part;
      const link = el('a', '', part);
      Object.assign(link, { href: part, target: '_blank', rel: 'noopener' });
      return link;
    }));
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
    (eodEdit?.textarea ?? ui.eodPanel).focus(); // keyboard focus inside the panel, so Esc reaches it
    loadEods();
  }

  function eodPanelHasFocus() {
    return ui.eodPanel.contains(ui.eodPanel.getRootNode().activeElement);
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
    const focused = ui.eodList.getRootNode().activeElement;
    const listHadFocus = ui.eodList.contains(focused);
    ui.eodList.replaceChildren(...eods.map(eodItem));
    ui.eodList.hidden = !eods.length;
    // Re-rendering drops focus from the list; keep it in the panel so Esc still works.
    if (listHadFocus) (eodEdit && focused === eodEdit.textarea ? eodEdit.textarea : ui.eodPanel).focus();
    renderDuplicateNotice();
  }

  // Warns (without blocking) when this ticket already has a standup today,
  // using the EOD list, which holds today's standups.
  function renderDuplicateNotice() {
    const today = localDate(new Date());
    const same = eodState.status === 'ready' && currentTicket
      ? eodState.eods.filter((e) => eodTicketId(e) === currentTicket && isToday(e.createdAt, today))
      : [];
    ui.dupNote.hidden = !same.length;
    if (!same.length) return;
    const [first] = same;
    const time = /\d{2}:\d{2}/.exec(first.createdAt)?.[0];
    const action = first.plannedAction.length > 70 ? `${first.plannedAction.slice(0, 70)}…` : first.plannedAction;
    const lead = el('strong', '', same.length === 1
      ? `Already added today${time ? ` at ${time}` : ''}:`
      : `${same.length} standups already added today for #${currentTicket}.`);
    ui.dupNote.replaceChildren(lead, same.length === 1 ? ` “${action}”. Adding again creates another entry.` : ' Adding again creates another entry.');
  }

  function eodTicketId(eod) {
    return /^#?(\d+)$/.exec(eod.ticket.trim())?.[1]
      || /\/tickets\/(\d+)\/?$/.exec(eod.link || '')?.[1]
      || null;
  }

  function localDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // Entries without a readable date are treated as today's, like the EOD page itself.
  function isToday(createdAt, today) {
    const date = /^\d{4}-\d{2}-\d{2}/.exec(createdAt || '')?.[0];
    return !date || date === today;
  }

  function eodItem(eod) {
    const editing = eodEdit?.id === eod.id;
    const li = el('li', `eod ${editing ? 'editing' : eod.update ? 'filled' : 'pending'}`);
    const top = el('div', 'eod-top');
    const id = el('div', 'eod-id');
    const ticket = eod.link ? el('a', '', `#${eod.ticket}`) : el('strong', '', `#${eod.ticket}`);
    if (eod.link) Object.assign(ticket, { href: eod.link, target: '_blank', rel: 'noopener' });
    id.append(ticket);
    if (eod.priority) id.append(el('span', `badge ${eod.priority.toLowerCase()}`, eod.priority));
    top.append(id, el('span', 'eod-sub', eod.createdAt));
    li.append(top, el('div', 'eod-action', eod.plannedAction));

    if (editing) {
      li.append(eodEditor());
      return li;
    }
    const row = el('div', 'eod-update-row');
    const update = el('div', `eod-update${eod.update ? '' : ' empty'}`, eod.update || 'EOD not filled yet');
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
    textarea.readOnly = saving; // not disabled: that would drop keyboard focus
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
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault(); // the server field is single-line
        saveEod();
      }
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
    ui.eodPanel.focus();
  }

  async function saveEod() {
    const edit = eodEdit;
    if (!edit || edit.saving) return;
    const hadFocus = eodPanelHasFocus(); // before the Save button is disabled and drops it
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
    if (hadFocus && !ui.eodPanel.hidden) (eodEdit === edit ? edit.textarea : ui.eodPanel).focus();
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
    const estTime = ui.estTime.value.trim() || '-';
    // Re-read at submit time: Livewire may have updated the page since opening.
    const priority = refreshMeta();

    if (!plannedAction) return showStatus('err', 'Enter your planned action first.');

    ui.submit.disabled = true;
    ui.submit.textContent = 'Sending…';
    ui.status.hidden = true;

    try {
      const res = await chrome.runtime.sendMessage({
        type: 'submitStandup',
        payload: { ticket, plannedAction, repoLink: ticketUrl(ticket), priority, estTime },
      });
      if (res?.ok) {
        ui.text.value = '';
        ui.estTime.value = '-';
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
      ui.estTime.value = '-';
      ui.status.hidden = true;
      renderDuplicateNotice();
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
