// Toolbar popup: pick the corner button's look. The choice is saved in
// chrome.storage.sync; content.js listens and restyles open Mantis tabs.

const grid = document.querySelector('.grid');
const status = document.querySelector('.status');
const key = ButtonStyles.STORAGE_KEY;
let statusTimer = null;

// Each preview renders the real button stylesheet in its own shadow root,
// so it looks exactly like the button on the page.
function preview(styleId) {
  const host = document.createElement('div');
  host.className = 'preview-host';
  host.attachShadow({ mode: 'open' }).innerHTML = `
    <style>
      :host { display: inline-block; }
      * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
      ${ButtonStyles.css(styleId)}
    </style>
    <div class="fab-scroll"><span class="fab">+ Standup</span></div>
  `;
  return host;
}

function card(style) {
  const label = document.createElement('label');
  label.className = 'card';
  label.dataset.id = style.id;

  const input = document.createElement('input');
  input.type = 'radio';
  input.name = 'style';
  input.value = style.id;
  input.className = 'sr-only';
  input.addEventListener('change', () => select(style.id, true));

  const stage = document.createElement('div');
  stage.className = 'stage';
  stage.append(preview(style.id));

  const info = document.createElement('div');
  info.className = 'info';
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = style.name;
  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = 'Selected';
  const desc = document.createElement('span');
  desc.className = 'desc';
  desc.textContent = style.description;
  info.append(name, badge, desc);

  label.append(input, stage, info);
  return label;
}

function select(id, save) {
  for (const el of grid.querySelectorAll('.card')) {
    const on = el.dataset.id === id;
    el.classList.toggle('selected', on);
    el.querySelector('input').checked = on;
  }
  if (!save) return;
  chrome.storage.sync.set({ [key]: id }).then(
    () => showStatus(`${ButtonStyles.STYLES.find((s) => s.id === id).name} saved · open Mantis tabs update instantly`),
    (err) => showStatus(`Could not save: ${err.message}`, true),
  );
}

function showStatus(text, isError = false) {
  status.textContent = text;
  status.classList.toggle('error', isError);
  status.classList.add('visible');
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => status.classList.remove('visible'), 2600);
}

grid.append(...ButtonStyles.STYLES.map(card));
chrome.storage.sync.get(key).then(
  (v) => {
    const id = ButtonStyles.STYLES.some((s) => s.id === v[key]) ? v[key] : ButtonStyles.DEFAULT;
    select(id, false);
    grid.querySelector('.card.selected')?.scrollIntoView({ block: 'nearest' });
  },
  () => select(ButtonStyles.DEFAULT, false),
);
