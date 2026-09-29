// Renders preview.html in a look: the same stylesheet, dark handling and cursor
// spotlight/tab glide the content script uses on Mantis. ?scroll=1 lets the
// page scroll (the gallery), for scroll-driven motion. The parent page can switch the
// look or replay the entrance animations with postMessage:
//   { type: 'msq-preview', theme, dark }   { type: 'msq-replay' }

const params = new URLSearchParams(location.search);
const style = document.createElement('style');
document.documentElement.append(style);
let current = null;
if (params.get('scroll') === '1') document.documentElement.classList.add('scrollable');

function show(id, dark) {
  current = MantisThemes.byId(id) || MantisThemes.byId(MantisThemes.DEFAULT);
  const root = document.documentElement;
  if (current.id === 'classic') root.removeAttribute('data-msq-theme');
  else root.setAttribute('data-msq-theme', current.id);
  root.classList.toggle('dark', Boolean(dark || current.dark));
  style.textContent = MantisThemes.css(current.id);
  settle();
}

// A fresh copy of the page runs every entrance animation again.
function replay() {
  const app = document.getElementById('app');
  app.replaceWith(app.cloneNode(true));
  settle();
}

addEventListener('message', (e) => {
  if (e.source !== parent) return;
  if (e.data?.type === 'msq-preview') {
    const change = () => { show(e.data.theme, e.data.dark); replay(); };
    if (!document.startViewTransition || !e.data.animate) return change();
    const root = document.documentElement;
    if (MantisThemes.byId(e.data.theme)?.motion) root.setAttribute('data-msq-switching', '');
    document.startViewTransition(change).finished.finally(() => root.removeAttribute('data-msq-switching'));
  }
  if (e.data?.type === 'msq-replay') replay();
});

MantisThemes.spotlight(window, () => current);
const settle = MantisThemes.glide(window, () => current);
show(params.get('theme'), params.get('dark') === '1');
