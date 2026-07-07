import React, { useEffect, useState } from 'react';
import { useTelemetry } from '../telemetry';

// Betaflight-style bottom status strip. Prefers live telemetry when
// connected; falls back to the last scan otherwise.
export default function StatusBar() {
  const [health, setHealth] = useState(null);
  const [scan, setScan] = useState(null);
  const { connected, telemetry } = useTelemetry();

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
      {item('link', connected ? 'live' : (health ? (health.serialBusy ? 'busy' : 'idle') : '—'))}
      {fc && item('board', `${fc.boardName || '?'}${fc.manufacturerId ? ` (${fc.manufacturerId})` : ''}`)}
      {fc?.firmware && item('firmware', `BF ${fc.firmware}`)}
      {connected && telemetry?.analog && item('vbat', `${telemetry.analog.voltage.toFixed(2)}V`)}
      {connected && telemetry?.analog && item('amps', `${telemetry.analog.amperage.toFixed(1)}A`)}
      {connected && telemetry?.status && item('cycle', `${telemetry.status.cycleTime}µs`)}
      {!connected && fc?.health?.cycleTime && item('cycle', `${fc.health.cycleTime}µs`)}
      {!connected && !fc && <span className="text-stack-muted">no scan yet — connect or run one in Setup</span>}
      <span className="ml-auto text-stack-muted">backend v{health?.version || '—'}</span>
    </footer>
  );
}
