// Submits the standup to standup.webmavens.dev using the user's existing
// browser session. Runs in the service worker so the cross-origin request
// is covered by host_permissions (content scripts are bound by page CORS).

const STANDUP_ORIGIN = 'https://standup.webmavens.dev';
const CREATE_URL = `${STANDUP_ORIGIN}/admin/standups/create`;
const INDEX_PATH = '/admin/standups';
const EOD_URL = `${STANDUP_ORIGIN}/admin/standups/edit-standups`;
const EOD_FORM_PATH = '/admin/standups/update-standups';

const HANDLERS = {
  submitStandup: (payload) => submitStandup(payload).then(() => ({})),
  fetchEods: () => fetchEods().then((eods) => ({ eods })),
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = HANDLERS[msg?.type];
  if (!handler) return;
  handler(msg.payload).then(
    (data) => sendResponse({ ok: true, ...data }),
    (err) => sendResponse({ ok: false, error: err.message || String(err) }),
  );
  return true; // keep the channel open for the async response
});

async function submitStandup({ ticket, plannedAction, repoLink, priority }) {
  if (!ticket || !plannedAction || !repoLink || !priority) {
    throw new Error('Missing standup data; nothing was submitted.');
  }

  // 1. Load the create form to get a fresh CSRF token, user_id and the
  //    form's own defaults for support_needed / blockers_challenges.
  const createRes = await fetchCreateForm();
  const form = parseStandupForm(await createRes.text());
  if (!form) throw new Error('Could not find the standup form on standup.webmavens.dev.');
  if (!form.fields._token) throw new Error('Standup form has no CSRF token; cannot submit.');
  if (!form.fields.user_id) throw new Error('Standup form has no user_id; cannot submit.');

  // 2. Keep every default the form ships with (_token, user_id,
  //    support_needed, blockers_challenges) and fill only our fields.
  const body = new URLSearchParams(form.fields);
  body.set('ticket', ticket);
  body.set('planned_action', plannedAction);
  body.set('repo_link', repoLink);
  body.set('priority', priority);
  body.set('est_time', '-');

  // Redirects are not followed: the server redirects to http:// URLs, and
  // Chrome blocks the resulting https -> http -> https chain with a CORS error
  // even though the standup was saved.
  const res = await fetch(form.action, { method: 'POST', credentials: 'include', body, redirect: 'manual' });

  if (res.status === 419) throw new Error('Standup session expired. Reload standup.webmavens.dev and try again.');
  if (res.type !== 'opaqueredirect') {
    const errors = res.ok ? extractErrors(await res.text()) : [];
    throw new Error(errors.length
      ? `Standup not saved: ${errors.join(' ')}`
      : `Standup not saved (unexpected HTTP ${res.status} response).`);
  }

  // 3. A redirect means the POST was accepted, but Laravel also redirects back
  //    to /create on validation failure, flashing the errors into the session.
  //    Reload the form: any errors shown there mean the standup was not saved.
  const errors = extractErrors(await (await fetchCreateForm()).text());
  if (errors.length) throw new Error(`Standup not saved: ${errors.join(' ')}`);
}

// When logged in the create form is a plain 200; any redirect means the
// session is gone and the server is sending us to /login.
function fetchCreateForm() {
  return fetchStandupPage(CREATE_URL, 'the standup form');
}

async function fetchStandupPage(url, what) {
  const res = await fetch(url, { credentials: 'include', redirect: 'manual' });
  if (res.type === 'opaqueredirect') {
    throw new Error('You are not logged into standup.webmavens.dev. Log in there, then try again.');
  }
  if (!res.ok) throw new Error(`Could not open ${what} (HTTP ${res.status}).`);
  return res;
}

// Each EOD is a row of the update-standups form that carries an
// evening_updates[<id>] input; columns are located by their header text.
async function fetchEods() {
  const html = await (await fetchStandupPage(EOD_URL, 'the EOD page')).text();

  const form = [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)].find(([, attrs]) => {
    const action = attr(attrs, 'action');
    return action && new URL(action, STANDUP_ORIGIN).pathname.replace(/\/$/, '') === EOD_FORM_PATH;
  });
  if (!form) throw new Error('Could not find the EOD list on standup.webmavens.dev.');

  const headers = [...(/<thead\b[^>]*>([\s\S]*?)<\/thead>/i.exec(form[2])?.[1] ?? '').matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)]
    .map(([, inner]) => cellText(inner));
  const col = (re) => headers.findIndex((h) => re.test(h));
  const cols = {
    ticket: col(/ticket/i),
    plannedAction: col(/planned/i),
    link: col(/link/i),
    priority: col(/priority/i),
    estTime: col(/est/i),
    createdAt: col(/created/i),
  };

  const tbody = /<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i.exec(form[2])?.[1] ?? '';
  const eods = [];
  for (const [, row] of tbody.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const input = [...row.matchAll(/<input\b[^>]*>/gi)].map(([tag]) => tag)
      .find((tag) => /^evening_updates\[\d+\]$/.test(attr(tag, 'name') || ''));
    if (!input) continue;

    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(([, inner]) => inner);
    const text = (i) => (i >= 0 && cells[i] != null ? cellText(cells[i]) : '');
    const anchor = cols.link >= 0 && cells[cols.link] ? /<a\b[^>]*>/i.exec(cells[cols.link]) : null;
    const href = anchor ? attr(anchor[0], 'href') : null;

    eods.push({
      id: /\[(\d+)\]/.exec(attr(input, 'name'))[1],
      ticket: text(cols.ticket),
      plannedAction: text(cols.plannedAction),
      link: href && /^https?:\/\//i.test(href) ? href : null,
      priority: text(cols.priority),
      estTime: text(cols.estTime),
      createdAt: text(cols.createdAt),
      update: attr(input, 'value') ?? '',
    });
  }
  return eods;
}

function cellText(html) {
  return decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

// DOMParser is not available in MV3 service workers, so parse with regexes.
// The form is server-rendered Blade, which keeps this predictable.
function parseStandupForm(html) {
  const formMatch = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
  let m;
  while ((m = formMatch.exec(html))) {
    const action = attr(m[1], 'action');
    if (!action || new URL(action, STANDUP_ORIGIN).pathname.replace(/\/$/, '') !== INDEX_PATH) continue;

    const inner = m[2];
    const fields = {};

    for (const [tag] of inner.matchAll(/<input\b[^>]*>/gi)) {
      const name = attr(tag, 'name');
      const type = (attr(tag, 'type') || 'text').toLowerCase();
      if (!name || ['submit', 'button', 'file', 'reset', 'image'].includes(type)) continue;
      if ((type === 'checkbox' || type === 'radio') && !/\schecked\b/i.test(tag)) continue;
      fields[name] = attr(tag, 'value') ?? '';
    }

    for (const [, attrs, content] of inner.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/gi)) {
      const name = attr(attrs, 'name');
      if (name) fields[name] = decodeEntities(content);
    }

    for (const [, attrs, content] of inner.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
      const name = attr(attrs, 'name');
      const selected = /<option\b([^>]*\sselected\b[^>]*)>/i.exec(content);
      if (name && selected && !/\sdisabled\b/i.test(selected[1])) fields[name] = attr(selected[1], 'value') ?? '';
    }

    return { action: new URL(action, STANDUP_ORIGIN).href, fields };
  }
  return null;
}

function attr(tag, name) {
  const re = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const m = re.exec(tag);
  return m ? decodeEntities(m[1] ?? m[2] ?? m[3]) : null;
}

function decodeEntities(s) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function extractErrors(html) {
  const errors = new Set();
  const patterns = [
    /<(?:span|div)[^>]*class="[^"]*(?:help-block|invalid-feedback|text-danger)[^"]*"[^>]*>([\s\S]*?)<\/(?:span|div)>/gi,
    /<div[^>]*class="[^"]*alert-danger[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
  ];
  for (const re of patterns) {
    for (const [, inner] of html.matchAll(re)) {
      const text = decodeEntities(inner.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
      if (text) errors.add(text);
    }
  }
  return [...errors];
}
