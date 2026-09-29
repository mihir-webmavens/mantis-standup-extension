// Mantis looks: whole-page restyles of projects.webmavens.dev, shared by the
// content script (mantis-theme.js), the popup's Settings picker and the full-size
// gallery (themes.html / preview.html). The choice is stored in
// chrome.storage.sync under STORAGE_KEY; 'classic' means Mantis as it ships.
//
// Mantis is a Livewire + Flux (Tailwind v4) app, so a look works in two layers:
//  1. Design tokens. Tailwind reads colours, radii, spacing and fonts from CSS
//     variables (--color-zinc-*, --radius-*, --spacing, --font-sans) and Flux its
//     accent from --color-accent*. Our stylesheet is unlayered, so it beats the
//     app's @layer theme/utilities and every page follows the look.
//  2. Components, found by Flux's data attributes ([data-flux-card],
//     [data-flux-button], [data-flux-navbar-items] …): shapes, shadows, motion.
// Only the look's own attribute on <html> (data-msq-theme) switches any of it on.

const MantisThemes = (() => {
  const STORAGE_KEY = 'mantisTheme';
  const DEFAULT = 'classic';

  const THEMES = [
    {
      id: 'classic', name: 'Classic', tagline: 'Mantis as it ships',
      description: 'No restyling: Mantis exactly as the team built it.',
      traits: ['Original colours', 'Original layout', 'No extra motion'],
      swatch: ['#ffffff', '#f4f4f5', '#27272a', '#3f3f46'], accent: '#3f3f46',
    },
    {
      id: 'kinetic', name: 'Kinetic', tagline: 'Everything moves with intent',
      description: 'A motion-first look. Pages unfold in 3D, cards tilt toward the cursor with a moving glare and a spinning gradient edge, buttons pull toward the pointer and ripple where you click, and one gradient pill glides between header tabs. Scrolling reveals content, tightens the header and fills a progress line.',
      traits: ['3D unfold entrances', 'Tilt cards with glare', 'Magnetic buttons + ripple', 'Gliding tab pill', 'Scroll-driven reveals', 'Circular switch reveal', 'Playground: bugs & secrets'],
      swatch: ['#f7f8fc', '#ff4d6d', '#ff9f1c', '#2ec4b6'], accent: '#ff4d6d', spotlight: true, motion: true, featured: true,
    },
    {
      id: 'aurora', name: 'Aurora', tagline: 'Frosted glass on a drifting glow',
      description: 'A floating glass header over a slowly moving colour field, frosted cards and pill-shaped gradient buttons with a light sweep. Content rises in softly out of a blur.',
      traits: ['Floating glass header', 'Frosted cards', 'Gradient pill buttons', 'Blur-in entrances'],
      swatch: ['#f6f4fd', '#ffffff', '#7c3aed', '#db2777'], accent: '#7c3aed', spotlight: false,
    },
    {
      id: 'graphite', name: 'Graphite', tagline: 'Precise, dense, keyboard-first',
      description: 'Tight spacing, hairline borders and small radii for scanning lots of tickets. Cards and rows light up under the cursor, and the active tab gets a glowing underline.',
      traits: ['Compact density', 'Cursor spotlight', 'Hairline borders', 'Snappy 300 ms motion'],
      swatch: ['#f7f8fa', '#ffffff', '#5e6ad2', '#16181d'], accent: '#5e6ad2', spotlight: true,
    },
    {
      id: 'paper', name: 'Paper', tagline: 'Calm, editorial, roomy',
      description: 'Warm paper tones, serif headings and generous spacing. Cards lift on a gentle spring, tabs get an ink underline that draws in, and buttons press down like keys.',
      traits: ['Serif headings', 'Airy spacing', 'Spring lift on hover', 'Tactile buttons'],
      swatch: ['#fbf9f5', '#ffffff', '#c2410c', '#211d18'], accent: '#c2410c', spotlight: false,
    },
    {
      id: 'pop', name: 'Pop', tagline: 'Bold neo-brutalist blocks',
      description: 'Thick ink outlines, hard offset shadows and a sunny yellow. Everything is physical: buttons shift toward the cursor and snap flat when pressed; content bounces in.',
      traits: ['Ink outlines', 'Offset shadows', 'Uppercase tabs', 'Bouncy entrances'],
      swatch: ['#fafafa', '#ffffff', '#ffd23f', '#111111'], accent: '#e0a800', spotlight: false,
    },
    {
      id: 'neon', name: 'Neon', tagline: 'Dark command centre',
      description: 'Always dark: a deep navy grid, monospace headings and cyan glow. A light beam scans the header, tabs glitch on hover, cards glow under the cursor and panels boot in line by line.',
      traits: ['Always dark', 'Glow + cursor spotlight', 'Monospace headings', 'Boot-up reveal'],
      swatch: ['#05080d', '#0a0f17', '#22d3ee', '#d946ef'], accent: '#22d3ee', spotlight: true, dark: true,
    },
  ];

  // Neutral scales (50 … 950). Tailwind's grey families all map to the look's one.
  const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
  const NEUTRALS = {
    kinetic: ['#f7f8fc', '#eef0f7', '#e1e4ef', '#c8cddd', '#979eb4', '#6b7390', '#50576f', '#3c4257', '#262a3a', '#171a26', '#0d0f18'],
    aurora: ['#f8f7fc', '#f1eff8', '#e4e0f0', '#cdc7de', '#9d95b5', '#736b8c', '#575070', '#433d58', '#2b2640', '#1c1830', '#110e1f'],
    graphite: ['#f7f8fa', '#eff1f4', '#e2e5ea', '#c9ced6', '#9aa1ad', '#6b7280', '#4e5461', '#3a3f4a', '#23262d', '#16181d', '#0c0d10'],
    paper: ['#fbf9f5', '#f5f1e9', '#e9e2d5', '#d5cbb9', '#a89c87', '#7d725f', '#5f5647', '#4a4237', '#2f2a23', '#211d18', '#151210'],
    pop: ['#fafafa', '#f4f4f0', '#e6e6e0', '#cfcfc8', '#a0a09a', '#71716c', '#52524e', '#3d3d3a', '#262624', '#181817', '#0d0d0c'],
    neon: ['#f4f8fb', '#e8f0f7', '#d3dfeb', '#aebfd4', '#7f93ad', '#52647c', '#2e3d52', '#1c2838', '#111926', '#0a0f17', '#05080d'],
  };
  const neutrals = (id) => ['zinc', 'gray', 'neutral', 'slate', 'stone']
    .map((family) => STEPS.map((step, i) => `--color-${family}-${step}: ${NEUTRALS[id][i]};`).join(' ')).join('\n');

  // What each look styles, by Flux's markup.
  const HEADER = ':is([data-flux-header], header:has([data-flux-navbar]))';
  const NAV = ':is([data-flux-navbar] > a, [data-flux-navbar] > ui-dropdown > button, [data-flux-navbar-items], [data-flux-navlist-item])';
  const CURRENT = ':is([data-current], [aria-current="page"])';
  const CARD = '[data-flux-card]';
  const BUTTON = '[data-flux-button]';
  const PRIMARY = '[data-flux-button]:is([data-variant="primary"], [class*="bg-[var(--color-accent)]"], [class*="bg-(--color-accent)"])';
  const SOLID = '[data-flux-button]:not([class*="bg-transparent"]):not([data-variant="ghost"]):not([data-flux-input] *)';
  const INPUT = ':is(:is(input:not([type="checkbox"], [type="radio"]), textarea, select)[data-flux-control], [data-flux-select-button])';
  const BADGE = '[data-flux-badge]';
  const MENU = ':is([data-flux-menu], ui-menu[popover])';
  const ROW = ':is(tbody > tr, [data-flux-row])';
  const HEAD_CELL = ':is(thead th, [data-flux-column])';
  const MAIN = ':is([data-flux-main], main)';
  // Elements that follow the cursor spotlight (see spotlight()).
  const SPOTLIGHT = '[data-flux-card], tbody > tr, [data-flux-row]';

  // nth-child delays for the 2nd … count-th sibling; delay(n) is the n-th step.
  const stagger = (sel, count, delay) => Array.from({ length: count - 1 }, (_, i) =>
    `${sel}:nth-child(${i + 2}) { animation-delay: ${delay(i + 1)}; }`).join('\n');

  // Motion and plumbing every look shares; each look fills in the --msq-* knobs.
  const COMMON = `
    @view-transition { navigation: auto; }
    @keyframes msq-fade { from { opacity: 0; } }
    @keyframes msq-rise { from { opacity: 0; transform: translateY(10px); } }
    @keyframes msq-rise-sm { from { opacity: 0; transform: translateY(4px); } }
    @keyframes msq-rise-blur { from { opacity: 0; transform: translateY(16px) scale(.99); filter: blur(10px); } }
    @keyframes msq-settle { from { opacity: 0; transform: translateY(14px) scale(.985); } }
    @keyframes msq-pop { 0% { opacity: 0; transform: translateY(22px) scale(.94); } 55% { opacity: 1; } }
    @keyframes msq-boot {
      0% { opacity: 0; clip-path: inset(0 0 100% 0); }
      35% { opacity: 1; } 45% { opacity: .35; } 55% { opacity: 1; } 62% { opacity: .6; } 70% { opacity: 1; }
      100% { clip-path: inset(0 0 0 0); }
    }
    @keyframes msq-slide { from { opacity: 0; transform: translateX(-10px); } }
    @keyframes msq-drop { from { opacity: 0; transform: translateY(-14px); } }
    @keyframes msq-menu { from { opacity: 0; transform: translateY(-6px) scale(.96); } }
    @keyframes msq-modal { from { opacity: 0; transform: translateY(16px) scale(.95); } }
    @keyframes msq-drift {
      0% { transform: translate3d(0, 0, 0) rotate(0deg); }
      50% { transform: translate3d(4%, -3%, 0) rotate(9deg); }
      100% { transform: translate3d(-3%, 4%, 0) rotate(-7deg); }
    }
    @keyframes msq-underline { from { transform: scaleX(0); opacity: 0; } }
    @keyframes msq-scan { from { background-position: 0 0, -60% 100%; } to { background-position: 0 0, 160% 100%; } }
    @keyframes msq-glitch {
      0% { text-shadow: 2px 0 rgb(217 70 239 / .9), -2px 0 rgb(34 211 238 / .9); transform: translateX(1px); }
      50% { text-shadow: -2px 0 rgb(217 70 239 / .9), 2px 0 rgb(34 211 238 / .9); transform: translateX(-1px); }
      100% { text-shadow: 0 0 10px rgb(34 211 238 / .6); transform: none; }
    }
    @keyframes msq-shine { from { transform: translateX(-130%) skewX(-20deg); } to { transform: translateX(330%) skewX(-20deg); } }

    html[data-msq-theme] {
      font-family: var(--font-sans);
      -webkit-font-smoothing: antialiased;
      scrollbar-color: color-mix(in srgb, var(--color-zinc-500) 45%, transparent) transparent;
      & ::selection { background: color-mix(in srgb, var(--color-accent) 30%, transparent); }
      & :focus-visible { outline-color: var(--color-accent); }

      /* Page content arrives in a staggered cascade (again after every navigation). */
      & ${MAIN} > * { animation: var(--msq-enter) var(--msq-dur) var(--msq-ease) backwards; }
      ${stagger(`& ${MAIN} > *`, 8, (n) => `calc(var(--msq-stagger) * ${n})`)}
      & ${CARD} { animation: var(--msq-enter) var(--msq-dur) var(--msq-ease) backwards; animation-delay: calc(var(--msq-stagger) * 1.5); }
      & ${ROW} { animation: var(--msq-row) calc(var(--msq-dur) * .8) var(--msq-ease) backwards; animation-delay: calc(var(--msq-stagger) * 2); }
      ${stagger(`& ${ROW}`, 14, (n) => `calc(var(--msq-stagger) * (2 + ${n} * .45))`)}
      & ${HEADER} { animation: msq-drop calc(var(--msq-dur) * 1.1) var(--msq-ease) backwards; }
      & ${MENU} { animation: msq-menu .2s var(--msq-ease); transform-origin: top center; }
      & dialog[open] { animation: msq-modal .34s var(--msq-ease); }
      & dialog[open]::backdrop { animation: msq-fade .25s ease; backdrop-filter: blur(6px); }

      & ${BUTTON} {
        transition: transform .18s var(--msq-ease), box-shadow .22s ease, background-color .2s ease,
          background-position .6s var(--msq-ease), border-color .2s ease, filter .2s ease, color .2s ease;
      }
      & ${BUTTON}:active:not(:disabled) { transform: translateY(1px) scale(.97); }
      & ${INPUT} { transition: border-color .2s ease, box-shadow .2s ease, background-color .2s ease, transform .15s ease; }
      & ${ROW} { transition: background-color .2s ease, box-shadow .2s ease; }
      & ${NAV} { transition: color .2s ease, background-color .2s ease, box-shadow .25s ease, transform .2s var(--msq-ease), background-size .45s var(--msq-ease); }
    }

    @media (prefers-reduced-motion: reduce) {
      html[data-msq-theme] *, html[data-msq-theme] *::before, html[data-msq-theme] *::after {
        animation-duration: 1ms !important; animation-delay: 0s !important; animation-iteration-count: 1 !important;
        animation-timeline: auto !important; transition-duration: 1ms !important;
      }
      html[data-msq-switching]::view-transition-new(root), html[data-msq-switching]::view-transition-old(root) { animation: none !important; }
    }
  `;

  const LOOKS = {
    kinetic: `
      @property --msq-angle { syntax: '<angle>'; inherits: false; initial-value: 0deg; }
      @property --msq-ripple { syntax: '<length-percentage>'; inherits: false; initial-value: 0%; }
      @keyframes msq-unfold {
        0% { opacity: 0; transform: perspective(1200px) rotateX(-14deg) translateY(28px) scale(.97); }
        55% { opacity: 1; }
      }
      @keyframes msq-cascade { from { opacity: 0; transform: translateX(-22px) skewX(-10deg); } }
      @keyframes msq-reveal { from { opacity: 0; translate: 0 48px; scale: .94; } }
      @keyframes msq-spin { to { --msq-angle: 360deg; } }
      @keyframes msq-morph {
        0% { border-radius: 42% 58% 70% 30% / 45% 45% 55% 55%; transform: translate(0, 0) rotate(0deg); filter: blur(70px) hue-rotate(0deg); }
        50% { border-radius: 70% 30% 46% 54% / 30% 29% 71% 70%; transform: translate(18vw, 10vh) rotate(120deg); }
        100% { border-radius: 36% 64% 38% 62% / 62% 38% 62% 38%; transform: translate(-6vw, 26vh) rotate(240deg); filter: blur(70px) hue-rotate(45deg); }
      }
      @keyframes msq-progress { from { transform: scaleX(0); } to { transform: scaleX(1); } }
      @keyframes msq-compact {
        from { background-color: var(--msq-hdr-a); box-shadow: none; }
        to { background-color: var(--msq-hdr-b); box-shadow: 0 14px 34px -22px rgb(var(--msq-coral) / .7); }
      }
      @keyframes msq-draw { from { background-size: 0 2px; } }
      @keyframes msq-badge { from { opacity: 0; scale: .3; } 60% { opacity: 1; } }
      @keyframes msq-ring { from { outline-offset: 8px; outline-color: transparent; } }
      @keyframes msq-menu-k { from { opacity: 0; transform: perspective(700px) rotateX(-22deg) translateY(-8px) scale(.94); } }
      @keyframes msq-modal-k { from { opacity: 0; transform: perspective(900px) rotateX(12deg) translateY(30px) scale(.9); } }
      @keyframes msq-circle { from { clip-path: circle(0% at 50% 42%); } to { clip-path: circle(150% at 50% 42%); } }

      /* Switching to Kinetic: the new look opens as a circle from the middle. */
      html[data-msq-switching]::view-transition-old(root) { animation: none; }
      html[data-msq-switching]::view-transition-new(root) { animation: msq-circle .9s cubic-bezier(.65, 0, .35, 1); }

      html[data-msq-theme="kinetic"] {
        ${neutrals('kinetic')}
        --color-accent: #ff4d6d; --color-accent-content: #e11d48; --color-accent-foreground: #fff;
        --font-sans: "Plus Jakarta Sans", "Manrope", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif;
        --radius-sm: .375rem; --radius-md: .5rem; --radius-lg: .75rem; --radius-xl: 1rem; --radius-2xl: 1.375rem;
        --msq-enter: msq-unfold; --msq-dur: .9s; --msq-ease: cubic-bezier(.34, 1.36, .64, 1); --msq-stagger: 70ms; --msq-row: msq-cascade;
        --msq-spring: cubic-bezier(.34, 1.56, .64, 1); --msq-smooth: cubic-bezier(.16, 1, .3, 1); --msq-elastic: cubic-bezier(.2, 2.4, .4, .6);
        --msq-coral: 255 77 109; --msq-teal: 46 196 182;
        --msq-grad: linear-gradient(110deg, #ff4d6d, #ff9f1c 50%, #2ec4b6, #ff4d6d);
        --msq-ring: conic-gradient(from var(--msq-angle), #ff4d6d, #ff9f1c, #2ec4b6, #8b5cf6, #ff4d6d);
        --msq-surface: var(--color-white);
        --msq-hdr-a: color-mix(in srgb, var(--color-white) 55%, transparent); --msq-hdr-b: color-mix(in srgb, var(--color-white) 90%, transparent);
        &.dark {
          --color-accent: #ff6b85; --color-accent-content: #ff8fa3; --color-accent-foreground: #fff;
          --msq-surface: var(--color-zinc-900);
          --msq-hdr-a: color-mix(in srgb, var(--color-zinc-950) 50%, transparent); --msq-hdr-b: color-mix(in srgb, var(--color-zinc-950) 88%, transparent);
        }

        /* A slowly morphing colour blob behind everything. */
        & body::before {
          content: ""; position: fixed; z-index: -1; pointer-events: none; top: -18vmax; left: -12vmax; width: 62vmax; height: 62vmax;
          background: conic-gradient(from 30deg, #ff4d6d, #ff9f1c, #2ec4b6, #8b5cf6, #ff4d6d); opacity: .26;
          animation: msq-morph 24s ease-in-out infinite alternate;
        }
        &.dark body::before { opacity: .2; }
        & :is(h1, h2, [data-flux-heading]) { letter-spacing: -.022em; }
        & ${MAIN} h1 {
          background: var(--msq-grad) 0 0 / 250% 100%; -webkit-background-clip: text; background-clip: text; color: transparent;
          animation: msq-unfold var(--msq-dur) var(--msq-ease) backwards, msq-flow 8s linear infinite;
        }
        & :is(a, button):focus-visible { animation: msq-ring .5s var(--msq-smooth); outline-offset: 2px; }

        /* Header: gradient edge that keeps turning; tightens as the page scrolls. */
        & ${HEADER} {
          background-color: var(--msq-hdr-b) !important; backdrop-filter: blur(18px) saturate(1.7);
          border-style: solid !important; border-width: 0 0 2px 0 !important; border-image: var(--msq-ring) 1;
          animation: msq-drop calc(var(--msq-dur) * 1.1) var(--msq-smooth) backwards, msq-spin 9s linear infinite;
        }

        /* Tabs: one gradient pill glides to the hovered tab and back to the current one (glide()). */
        & [data-flux-navbar] { position: relative; z-index: 0; }
        & [data-flux-navbar]::before {
          content: ""; position: absolute; z-index: -1; left: 0; top: var(--msq-ind-y, 0); pointer-events: none;
          width: var(--msq-ind-w, 0); height: var(--msq-ind-h, 100%); border-radius: 999px;
          background: var(--msq-grad) 0 0 / 250% 100%;
          box-shadow: 0 10px 24px -10px rgb(var(--msq-coral) / .8);
          transform: translateX(var(--msq-ind-x, 0));
          transition: transform .55s var(--msq-spring), width .55s var(--msq-spring), top .3s ease, height .3s ease, opacity .3s ease;
          animation: msq-flow 6s linear infinite;
        }
        & ${NAV} { border-radius: 999px; background-color: transparent !important; transition: color .3s ease, transform .35s var(--msq-spring); }
        & ${NAV}::after { display: none !important; }
        & ${NAV}:active { transform: scale(.94); }
        & [data-flux-navbar]:not(:has(> :hover)) > :is(${CURRENT}), & [data-flux-navbar] > :hover { color: #fff !important; }
        & [data-flux-navbar]:not(:has(> :hover)) > :is(${CURRENT}) *, & [data-flux-navbar] > :hover * { color: inherit !important; }

        /* Cards: tilt toward the cursor, glare where it points, spinning gradient edge. */
        & ${CARD} {
          /* The edge spin is always listed (paused) so hovering never restarts the entrance. */
          animation: msq-reveal linear both, msq-unfold var(--msq-dur) var(--msq-ease) backwards, msq-spin 3s linear infinite;
          animation-timeline: auto, auto, auto; animation-delay: 0s, calc(var(--msq-stagger) * 1.5), 0s;
          animation-play-state: running, running, paused;
          transition: transform .7s var(--msq-spring), box-shadow .5s ease, rotate .9s var(--msq-elastic), scale .9s var(--msq-elastic);
          box-shadow: 0 1px 2px rgb(0 0 0 / .04), 0 12px 30px -22px rgb(var(--msq-coral) / .45);
        }
        & ${CARD}:hover {
          transform: perspective(900px) rotateX(calc(var(--msq-ny, 0) * -6deg)) rotateY(calc(var(--msq-nx, 0) * 7deg)) translateY(-4px);
          transition: transform .18s ease-out, box-shadow .5s ease, rotate .9s var(--msq-elastic), scale .9s var(--msq-elastic);
          border-color: transparent !important;
          background:
            radial-gradient(420px circle at var(--msq-x, 50%) var(--msq-y, 50%), rgb(255 255 255 / .55), transparent 55%) padding-box,
            linear-gradient(var(--msq-surface), var(--msq-surface)) padding-box,
            var(--msq-ring) border-box !important;
          box-shadow: 0 28px 50px -24px rgb(var(--msq-coral) / .55), 0 10px 20px -16px rgb(var(--msq-teal) / .5);
          animation-play-state: running;
        }
        &.dark ${CARD}:hover {
          background:
            radial-gradient(420px circle at var(--msq-x, 50%) var(--msq-y, 50%), rgb(255 255 255 / .09), transparent 55%) padding-box,
            linear-gradient(var(--msq-surface), var(--msq-surface)) padding-box,
            var(--msq-ring) border-box !important;
        }

        /* Buttons: pulled toward the pointer, ripple from the click point. */
        & ${SOLID} {
          background-image: radial-gradient(circle at var(--msq-x, 50%) var(--msq-y, 50%), rgb(var(--msq-coral) / .16) var(--msq-ripple), transparent calc(var(--msq-ripple) + 1%));
          transition: transform .45s var(--msq-spring), box-shadow .3s ease, background-position .8s var(--msq-smooth), filter .2s ease, --msq-ripple 0s;
        }
        & ${SOLID}:hover { transform: translate(calc(var(--msq-nx, 0) * 5px), calc(var(--msq-ny, 0) * 4px)); transition-duration: .2s, .3s, .8s, .2s, 0s; }
        & ${SOLID}:active:not(:disabled) {
          --msq-ripple: 160%; transform: translate(calc(var(--msq-nx, 0) * 3px), calc(var(--msq-ny, 0) * 2px)) scale(.94);
          transition: transform .12s ease, box-shadow .3s ease, background-position .8s ease, filter .2s ease, --msq-ripple .6s cubic-bezier(.2, .7, .3, 1);
        }
        & ${PRIMARY} {
          border: 0 !important; color: #fff !important;
          background-image:
            radial-gradient(circle at var(--msq-x, 50%) var(--msq-y, 50%), rgb(255 255 255 / .42) var(--msq-ripple), transparent calc(var(--msq-ripple) + 1%)),
            var(--msq-grad) !important;
          background-size: 100% 100%, 250% 100%;
          box-shadow: 0 10px 24px -10px rgb(var(--msq-coral) / .85), inset 0 1px 0 rgb(255 255 255 / .3) !important;
        }
        & ${PRIMARY}:hover { background-position: 0 0, 100% 0; box-shadow: 0 16px 30px -12px rgb(var(--msq-coral) / .9), 0 6px 18px -10px rgb(var(--msq-teal) / .7) !important; }

        & ${INPUT}:focus {
          border-color: rgb(var(--msq-coral) / .55) !important; outline: none;
          box-shadow: 0 0 0 4px rgb(var(--msq-coral) / .14) !important;
          background-image: linear-gradient(90deg, #ff4d6d, #ff9f1c, #2ec4b6); background-repeat: no-repeat;
          background-size: 100% 2px; background-position: 0 100%;
          animation: msq-draw .5s var(--msq-smooth);
        }

        /* Rows: cascade in, reveal on scroll, slide on hover while an accent bar grows. */
        & ${ROW} {
          animation: msq-reveal linear both, msq-cascade calc(var(--msq-dur) * .8) var(--msq-ease) backwards;
          animation-timeline: auto, auto; animation-delay: 0s, calc(var(--msq-stagger) * 2);
          background-image: linear-gradient(#ff4d6d, #2ec4b6); background-repeat: no-repeat; background-position: 0 50%; background-size: 3px 0;
          transition: background-size .35s var(--msq-spring), background-color .25s ease, transform .35s var(--msq-spring);
        }
        ${stagger(`& ${ROW}`, 14, (n) => `0s, calc(var(--msq-stagger) * (2 + ${n} * .5))`)}
        & ${ROW}:hover { transform: translateX(4px); background-size: 3px 100%; background-color: rgb(var(--msq-coral) / .05) !important; }

        & ${BADGE} { border-radius: 999px; animation: msq-badge .55s var(--msq-spring) backwards; animation-delay: calc(var(--msq-stagger) * 5); }
        & ${MENU} { animation: msq-menu-k .38s var(--msq-spring); transform-origin: top center; border-radius: var(--radius-xl); box-shadow: 0 26px 50px -20px rgb(var(--msq-coral) / .45) !important; }
        & dialog[open] { animation: msq-modal-k .55s var(--msq-spring); }

        /* Playground secret (playground.js): shaking the mouse knocks the cards, which wobble back. */
        &[data-msq-fx="jelly"] ${CARD} { rotate: -3deg; scale: 1.04; transition-duration: .7s, .5s, .12s, .12s; }
        &[data-msq-fx="jelly"] ${CARD}:nth-child(even) { rotate: 3deg; }

        /* Scroll-driven: content reveals as it enters, the header tightens, a progress line fills. */
        @supports (animation-timeline: view()) {
          & ${CARD} { animation-timeline: view(), auto, auto; animation-range: entry 0% entry 70%, normal, normal; }
          & ${ROW} { animation-timeline: view(), auto; animation-range: entry 0% entry 70%, normal; }
          & ${HEADER} {
            animation: msq-drop calc(var(--msq-dur) * 1.1) var(--msq-smooth) backwards, msq-spin 9s linear infinite, msq-compact linear both;
            animation-timeline: auto, auto, scroll(root); animation-range: normal, normal, 0 160px;
          }
          & body::after {
            content: ""; position: fixed; z-index: 2147483000; top: 0; left: 0; right: 0; height: 3px; pointer-events: none;
            background: var(--msq-grad); transform-origin: 0 50%; transform: scaleX(0);
            animation: msq-progress linear both; animation-timeline: scroll(root);
          }
        }
      }

      @media (prefers-reduced-motion: reduce) {
        html[data-msq-theme="kinetic"] {
          & :is(${CARD}, ${SOLID}, ${ROW}):hover { transform: none !important; }
          & body::after { display: none; }
        }
      }
    `,

    aurora: `
      html[data-msq-theme="aurora"] {
        ${neutrals('aurora')}
        --color-accent: #7c3aed; --color-accent-content: #6d28d9; --color-accent-foreground: #fff;
        --font-sans: "Plus Jakarta Sans", "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, sans-serif;
        --radius-sm: .375rem; --radius-md: .625rem; --radius-lg: .875rem; --radius-xl: 1.125rem; --radius-2xl: 1.5rem;
        --msq-enter: msq-rise-blur; --msq-dur: .75s; --msq-ease: cubic-bezier(.16, 1, .3, 1); --msq-stagger: 80ms; --msq-row: msq-rise;
        --msq-glow: 124 58 237;
        --msq-glass: rgb(255 255 255 / .62); --msq-glass-strong: rgb(255 255 255 / .88); --msq-glass-edge: rgb(255 255 255 / .8);
        --msq-grad: linear-gradient(120deg, #7c3aed, #c026d3 50%, #db2777, #7c3aed);
        &.dark {
          --color-accent: #a78bfa; --color-accent-content: #c4b5fd; --color-accent-foreground: #1c1830; --msq-glow: 167 139 250;
          --msq-glass: rgb(30 25 52 / .55); --msq-glass-strong: rgb(24 20 42 / .9); --msq-glass-edge: rgb(255 255 255 / .09);
        }
        & body { background-color: #f6f4fd; }
        &.dark body { background-color: #0f0c1d; }
        & body::before {
          content: ""; position: fixed; inset: -25%; z-index: -1; pointer-events: none;
          background:
            radial-gradient(34% 30% at 22% 18%, rgb(167 139 250 / .42), transparent 70%),
            radial-gradient(30% 28% at 82% 12%, rgb(244 114 182 / .3), transparent 70%),
            radial-gradient(38% 34% at 68% 86%, rgb(56 189 248 / .24), transparent 70%);
          filter: blur(24px); animation: msq-drift 28s ease-in-out infinite alternate;
        }
        &.dark body::before { opacity: .6; }

        & ${HEADER} {
          margin: 10px 12px 0; top: 10px; border: 1px solid var(--msq-glass-edge) !important; border-radius: 18px;
          background: var(--msq-glass) !important; backdrop-filter: blur(20px) saturate(1.7);
          box-shadow: 0 14px 36px -18px rgb(var(--msq-glow) / .45), inset 0 1px 0 rgb(255 255 255 / .45);
        }
        & ${NAV} { border-radius: 999px; }
        & ${NAV}::after { display: none !important; }
        & ${NAV}:hover { background-color: rgb(var(--msq-glow) / .1) !important; }
        & ${NAV}:is(${CURRENT}) {
          background: var(--msq-grad) 0 0 / 250% 100% !important; color: #fff !important;
          box-shadow: 0 8px 20px -8px rgb(var(--msq-glow) / .75);
        }
        & ${NAV}:is(${CURRENT}) * { color: inherit !important; }

        & ${MAIN} h1 {
          background: var(--msq-grad) 0 0 / 200% 100%; -webkit-background-clip: text; background-clip: text; color: transparent;
          letter-spacing: -.02em;
        }
        & ${CARD} {
          background: var(--msq-glass) !important; backdrop-filter: blur(14px) saturate(1.5);
          border-color: var(--msq-glass-edge) !important;
          box-shadow: inset 0 1px 0 rgb(255 255 255 / .5), 0 14px 34px -22px rgb(var(--msq-glow) / .6);
          transition: transform .5s var(--msq-ease), box-shadow .5s var(--msq-ease);
        }
        & ${CARD}:hover {
          transform: translateY(-3px);
          box-shadow: inset 0 1px 0 rgb(255 255 255 / .55), 0 24px 46px -22px rgb(var(--msq-glow) / .7);
        }
        & ${SOLID} { border-radius: 999px; }
        & ${PRIMARY} {
          position: relative; overflow: hidden; border: 0 !important; color: #fff !important;
          background: var(--msq-grad) 0 0 / 200% 100% !important;
          box-shadow: 0 8px 22px -10px rgb(var(--msq-glow) / .85), inset 0 1px 0 rgb(255 255 255 / .25);
        }
        & ${PRIMARY}:hover { background-position: 100% 0 !important; transform: translateY(-1px); box-shadow: 0 14px 30px -10px rgb(var(--msq-glow) / .95); }
        & ${PRIMARY}::after {
          content: ""; position: absolute; top: 0; bottom: 0; left: 0; width: 35%; pointer-events: none;
          background: linear-gradient(100deg, transparent, rgb(255 255 255 / .5), transparent); transform: translateX(-130%) skewX(-20deg);
        }
        & ${PRIMARY}:hover::after { animation: msq-shine .9s ease; }
        & ${INPUT} { border-radius: 12px; }
        & ${INPUT}:focus { border-color: rgb(var(--msq-glow) / .6) !important; box-shadow: 0 0 0 4px rgb(var(--msq-glow) / .16) !important; outline: none; }
        & ${ROW}:hover { background-color: rgb(var(--msq-glow) / .06) !important; }
        & ${BADGE} { border-radius: 999px; }
        & :is(${MENU}, dialog[open]) {
          background: var(--msq-glass-strong) !important; backdrop-filter: blur(22px) saturate(1.8);
          border-color: var(--msq-glass-edge) !important; border-radius: 16px;
          box-shadow: 0 26px 50px -20px rgb(var(--msq-glow) / .5);
        }
      }
    `,

    graphite: `
      html[data-msq-theme="graphite"] {
        ${neutrals('graphite')}
        --color-accent: #5e6ad2; --color-accent-content: #4f5bc4; --color-accent-foreground: #fff;
        --font-sans: "Inter", "Inter Variable", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif;
        --radius-sm: .1875rem; --radius-md: .3125rem; --radius-lg: .4375rem; --radius-xl: .5625rem; --radius-2xl: .75rem;
        --spacing: .2375rem;
        --msq-enter: msq-rise-sm; --msq-dur: .32s; --msq-ease: cubic-bezier(.2, 0, 0, 1); --msq-stagger: 40ms; --msq-row: msq-fade;
        --msq-glow: 94 106 210; --msq-line: var(--color-zinc-200);
        font-feature-settings: "cv11", "ss01"; letter-spacing: -.006em;
        &.dark { --color-accent: #7c86ec; --color-accent-content: #a5acf5; --msq-glow: 124 134 236; --msq-line: var(--color-zinc-800); }
        & body::before {
          content: ""; position: fixed; inset: 0; z-index: -1; pointer-events: none; opacity: .7;
          background-image: radial-gradient(var(--color-zinc-300) 1px, transparent 1px); background-size: 22px 22px;
          -webkit-mask-image: linear-gradient(to bottom, #000, transparent 55%); mask-image: linear-gradient(to bottom, #000, transparent 55%);
        }
        &.dark body::before { background-image: radial-gradient(var(--color-zinc-700) 1px, transparent 1px); }

        & ${HEADER} {
          background: color-mix(in srgb, var(--color-white) 80%, transparent) !important; backdrop-filter: blur(14px) saturate(1.6);
          border-bottom: 1px solid var(--msq-line) !important; box-shadow: none !important;
        }
        &.dark ${HEADER} { background: color-mix(in srgb, var(--color-zinc-950) 80%, transparent) !important; }
        & ${NAV} { position: relative; border-radius: var(--radius-md); color: var(--color-zinc-500); }
        & ${NAV}:hover { background-color: var(--color-zinc-100) !important; color: var(--color-zinc-900) !important; }
        &.dark ${NAV}:hover { background-color: var(--color-zinc-800) !important; color: var(--color-zinc-100) !important; }
        & ${NAV}:is(${CURRENT}) { color: var(--color-zinc-950) !important; font-weight: 600; }
        &.dark ${NAV}:is(${CURRENT}) { color: #fff !important; }
        & ${NAV}:is(${CURRENT})::after {
          content: ""; display: block; position: absolute; inset: auto 8px -3px 8px; height: 2px; border-radius: 2px;
          background: var(--color-accent) !important; box-shadow: 0 0 12px rgb(var(--msq-glow) / .9);
          transform-origin: left center; animation: msq-underline .4s var(--msq-ease) backwards;
        }

        & ${MAIN} h1 { letter-spacing: -.022em; font-weight: 650; }
        & ${CARD} { border-color: var(--msq-line) !important; box-shadow: 0 1px 1px rgb(0 0 0 / .03); transition: border-color .2s ease, box-shadow .25s ease; }
        & ${CARD}:hover {
          border-color: rgb(var(--msq-glow) / .45) !important;
          box-shadow: 0 0 0 1px rgb(var(--msq-glow) / .12), 0 10px 26px -16px rgb(var(--msq-glow) / .45);
        }
        & :is(${CARD}, ${ROW}):hover {
          background-image: radial-gradient(380px circle at var(--msq-x, 50%) var(--msq-y, 50%), rgb(var(--msq-glow) / .1), transparent 60%);
        }
        & ${ROW}:hover { box-shadow: inset 2px 0 0 var(--color-accent); }
        & ${PRIMARY} { box-shadow: inset 0 1px 0 rgb(255 255 255 / .2), 0 0 0 1px rgb(var(--msq-glow) / .5), 0 1px 2px rgb(0 0 0 / .2) !important; }
        & ${PRIMARY}:hover { filter: brightness(1.1); box-shadow: inset 0 1px 0 rgb(255 255 255 / .2), 0 0 0 1px rgb(var(--msq-glow) / .7), 0 6px 16px -6px rgb(var(--msq-glow) / .7) !important; }
        & ${INPUT}:focus { border-color: var(--color-accent) !important; box-shadow: 0 0 0 3px rgb(var(--msq-glow) / .2) !important; outline: none; }
        & ${BADGE} { border-radius: var(--radius-sm); font-weight: 550; }
        & ${HEAD_CELL} { text-transform: uppercase; font-size: 11px; letter-spacing: .06em; color: var(--color-zinc-500); }
        & ${MENU} { border-radius: var(--radius-lg); box-shadow: 0 18px 40px -14px rgb(0 0 0 / .28), 0 0 0 1px var(--msq-line) !important; }
        & kbd { font-family: inherit; font-size: .75em; padding: 0 5px; border: 1px solid var(--msq-line); border-bottom-width: 2px; border-radius: 4px; }
      }
    `,

    paper: `
      html[data-msq-theme="paper"] {
        ${neutrals('paper')}
        --color-accent: #c2410c; --color-accent-content: #9a3412; --color-accent-foreground: #fff;
        --font-sans: "Source Sans 3", "Avenir Next", "Segoe UI", system-ui, -apple-system, sans-serif;
        --msq-serif: "Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif;
        --radius-sm: .375rem; --radius-md: .625rem; --radius-lg: .875rem; --radius-xl: 1.125rem; --radius-2xl: 1.5rem;
        --spacing: .2625rem;
        --msq-enter: msq-settle; --msq-dur: .85s; --msq-ease: cubic-bezier(.16, 1, .3, 1); --msq-stagger: 90ms; --msq-row: msq-fade;
        --msq-spring: cubic-bezier(.34, 1.56, .64, 1);
        --msq-shadow: 0 1px 2px rgb(74 52 30 / .06), 0 10px 28px -14px rgb(74 52 30 / .22);
        --msq-shadow-hi: 0 2px 4px rgb(74 52 30 / .06), 0 24px 44px -18px rgb(74 52 30 / .34);
        &.dark {
          --color-accent: #fb923c; --color-accent-content: #fdba74; --color-accent-foreground: #1c1410;
          --msq-shadow: 0 1px 2px rgb(0 0 0 / .3), 0 10px 28px -14px rgb(0 0 0 / .6);
          --msq-shadow-hi: 0 2px 4px rgb(0 0 0 / .3), 0 24px 44px -18px rgb(0 0 0 / .75);
        }
        & body::before {
          content: ""; position: fixed; inset: 0; z-index: -1; pointer-events: none;
          background: radial-gradient(120% 70% at 50% -12%, rgb(254 215 170 / .55), transparent 62%);
        }
        &.dark body::before { background: radial-gradient(120% 70% at 50% -12%, rgb(251 146 60 / .09), transparent 62%); }
        & :is(h1, h2, h3, [data-flux-heading]) { font-family: var(--msq-serif); letter-spacing: -.012em; }
        & ${MAIN} h1 { font-weight: 600; }

        & ${HEADER} {
          background: color-mix(in srgb, var(--color-zinc-50) 90%, transparent) !important; backdrop-filter: blur(8px);
          border-bottom: 1px solid var(--color-zinc-200) !important;
          box-shadow: 0 1px 0 var(--color-zinc-100), 0 8px 22px -18px rgb(74 52 30 / .35) !important;
        }
        &.dark ${HEADER} { background: color-mix(in srgb, var(--color-zinc-950) 88%, transparent) !important; border-bottom-color: var(--color-zinc-800) !important; box-shadow: none !important; }
        & ${NAV} {
          background-color: transparent !important;
          background-image: linear-gradient(currentColor, currentColor) !important; background-repeat: no-repeat !important;
          background-position: 10px calc(100% - 3px) !important; background-size: 0 1.5px !important;
        }
        & ${NAV}::after { display: none !important; }
        & ${NAV}:hover { background-size: calc(100% - 20px) 1.5px !important; }
        & ${NAV}:is(${CURRENT}) { color: var(--color-accent-content) !important; background-size: calc(100% - 20px) 2px !important; }

        & ${CARD} {
          border-color: var(--color-zinc-200) !important; box-shadow: var(--msq-shadow);
          transition: transform .65s var(--msq-spring), box-shadow .65s var(--msq-ease);
        }
        &.dark ${CARD} { border-color: var(--color-zinc-800) !important; }
        & ${CARD}:hover { transform: translateY(-4px) rotate(-.25deg); box-shadow: var(--msq-shadow-hi); }
        & ${SOLID} { transition: transform .35s var(--msq-spring), box-shadow .25s ease, background-color .2s ease, filter .2s ease; }
        & ${PRIMARY} {
          transform: translateY(-1px);
          box-shadow: 0 3px 0 color-mix(in srgb, var(--color-accent) 55%, #000), 0 10px 20px -10px rgb(194 65 12 / .55) !important;
        }
        & ${PRIMARY}:hover { transform: translateY(-2px); filter: saturate(1.1); }
        & ${PRIMARY}:active:not(:disabled) { transform: translateY(2px); box-shadow: 0 0 0 color-mix(in srgb, var(--color-accent) 55%, #000) !important; }
        & ${INPUT}:focus { border-color: var(--color-accent) !important; box-shadow: 0 0 0 4px color-mix(in srgb, var(--color-accent) 16%, transparent) !important; outline: none; }
        & ${ROW}:hover { background-color: color-mix(in srgb, var(--color-accent) 5%, transparent) !important; }
        & ${BADGE} { border-radius: 6px; letter-spacing: .02em; }
        & ${MAIN} a:not([data-flux-button]) { text-underline-offset: 3px; text-decoration-thickness: 1px; }
        & ${MENU} { border-radius: var(--radius-xl); box-shadow: var(--msq-shadow-hi) !important; }
      }
    `,

    pop: `
      html[data-msq-theme="pop"] {
        ${neutrals('pop')}
        --color-accent: #ffd23f; --color-accent-content: #3346ff; --color-accent-foreground: #111;
        --font-sans: "Space Grotesk", "Archivo", "Avenir Next", "Segoe UI", system-ui, sans-serif;
        --radius-sm: .375rem; --radius-md: .5rem; --radius-lg: .625rem; --radius-xl: .75rem; --radius-2xl: 1rem;
        --msq-enter: msq-pop; --msq-dur: .6s; --msq-ease: cubic-bezier(.34, 1.56, .64, 1); --msq-stagger: 60ms; --msq-row: msq-slide;
        --msq-ink: #111; --msq-paper: #fff; --msq-hi: #fff1a8;
        &.dark { --color-accent-content: #a5b4fc; --msq-ink: #f4f4ef; --msq-paper: var(--color-zinc-900); --msq-hi: #3d3510; }
        & body::before {
          content: ""; position: fixed; inset: 0; z-index: -1; pointer-events: none;
          background-image: radial-gradient(color-mix(in srgb, var(--msq-ink) 16%, transparent) 1.2px, transparent 1.5px);
          background-size: 20px 20px;
        }
        & :is(h1, h2, [data-flux-heading]) { font-weight: 800; letter-spacing: -.02em; }

        & ${HEADER} {
          background: var(--msq-paper) !important; border-bottom: 3px solid var(--msq-ink) !important;
          box-shadow: 0 4px 0 var(--color-accent) !important;
        }
        & ${NAV} {
          border: 2px solid transparent; border-radius: 10px; font-weight: 700; font-size: 12px;
          text-transform: uppercase; letter-spacing: .05em;
        }
        & ${NAV}::after { display: none !important; }
        & ${NAV}:hover { transform: rotate(-2deg) translateY(-1px); background-color: var(--msq-hi) !important; border-color: var(--msq-ink); }
        & ${NAV}:is(${CURRENT}) {
          background-color: var(--color-accent) !important; color: #111 !important; border-color: var(--msq-ink);
          box-shadow: 3px 3px 0 var(--msq-ink);
        }
        & ${NAV}:is(${CURRENT}) * { color: #111 !important; }

        & ${CARD} {
          border: 2px solid var(--msq-ink) !important; border-radius: 14px; box-shadow: 5px 5px 0 var(--msq-ink);
          transition: transform .18s ease, box-shadow .18s ease;
        }
        & ${CARD}:hover { transform: translate(-2px, -2px); box-shadow: 7px 7px 0 var(--msq-ink); }
        & ${SOLID} {
          border: 2px solid var(--msq-ink) !important; box-shadow: 3px 3px 0 var(--msq-ink) !important; font-weight: 700;
          transition: transform .12s ease, box-shadow .12s ease, background-color .15s ease;
        }
        & ${SOLID}:hover { transform: translate(-1px, -1px); box-shadow: 4px 4px 0 var(--msq-ink) !important; }
        & ${SOLID}:active:not(:disabled) { transform: translate(3px, 3px); box-shadow: 0 0 0 var(--msq-ink) !important; }
        & ${PRIMARY} { background-color: var(--color-accent) !important; color: #111 !important; }
        & ${INPUT} { border: 2px solid var(--msq-ink) !important; border-radius: 10px; box-shadow: none !important; }
        & ${INPUT}:focus { transform: translate(-1px, -1px); box-shadow: 3px 3px 0 var(--color-accent-content) !important; outline: none; }
        & ${BADGE} { border: 1.5px solid var(--msq-ink); border-radius: 6px; font-weight: 700; }
        & ${ROW}:hover { background-color: var(--msq-hi) !important; }
        & ${HEAD_CELL} { text-transform: uppercase; font-size: 11px; letter-spacing: .08em; font-weight: 800; border-bottom: 2px solid var(--msq-ink); }
        & ${MENU} { border: 2px solid var(--msq-ink) !important; border-radius: 12px; box-shadow: 5px 5px 0 var(--msq-ink) !important; }
        & dialog[open] { border: 3px solid var(--msq-ink); box-shadow: 10px 10px 0 var(--msq-ink); }
        & [data-flux-avatar] { outline: 2px solid var(--msq-ink); }
      }
    `,

    neon: `
      html[data-msq-theme="neon"] {
        ${neutrals('neon')}
        --color-accent: #22d3ee; --color-accent-content: #67e8f9; --color-accent-foreground: #04121a;
        --font-sans: "Inter", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif;
        --msq-mono: "JetBrains Mono", "Fira Code", "SF Mono", ui-monospace, Menlo, Consolas, monospace;
        --radius-sm: .25rem; --radius-md: .375rem; --radius-lg: .5rem; --radius-xl: .625rem; --radius-2xl: .875rem;
        --msq-enter: msq-boot; --msq-dur: .65s; --msq-ease: cubic-bezier(.22, 1, .36, 1); --msq-stagger: 75ms; --msq-row: msq-slide;
        --msq-cy: 34 211 238; --msq-mag: 217 70 239;
        color-scheme: dark;
        scrollbar-color: rgb(var(--msq-cy) / .35) transparent;
        & body { background-color: #05080d !important; }
        & body::before {
          content: ""; position: fixed; inset: 0; z-index: -1; pointer-events: none;
          background:
            radial-gradient(60% 50% at 50% -10%, rgb(var(--msq-cy) / .18), transparent 70%),
            radial-gradient(40% 40% at 100% 100%, rgb(var(--msq-mag) / .12), transparent 70%),
            linear-gradient(rgb(var(--msq-cy) / .05) 1px, transparent 1px) 0 0 / 34px 34px,
            linear-gradient(90deg, rgb(var(--msq-cy) / .05) 1px, transparent 1px) 0 0 / 34px 34px;
        }
        & ::selection { background: rgb(var(--msq-cy) / .35); color: #fff; }
        & :is(h1, h2, h3, [data-flux-heading], ${HEAD_CELL}, ${BADGE}, code, kbd) { font-family: var(--msq-mono); }
        & ${MAIN} h1 { letter-spacing: -.01em; text-shadow: 0 0 22px rgb(var(--msq-cy) / .4); }

        & ${HEADER} {
          background-color: rgb(5 8 13 / .72) !important;
          background-image:
            linear-gradient(transparent, transparent),
            linear-gradient(90deg, transparent, rgb(var(--msq-cy)), rgb(var(--msq-mag)), transparent);
          background-repeat: no-repeat; background-size: 100% 100%, 30% 1px; background-position: 0 0, -60% 100%;
          animation: msq-drop calc(var(--msq-dur) * 1.1) var(--msq-ease) backwards, msq-scan 5.5s linear infinite;
          backdrop-filter: blur(14px) saturate(1.4);
          border-bottom: 1px solid rgb(var(--msq-cy) / .22) !important;
          box-shadow: 0 10px 30px -22px rgb(var(--msq-cy) / .8) !important;
        }
        & ${NAV} { font-family: var(--msq-mono); font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: var(--color-zinc-300); }
        & ${NAV}:hover { color: #e6fbff !important; background-color: rgb(var(--msq-cy) / .06) !important; animation: msq-glitch .35s steps(2) 1; }
        & ${NAV}:is(${CURRENT}) {
          color: var(--color-accent) !important; background-color: rgb(var(--msq-cy) / .09) !important;
          text-shadow: 0 0 12px rgb(var(--msq-cy) / .75);
        }
        & ${NAV}:is(${CURRENT})::after { background: var(--color-accent) !important; box-shadow: 0 0 10px rgb(var(--msq-cy)); }

        & ${CARD} {
          background-color: rgb(10 15 23 / .78) !important; backdrop-filter: blur(6px);
          border: 1px solid rgb(var(--msq-cy) / .14) !important;
          transition: border-color .25s ease, box-shadow .3s ease, transform .3s var(--msq-ease);
        }
        & ${CARD}:hover {
          border-color: rgb(var(--msq-cy) / .5) !important; transform: translateY(-2px);
          box-shadow: 0 0 0 1px rgb(var(--msq-cy) / .15), 0 0 34px -8px rgb(var(--msq-cy) / .45);
        }
        & :is(${CARD}, ${ROW}):hover {
          background-image: radial-gradient(320px circle at var(--msq-x, 50%) var(--msq-y, 50%), rgb(var(--msq-cy) / .12), transparent 60%);
        }
        & ${PRIMARY} { font-weight: 600; box-shadow: 0 0 0 1px rgb(var(--msq-cy) / .6), 0 0 22px -4px rgb(var(--msq-cy) / .75) !important; }
        & ${PRIMARY}:hover { filter: brightness(1.12); box-shadow: 0 0 0 1px rgb(var(--msq-cy)), 0 0 34px -2px rgb(var(--msq-cy) / .95) !important; }
        & ${INPUT} { background-color: rgb(5 8 13 / .6) !important; border-color: rgb(var(--msq-cy) / .2) !important; }
        & ${INPUT}:focus { border-color: var(--color-accent) !important; box-shadow: 0 0 0 3px rgb(var(--msq-cy) / .18), 0 0 20px -6px rgb(var(--msq-cy) / .8) !important; outline: none; }
        & ${ROW}:hover { background-color: rgb(var(--msq-cy) / .05) !important; box-shadow: inset 2px 0 0 var(--color-accent); }
        & ${BADGE} { text-transform: uppercase; letter-spacing: .05em; font-size: 10.5px; }
        & :is(${MENU}, dialog[open]) {
          background: rgb(8 12 20 / .94) !important; backdrop-filter: blur(12px);
          border: 1px solid rgb(var(--msq-cy) / .25) !important; box-shadow: 0 0 44px -12px rgb(var(--msq-cy) / .55) !important;
        }
      }
    `,
  };

  const byId = (id) => THEMES.find((t) => t.id === id) || null;
  // Stylesheet for a look; '' for Classic (or an unknown id).
  const css = (id) => (LOOKS[id] ? COMMON + LOOKS[id] : '');

  // Cursor tracking for the hovered card/row (and, for motion looks, button):
  // --msq-x/--msq-y is the pointer relative to it (glows, ripple origin) and
  // --msq-nx/--msq-ny the same from -1 to 1 around its centre (tilt, magnet).
  // getLook() returns the look on screen. Only custom properties are set.
  function spotlight(win, getLook) {
    let frame = 0;
    let last = null;
    const track = () => {
      frame = 0;
      const look = getLook();
      const el = (look?.motion && last?.target?.closest?.(BUTTON)) || last?.target?.closest?.(SPOTLIGHT);
      if (!el) return;
      const r = el.getBoundingClientRect();
      const x = last.clientX - r.left;
      const y = last.clientY - r.top;
      el.style.setProperty('--msq-x', `${Math.round(x)}px`);
      el.style.setProperty('--msq-y', `${Math.round(y)}px`);
      if (!look?.motion || !r.width || !r.height) return;
      const clamp = (v) => Math.max(-1, Math.min(1, v)).toFixed(3);
      el.style.setProperty('--msq-nx', clamp((x / r.width) * 2 - 1));
      el.style.setProperty('--msq-ny', clamp((y / r.height) * 2 - 1));
    };
    const on = (e) => {
      if (!getLook()?.spotlight) return;
      last = e;
      if (e.type === 'pointerdown') track();
      else if (!frame) frame = win.requestAnimationFrame(track);
    };
    win.addEventListener('pointermove', on, { passive: true, capture: true });
    win.addEventListener('pointerdown', on, { passive: true, capture: true });
  }

  // Motion looks: the header's tab pill (a ::before on the navbar) follows the
  // hovered tab and returns to the current one. The navbar gets the target's box
  // as --msq-ind-*; CSS springs the pill there. Returns settle(), which puts it
  // back on the current tab (call it after the page redraws).
  function glide(win, getLook) {
    const doc = win.document;
    const place = (nav, item) => {
      if (!item) {
        nav.style.setProperty('--msq-ind-w', '0px');
        return;
      }
      const n = nav.getBoundingClientRect();
      const r = item.getBoundingClientRect();
      nav.style.setProperty('--msq-ind-x', `${Math.round(r.left - n.left)}px`);
      nav.style.setProperty('--msq-ind-y', `${Math.round(r.top - n.top)}px`);
      nav.style.setProperty('--msq-ind-w', `${Math.round(r.width)}px`);
      nav.style.setProperty('--msq-ind-h', `${Math.round(r.height)}px`);
    };
    const current = (nav) => nav.querySelector(':scope > :is([data-current], [aria-current="page"])');
    const settle = () => {
      if (!getLook()?.motion) return;
      for (const nav of doc.querySelectorAll('[data-flux-navbar]')) {
        if (!nav.matches(':hover')) place(nav, current(nav));
      }
    };
    doc.addEventListener('pointerover', (e) => {
      if (!getLook()?.motion) return;
      const item = e.target.closest?.('[data-flux-navbar] > *');
      if (item) place(item.parentElement, item);
    }, { passive: true });
    doc.addEventListener('pointerout', (e) => {
      if (!getLook()?.motion) return;
      const nav = e.target.closest?.('[data-flux-navbar]');
      if (nav && !nav.contains(e.relatedTarget)) place(nav, current(nav));
    }, { passive: true });
    win.addEventListener('resize', settle, { passive: true });
    win.addEventListener('load', settle);
    doc.addEventListener('DOMContentLoaded', settle);
    doc.fonts?.ready.then(settle, () => {});
    return settle;
  }

  return { STORAGE_KEY, DEFAULT, THEMES, byId, css, spotlight, glide };
})();
