// Kinetic playground: a little fun while Mantis is in the Kinetic look (themes.js).
// Every few minutes a bug scuttles across the page (it dodges the cursor); click
// it to squash it. Clicks on empty page space throw sparks, and three secrets
// hide in the look: the Konami code, shaking the mouse, and typing "bugs".
// Off with Settings → Kinetic playground, with any other look, or when the
// system asks for reduced motion. It lives in its own shadow root on <html>, only
// the bugs take clicks, and it never reacts to keys typed into fields.
// Stats (squashed, fastest, best combo, secrets) are kept in chrome.storage.local.

(() => {
  const SETTING = 'playground';
  const STATS = 'playStats';
  const COLORS = ['#ff4d6d', '#ff9f1c', '#2ec4b6', '#8b5cf6', '#ffd23f'];
  const SECRETS = { konami: 'Konami code', shake: 'Shake it off', bugs: 'The magic word' };
  const KONAMI = ['arrowup', 'arrowup', 'arrowdown', 'arrowdown', 'arrowleft', 'arrowright', 'arrowleft', 'arrowright', 'b', 'a'];
  const MILESTONES = { 1: 'First bug squashed!', 10: '10 bugs: exterminator in training', 50: '50 bugs: QA legend', 100: '100 bugs: the tracker fears you' };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');

  let theme = null;
  let enabled = true;
  let host = null;
  let root = null;
  let toastEl = null;
  let toastTimer = null;
  let spawnTimer = null;
  let frame = 0;
  let lastFrame = 0;
  let lastTyped = 0;
  let lastMoved = Date.now();
  let lastSquash = 0;
  let combo = 0;
  const pointer = { x: -999, y: -999 };
  const bugs = new Set();
  let stats = { squashed: 0, fastest: null, combo: 0, secrets: [] };

  const active = () => theme === 'kinetic' && enabled && !reduced.matches;
  const rand = (a, b) => a + Math.random() * (b - a);

  const CSS = `
    :host { all: initial; display: block; position: fixed; inset: 0; z-index: 2147482000; pointer-events: none; contain: strict; }
    * { box-sizing: border-box; }
    .bug {
      position: absolute; left: 0; top: 0; width: 38px; height: 38px; margin: -19px 0 0 -19px; padding: 0; border: 0;
      background: none; cursor: pointer; pointer-events: auto; will-change: transform; -webkit-tap-highlight-color: transparent;
    }
    .bug svg { display: block; width: 100%; height: 100%; filter: drop-shadow(0 3px 3px rgb(0 0 0 / .25)); transition: transform .2s ease; }
    .bug:hover svg { transform: scale(1.15); }
    .bug.panic .legs path { animation-duration: .07s; }
    .legs path { transform-box: fill-box; transform-origin: center; animation: step .14s ease-in-out infinite alternate; }
    .legs .b { animation-direction: alternate-reverse; }
    @keyframes step { from { transform: rotate(-16deg); } to { transform: rotate(16deg); } }
    .splat { position: absolute; left: 0; top: 0; width: 56px; height: 56px; margin: -28px 0 0 -28px; animation: splat 1.6s cubic-bezier(.2, .9, .3, 1) forwards; }
    @keyframes splat { 0% { transform: var(--at) scale(.2); } 12% { transform: var(--at) scale(1.15); } 25% { transform: var(--at) scale(1); opacity: .9; } 100% { transform: var(--at) scale(1); opacity: 0; } }
    .p {
      position: absolute; left: 0; top: 0; width: 7px; height: 7px; border-radius: 2px; background: var(--c);
      transform: var(--at); animation: burst var(--t, .75s) cubic-bezier(.15, .7, .3, 1) forwards;
    }
    .p.round { border-radius: 50%; }
    @keyframes burst { to { transform: var(--at) translate(var(--dx), var(--dy)) rotate(var(--r)) scale(.15); opacity: 0; } }
    .c {
      position: absolute; top: -16px; left: var(--x); width: 8px; height: 13px; border-radius: 2px; background: var(--c);
      animation: fall var(--d) cubic-bezier(.3, .1, .6, 1) var(--delay) forwards;
    }
    @keyframes fall {
      25% { transform: translate(calc(var(--drift) * .5), 30vh) rotate(calc(var(--r) * .3)); }
      to { transform: translate(var(--drift), 110vh) rotate(var(--r)); }
    }
    .score {
      position: absolute; left: 0; top: 0; transform: var(--at); font: 800 15px/1 system-ui, sans-serif; white-space: nowrap;
      background: linear-gradient(110deg, #ff4d6d, #ff9f1c, #2ec4b6); -webkit-background-clip: text; background-clip: text; color: transparent;
      animation: score 1.1s cubic-bezier(.2, .9, .3, 1) forwards;
    }
    @keyframes score { 0% { opacity: 0; translate: -50% 0; scale: .5; } 20% { opacity: 1; scale: 1.2; } 100% { opacity: 0; translate: -50% -46px; scale: 1; } }
    .toast {
      position: absolute; left: 16px; bottom: 16px; display: flex; align-items: center; gap: 10px; max-width: min(360px, calc(100vw - 32px));
      padding: 10px 14px 10px 12px; border-radius: 14px; font: 600 13px/1.35 system-ui, sans-serif; color: #fff;
      background: rgb(23 26 38 / .92); backdrop-filter: blur(10px); box-shadow: 0 18px 40px -16px rgb(255 77 109 / .6), inset 0 0 0 1px rgb(255 255 255 / .08);
      opacity: 0; transform: translateY(20px) scale(.95); transition: opacity .3s ease, transform .45s cubic-bezier(.34, 1.56, .64, 1);
    }
    .toast.show { opacity: 1; transform: none; }
    .toast i { flex: none; width: 26px; height: 26px; display: grid; place-items: center; border-radius: 8px; font-style: normal;
      background: linear-gradient(135deg, #ff4d6d, #ff9f1c); }
  `;

  const BUG = `<svg viewBox="0 0 32 32" aria-hidden="true">
    <g class="legs" stroke="#1f2233" stroke-width="2" stroke-linecap="round">
      <path d="M10 11 L4 8"/><path class="b" d="M9 16 L3 16"/><path d="M10 21 L4 24"/>
      <path class="b" d="M22 11 L28 8"/><path d="M23 16 L29 16"/><path class="b" d="M22 21 L28 24"/>
    </g>
    <path d="M13.5 5 Q11.5 1.5 9 1.5 M18.5 5 Q20.5 1.5 23 1.5" stroke="#1f2233" stroke-width="1.6" fill="none" stroke-linecap="round"/>
    <circle cx="16" cy="8" r="4.6" fill="#1f2233"/>
    <ellipse cx="16" cy="18.5" rx="8.2" ry="10" fill="#ff4d6d"/>
    <ellipse cx="13" cy="14" rx="3" ry="4" fill="#fff" opacity=".28"/>
    <path d="M16 9 V28.4" stroke="#1f2233" stroke-width="1.4"/>
    <g fill="#1f2233"><circle cx="12.4" cy="16" r="1.8"/><circle cx="19.6" cy="16" r="1.8"/><circle cx="12" cy="22.4" r="1.6"/><circle cx="20" cy="22.4" r="1.6"/></g>
    <circle cx="14.2" cy="7" r="1" fill="#fff"/><circle cx="17.8" cy="7" r="1" fill="#fff"/>
  </svg>`;
  const SPLAT = `<svg viewBox="0 0 56 56" aria-hidden="true"><g fill="#ff4d6d">
    <path d="M28 14c5 0 6 5 10 5s8 3 6 8-1 7 1 10-3 7-8 5-6 3-10 3-7-4-11-3-7-3-5-8-2-6-3-10 3-7 8-6 7-4 12-4z" opacity=".9"/>
    <circle cx="9" cy="12" r="3"/><circle cx="47" cy="9" r="2.4"/><circle cx="50" cy="44" r="3.2"/><circle cx="7" cy="46" r="2.2"/><circle cx="30" cy="5" r="1.8"/>
  </g><g fill="#1f2233" opacity=".7"><circle cx="24" cy="26" r="2"/><circle cx="33" cy="30" r="1.6"/></g></svg>`;

  // ---------- overlay ----------

  function mount() {
    if (host?.isConnected) return;
    if (!host) {
      host = document.createElement('mantis-playground');
      root = host.attachShadow({ mode: 'open' });
      root.innerHTML = `<style>${CSS}</style><div class="toast" role="status" aria-live="polite"></div>`;
      toastEl = root.querySelector('.toast');
    }
    document.documentElement.append(host);
  }

  function unmount() {
    for (const bug of bugs) bug.el.remove();
    bugs.clear();
    host?.remove();
  }

  function add(el, ms) {
    root.append(el);
    setTimeout(() => el.remove(), ms);
    return el;
  }

  function burst(x, y, count, { spread = 90, round = false } = {}) {
    for (let i = 0; i < count; i++) {
      const a = (Math.PI * 2 * i) / count + rand(-.3, .3);
      const d = rand(spread * .45, spread);
      const p = document.createElement('span');
      p.className = round || i % 3 === 0 ? 'p round' : 'p';
      p.style.cssText = `--at: translate(${x}px, ${y}px); --dx: ${Math.cos(a) * d}px; --dy: ${Math.sin(a) * d}px; --r: ${rand(-360, 360)}deg; --c: ${COLORS[i % COLORS.length]}; --t: ${rand(.55, .9)}s`;
      add(p, 1000);
    }
  }

  function confetti(count = 90) {
    for (let i = 0; i < count; i++) {
      const c = document.createElement('span');
      c.className = 'c';
      c.style.cssText = `--x: ${rand(0, 100)}vw; --c: ${COLORS[i % COLORS.length]}; --d: ${rand(2.2, 3.8)}s; --delay: ${rand(0, .9)}s; --drift: ${rand(-120, 120)}px; --r: ${rand(-720, 720)}deg`;
      add(c, 5000);
    }
  }

  function float(x, y, text) {
    const s = document.createElement('span');
    s.className = 'score';
    s.style.setProperty('--at', `translate(${x}px, ${y - 24}px)`);
    s.textContent = text;
    add(s, 1200);
  }

  function toast(icon, text) {
    mount();
    toastEl.innerHTML = '';
    toastEl.append(Object.assign(document.createElement('i'), { textContent: icon }), text);
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3200);
  }

  // ---------- bugs ----------

  function spawnBug(delay = 0) {
    if (!active() || bugs.size >= 8) return;
    mount();
    const w = innerWidth;
    const h = innerHeight;
    const edge = Math.floor(rand(0, 4));
    const x = edge === 0 ? -30 : edge === 1 ? w + 30 : rand(40, w - 40);
    const y = edge === 2 ? -30 : edge === 3 ? h + 30 : rand(80, h - 40);
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'bug';
    el.setAttribute('aria-label', 'A bug! Click to squash it');
    el.innerHTML = BUG;
    const bug = {
      el, x, y, angle: Math.atan2(h / 2 - y, w / 2 - x), turn: 0, speed: rand(80, 120),
      born: performance.now() + delay, life: rand(14000, 20000), leaving: false,
    };
    el.style.transform = `translate(${x}px, ${y}px)`;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      squash(bug);
    });
    setTimeout(() => {
      if (!active()) return;
      root.append(el);
      bugs.add(bug);
      loop();
    }, delay);
  }

  function swarm(count = 3) {
    for (let i = 0; i < count; i++) spawnBug(i * 450);
  }

  function loop() {
    if (frame) return;
    lastFrame = performance.now();
    const tick = (now) => {
      const dt = Math.min(.05, (now - lastFrame) / 1000);
      lastFrame = now;
      const w = innerWidth;
      const h = innerHeight;
      for (const bug of bugs) {
        const age = now - bug.born;
        if (!bug.leaving && age > bug.life) bug.leaving = true;
        let speed = bug.speed;
        const dx = bug.x - pointer.x;
        const dy = bug.y - pointer.y;
        const near = Math.hypot(dx, dy) < 110;
        bug.el.classList.toggle('panic', near);
        if (near) {
          // Scared of the cursor: turn away and run.
          steer(bug, Math.atan2(dy, dx), 7 * dt);
          speed *= 2;
        } else if (bug.leaving) {
          const exits = [[-60, bug.y], [w + 60, bug.y], [bug.x, -60], [bug.x, h + 60]];
          const [ex, ey] = exits.sort((a, b) => Math.hypot(a[0] - bug.x, a[1] - bug.y) - Math.hypot(b[0] - bug.x, b[1] - bug.y))[0];
          steer(bug, Math.atan2(ey - bug.y, ex - bug.x), 3 * dt);
        } else {
          // Wander, and turn back in near the edges.
          bug.turn = Math.max(-2.2, Math.min(2.2, bug.turn + rand(-6, 6) * dt));
          bug.angle += bug.turn * dt;
          const m = 50;
          if (bug.x < m || bug.x > w - m || bug.y < 70 || bug.y > h - m) steer(bug, Math.atan2(h / 2 - bug.y, w / 2 - bug.x), 3 * dt);
        }
        bug.x += Math.cos(bug.angle) * speed * dt;
        bug.y += Math.sin(bug.angle) * speed * dt;
        bug.el.style.transform = `translate(${bug.x.toFixed(1)}px, ${bug.y.toFixed(1)}px) rotate(${(bug.angle + Math.PI / 2).toFixed(3)}rad)`;
        if (bug.leaving && (bug.x < -50 || bug.x > w + 50 || bug.y < -50 || bug.y > h + 50)) {
          bug.el.remove();
          bugs.delete(bug);
        }
      }
      frame = bugs.size ? requestAnimationFrame(tick) : 0;
    };
    frame = requestAnimationFrame(tick);
  }

  function steer(bug, target, amount) {
    const diff = Math.atan2(Math.sin(target - bug.angle), Math.cos(target - bug.angle));
    bug.angle += Math.max(-amount, Math.min(amount, diff));
  }

  function squash(bug) {
    if (!bugs.has(bug)) return;
    bugs.delete(bug);
    bug.el.remove();
    const now = performance.now();
    combo = now - lastSquash < 2500 ? combo + 1 : 1;
    lastSquash = now;
    const splat = document.createElement('div');
    splat.className = 'splat';
    splat.style.setProperty('--at', `translate(${bug.x}px, ${bug.y}px) rotate(${rand(0, 360)}deg)`);
    splat.innerHTML = SPLAT;
    add(splat, 1700);
    burst(bug.x, bug.y, 16);
    float(bug.x, bug.y, combo > 1 ? `Combo ×${combo}!` : '+1');
    record((s) => {
      s.squashed += 1;
      const ms = Math.max(0, Math.round(now - bug.born));
      if (s.fastest == null || ms < s.fastest) s.fastest = ms;
      if (combo > s.combo) s.combo = combo;
      const milestone = MILESTONES[s.squashed];
      if (milestone) toast('🐞', milestone);
      else if (combo === 3) toast('🔥', 'Triple squash!');
    });
  }

  // Next bug in a few minutes, only while you are around and not typing.
  function schedule(ms) {
    clearTimeout(spawnTimer);
    if (!active()) return;
    spawnTimer = setTimeout(() => {
      const now = Date.now();
      const busy = document.visibilityState !== 'visible' || now - lastTyped < 8000 || now - lastMoved > 180000
        || document.querySelector('dialog[open]');
      if (busy) return schedule(30000);
      if (Math.random() < .2) swarm(3);
      else spawnBug();
      schedule(rand(180000, 360000));
    }, ms);
  }

  // ---------- stats & secrets ----------

  function record(change) {
    change(stats);
    chrome.storage.local.set({ [STATS]: stats }).catch(() => {});
  }

  function secret(id, effect) {
    effect();
    record((s) => {
      if (s.secrets.includes(id)) return;
      s.secrets.push(id);
      toast('✨', `Secret found (${s.secrets.length}/${Object.keys(SECRETS).length}): ${SECRETS[id]}`);
    });
  }

  function jelly() {
    const html = document.documentElement;
    html.setAttribute('data-msq-fx', 'jelly');
    setTimeout(() => html.removeAttribute('data-msq-fx'), 160);
  }

  const editable = (el) => el?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
  let konami = 0;
  let typed = '';

  document.addEventListener('keydown', (e) => {
    const target = e.composedPath()[0];
    if (editable(target)) {
      lastTyped = Date.now();
      return;
    }
    if (!active() || e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.toLowerCase();
    konami = key === KONAMI[konami] ? konami + 1 : key === KONAMI[0] ? 1 : 0;
    if (konami === KONAMI.length) {
      konami = 0;
      secret('konami', () => { mount(); confetti(); });
    }
    typed = (typed + (key.length === 1 ? key : ' ')).slice(-8);
    if (typed.endsWith('bugs')) {
      typed = '';
      secret('bugs', () => swarm(5));
    }
  }, { capture: true, passive: true });

  // Shaking the mouse hard: six quick left/right turns.
  let dir = 0;
  let travel = 0;
  const turns = [];
  let shakeCooldown = 0;
  document.addEventListener('pointermove', (e) => {
    lastMoved = Date.now();
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    if (!active() || e.pointerType !== 'mouse') return;
    const d = Math.sign(e.movementX);
    if (!d) return;
    if (d === dir) {
      travel += Math.abs(e.movementX);
      return;
    }
    const now = e.timeStamp;
    if (travel > 30) turns.push(now);
    dir = d;
    travel = Math.abs(e.movementX);
    while (turns.length && now - turns[0] > 900) turns.shift();
    if (turns.length >= 6 && now > shakeCooldown) {
      turns.length = 0;
      shakeCooldown = now + 3000;
      secret('shake', jelly);
    }
  }, { capture: true, passive: true });

  // Sparks when clicking empty page space (never on anything you can use).
  document.addEventListener('pointerdown', (e) => {
    if (!active() || e.button !== 0) return;
    if (e.composedPath().some((el) => el === host || el?.matches?.('a, button, input, textarea, select, label, summary, [role], [tabindex], [contenteditable], [data-flux-card], table, dialog, header, mantis-quick-standup, mantis-ai, ui-dropdown'))) return;
    mount();
    burst(e.clientX, e.clientY, 10, { spread: 55, round: true });
  }, { capture: true, passive: true });

  // Test hook and the popup's "Release bugs": document.dispatchEvent(new CustomEvent('msq-play', { detail: 'swarm' })).
  document.addEventListener('msq-play', (e) => { if (active() && e.detail === 'swarm') swarm(3); });
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== 'play') return;
    if (!active()) return sendResponse({ ok: false, reason: theme === 'kinetic' ? 'off' : 'look' });
    swarm(msg.count || 3);
    sendResponse({ ok: true });
  });

  // ---------- settings ----------

  function update() {
    if (active()) {
      mount();
      if (!spawnTimer) schedule(rand(60000, 120000));
    } else {
      clearTimeout(spawnTimer);
      spawnTimer = null;
      unmount();
    }
  }

  chrome.storage.sync.get([MantisThemes.STORAGE_KEY, SETTING]).then((v) => {
    theme = v[MantisThemes.STORAGE_KEY] || null;
    enabled = v[SETTING] !== false;
    update();
  }, () => {});
  chrome.storage.local.get(STATS).then((v) => { stats = { ...stats, ...v[STATS] }; }, () => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && MantisThemes.STORAGE_KEY in changes) theme = changes[MantisThemes.STORAGE_KEY].newValue || null;
    if (area === 'sync' && SETTING in changes) enabled = changes[SETTING].newValue !== false;
    if (area === 'local' && STATS in changes) stats = { ...stats, ...changes[STATS].newValue };
    if (area === 'sync') update();
  });
  reduced.addEventListener('change', update);
})();
