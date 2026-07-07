import React, { useEffect, useState } from 'react';

// Betaflight-style bottom status strip: board identity from the last scan,
// serial-mutex state, backend version.
export default function StatusBar() {
  const [health, setHealth] = useState(null);
  const [scan, setScan] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const j = await (await fetch('/api/health')).json();
        if (!cancelled) setHealth(j);
      } catch { if (!cancelled) setHealth(null); }
      try { setScan(JSON.parse(localStorage.getItem('st:lastScan'))); } catch {}
    }
    poll();
    const i = setInterval(poll, 3000);
    return () => { cancelled = true; clearInterval(i); };
  }, []);

  const fc = scan?.fc;
  const item = (label, value) => (
    <span className="whitespace-nowrap">
      <span className="text-stack-muted">{label}: </span>
      <span className="text-stack-text">{value}</span>
    </span>
  );

  return (
    <footer className="h-8 bg-stack-header border-t border-stack-border px-4 flex items-center gap-5 text-[11px] font-mono overflow-x-auto shrink-0">
      {item('serial', health ? (health.serialBusy ? 'busy' : 'idle') : '—')}
      {fc && item('board', `${fc.boardName || '?'}${fc.manufacturerId ? ` (${fc.manufacturerId})` : ''}`)}
      {fc?.firmware && item('firmware', `BF ${fc.firmware}`)}
      {fc?.mcuType && item('mcu', fc.mcuType)}
      {fc?.health?.cycleTime && item('cycle', `${fc.health.cycleTime}µs`)}
      {!fc && <span className="text-stack-muted">no scan yet — run one in Setup</span>}
      <span className="ml-auto text-stack-muted">backend v{health?.version || '—'}</span>
    </footer>
  );
}
