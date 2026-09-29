// Applies the Header tab's choices (see header-layout.js) to the Mantis header:
// hidden tabs get display:none, visible ones the saved order (CSS `order`, so
// Mantis's markup is never moved). Each tab is tagged data-msq-tab="<key>" and a
// generated stylesheet does the rest. Runs at document_start: the last layout is
// mirrored in the page's localStorage, so it applies before the first frame.
// Until a layout is known, mantis-header.css keeps the pre-1.8 hidden items.

(() => {
  const MIRROR = 'msq-header-layout';
  const NAV = 'header [data-flux-navbar]';
  const SWITCHER = 'header ui-dropdown:has(button[aria-label="Switch project"])';
  const LEGACY = ['a[href*="/tickets?unassigned=1"]', 'a[href$="/todos"]', 'a[href*="/github/"]'];

  let layout; // undefined until known; null when none is saved
  let style = null;
  let reported = '';

  try {
    const mirror = localStorage.getItem(MIRROR);
    if (mirror) layout = JSON.parse(mirror).layout ?? null;
  } catch { /* no mirror: wait for storage */ }

  function labelOf(el) {
    const trigger = el.matches('a, button') ? el : el.querySelector('button, a') || el;
    const text = trigger.getAttribute('aria-label') || trigger.getAttribute('title') || trigger.textContent;
    // Drop unread/count badges ("Notifications 3").
    return text.replace(/\s+/g, ' ').trim().replace(/\s*\d+\+?$/, '');
  }

  function findItems() {
    const items = [];
    const keys = new Set();
    const add = (el, label, extra) => {
      let key = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item';
      for (let n = 2; keys.has(key); n++) key = key.replace(/-\d+$/, '') + '-' + n;
      keys.add(key);
      items.push({ el, key, label, ...extra });
    };
    const nav = document.querySelector(NAV);
    for (const el of nav?.children || []) {
      if (/^(mantis-ai-launcher|script|style|template)$/.test(el.localName)) continue;
      const label = labelOf(el);
      if (label) add(el, label, { legacy: LEGACY.some((sel) => el.matches(sel) || el.querySelector(sel)) });
    }
    const switcher = document.querySelector(SWITCHER);
    if (switcher) add(switcher, 'Project switcher', { fixed: true, legacy: true });
    return { nav, items };
  }

  function cssFor(items) {
    const resolved = HeaderLayout.resolve(items, layout);
    const ordered = Boolean(layout?.order?.length);
    return resolved.map((it, i) => {
      const sel = `[data-msq-tab="${it.key}"]`;
      if (it.hidden) return `${sel} { display: none !important; }`;
      return ordered && !it.fixed ? `${sel} { order: ${i}; }` : '';
    }).join('\n');
  }

  function apply() {
    const { nav, items } = findItems();
    for (const it of items) {
      if (it.el.getAttribute('data-msq-tab') !== it.key) it.el.setAttribute('data-msq-tab', it.key);
    }
    if (nav) report(items);
    if (layout === undefined) return;
    const root = document.documentElement;
    if (!root.hasAttribute('data-msq-header')) root.setAttribute('data-msq-header', '');
    if (!style) {
      style = document.createElement('style');
      style.id = 'msq-header-layout';
    }
    const css = cssFor(items);
    if (style.textContent !== css) style.textContent = css;
    if (!style.isConnected) root.append(style);
  }

  // What the popup lists: the tabs as Mantis draws them.
  function report(items) {
    const list = items.map(({ key, label, fixed, legacy }) => ({ key, label, fixed: Boolean(fixed), legacy: Boolean(legacy) }));
    const json = JSON.stringify(list);
    if (json === reported) return;
    reported = json;
    chrome.storage.local.set({ [HeaderLayout.ITEMS_KEY]: list }).catch(() => {});
  }

  function setLayout(value) {
    layout = value ?? null;
    try { localStorage.setItem(MIRROR, JSON.stringify({ layout })); } catch { /* storage blocked */ }
    apply();
  }

  chrome.storage.sync.get(HeaderLayout.STORAGE_KEY).then((v) => setLayout(v[HeaderLayout.STORAGE_KEY]), () => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && HeaderLayout.STORAGE_KEY in changes) setLayout(changes[HeaderLayout.STORAGE_KEY].newValue);
  });

  // Tag tabs as they are parsed and whenever Livewire redraws the header (a
  // mutation callback runs before the next frame is drawn).
  new MutationObserver(apply).observe(document.documentElement, {
    childList: true, subtree: true, attributes: true, attributeFilter: ['data-msq-tab', 'data-msq-header'],
  });
  apply();
})();
