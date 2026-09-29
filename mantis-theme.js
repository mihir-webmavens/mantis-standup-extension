// Applies the Mantis look chosen in Settings (see themes.js): marks <html> with
// data-msq-theme and adds the look's stylesheet as <html>'s last child, where
// Livewire's head/body swaps never touch it. Runs at document_start; the last
// choice is mirrored in the page's localStorage, so it applies before the first
// frame. Switching looks while a tab is open cross-fades (View Transitions).
// Neon is always dark: it adds Flux's `dark` class and removes it again only if
// it was the one that added it. Motion looks (Kinetic) open with a circular
// reveal and get the gliding tab pill (MantisThemes.glide).

(() => {
  const MIRROR = 'msq-theme';
  const root = document.documentElement;
  let theme = null; // null: Classic
  let style = null;
  let forcedDark = false;
  let settle = () => {};

  try { theme = MantisThemes.byId(localStorage.getItem(MIRROR)); } catch { /* storage blocked */ }

  function apply() {
    const look = theme && theme.id !== 'classic' ? theme : null;
    if (!look) {
      if (root.hasAttribute('data-msq-theme')) root.removeAttribute('data-msq-theme');
      style?.remove();
    } else {
      if (root.getAttribute('data-msq-theme') !== look.id) root.setAttribute('data-msq-theme', look.id);
      if (!style) {
        style = document.createElement('style');
        style.id = 'msq-theme';
      }
      const css = MantisThemes.css(look.id);
      if (style.textContent !== css) style.textContent = css;
      if (!style.isConnected) root.append(style);
    }
    if (look?.dark && !root.classList.contains('dark')) {
      root.classList.add('dark');
      forcedDark = true;
    } else if (!look?.dark && forcedDark) {
      forcedDark = false;
      root.classList.remove('dark');
    }
    settle();
  }

  function setTheme(id, animate) {
    const next = MantisThemes.byId(id);
    try { localStorage.setItem(MIRROR, next?.id || MantisThemes.DEFAULT); } catch { /* storage blocked */ }
    if ((next?.id || null) === (theme?.id || null)) return;
    theme = next;
    if (!animate || !document.startViewTransition || document.visibilityState !== 'visible') {
      apply();
      return;
    }
    if (theme?.motion) root.setAttribute('data-msq-switching', '');
    document.startViewTransition(apply).finished.finally(() => root.removeAttribute('data-msq-switching'));
  }

  chrome.storage.sync.get(MantisThemes.STORAGE_KEY).then((v) => setTheme(v[MantisThemes.STORAGE_KEY], false), () => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && MantisThemes.STORAGE_KEY in changes) setTheme(changes[MantisThemes.STORAGE_KEY].newValue, true);
  });

  // Put the stylesheet, attribute and dark class back if the page removes them.
  new MutationObserver(apply).observe(root, { childList: true, attributes: true, attributeFilter: ['class', 'data-msq-theme'] });
  MantisThemes.spotlight(window, () => theme);
  settle = MantisThemes.glide(window, () => theme);
  apply();
})();
