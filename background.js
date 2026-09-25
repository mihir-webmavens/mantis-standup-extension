// Submits the standup to standup.webmavens.dev using the user's existing
// browser session. Runs in the service worker so the cross-origin request
// is covered by host_permissions (content scripts are bound by page CORS).

const STANDUP_ORIGIN = 'https://standup.webmavens.dev';
const CREATE_URL = `${STANDUP_ORIGIN}/admin/standups/create`;
const INDEX_PATH = '/admin/standups';

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'submitStandup') return;
  submitStandup(msg.payload).then(
    () => sendResponse({ ok: true }),
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
async function fetchCreateForm() {
  const res = await fetch(CREATE_URL, { credentials: 'include', redirect: 'manual' });
  if (res.type === 'opaqueredirect') {
    throw new Error('You are not logged into standup.webmavens.dev. Log in there, then try again.');
  }
  if (!res.ok) throw new Error(`Could not open the standup form (HTTP ${res.status}).`);
  return res;
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
