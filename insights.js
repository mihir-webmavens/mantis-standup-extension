// The Insights page: the ticket digest (fetched by background.js through the
// MantisAI helper) and the time tracker's weekly breakdown. Reads
// chrome.storage.local and re-renders when either changes.

(() => {
  const DIGEST_LAST_KEY = 'ticketDigestLast';
  const TIME_LOG_KEY = 'timeLog';
  const TIME_TITLES_KEY = 'timeTicketTitles';
  const TIME_KEY = 'timeTracker';
  const MANTIS_ORIGIN = 'https://projects.webmavens.dev';
  const MANTIS_HOST = 'projects.webmavens.dev';
  const STATUS_LABELS = { new: 'New', assigned: 'Assigned', in_progress: 'In progress' };
  const RANK_LIMIT = 12;

  const $ = (sel) => document.querySelector(sel);
  const state = { digest: null, log: {}, titles: {}, trackerOn: false, weekStart: startOfWeek(new Date()), day: null, refreshing: false };

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function localDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // Weeks start on Monday.
  function startOfWeek(d) {
    const start = new Date(d);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    return start;
  }

  function addDays(d, n) {
    const next = new Date(d);
    next.setDate(next.getDate() + n);
    return next;
  }

  function duration(ms) {
    const min = Math.round(ms / 60000);
    if (min < 1) return ms > 0 ? '<1m' : '0m';
    const h = Math.floor(min / 60);
    return h ? `${h}h ${String(min % 60).padStart(2, '0')}m` : `${min}m`;
  }

  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const ticketLink = (id, text = `#${id}`) => {
    const a = el('a', null, text);
    a.href = `${MANTIS_ORIGIN}/tickets/${id}`;
    a.target = '_blank';
    a.rel = 'noopener';
    return a;
  };

  // ---------- digest ----------

  function ageText(t) {
    if (t.idleDays == null) return '';
    if (t.idleDays === 0) return 'updated today';
    return t.idleDays === 1 ? 'updated yesterday' : `no update in ${t.idleDays} days`;
  }

  // Time tracked on a ticket this calendar week (from the time tracker).
  function weekTicketTime(id) {
    let ms = 0;
    const start = startOfWeek(new Date());
    for (let i = 0; i < 7; i++) ms += state.log[localDate(addDays(start, i))]?.tickets?.[id] || 0;
    return ms;
  }

  function ticketItem(t) {
    const li = el('li', `ticket${t.stale ? ' stale' : ''}`);
    const num = ticketLink(t.id);
    num.className = 'num';
    li.append(num, el('span', 'title', t.title || '(no title)'), el('span', 'age', ageText(t)));
    const meta = el('div', 'meta');
    if (t.project) meta.append(el('span', null, t.project));
    meta.append(el('span', 'chip', STATUS_LABELS[t.status] || t.status));
    if (t.priority) meta.append(el('span', `chip ${t.priority}`, t.priority[0].toUpperCase() + t.priority.slice(1)));
    const spent = weekTicketTime(String(t.id));
    if (spent >= 60000) meta.append(el('span', null, `${duration(spent)} this week`));
    li.append(meta);
    return li;
  }

  function stat(value, label, warn = false) {
    const box = el('div', `stat${warn ? ' warn' : ''}`);
    box.append(el('strong', null, String(value)), label);
    return box;
  }

  function renderDigest() {
    const d = state.digest;
    const notice = $('#digest-notice');
    const stats = $('#digest-stats');
    const active = $('#digest-active');
    const testing = $('#digest-testing');
    $('#digest-refresh').disabled = state.refreshing;
    $('#digest-refresh').textContent = state.refreshing ? 'Fetching…' : 'Refresh';
    active.replaceChildren();
    notice.hidden = true;
    notice.classList.remove('err');

    if (state.refreshing) {
      notice.hidden = false;
      notice.textContent = 'Fetching your tickets from Mantis through the MantisAI helper. This takes about 15 seconds.';
    }
    if (!d) {
      stats.hidden = true;
      testing.hidden = true;
      $('#digest-meta').textContent = 'Not fetched yet. Press Refresh.';
      return;
    }
    $('#digest-meta').textContent = `${d.error ? 'Last try' : 'Updated'} ${new Date(d.fetchedAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`
      + (d.staleDays ? ` · stale after ${plural(d.staleDays, 'day')} without an update` : '');
    if (d.error && !state.refreshing) {
      notice.hidden = false;
      notice.classList.add('err');
      notice.textContent = d.error;
    }
    if (!Array.isArray(d.active)) {
      stats.hidden = true;
      testing.hidden = true;
      return;
    }

    stats.hidden = false;
    stats.replaceChildren(
      stat(d.active.length, 'active'),
      stat(d.stale, 'stale', d.stale > 0),
      stat(d.testing.length, 'waiting for testing'),
    );
    if (d.active.length) active.append(...d.active.map(ticketItem));
    else active.append(el('li', 'empty', 'No active tickets. Nice.'));

    testing.hidden = !d.testing.length;
    testing.querySelector('summary').textContent = `${plural(d.testing.length, 'ticket')} waiting for testing`;
    testing.querySelector('ul').replaceChildren(...d.testing.map(ticketItem));
  }

  async function refreshDigest() {
    state.refreshing = true;
    renderDigest();
    const res = await chrome.runtime.sendMessage({ type: 'runDigest' }).catch((err) => ({ ok: false, error: err.message }));
    state.refreshing = false;
    if (res?.ok) state.digest = res.digest;
    else state.digest = { ...(state.digest || {}), fetchedAt: Date.now(), error: res?.error || 'Something went wrong.' };
    renderDigest();
  }

  // ---------- time ----------

  // One day's totals: Mantis tickets, other Mantis pages, other sites.
  function dayTotals(day) {
    const entry = state.log[day] || {};
    const sum = (o) => Object.values(o || {}).reduce((a, b) => a + b, 0);
    const mantis = entry.sites?.[MANTIS_HOST] || 0;
    return { tickets: sum(entry.tickets), mantis, sites: sum(entry.sites) - mantis };
  }

  function weekDays() {
    return Array.from({ length: 7 }, (_, i) => localDate(addDays(state.weekStart, i)));
  }

  function renderRank(list, rows, total, render) {
    list.replaceChildren();
    if (!rows.length) return list.append(el('li', 'empty', 'Nothing tracked.'));
    for (const [key, ms] of rows.slice(0, RANK_LIMIT)) {
      const li = el('li');
      const fill = el('span', 'fill');
      fill.style.width = `${total ? (ms / rows[0][1]) * 100 : 0}%`;
      const name = el('span', 'name');
      render(name, key);
      li.append(fill, name, el('span', 'dur', duration(ms)));
      list.append(li);
    }
    if (rows.length > RANK_LIMIT) list.append(el('li', 'empty', `and ${rows.length - RANK_LIMIT} more`));
  }

  function renderTime() {
    const days = weekDays();
    const today = localDate(new Date());
    const end = addDays(state.weekStart, 6);
    const fmt = (d) => d.toLocaleDateString([], { day: 'numeric', month: 'short' });
    $('#week-label').textContent = state.weekStart.getTime() === startOfWeek(new Date()).getTime() ? 'This week' : `${fmt(state.weekStart)} – ${fmt(end)}`;
    $('#week-next').disabled = days.includes(today);

    const notice = $('#time-notice');
    notice.hidden = state.trackerOn;
    notice.textContent = 'The time tracker is off. Turn it on in the toolbar popup → Settings → Time tracker.';

    // Bars
    const totals = days.map(dayTotals);
    const max = Math.max(...totals.map((t) => t.tickets + t.mantis + t.sites), 1);
    const chart = $('#time-chart');
    chart.replaceChildren();
    days.forEach((day, i) => {
      const t = totals[i];
      const sum = t.tickets + t.mantis + t.sites;
      const col = el('button', `bar-col${day === today ? ' today' : ''}`);
      col.type = 'button';
      col.setAttribute('aria-pressed', String(state.day === day));
      const date = addDays(state.weekStart, i);
      col.setAttribute('aria-label', `${date.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}: ${duration(sum)}`);
      const bar = el('div', 'bar');
      for (const kind of ['tickets', 'mantis', 'sites']) {
        const seg = el('span', kind);
        seg.style.height = `${(t[kind] / max) * 100}%`;
        bar.append(seg);
      }
      col.append(el('span', 'total', sum ? duration(sum) : ''), bar, el('span', 'day', date.toLocaleDateString([], { weekday: 'short' })));
      col.addEventListener('click', () => {
        state.day = state.day === day ? null : day;
        renderTime();
      });
      chart.append(col);
    });

    // Lists for the picked day, else the whole week.
    const scope = state.day ? [state.day] : days;
    const tickets = {};
    const sites = {};
    for (const day of scope) {
      for (const [id, ms] of Object.entries(state.log[day]?.tickets || {})) tickets[id] = (tickets[id] || 0) + ms;
      for (const [host, ms] of Object.entries(state.log[day]?.sites || {})) sites[host] = (sites[host] || 0) + ms;
    }
    const sorted = (o) => Object.entries(o).filter(([, ms]) => ms >= 30000).sort((a, b) => b[1] - a[1]);
    const ticketRows = sorted(tickets);
    const siteRows = sorted(sites);
    const sumOf = (rows) => rows.reduce((a, [, ms]) => a + ms, 0);

    const scopeLabel = state.day ? new Date(`${state.day}T00:00`).toLocaleDateString([], { weekday: 'long' }) : 'this week';
    $('#tickets-head').textContent = `Tickets · ${duration(sumOf(ticketRows))}`;
    $('#sites-head').textContent = `Sites · ${duration(sumOf(siteRows))}`;
    renderRank($('#time-tickets'), ticketRows, sumOf(ticketRows), (name, id) => {
      name.append(ticketLink(id));
      const title = state.titles[id] || state.digest?.active?.find((t) => String(t.id) === id)?.title;
      if (title) name.append(` ${title}`);
      name.title = title || '';
    });
    renderRank($('#time-sites'), siteRows, sumOf(siteRows), (name, host) => {
      name.textContent = host === MANTIS_HOST ? `${host} (lists, dashboard)` : host;
      name.title = host;
    });

    const all = totals.reduce((a, t) => a + t.tickets + t.mantis + t.sites, 0);
    const ticketAll = totals.reduce((a, t) => a + t.tickets, 0);
    const daysTracked = totals.filter((t) => t.tickets + t.mantis + t.sites > 0).length;
    $('#time-stats').replaceChildren(
      stat(duration(all), 'in Chrome'),
      stat(duration(ticketAll), 'on Mantis tickets'),
      stat(all ? `${Math.round((ticketAll / all) * 100)}%` : '–', 'on tickets'),
      stat(daysTracked ? duration(all / daysTracked) : '–', 'per tracked day'),
    );
    $('#time-meta').textContent = `Showing ${scopeLabel}. Time Chrome was focused on each tab; sites by name only, kept on this computer.`;
  }

  // ---------- wiring ----------

  $('#digest-refresh').addEventListener('click', refreshDigest);
  $('#week-prev').addEventListener('click', () => {
    state.weekStart = addDays(state.weekStart, -7);
    state.day = null;
    renderTime();
  });
  $('#week-next').addEventListener('click', () => {
    state.weekStart = addDays(state.weekStart, 7);
    state.day = null;
    renderTime();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      if (changes[DIGEST_LAST_KEY] && !state.refreshing) {
        state.digest = changes[DIGEST_LAST_KEY].newValue || null;
        renderDigest();
      }
      if (changes[TIME_LOG_KEY] || changes[TIME_TITLES_KEY]) {
        if (changes[TIME_LOG_KEY]) state.log = changes[TIME_LOG_KEY].newValue || {};
        if (changes[TIME_TITLES_KEY]) state.titles = changes[TIME_TITLES_KEY].newValue || {};
        renderTime();
        renderDigest();
      }
    }
    if (area === 'sync' && changes[TIME_KEY]) {
      state.trackerOn = Boolean(changes[TIME_KEY].newValue?.enabled);
      renderTime();
    }
  });

  Promise.all([
    chrome.storage.local.get([DIGEST_LAST_KEY, TIME_LOG_KEY, TIME_TITLES_KEY]),
    chrome.storage.sync.get(TIME_KEY),
    chrome.permissions.contains({ permissions: ['tabs', 'idle'] }).catch(() => false),
  ]).then(([local, sync, granted]) => {
    state.digest = local[DIGEST_LAST_KEY] || null;
    state.log = local[TIME_LOG_KEY] || {};
    state.titles = local[TIME_TITLES_KEY] || {};
    state.trackerOn = Boolean(sync[TIME_KEY]?.enabled) && granted;
    renderDigest();
    renderTime();
  });
  renderDigest();
  renderTime();
})();
