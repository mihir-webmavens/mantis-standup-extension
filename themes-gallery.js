// Full-size look gallery (themes.html): every look on the stand-in Mantis page
// (preview.html, scrollable here), light or dark, and "Use this look" to switch Mantis to it.
// Opened from the popup's Settings → Mantis look → Preview all.

const key = MantisThemes.STORAGE_KEY;
const list = document.querySelector('.list');
const glider = document.querySelector('.glider');
const frame = document.getElementById('frame');
const viewport = document.querySelector('.viewport');
const useBtn = document.getElementById('use');
const modeLight = document.getElementById('mode-light');
const modeDark = document.getElementById('mode-dark');
const toast = document.querySelector('.toast');
const title = document.querySelector('.title');

let shown = MantisThemes.DEFAULT;
let current = MantisThemes.DEFAULT;
let dark = matchMedia('(prefers-color-scheme: dark)').matches;
let toastTimer = null;

function item(theme) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'item';
  btn.dataset.id = theme.id;
  btn.setAttribute('role', 'radio');
  btn.style.setProperty('--dot', theme.accent);
  const swatch = document.createElement('span');
  swatch.className = 'swatch';
  for (const color of theme.swatch) swatch.append(Object.assign(document.createElement('i'), { style: `background:${color}` }));
  const text = document.createElement('span');
  text.append(
    Object.assign(document.createElement('span'), { className: 'item-name', textContent: theme.name }),
    Object.assign(document.createElement('span'), { className: 'item-tag', textContent: theme.tagline }),
  );
  const badge = Object.assign(document.createElement('span'), { className: 'in-use', textContent: 'In use' });
  if (theme.id === 'pop') badge.style.color = '#111';
  if (theme.featured) text.querySelector('.item-name').append(Object.assign(document.createElement('span'), { className: 'motion', textContent: 'Motion' }));
  btn.append(swatch, text, badge);
  btn.addEventListener('click', () => show(theme.id));
  return btn;
}

function moveGlider() {
  const active = list.querySelector(`.item[data-id="${shown}"]`);
  glider.style.setProperty('--y', `${active.offsetTop}px`);
  glider.style.setProperty('--h', `${active.offsetHeight}px`);
}

function renderDetails() {
  const theme = MantisThemes.byId(shown);
  document.documentElement.style.setProperty('--look', theme.accent);
  document.getElementById('look-name').textContent = theme.name;
  document.getElementById('look-desc').textContent = theme.description;
  document.getElementById('look-traits').replaceChildren(...theme.traits.map((t) => Object.assign(document.createElement('li'), { textContent: t })));
  title.classList.remove('swap');
  void title.offsetWidth; // restart the swap-in animation
  title.classList.add('swap');
  for (const el of list.querySelectorAll('.item')) {
    const on = el.dataset.id === shown;
    el.setAttribute('aria-checked', String(on));
    el.tabIndex = on ? 0 : -1;
    el.classList.toggle('current', el.dataset.id === current);
  }
  const inUse = shown === current;
  useBtn.disabled = inUse;
  useBtn.textContent = inUse ? '✓ In use' : `Use ${theme.name}`;
  useBtn.classList.toggle('pop-dark', theme.id === 'pop' && !inUse);
  // Neon is always dark.
  modeLight.disabled = Boolean(theme.dark);
  modeLight.setAttribute('aria-pressed', String(!dark && !theme.dark));
  modeDark.setAttribute('aria-pressed', String(dark || Boolean(theme.dark)));
  moveGlider();
}

function show(id, { animate = true } = {}) {
  shown = MantisThemes.byId(id)?.id || MantisThemes.DEFAULT;
  history.replaceState(null, '', `#${shown}`);
  renderDetails();
  frame.contentWindow?.postMessage({ type: 'msq-preview', theme: shown, dark, animate }, '*');
}

function showToast(text) {
  toast.textContent = text;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 2600);
}

// Fit the 1100px-wide page into the viewport, filling its height.
new ResizeObserver(() => {
  const k = Math.min(1, viewport.clientWidth / 1100);
  viewport.style.setProperty('--k', k);
  viewport.style.setProperty('--fh', `${Math.ceil(viewport.clientHeight / k)}px`);
}).observe(viewport);
new ResizeObserver(moveGlider).observe(list);

list.append(...MantisThemes.THEMES.map(item));
list.addEventListener('keydown', (e) => {
  const ids = MantisThemes.THEMES.map((t) => t.id);
  const i = ids.indexOf(shown);
  let next = null;
  if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = ids[(i + 1) % ids.length];
  if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = ids[(i - 1 + ids.length) % ids.length];
  if (e.key === 'Home') next = ids[0];
  if (e.key === 'End') next = ids.at(-1);
  if (e.key === 'Enter' && !useBtn.disabled) { e.preventDefault(); useBtn.click(); return; }
  if (!next) return;
  e.preventDefault();
  show(next);
  list.querySelector(`.item[data-id="${next}"]`).focus();
});

modeLight.addEventListener('click', () => { dark = false; show(shown); });
modeDark.addEventListener('click', () => { dark = true; show(shown); });
document.getElementById('replay').addEventListener('click', () => frame.contentWindow?.postMessage({ type: 'msq-replay' }, '*'));
useBtn.addEventListener('click', () => {
  const id = shown;
  chrome.storage.sync.set({ [key]: id }).then(
    () => showToast(`${MantisThemes.byId(id).name} is on · open Mantis tabs update instantly`),
    (err) => showToast(`Could not save: ${err.message}`),
  );
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync' || !(key in changes)) return;
  current = MantisThemes.byId(changes[key].newValue)?.id || MantisThemes.DEFAULT;
  renderDetails();
});

chrome.storage.sync.get(key).then((v) => v[key], () => null).then((saved) => {
  current = MantisThemes.byId(saved)?.id || MantisThemes.DEFAULT;
  const start = MantisThemes.byId(location.hash.slice(1))?.id || current;
  shown = start;
  const loaded = { theme: start, dark };
  frame.src = `preview.html?theme=${start}&dark=${dark ? 1 : 0}&scroll=1`;
  // Picks made before the preview finished loading were posted into the void.
  frame.addEventListener('load', () => {
    if (shown !== loaded.theme || dark !== loaded.dark) frame.contentWindow.postMessage({ type: 'msq-preview', theme: shown, dark, animate: false }, '*');
  }, { once: true });
  renderDetails();
  list.querySelector(`.item[data-id="${start}"]`).focus({ preventScroll: true });
});
