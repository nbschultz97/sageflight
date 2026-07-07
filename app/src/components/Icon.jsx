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
