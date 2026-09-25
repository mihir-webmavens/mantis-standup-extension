// Corner-button looks, shared by the toolbar popup (previews) and content.js
// (the real button). Each style only restyles .fab-scroll / .fab; layout and
// behaviour live in content.js.

const ButtonStyles = (() => {
  const STORAGE_KEY = 'buttonStyle';
  const DEFAULT = 'aurora';

  // Shape, size and the shared hover/press/hint effects.
  const BASE = `
    .fab-scroll {
      display: grid; grid-auto-rows: 44px; height: 44px;
      overflow-y: auto; overscroll-behavior: contain; scroll-snap-type: y mandatory;
      scrollbar-width: none; border-radius: 999px;
      transition: transform .2s ease, box-shadow .2s ease;
    }
    .fab-scroll::-webkit-scrollbar { display: none; }
    .fab-scroll:hover { transform: translateY(-2px); }
    .fab {
      position: relative; overflow: hidden; scroll-snap-align: start; width: 100%; height: 44px;
      display: flex; align-items: center; justify-content: center; gap: 8px;
      border: 0; border-radius: 999px;
      padding: 0 18px; font-size: 14px; font-weight: 700; letter-spacing: .02em; cursor: pointer; white-space: nowrap;
      transition: transform .12s ease;
    }
    /* Light sweep across the button on hover. */
    .fab::before {
      content: ""; position: absolute; top: 0; bottom: 0; left: -75%; width: 50%;
      background: linear-gradient(100deg, transparent, rgba(255,255,255,.45), transparent);
      transform: skewX(-20deg); pointer-events: none;
    }
    .fab:hover::before { animation: fab-shine .8s ease; }
    .fab::after { content: "↕"; font-size: 12px; opacity: .75; animation: fab-nudge 2.4s ease-in-out infinite; }
    .fab:active { transform: scale(.95); }
    .fab:focus-visible { outline: 2px solid #fff; outline-offset: -4px; }
    @keyframes fab-shine { to { left: 130%; } }
    @keyframes fab-nudge { 0%, 70%, 100% { transform: translateY(0); } 80% { transform: translateY(-2px); } 90% { transform: translateY(2px); } }
    @keyframes fab-flow { from { background-position: 0% 0; } to { background-position: 200% 0; } }
  `;

  const REDUCED_MOTION = `
    @media (prefers-reduced-motion: reduce) {
      .fab, .fab::before, .fab::after, .fab-scroll, .fab:hover::before { animation: none !important; }
      .fab-scroll, .fab { transition: none !important; }
    }
  `;

  const STYLES = [
    {
      id: 'aurora', name: 'Aurora', description: 'Violet to pink, flowing glow',
      css: `
        .fab-scroll {
          box-shadow: 0 8px 24px rgba(124,58,237,.35), inset 0 0 0 1px rgba(255,255,255,.15);
          animation: aurora-glow 4s ease-in-out infinite;
        }
        .fab-scroll:hover { box-shadow: 0 12px 30px rgba(219,39,119,.4), inset 0 0 0 1px rgba(255,255,255,.2); }
        .fab {
          background: linear-gradient(120deg, #7c3aed 0%, #db2777 50%, #7c3aed 100%);
          background-size: 200% 100%; animation: fab-flow 6s linear infinite; color: #fff;
        }
        @keyframes aurora-glow {
          0%, 100% { box-shadow: 0 8px 24px rgba(124,58,237,.35), inset 0 0 0 1px rgba(255,255,255,.15); }
          50% { box-shadow: 0 8px 28px rgba(219,39,119,.45), inset 0 0 0 1px rgba(255,255,255,.15); }
        }
      `,
    },
    {
      id: 'sunset', name: 'Sunset', description: 'Warm orange, pink and amber',
      css: `
        .fab-scroll { box-shadow: 0 8px 24px rgba(249,115,22,.38); }
        .fab-scroll:hover { box-shadow: 0 12px 30px rgba(236,72,153,.42); }
        .fab {
          background: linear-gradient(90deg, #f97316 0%, #ec4899 50%, #f97316 100%);
          background-size: 200% 100%; animation: fab-flow 5s linear infinite;
          color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,.18);
        }
      `,
    },
    {
      id: 'mint', name: 'Mint', description: 'Fresh emerald and teal',
      css: `
        .fab-scroll { box-shadow: 0 8px 24px rgba(16,185,129,.35); }
        .fab-scroll:hover { box-shadow: 0 12px 30px rgba(20,184,166,.45); }
        .fab {
          background: linear-gradient(90deg, #059669 0%, #14b8a6 50%, #059669 100%);
          background-size: 200% 100%; animation: fab-flow 6s linear infinite; color: #fff;
        }
      `,
    },
    {
      id: 'ember', name: 'Ember', description: 'Hot gradient with a pulsing glow',
      css: `
        .fab-scroll { animation: ember-pulse 1.8s ease-in-out infinite; }
        .fab {
          background: linear-gradient(90deg, #dc2626 0%, #f97316 35%, #facc15 50%, #f97316 65%, #dc2626 100%);
          background-size: 200% 100%; animation: fab-flow 3s linear infinite;
          color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,.3);
        }
        @keyframes ember-pulse {
          0%, 100% { box-shadow: 0 6px 18px rgba(239,68,68,.35); }
          50% { box-shadow: 0 10px 30px rgba(249,115,22,.6); }
        }
      `,
    },
    {
      id: 'neon', name: 'Neon', description: 'Dark with a cyan/magenta glow',
      css: `
        .fab-scroll { animation: neon-glow 3s ease-in-out infinite alternate; }
        .fab {
          background: #0b0b14; color: #67e8f9; border: 1.5px solid #22d3ee;
          text-shadow: 0 0 8px rgba(34,211,238,.8);
          animation: neon-line 3s ease-in-out infinite alternate;
        }
        .fab::before { background: linear-gradient(100deg, transparent, rgba(103,232,249,.25), transparent); }
        .fab:focus-visible { outline-color: #67e8f9; }
        @keyframes neon-line {
          from { border-color: #22d3ee; color: #67e8f9; text-shadow: 0 0 8px rgba(34,211,238,.8); }
          to { border-color: #e879f9; color: #f5d0fe; text-shadow: 0 0 8px rgba(232,121,249,.8); }
        }
        @keyframes neon-glow {
          from { box-shadow: 0 0 16px rgba(34,211,238,.5), 0 0 34px rgba(34,211,238,.2); }
          to { box-shadow: 0 0 16px rgba(232,121,249,.5), 0 0 34px rgba(232,121,249,.2); }
        }
      `,
    },
    {
      id: 'midnight', name: 'Midnight', description: 'Sleek black with a violet edge',
      css: `
        .fab-scroll { box-shadow: 0 8px 24px rgba(0,0,0,.35); }
        .fab-scroll:hover { box-shadow: 0 12px 30px rgba(0,0,0,.45), 0 0 22px rgba(139,92,246,.45); }
        .fab {
          background: linear-gradient(180deg, #27272a, #09090b); color: #fafafa;
          box-shadow: inset 0 0 0 1px rgba(255,255,255,.1);
          transition: transform .12s ease, box-shadow .2s ease;
        }
        .fab:hover { box-shadow: inset 0 0 0 1px rgba(167,139,250,.75); }
        .fab::before { background: linear-gradient(100deg, transparent, rgba(255,255,255,.16), transparent); }
        .fab::after { color: #a78bfa; opacity: 1; }
      `,
    },
    {
      id: 'glass', name: 'Glass', description: 'Frosted, see-through and light',
      css: `
        .fab-scroll { box-shadow: 0 8px 28px rgba(15,23,42,.2); }
        .fab-scroll:hover { box-shadow: 0 12px 32px rgba(15,23,42,.28); }
        .fab {
          background: rgba(255,255,255,.6); color: #3b0764;
          -webkit-backdrop-filter: blur(12px) saturate(1.6); backdrop-filter: blur(12px) saturate(1.6);
          box-shadow: inset 0 0 0 1px rgba(255,255,255,.85), inset 0 -1px 0 rgba(15,23,42,.08);
        }
        .fab::before { background: linear-gradient(100deg, transparent, rgba(255,255,255,.8), transparent); }
        .fab::after { color: #7c3aed; }
        .fab:focus-visible { outline-color: #7c3aed; }
      `,
    },
    {
      id: 'outline', name: 'Outline', description: 'Gradient border, fills on hover',
      css: `
        .fab-scroll { box-shadow: 0 6px 18px rgba(124,58,237,.18); }
        .fab {
          background: linear-gradient(#fff, #fff) padding-box, linear-gradient(120deg, #7c3aed, #db2777) border-box;
          border: 2px solid transparent; color: #7c3aed;
          transition: transform .12s ease, color .2s ease;
        }
        .fab:hover { background: linear-gradient(120deg, #7c3aed, #db2777) padding-box, linear-gradient(120deg, #7c3aed, #db2777) border-box; color: #fff; }
        .fab:focus-visible { outline-color: #7c3aed; }
      `,
    },
    {
      id: 'candy', name: 'Candy', description: 'Soft pastels with a gentle bounce',
      css: `
        .fab-scroll { box-shadow: 0 8px 22px rgba(236,72,153,.25); animation: candy-bob 2.8s ease-in-out infinite; }
        .fab {
          background: linear-gradient(90deg, #fbcfe8 0%, #ddd6fe 33%, #fed7aa 66%, #fbcfe8 100%);
          background-size: 200% 100%; animation: fab-flow 8s linear infinite; color: #831843;
        }
        .fab::after { color: #9d174d; }
        .fab:focus-visible { outline-color: #9d174d; }
        @keyframes candy-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
      `,
    },
    {
      id: 'minimal', name: 'Minimal', description: 'Flat charcoal, no animation',
      css: `
        .fab-scroll { box-shadow: 0 4px 14px rgba(0,0,0,.2); }
        .fab-scroll:hover { transform: none; }
        .fab { background: #1f2937; color: #f9fafb; font-weight: 600; letter-spacing: 0; transition: transform .12s ease, background .15s ease; }
        .fab:hover { background: #111827; }
        .fab::before { display: none; }
        .fab::after { animation: none; opacity: .5; }
      `,
    },
  ];

  const byId = (id) => STYLES.find((s) => s.id === id) || STYLES.find((s) => s.id === DEFAULT);

  return {
    STORAGE_KEY,
    DEFAULT,
    STYLES,
    // Full stylesheet for one style; unknown ids fall back to the default.
    css: (id) => BASE + byId(id).css + REDUCED_MOTION,
  };
})();
