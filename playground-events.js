// Random events for the Kinetic playground (playground.js): short, rare surprises
// in four tiers (common 70%, uncommon 20%, rare 8%, legendary 2%). An event is
// "discovered" the first time it plays; Settings counts them and names only the
// ones found, never the whole list. Some can be clicked for a secret.
// The popup loads this file too, only for the names (SECRETS, LIST).

const MantisPlayEvents = (() => {
  const TIERS = { common: 70, uncommon: 20, rare: 8, legendary: 2 };
  const SECRETS = {
    konami: 'Konami code', shake: 'Shake it off', bugs: 'The magic word', walker: 'Said hi to the mantis',
    ufo: 'Close encounter', golden: 'Golden bug', butterfly: 'Caught a butterfly', star: 'Wished on a star',
    leaf: 'Golden leaf', box: 'Opened the mystery box', door: 'The tiny door', mystery: '???',
  };
  // id: [tier, name]. A null tier is never picked at random; it has its own trigger.
  const LIST = {
    wave: ['common', 'Mantis says hi'],
    curious: ['common', 'A curious mantis'],
    butterflies: ['common', 'Butterflies'],
    cloud: ['common', 'A passing cloud'],
    leaves: ['common', 'Falling leaves'],
    fireflies: ['common', 'Fireflies'],
    dance: ['uncommon', 'Dance break'],
    runner: ['uncommon', 'Ticket delivery'],
    trip: ['uncommon', 'Oops'],
    coffee: ['uncommon', 'Coffee break'],
    shades: ['uncommon', 'Too cool'],
    detective: ['uncommon', 'Mantis detective'],
    rain: ['uncommon', 'A little rain'],
    rainbow: ['uncommon', 'Rainbow'],
    glow: ['uncommon', 'Golden hour'],
    star: ['uncommon', 'Shooting star'],
    clones: ['rare', 'Mantis clones'],
    ufo: ['rare', 'UFO flyby'],
    abduct: ['rare', 'Abducted!'],
    portal: ['rare', 'Portal hop'],
    alien: ['rare', 'Alien visit'],
    robots: ['rare', 'Robot parade'],
    dino: ['rare', 'Tiny dinosaur'],
    meteor: ['rare', 'Meteor strike'],
    snow: ['rare', 'Snowfall'],
    ninja: ['rare', 'Ninja mantis'],
    magician: ['rare', 'The magician'],
    box: ['rare', 'Mystery box'],
    roll: ['legendary', 'Barrel roll'],
    flip: ['legendary', 'Upside down'],
    update: ['legendary', 'System update'],
    saw: ['legendary', 'I saw that'],
    ghost: ['legendary', 'Ghost mantis'],
    door: ['legendary', 'A tiny door'],
    mystery: ['legendary', '???'],
    tiny: ['legendary', 'Tiny traveller'],
    sleep: [null, 'Nap time'],
    party: [null, 'Celebration'],
  };
  const NIGHT_ONLY = ['fireflies', 'ghost'];
  const HELLO = ['Hi!', 'Just passing through', 'Ship it!', 'Any bugs here?', 'Standup done?', 'Nice work today'];

  const CSS = `
    .actor {
      position: absolute; left: 0; bottom: 2px; width: 64px; height: 56px; padding: 0; border: 0; background: none;
      pointer-events: none; will-change: transform; -webkit-tap-highlight-color: transparent;
    }
    button.actor, .hit { pointer-events: auto; cursor: pointer; }
    .actor.done, .hit.done { pointer-events: none; }
    .actor.top { bottom: auto; top: 0; }
    .fig { display: block; width: 100%; height: 100%; transform: scaleX(var(--flip, 1)) scale(var(--s, 1)); transform-origin: 50% 100%; }
    .top .fig { transform-origin: 50% 0; }
    .fig svg { display: block; width: 100%; height: 100%; filter: drop-shadow(0 3px 2px rgb(0 0 0 / .2)); }
    .emo { display: grid; place-items: end center; height: 100%; font: 38px/1 system-ui, sans-serif; }
    .march .emo { animation: bob .3s ease-in-out infinite alternate; }
    .actor .body { animation: bob .36s ease-in-out infinite alternate; }
    .actor .legs path { animation-duration: .18s; }
    .actor.fast .legs path { animation-duration: .08s; }
    .actor.rest .body, .actor.rest .legs path { animation-play-state: paused; }
    .actor.rest .arm { animation: wave .3s ease-in-out 4 alternate; }
    .arm { transform-box: fill-box; transform-origin: 0% 100%; }
    .steam { animation: steam 1.2s ease-in-out infinite; }
    .ninja .body > [fill="#69db7c"] { fill: #343a40; }
    .ghost { opacity: .5; }
    .ghost .fig { filter: grayscale(1) brightness(1.7); animation: haunt 1.6s ease-in-out infinite alternate; }
    @keyframes bob { to { transform: translateY(-2px); } }
    @keyframes wave { to { transform: rotate(-35deg); } }
    @keyframes steam { 50% { opacity: .2; transform: translateY(-2px); } }
    @keyframes haunt { to { translate: 0 -10px; } }
    .say {
      position: absolute; bottom: 58px; left: 50%; translate: -50% 0; padding: 5px 9px; border-radius: 10px; white-space: nowrap;
      font: 700 12px/1.2 system-ui, sans-serif; color: #1f2233; background: #fff; box-shadow: 0 6px 18px -6px rgb(0 0 0 / .35);
      opacity: 0; scale: .6; transition: opacity .2s ease, scale .3s cubic-bezier(.34, 1.56, .64, 1);
    }
    .top .say { bottom: auto; top: 30px; }
    .say.show { opacity: 1; scale: 1; }
    .zz { position: absolute; left: 44px; bottom: 40px; font: 800 13px/1 system-ui, sans-serif; color: #5c7cfa; animation: zz 2.4s ease-out infinite; }
    .zz:nth-of-type(2) { animation-delay: .8s; } .zz:nth-of-type(3) { animation-delay: 1.6s; }
    @keyframes zz { from { opacity: 0; transform: translate(0, 0) scale(.6); } 30% { opacity: 1; } to { opacity: 0; transform: translate(14px, -30px) scale(1.3); } }
    .sleep .fig { rotate: -8deg; }

    .ufo {
      position: absolute; left: 0; top: 0; width: 84px; height: 48px; padding: 0; border: 0; background: none;
      cursor: pointer; pointer-events: auto; will-change: transform; -webkit-tap-highlight-color: transparent;
    }
    .ufo svg { position: relative; display: block; width: 100%; height: 100%; animation: hover 1.4s ease-in-out infinite alternate; filter: drop-shadow(0 8px 10px rgb(0 0 0 / .25)); }
    .ufo .lights circle { animation: blink .6s steps(1) infinite; }
    .ufo .lights circle:nth-child(2) { animation-delay: .2s; }
    .ufo .lights circle:nth-child(3) { animation-delay: .4s; }
    @keyframes hover { from { transform: translateY(-4px) rotate(-4deg); } to { transform: translateY(4px) rotate(4deg); } }
    @keyframes blink { 50% { fill: #fff; } }
    .beam {
      position: absolute; left: 50%; top: 40px; width: 110px; height: 0; translate: -50% 0; pointer-events: none;
      background: linear-gradient(rgb(170 255 200 / .55), rgb(170 255 200 / 0)); clip-path: polygon(38% 0, 62% 0, 100% 100%, 0 100%);
      transition: height .5s cubic-bezier(.2, .9, .3, 1);
    }
    .ufo.beaming .beam { height: 220px; }

    .flake, .drop, .leaf {
      position: absolute; top: -24px; left: var(--x); pointer-events: none; line-height: 1;
      animation: sway var(--d) linear var(--delay) forwards;
    }
    .drop { width: 1.5px; height: 18px; border-radius: 1px; background: linear-gradient(rgb(116 192 252 / 0), rgb(116 192 252 / .75)); animation-name: rain; }
    .flake { font-size: var(--z, 12px); color: #d0ebff; text-shadow: 0 0 4px rgb(0 0 0 / .15); }
    .leaf { font-size: 20px; }
    .leaf.hit { filter: sepia(1) saturate(4) hue-rotate(5deg) drop-shadow(0 0 6px #ffd23f); font-size: 24px; }
    @keyframes rain { to { transform: translate(-40px, 112vh); } }
    @keyframes sway {
      25% { transform: translate(var(--drift), 28vh) rotate(calc(var(--r) * .3)); }
      50% { transform: translate(calc(var(--drift) * -1), 56vh) rotate(calc(var(--r) * .6)); }
      75% { transform: translate(var(--drift), 84vh) rotate(calc(var(--r) * .8)); }
      to { transform: translate(0, 112vh) rotate(var(--r)); }
    }
    .firefly {
      position: absolute; left: var(--x); top: var(--y); width: 6px; height: 6px; border-radius: 50%; pointer-events: none;
      background: #fff9c4; box-shadow: 0 0 10px 4px rgb(255 236 120 / .7);
      animation: drift var(--d) ease-in-out forwards, glow 1.3s ease-in-out infinite alternate;
    }
    @keyframes drift { 0% { opacity: 0; } 15%, 85% { opacity: 1; } to { opacity: 0; transform: translate(var(--dx), var(--dy)); } }
    @keyframes glow { from { scale: .6; filter: brightness(.7); } }
    .butterfly { position: absolute; left: 0; top: 0; padding: 4px; border: 0; background: none; font: 24px/1 system-ui, sans-serif; will-change: transform; }
    .butterfly span { display: block; animation: flap .22s ease-in-out infinite alternate; }
    @keyframes flap { to { transform: scaleX(.55); } }
    .cloud { position: absolute; left: 0; top: 70px; width: 170px; pointer-events: none; opacity: .75; filter: drop-shadow(0 10px 14px rgb(0 0 0 / .12)); }
    .rainbow {
      position: absolute; right: 6vw; top: 60px; width: 300px; height: 150px; pointer-events: none; border-radius: 300px 300px 0 0;
      background: radial-gradient(circle at 50% 100%, transparent 52%, #8b5cf6 52% 57%, #339af0 57% 62%, #51cf66 62% 67%, #ffd23f 67% 72%, #ff9f1c 72% 77%, #ff4d6d 77% 82%, transparent 82%);
      opacity: 0; filter: blur(1px); animation: fadeio 6s ease-in-out forwards;
    }
    .tint {
      position: absolute; inset: 0; pointer-events: none; mix-blend-mode: soft-light; opacity: 0;
      background: linear-gradient(180deg, #ff9f1c, #ff4d6d 60%, #8b5cf6); animation: fadeio 7s ease-in-out forwards;
    }
    @keyframes fadeio { 20%, 75% { opacity: .85; } }
    .shoot {
      position: absolute; left: 0; top: 0; width: 120px; height: 20px; padding: 0; border: 0; will-change: transform;
      background: linear-gradient(90deg, rgb(255 255 255 / 0), rgb(255 236 150 / .9)); border-radius: 10px; clip-path: polygon(0 45%, 100% 0, 100% 100%, 0 55%);
    }
    .shoot::after { content: ""; position: absolute; right: -3px; top: 3px; width: 14px; height: 14px; border-radius: 50%; background: #fff; box-shadow: 0 0 14px 6px #ffd23f; }
    .meteor { position: absolute; left: 0; top: 0; font: 30px/1 system-ui, sans-serif; filter: drop-shadow(0 0 10px #ff9f1c); pointer-events: none; }
    .crater { position: absolute; bottom: 0; width: 60px; height: 14px; margin-left: -30px; border-radius: 50%; pointer-events: none;
      background: radial-gradient(#495057, #868e96 60%, transparent 70%); animation: fadeio 10s ease-in forwards; opacity: .85; }
    .portal {
      position: absolute; bottom: 0; width: 70px; height: 90px; margin-left: -35px; border-radius: 50%; pointer-events: none;
      background: radial-gradient(#fff, #b197fc 30%, #7048e8 60%, transparent 70%); box-shadow: 0 0 30px #845ef7;
      animation: portal 2.6s ease-in-out forwards;
    }
    @keyframes portal { 0% { scale: 0; } 20%, 80% { scale: 1; } 100% { scale: 0; } }
    .pop { position: absolute; bottom: 0; width: 60px; height: 64px; margin-left: -30px; pointer-events: none; animation: peek 4s cubic-bezier(.3, 1.4, .5, 1) forwards; }
    @keyframes peek { 0% { transform: translateY(70px); } 15%, 85% { transform: none; } 100% { transform: translateY(70px); } }
    .pop .say { bottom: 66px; }
    .rise { position: absolute; left: 0; top: 0; transform: var(--at); font: 30px/1 system-ui, sans-serif; animation: riseup 1.8s cubic-bezier(.2, .9, .3, 1) forwards; }
    @keyframes riseup { 0% { opacity: 0; translate: -50% 10px; scale: .4; } 20% { opacity: 1; scale: 1.2; } 100% { opacity: 0; translate: -50% -70px; scale: 1; } }
    .thing {
      position: absolute; left: var(--x); top: var(--y); padding: 6px 10px; border: 0; border-radius: 12px; background: none;
      font: 900 28px/1 system-ui, sans-serif; animation: thing 1.6s ease-in-out infinite alternate, fadeio2 var(--d) ease-in-out forwards;
    }
    .thing.q { font-size: 18px; color: #fff; background: #1f2233; letter-spacing: 2px; animation-name: glitch, fadeio2; animation-duration: .5s, var(--d); animation-timing-function: steps(2), ease-in-out; }
    @keyframes thing { to { transform: translateY(-6px) rotate(4deg); } }
    @keyframes glitch { 50% { transform: translate(2px, -1px) skewX(-8deg); } }
    @keyframes fadeio2 { 0% { opacity: 0; scale: .3; } 10%, 90% { opacity: 1; scale: 1; } 100% { opacity: 0; scale: .8; } }
    .card {
      position: absolute; left: 50%; top: 30%; translate: -50% 0; width: min(320px, calc(100vw - 32px)); padding: 16px 18px; border-radius: 16px;
      font: 600 14px/1.4 system-ui, sans-serif; color: #fff; background: rgb(23 26 38 / .94); box-shadow: 0 30px 60px -20px rgb(0 0 0 / .6);
      animation: fadeio2 5s ease-in-out forwards;
    }
    .card .bar { height: 6px; margin-top: 10px; border-radius: 3px; background: rgb(255 255 255 / .15); overflow: hidden; }
    .card .bar i { display: block; height: 100%; width: 0; background: linear-gradient(90deg, #2ec4b6, #8b5cf6); animation: fill 3s ease-in-out forwards; }
    @keyframes fill { 60% { width: 83%; } 80% { width: 84%; } to { width: 100%; } }
    .eyes {
      position: absolute; bottom: -8px; display: flex; gap: 6px; padding: 12px 14px 20px; border-radius: 40px 40px 0 0; background: #69db7c;
      pointer-events: none; animation: peek 4s cubic-bezier(.3, 1.4, .5, 1) forwards;
    }
    .eyes i { position: relative; width: 26px; height: 26px; border-radius: 50%; background: #fff; box-shadow: inset 0 -3px 0 rgb(0 0 0 / .08); }
    .eyes i::after { content: ""; position: absolute; left: 50%; top: 50%; width: 11px; height: 11px; margin: -5.5px; border-radius: 50%; background: #1f2233; transform: translate(var(--px, 0), var(--py, 0)); transition: transform .15s ease; }
    .eyes .say { bottom: 70px; }
  `;

  const ACC = {
    shades: '<rect x="46.5" y="9" width="10" height="4.6" rx="2" fill="#1f2233"/><path d="M42 10 H47" stroke="#1f2233" stroke-width="1.2"/>',
    coffee: `<path d="M49 27 H57 L56 35 H50 Z" fill="#fff" stroke="#1f2233" stroke-width="1"/><path d="M57 29 Q60 30 56.5 33" stroke="#1f2233" stroke-width="1" fill="none"/>
      <path class="steam" d="M51.5 25 Q53 23 51.5 21 M54.5 25 Q56 23 54.5 21" stroke="#adb5bd" stroke-width="1" fill="none"/>`,
    ticket: `<g transform="rotate(-12 55 22)"><rect x="48" y="16" width="14" height="10" rx="1.5" fill="#fff" stroke="#1f2233" stroke-width="1"/>
      <path d="M50.5 19.5 H59 M50.5 22.5 H56" stroke="#8b5cf6" stroke-width="1.4" stroke-linecap="round"/></g>`,
    band: '<g stroke="#e03131" stroke-linecap="round"><path d="M45 9.5 L55.5 12.5" stroke-width="2.6"/><path d="M45 9.5 L39 7 M45 9.5 L38.5 11.5" stroke-width="1.6"/></g>',
    lens: '<circle cx="57" cy="29" r="4.2" fill="rgb(165 243 252 / .55)" stroke="#1f2233" stroke-width="1.5"/><path d="M53.8 32 L50.5 35.5" stroke="#1f2233" stroke-width="2" stroke-linecap="round"/>',
    hat: '<path d="M46 9.5 L50.5 1 L55 10 Z" fill="#ff4d6d" stroke="#1f2233" stroke-width=".8"/><circle cx="50.5" cy="1.5" r="1.4" fill="#ffd23f"/>',
    tophat: '<rect x="45" y="7.5" width="12" height="2" rx="1" fill="#1f2233"/><rect x="47" y=".5" width="8" height="7.5" rx="1" fill="#1f2233"/><rect x="47" y="5.5" width="8" height="1.6" fill="#e03131"/>',
  };
  // Faces right; .fig flips it with --flip to walk left.
  const MANTIS = (acc = '') => `<svg viewBox="0 0 64 56" aria-hidden="true">
    <g class="legs" stroke="#2f9e44" stroke-width="2.4" stroke-linecap="round" fill="none">
      <path d="M22 36 L16 54"/><path class="b" d="M27 37 L26 54"/><path d="M33 36 L38 54"/><path class="b" d="M38 35 L46 54"/>
    </g>
    <g class="body">
      <path d="M8 34 Q18 26 34 32 L40 34 Q30 40 14 38 Z" fill="#69db7c"/>
      <path d="M12 34 Q20 31 32 33" stroke="#2f9e44" stroke-width="1.2" fill="none"/>
      <path d="M38 34 Q42 22 46 16" stroke="#51cf66" stroke-width="5" stroke-linecap="round" fill="none"/>
      <path class="arm" d="M44 22 L54 26 L50 32" stroke="#40c057" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      <path d="M44 8 L56 12 L48 20 Z" fill="#69db7c" stroke="#2f9e44" stroke-width="1" stroke-linejoin="round"/>
      <circle cx="52" cy="11.5" r="3" fill="#1f2233"/><circle cx="53" cy="10.5" r="1" fill="#fff"/>
      <path d="M50 8 Q54 1 60 2 M48 8 Q50 1 55 1" stroke="#2f9e44" stroke-width="1.2" fill="none" stroke-linecap="round"/>
      ${ACC[acc] || ''}
    </g>
  </svg>`;
  const UFO = `<svg viewBox="0 0 84 48" aria-hidden="true">
    <ellipse cx="42" cy="20" rx="15" ry="13" fill="#a5f3fc" opacity=".85"/>
    <circle cx="42" cy="18" r="6" fill="#69db7c"/><circle cx="40" cy="17" r="1.6" fill="#1f2233"/><circle cx="44.5" cy="17" r="1.6" fill="#1f2233"/>
    <ellipse cx="42" cy="28" rx="38" ry="10" fill="#8b5cf6"/>
    <ellipse cx="42" cy="25" rx="30" ry="5" fill="#b197fc"/>
    <g class="lights" fill="#ffd23f"><circle cx="20" cy="30" r="2.4"/><circle cx="42" cy="33" r="2.4"/><circle cx="64" cy="30" r="2.4"/></g>
  </svg>`;
  const CLOUD = `<svg viewBox="0 0 170 80" aria-hidden="true"><path fill="#fff" d="M30 70 Q2 70 6 50 Q10 32 32 36 Q36 12 62 14 Q84 0 104 18 Q128 10 136 34 Q166 34 164 54 Q162 70 140 70 Z"/></svg>`;

  // kit (from playground.js): layer, mount, add, burst, confetti, toast, secret, bugs, pointer, spawnBug.
  function create(kit) {
    const rand = (a, b) => a + Math.random() * (b - a);
    const pick = (list) => list[Math.floor(Math.random() * list.length)];
    const layer = () => { kit.mount(); return kit.layer(); };
    const later = (ms, el, fn) => setTimeout(() => { if (el.isConnected) fn(); }, ms);
    const center = (el) => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
    const night = () => { const h = new Date().getHours(); return h >= 19 || h < 6; };
    let sleeper = null;
    let watcher = null;

    function tap(el, fn) {
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        el.classList.add('done');
        fn();
      }, { once: true });
    }

    function make(tag, className, html = '', style = '') {
      const el = document.createElement(tag);
      if (tag === 'button') el.type = 'button';
      el.className = className;
      el.innerHTML = html;
      if (style) el.style.cssText = style;
      return el;
    }

    function speak(el, text, ms = 2200) {
      const say = el.querySelector('.say');
      if (!say) return;
      say.textContent = text;
      say.classList.add('show');
      clearTimeout(say.timer);
      say.timer = setTimeout(() => say.classList.remove('show'), ms);
    }

    function rise(x, y, text) {
      const el = make('span', 'rise', '', `--at: translate(${x}px, ${y}px)`);
      el.textContent = text;
      kit.add(el, 1900);
    }

    // A mantis to walk about; clicking one is the "walker" secret.
    function mantis(acc, cls = '') {
      const el = make('button', `actor mantis ${cls}`, `<span class="fig">${MANTIS(acc)}</span><span class="say"></span>`);
      el.setAttribute('aria-label', 'A mantis. Click to say hi');
      tap(el, () => {
        const [x, y] = center(el);
        kit.burst(x, y, 18);
        el.querySelector('.fig').animate([{ translate: '0 0' }, { translate: '0 -26px' }, { translate: '0 0' }], { duration: 450, easing: 'cubic-bezier(.3, 1.6, .6, 1)' });
        speak(el, 'You found me!');
        kit.secret('walker');
      });
      return el;
    }

    function sprite(emoji, { face = 'right', cls = '' } = {}) {
      const el = make('div', `actor ${cls}`, `<span class="fig"><span class="emo">${emoji}</span></span><span class="say"></span>`);
      el.dataset.face = face;
      return el;
    }

    // Walks an actor across the bottom (or top) of the screen, optionally stopping once.
    function cross(el, { speed = 75, pause = 0, stop, from, ltr = Math.random() < .5, delay = 0, onPause } = {}) {
      const w = innerWidth;
      const size = 64;
      const start = from ?? (ltr ? -size - 10 : w + 10);
      const end = ltr ? w + 10 : -size - 10;
      let mid = stop ?? start + (end - start) * rand(.3, .6);
      mid = Math.max(8, Math.min(w - size - 8, mid));
      if (ltr ? mid < start : mid > start) mid = start;
      el.style.setProperty('--flip', (ltr ? 1 : -1) * (el.dataset.face === 'left' ? -1 : 1));
      const at = (x) => ({ transform: `translateX(${Math.round(x)}px)` });
      const t1 = pause ? (Math.abs(mid - start) / speed) * 1000 : 0;
      const t2 = ((pause ? Math.abs(end - mid) : Math.abs(end - start)) / speed) * 1000;
      const total = t1 + pause + t2;
      const frames = pause
        ? [at(start), { ...at(mid), offset: t1 / total }, { ...at(mid), offset: (t1 + pause) / total }, at(end)]
        : [at(start), at(end)];
      el.style.transform = at(start).transform;
      layer().append(el);
      const anim = el.animate(frames, { duration: total, delay, easing: 'linear' });
      anim.finished.then(() => el.remove(), () => el.remove());
      if (pause) {
        later(delay + t1, el, () => { el.classList.add('rest'); onPause?.(el, mid); });
        later(delay + t1 + pause, el, () => el.classList.remove('rest'));
      }
      return { anim, mid, ltr };
    }

    function stroll({ acc, cls, say, pause = say ? 2400 : 0, speed = 75, ...rest } = {}) {
      const el = mantis(acc, cls);
      const walk = cross(el, { pause, speed, ...rest, onPause: (e, x) => { if (say) speak(e, say); rest.onPause?.(e, x); } });
      return { el, ...walk };
    }

    function fall(className, count, { html = () => '', seconds = [4, 7], spread = 1.5, style = () => '' } = {}) {
      for (let i = 0; i < count; i++) {
        const d = rand(...seconds);
        const delay = rand(0, spread);
        kit.add(make('span', className, html(i), `--x: ${rand(0, 100)}vw; --d: ${d}s; --delay: ${delay}s; --drift: ${rand(-40, 40)}px; --r: ${rand(-360, 360)}deg; ${style(i)}`), (d + delay) * 1000 + 200);
      }
    }

    function saucer() {
      const el = make('button', 'ufo', `<span class="beam"></span>${UFO}`);
      el.setAttribute('aria-label', 'A UFO! Click it');
      tap(el, () => {
        const [x, y] = center(el);
        kit.burst(x, y, 20, { spread: 110, round: true });
        el.getAnimations().forEach((a) => { a.playbackRate = 4; }); // startled, it zooms off
        kit.secret('ufo');
      });
      return el;
    }

    // The nearest bug on screen floats up into the UFO.
    function abductBug(x, y) {
      let target = null;
      for (const bug of kit.bugs) if (!target || Math.abs(bug.x - x) < Math.abs(target.x - x)) target = bug;
      if (!target) return;
      kit.bugs.delete(target);
      target.el.style.pointerEvents = 'none';
      target.el.animate([
        { transform: target.el.style.transform, opacity: 1 },
        { transform: `translate(${x}px, ${y}px) rotate(720deg) scale(.2)`, opacity: 0 },
      ], { duration: 1400, easing: 'cubic-bezier(.5, 0, .7, 1)', fill: 'forwards' }).finished.then(() => target.el.remove(), () => target.el.remove());
    }

    function rainbow() {
      kit.add(make('div', 'rainbow'), 6100);
    }

    function party() {
      kit.confetti(70);
      if (Math.random() < .15) rainbow();
      kit.toast('🎉', pick(['Nice one!', 'Done and dusted!', 'Another one shipped!', 'Look at you go!']));
    }

    // Spins or flips the whole page around the middle of the screen.
    function turn(frames, duration) {
      if (!document.body) return;
      const origin = `50% ${Math.round(scrollY + innerHeight / 2)}px`;
      document.body.animate(frames.map((f) => ({ ...f, transformOrigin: origin })), { duration, easing: 'cubic-bezier(.65, 0, .35, 1)' });
    }

    function thing(text, cls, seconds, onTap) {
      const el = make('button', `thing hit ${cls}`, '', `--x: ${rand(8, 85)}vw; --y: ${rand(20, 75)}vh; --d: ${seconds}s`);
      el.textContent = text;
      el.setAttribute('aria-label', 'Something odd. Click it');
      tap(el, () => {
        const [x, y] = center(el);
        el.remove();
        kit.burst(x, y, 22, { spread: 120 });
        onTap(x, y);
      });
      kit.add(el, seconds * 1000);
    }

    const RUN = {
      wave: () => stroll({ say: pick(HELLO), pause: 2600 }),
      curious: () => {
        const x = kit.pointer.x > 0 ? kit.pointer.x - 32 : undefined;
        stroll({ stop: x, say: '?', pause: 2400, speed: 90 });
      },
      coffee: () => stroll({ acc: 'coffee', say: 'Coffee break ☕', speed: 55 }),
      shades: () => stroll({ acc: 'shades', say: 'Too cool 😎', speed: 85 }),
      detective: () => stroll({ acc: 'lens', say: 'Hmm… a clue!', speed: 45 }),
      runner: () => {
        const { el } = stroll({ acc: 'ticket', cls: 'fast', speed: 260 });
        speak(el, 'Urgent ticket!', 1800);
      },
      trip: () => stroll({
        pause: 2400,
        onPause: (el) => {
          const fig = el.querySelector('.fig');
          fig.animate([{ rotate: '0deg' }, { rotate: '75deg', offset: .25 }, { rotate: '75deg', offset: .7 }, { rotate: '0deg' }], { duration: 1500, easing: 'ease-in-out' });
          speak(el, '*oof*', 1200);
          later(1500, el, () => speak(el, "I'm fine!", 900));
        },
      }),
      dance: () => stroll({
        acc: 'hat', pause: 3200,
        onPause: (el, x) => {
          el.querySelector('.fig').animate([
            { rotate: '0deg', translate: '0 0' }, { rotate: '-14deg', translate: '0 -10px' }, { rotate: '0deg', translate: '0 0' },
            { rotate: '14deg', translate: '0 -10px' }, { rotate: '0deg', translate: '0 0' },
          ], { duration: 700, iterations: 4 });
          for (let i = 0; i < 4; i++) setTimeout(() => rise(x + 32 + rand(-20, 20), innerHeight - 70, pick(['♪', '♫'])), i * 650);
        },
      }),
      clones: () => {
        const ltr = Math.random() < .5;
        for (let i = 0; i < 3; i++) {
          const el = mantis('');
          el.style.setProperty('--s', .55);
          cross(el, { ltr, speed: 120, delay: i * 350 });
        }
      },
      tiny: () => {
        const el = mantis('', 'top');
        el.style.setProperty('--s', .45);
        cross(el, { speed: 55 });
      },
      ghost: () => {
        const { el } = stroll({ cls: 'ghost', speed: 40, say: 'Boo…', pause: 2200 });
        el.setAttribute('aria-label', 'A ghost mantis. Click it');
      },
      ninja: () => stroll({
        acc: 'band', cls: 'ninja', speed: 110, pause: 1400, say: 'Hi-ya!',
        onPause: (el) => later(700, el, () => {
          const [x, y] = center(el);
          kit.burst(x, y, 24, { spread: 60, round: true });
          el.remove();
        }),
      }),
      magician: () => stroll({
        acc: 'tophat', pause: 3200,
        onPause: (el, x) => {
          later(600, el, () => { speak(el, 'Ta-da!', 1800); rise(x + 44, innerHeight - 80, pick(['🐇', '🌸', '🕊️', '💐'])); });
        },
      }),
      sleep: () => {
        if (sleeper) return;
        const el = mantis('', 'sleep rest');
        el.insertAdjacentHTML('beforeend', '<span class="zz">z</span><span class="zz">z</span><span class="zz">Z</span>');
        el.style.setProperty('--flip', 1);
        el.style.transform = 'translateX(16px)';
        layer().append(el);
        sleeper = el;
      },
      abduct: () => stroll({
        pause: 5600, speed: 70,
        onPause: (el, x) => {
          const y = innerHeight - 250;
          const ufo = saucer();
          const ltr = Math.random() < .5;
          const off = ltr ? -100 : innerWidth + 20;
          const pos = (px) => ({ transform: `translate(${Math.round(px)}px, ${y}px)` });
          layer().append(ufo);
          ufo.animate([pos(off), { ...pos(x - 10), offset: .22 }, { ...pos(x - 10), offset: .78 }, pos(innerWidth - off - 80)], { duration: 5400, easing: 'ease-in-out' })
            .finished.then(() => ufo.remove(), () => ufo.remove());
          const fig = el.querySelector('.fig');
          later(1200, el, () => ufo.classList.add('beaming'));
          later(1500, el, () => fig.animate([{ translate: '0 0', opacity: 1 }, { translate: '0 -170px', scale: .3, opacity: 0 }], { duration: 900, easing: 'ease-in', fill: 'forwards' }));
          later(3200, el, () => fig.animate([{ translate: '0 -170px', scale: .3, opacity: 0 }, { translate: '0 0', scale: 1, opacity: 1 }], { duration: 800, easing: 'cubic-bezier(.3, 1.4, .5, 1)', fill: 'forwards' }));
          later(4200, el, () => { ufo.classList.remove('beaming'); speak(el, '…what just happened?', 1800); });
        },
      }),
      portal: () => {
        const ltr = Math.random() < .5;
        const w = innerWidth;
        const a = ltr ? rand(.25, .4) * w : rand(.6, .75) * w;
        const b = ltr ? rand(.7, .85) * w : rand(.15, .3) * w;
        stroll({
          ltr, stop: a - 32, pause: 900, speed: 90,
          onPause: (el) => {
            kit.add(make('div', 'portal', '', `left: ${a}px`), 2700);
            later(500, el, () => {
              el.querySelector('.fig').animate([{ scale: 1, opacity: 1 }, { scale: .1, opacity: 0 }], { duration: 350, fill: 'forwards' });
              setTimeout(() => {
                el.remove();
                kit.add(make('div', 'portal', '', `left: ${b}px`), 2700);
                setTimeout(() => {
                  const out = stroll({ ltr, from: b - 32, speed: 90 });
                  speak(out.el, 'Shortcut!', 1600);
                }, 600);
              }, 400);
            });
          },
        });
      },
      alien: () => {
        const el = make('div', 'pop', '<span class="emo">👽</span><span class="say"></span>', `left: ${rand(10, 90)}vw`);
        kit.add(el, 4100);
        setTimeout(() => speak(el, pick(['Greetings, human!', 'Take me to your standup', '👋']), 2200), 700);
      },
      robots: () => {
        const ltr = Math.random() < .5;
        for (let i = 0; i < 4; i++) cross(sprite('🤖', { cls: 'march' }), { ltr, speed: 55, delay: i * 800 });
      },
      dino: () => {
        const el = sprite('🦖', { face: 'left', cls: 'march' });
        cross(el, { speed: 95, pause: 1600, onPause: () => speak(el, 'Rawr!', 1300) });
      },
      ufo: () => {
        if (layer().querySelector('.ufo')) return;
        const w = innerWidth;
        const ltr = Math.random() < .5;
        const y = rand(90, Math.max(100, Math.min(200, innerHeight / 3)));
        const from = ltr ? -100 : w + 20;
        const to = ltr ? w + 20 : -100;
        const stop = from + (to - from) * rand(.35, .65);
        const fly = (a, b) => (Math.abs(b - a) / 260) * 1000;
        const pause = 2200;
        const first = fly(from, stop);
        const total = first + pause + fly(stop, to);
        const el = saucer();
        layer().append(el);
        el.animate([
          { transform: `translate(${from}px, ${y}px)` },
          { transform: `translate(${stop}px, ${y}px)`, offset: first / total, easing: 'ease-out' },
          { transform: `translate(${stop}px, ${y}px)`, offset: (first + pause) / total, easing: 'ease-in' },
          { transform: `translate(${to}px, ${y + rand(-60, 20)}px)` },
        ], { duration: total, easing: 'linear' }).finished.then(() => el.remove(), () => el.remove());
        later(first, el, () => {
          el.classList.add('beaming');
          abductBug(stop + 42, y + 30);
          later(pause - 400, el, () => el.classList.remove('beaming'));
        });
      },
      butterflies: () => {
        const ltr = Math.random() < .5;
        for (let i = 0; i < 3; i++) {
          const el = make('button', 'butterfly hit', '<span>🦋</span>');
          el.setAttribute('aria-label', 'A butterfly. Catch it');
          const y = rand(.2, .7) * innerHeight;
          const xs = ltr ? [-40, innerWidth + 40] : [innerWidth + 40, -40];
          const frames = Array.from({ length: 9 }, (_, k) => ({
            transform: `translate(${xs[0] + ((xs[1] - xs[0]) * k) / 8}px, ${y + Math.sin(k * 1.3 + i) * 50}px)`,
          }));
          tap(el, () => {
            const [x, cy] = center(el);
            el.remove();
            kit.burst(x, cy, 14, { round: true });
            kit.secret('butterfly');
          });
          layer().append(el);
          el.animate(frames, { duration: rand(9000, 12000), delay: i * 600, easing: 'ease-in-out', fill: 'backwards' })
            .finished.then(() => el.remove(), () => el.remove());
        }
      },
      cloud: () => {
        const el = make('div', 'cloud', CLOUD, `top: ${rand(60, 140)}px`);
        const ltr = Math.random() < .5;
        layer().append(el);
        el.animate([{ transform: `translateX(${ltr ? -180 : innerWidth}px)` }, { transform: `translateX(${ltr ? innerWidth : -180}px)` }], { duration: 20000 })
          .finished.then(() => el.remove(), () => el.remove());
      },
      leaves: () => {
        fall('leaf', 10, { html: () => pick(['🍂', '🍁', '🍃']), seconds: [5, 8], spread: 2.5 });
        if (Math.random() < .25) {
          const el = make('button', 'leaf hit', '🍂', `--x: ${rand(10, 90)}vw; --d: 9s; --delay: .5s; --drift: 50px; --r: 200deg`);
          el.setAttribute('aria-label', 'A golden leaf. Catch it');
          tap(el, () => {
            const [x, y] = center(el);
            el.remove();
            kit.burst(x, y, 20, { spread: 100 });
            kit.secret('leaf');
          });
          kit.add(el, 9600);
        }
      },
      fireflies: () => {
        for (let i = 0; i < 14; i++) {
          kit.add(make('span', 'firefly', '', `--x: ${rand(5, 95)}vw; --y: ${rand(15, 90)}vh; --dx: ${rand(-80, 80)}px; --dy: ${rand(-60, 30)}px; --d: ${rand(6, 9)}s`), 9200);
        }
      },
      rain: () => {
        fall('drop', 70, { seconds: [.7, 1.1], spread: 5 });
        if (Math.random() < .35) setTimeout(rainbow, 6000);
      },
      snow: () => fall('flake', 50, { html: () => '❄', seconds: [6, 9], spread: 3, style: () => `--z: ${Math.round(rand(9, 18))}px` }),
      rainbow,
      glow: () => kit.add(make('div', 'tint'), 7100),
      star: () => {
        const el = make('button', 'shoot hit');
        el.setAttribute('aria-label', 'A shooting star. Make a wish');
        const ltr = Math.random() < .5;
        const y = rand(60, 180);
        const [x0, x1] = ltr ? [-130, innerWidth + 10] : [innerWidth + 10, -130];
        const angle = ltr ? 12 : 168;
        tap(el, () => {
          const [x, cy] = center(el);
          kit.burst(x, cy, 24, { spread: 120, round: true });
          el.remove();
          kit.toast('🌠', 'Wish made.');
          kit.secret('star');
        });
        layer().append(el);
        el.animate([
          { transform: `translate(${x0}px, ${y}px) rotate(${angle}deg)`, opacity: 0 },
          { opacity: 1, offset: .1 },
          { transform: `translate(${x1}px, ${y + 140}px) rotate(${angle}deg)`, opacity: 0 },
        ], { duration: 2800, easing: 'ease-in' }).finished.then(() => el.remove(), () => el.remove());
      },
      meteor: () => {
        const x = rand(.2, .8) * innerWidth;
        const el = make('span', 'meteor', '☄️');
        layer().append(el);
        el.animate([
          { transform: `translate(${x - 260}px, -60px) rotate(-20deg)` },
          { transform: `translate(${x - 15}px, ${innerHeight - 30}px) rotate(-20deg)` },
        ], { duration: 900, easing: 'ease-in' }).finished.then(() => {
          el.remove();
          kit.burst(x, innerHeight - 10, 30, { spread: 140 });
          kit.add(make('div', 'crater', '', `left: ${x}px`), 10000);
          document.body?.animate([{ translate: '0 0' }, { translate: '4px -3px' }, { translate: '-4px 3px' }, { translate: '0 0' }], { duration: 280, iterations: 2 });
          setTimeout(() => {
            const run = stroll({ from: x - 32, ltr: Math.random() < .5, cls: 'fast', speed: 380 });
            speak(run.el, '!!', 1400);
          }, 500);
        }, () => el.remove());
      },
      box: () => thing('🎁', '', 7, (x, y) => {
        const gift = pick(['confetti', 'golden', 'rainbow', 'vibes']);
        if (gift === 'confetti') kit.confetti(60);
        else if (gift === 'golden') kit.spawnBug(0, true);
        else if (gift === 'rainbow') rainbow();
        else rise(x, y, '💖');
        kit.secret('box');
      }),
      mystery: () => thing('???', 'q', 5, () => kit.secret('mystery', "You weren't supposed to find this.")),
      door: () => {
        const el = make('button', 'thing hit', '🚪', `--x: ${rand(8, 88)}vw; --y: calc(100vh - 52px); animation: fadeio2 6s ease-in-out forwards`);
        el.setAttribute('aria-label', 'A tiny door. Knock');
        tap(el, () => {
          el.textContent = '✨';
          const [x, y] = center(el);
          rise(x, y - 10, '👋');
          kit.secret('door');
        });
        kit.add(el, 6000);
      },
      roll: () => {
        turn([{ rotate: '0turn' }, { rotate: '1turn' }], 1300);
        setTimeout(() => kit.toast('🌀', 'Did Mantis just do a barrel roll?'), 1300);
      },
      flip: () => {
        turn([{ rotate: '0deg' }, { rotate: '180deg', offset: .2 }, { rotate: '180deg', offset: .8 }, { rotate: '0deg' }], 1700);
        setTimeout(() => kit.toast('🙃', 'Did that really happen?'), 1700);
      },
      update: () => {
        const el = make('div', 'card', '⚙️ Installing Mantis update… please don\'t turn off your computer<div class="bar"><i></i></div>');
        el.setAttribute('role', 'status');
        kit.add(el, 5000);
        setTimeout(() => { if (el.isConnected) el.textContent = 'Just kidding 😄'; }, 3300);
      },
      saw: () => {
        const right = kit.pointer.x > innerWidth / 2;
        const el = make('div', 'eyes', '<i></i><i></i><span class="say"></span>', right ? 'right: 30px' : 'left: 30px');
        kit.add(el, 4100);
        watcher = el;
        look();
        setTimeout(() => speak(el, 'I saw that.', 2400), 600);
        setTimeout(() => { if (watcher === el) watcher = null; }, 4100);
      },
      party,
    };

    // Pupils follow the cursor while the "I saw that" eyes are up.
    function look() {
      if (!watcher?.isConnected) return;
      for (const eye of watcher.querySelectorAll('i')) {
        const r = eye.getBoundingClientRect();
        const a = Math.atan2(kit.pointer.y - (r.top + r.height / 2), kit.pointer.x - (r.left + r.width / 2));
        eye.style.setProperty('--px', `${(Math.cos(a) * 6).toFixed(1)}px`);
        eye.style.setProperty('--py', `${(Math.sin(a) * 6).toFixed(1)}px`);
      }
    }

    // You're back: the napping mantis jumps awake and runs off.
    function wake() {
      const el = sleeper;
      if (!el) return;
      sleeper = null;
      if (!el.isConnected) return;
      el.classList.remove('sleep', 'rest');
      el.classList.add('fast', 'done');
      el.querySelectorAll('.zz').forEach((z) => z.remove());
      speak(el, '!', 900);
      el.animate([{ transform: 'translateX(16px)' }, { transform: 'translateX(16px) translateY(-18px)', offset: .25 }, { transform: 'translateX(16px)', offset: .4 }, { transform: 'translateX(-90px)' }], { duration: 1100, easing: 'ease-in' })
        .finished.then(() => el.remove(), () => el.remove());
      el.style.setProperty('--flip', -1);
    }

    return {
      CSS,
      run(id) {
        if (!RUN[id]) return false;
        RUN[id]();
        kit.discover(id);
        return true;
      },
      // One event at random, by tier; night-only ones only at night.
      pick() {
        let n = rand(0, 100);
        let tier = 'common';
        for (const [name, weight] of Object.entries(TIERS)) if ((n -= weight) < 0) { tier = name; break; }
        const ids = Object.keys(LIST).filter((id) => LIST[id][0] === tier && (night() || !NIGHT_ONLY.includes(id)));
        return pick(ids);
      },
      moved() {
        wake();
        look();
      },
      sleeping: () => !!sleeper,
      clear() {
        sleeper = null;
        watcher = null;
      },
    };
  }

  return { SECRETS, LIST, create };
})();
