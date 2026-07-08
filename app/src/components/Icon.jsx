import React from 'react';

// Minimal stroke icons for the Betaflight-style sidebar. 24x24 viewBox.
const PATHS = {
  // quad / setup
  setup: (
    <>
      <circle cx="6" cy="6" r="3" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="18" r="3" />
      <path d="M8 8l8 8M16 8l-8 8" />
    </>
  ),
  // motor / fan
  motors: (
    <>
      <circle cx="12" cy="12" r="2.5" />
      <path d="M12 9.5C12 5 15 3.5 18 4.5c-1 3-2.5 4.5-6 5M14.5 12c4.5 0 6 3 5 6-3-1-4.5-2.5-5-6M9.5 12c-4.5 0-6-3-5-6 3 1 4.5 2.5 5 6M12 14.5c0 4.5-3 6-6 5 1-3 2.5-4.5 6-5" />
    </>
  ),
  // ESC chip
  esc: (
    <>
      <rect x="6" y="6" width="12" height="12" rx="1.5" />
      <path d="M9 6V3M15 6V3M9 21v-3M15 21v-3M6 9H3M6 15H3M21 9h-3M21 15h-3" />
    </>
  ),
  // config / terminal
  config: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="1.5" />
      <path d="M7 9l3 3-3 3M12 15h5" />
    </>
  ),
  // checklists
  checklists: (
    <>
      <path d="M4 6h2M4 12h2M4 18h2M9 6h11M9 12h11M9 18h11" />
    </>
  ),
  // AI chat
  chat: (
    <>
      <path d="M4 5h16v11H9l-5 4V5z" />
      <path d="M8.5 10.5h.01M12 10.5h.01M15.5 10.5h.01" />
    </>
  ),
  // receiver / radio
  receiver: (
    <>
      <path d="M12 12l-6 9M12 12l6 9M12 12V5" />
      <path d="M8 5a6 6 0 018 0M6 3a9 9 0 0112 0" />
      <circle cx="12" cy="12" r="1.2" />
    </>
  ),
  // modes / switch
  modes: (
    <>
      <rect x="3" y="9" width="18" height="6" rx="3" />
      <circle cx="16" cy="12" r="2.2" />
    </>
  ),
  // tune / sliders
  tune: (
    <>
      <path d="M5 4v6M5 14v6M12 4v10M12 18v2M19 4v2M19 10v10" />
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="16" r="2" />
      <circle cx="19" cy="8" r="2" />
    </>
  ),
  // ports / plug
  ports: (
    <>
      <rect x="7" y="3" width="10" height="8" rx="1" />
      <path d="M10 3V1M14 3V1M12 11v4M12 15c0 3-2 4-4 4H6M12 15c0 3 2 4 4 4h2" />
    </>
  ),
  // presets / gift box
  presets: (
    <>
      <rect x="4" y="8" width="16" height="12" rx="1" />
      <path d="M4 12h16M12 8v12M12 8c-4 0-5-5-2-5s2 5 2 5zM12 8c4 0 5-5 2-5s-2 5-2 5z" />
    </>
  ),
  // osd / screen overlay
  osd: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="1.5" />
      <path d="M6 9h4M14 9h4M9 15h6" />
    </>
  ),
  // failsafe / parachute
  failsafe: (
    <>
      <path d="M4 10a8 8 0 0116 0" />
      <path d="M4 10c2.5 2 5.5 2 8 0 2.5 2 5.5 2 8 0" />
      <path d="M4 10l7 8M20 10l-7 8M12 12v6" />
      <circle cx="12" cy="19.5" r="1.5" />
    </>
  ),
  // gps / location pin
  gps: (
    <>
      <path d="M12 21s-7-6.1-7-11a7 7 0 0114 0c0 4.9-7 11-7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  // vtx / broadcast antenna
  vtx: (
    <>
      <path d="M12 9v11" />
      <circle cx="12" cy="7.5" r="1.5" />
      <path d="M8.5 4a6 6 0 000 7M15.5 4a6 6 0 010 7" />
      <path d="M5.8 1.8a9.5 9.5 0 000 11.4M18.2 1.8a9.5 9.5 0 010 11.4" />
    </>
  ),
  // sensors / waveform
  sensors: (
    <>
      <path d="M3 12h3l2-6 4 12 3-9 2 3h4" />
    </>
  ),
  // blackbox / flight recorder
  blackbox: (
    <>
      <rect x="4" y="8" width="16" height="12" rx="1.5" />
      <path d="M4 12h16M8 8V5a4 4 0 018 0v3" />
      <path d="M7 16h2M11 16h2M15 16h2" />
    </>
  ),
  // firmware flash
  flash: (
    <>
      <path d="M13 2L5 13h5l-1 9 8-11h-5l1-9z" />
    </>
  ),
};

export default function Icon({ name, className = 'w-5 h-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {PATHS[name] || <circle cx="12" cy="12" r="8" />}
    </svg>
  );
}
