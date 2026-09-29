// Mantis header layout, shared by the toolbar popup (Header tab) and
// mantis-header.js (applies it on Mantis pages). The user's choice is stored in
// chrome.storage.sync as { order: [keys], hidden: [keys] }; the header items last
// seen on Mantis are kept in chrome.storage.local so the popup can list them.
// No saved layout means the pre-1.8 look: Unassigned, Todos, GitHub and the
// project switcher hidden (`legacy` items). New installs start with everything shown.

const HeaderLayout = (() => {
  const STORAGE_KEY = 'headerLayout';
  const ITEMS_KEY = 'headerItems';

  // items: [{ key, label, fixed, legacy }] in Mantis's own order. Fixed items (the
  // project switcher sits outside the tab row) can be hidden but not moved.
  // Returns the items in display order, each with `hidden`.
  function resolve(items, layout) {
    const rank = new Map((layout?.order || []).map((key, i) => [key, i]));
    const movable = items.filter((it) => !it.fixed);
    const ordered = movable.filter((it) => rank.has(it.key)).sort((a, b) => rank.get(a.key) - rank.get(b.key));
    // Tabs Mantis added since the order was saved go right after their neighbour.
    movable.forEach((it, i) => {
      if (rank.has(it.key)) return;
      const prev = movable.slice(0, i).reverse().find((p) => ordered.includes(p));
      ordered.splice(prev ? ordered.indexOf(prev) + 1 : 0, 0, it);
    });
    const hidden = layout ? new Set(layout.hidden || []) : null;
    return [...ordered, ...items.filter((it) => it.fixed)]
      .map((it) => ({ ...it, hidden: hidden ? hidden.has(it.key) : Boolean(it.legacy) }));
  }

  return { STORAGE_KEY, ITEMS_KEY, resolve };
})();
