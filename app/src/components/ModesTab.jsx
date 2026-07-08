import React, { useEffect, useState } from 'react';
import { useTelemetry } from '../telemetry';

// Aux switch range editor — Betaflight's Modes tab. When connected, a live
// marker shows the actual switch position inside each range, so you can see
// a mode activate as you flip the switch.
const COMMON_BOXES = [
  { id: 0, name: 'ARM' }, { id: 1, name: 'ANGLE' }, { id: 2, name: 'HORIZON' },
  { id: 13, name: 'BEEPER' }, { id: 26, name: 'BLACKBOX' }, { id: 27, name: 'FAILSAFE' },
  { id: 28, name: 'AIR MODE' }, { id: 35, name: 'CAMERA CONTROL 2' },
  { id: 37, name: 'FLIP OVER AFTER CRASH' }, { id: 38, name: 'PREARM' },
  { id: 40, name: 'VTX PIT MODE' }, { id: 46, name: 'PARALYZE' }, { id: 47, name: 'GPS RESCUE' },
];

export default function ModesTab() {
  const [slots, setSlots] = useState(null);   // from /api/modes
  const [edits, setEdits] = useState({});     // slot -> edited slot object
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState(null);
  const { connected, telemetry } = useTelemetry();
  const rc = telemetry?.rc?.channels || [];

  async function load() {
    setLoading(true); setError(null); setEdits({});
    try {
      const j = await (await fetch('/api/modes')).json();
      if (!j.ok) throw new Error(j.error || 'read failed');
      setSlots(j.slots);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  const merged = (slots || []).map(s => edits[s.slot] ? { ...s, ...edits[s.slot] } : s);
  const changedSlots = merged.filter((s, i) => {
    const orig = slots[i];
    return s.boxId !== orig.boxId || s.auxChannel !== orig.auxChannel || s.start !== orig.start || s.end !== orig.end;
  });

  function edit(slot, patch) {
    setEdits(e => ({ ...e, [slot]: { ...(e[slot] || {}), ...patch } }));
  }

  async function apply() {
    setConfirm(false); setApplying(true); setError(null);
    try {
      const commands = [
        ...changedSlots.map(s => `aux ${s.slot} ${s.boxId} ${s.auxChannel} ${s.start} ${s.end} ${s.logic || 0} ${s.linkedTo || 0}`),
        'save',
      ];
      const tr = await fetch('/api/safety/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'config.write', acknowledged: true, backupTaken: true }),
      });
      const tj = await tr.json();
      if (!tj.ok) throw new Error(tj.error || 'token refused');
      const r = await fetch('/api/cli/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tj.token, commands }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'apply failed');
      await new Promise(r2 => setTimeout(r2, 3500));
      await load();
    } catch (e) { setError(e.message); }
    finally { setApplying(false); }
  }

  const activeSlots = merged.filter(s => s.active || edits[s.slot]);
  const spareSlot = merged.find(s => !s.active && !edits[s.slot]);

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Modes</h1>
          <p className="text-stack-muted mt-1">
            Map modes to switch ranges. {connected ? 'Live markers show your actual switch position — flip a switch and watch.' : 'Connect for live switch markers.'}
          </p>
        </div>
        <button className="btn-ghost text-sm shrink-0" disabled={loading || applying} onClick={load}>
          {loading ? 'Reading…' : 'Re-read from FC'}
        </button>
      </div>

      {error && <div className="panel p-4 border-stack-err text-stack-err text-sm">{error}</div>}
      {!slots && !error && <div className="panel p-4 text-sm text-stack-muted">{loading ? 'Reading aux ranges…' : 'Plug in an FC to read modes.'}</div>}

      {slots && (
        <>
          <section className="space-y-3">
            {activeSlots.length === 0 && (
              <div className="panel p-4 text-sm text-stack-muted">No modes configured yet — add one below (you need at least ARM).</div>
            )}
            {activeSlots.map(s => (
              <ModeRow key={s.slot} s={s} rc={rc} connected={connected} onEdit={patch => edit(s.slot, patch)} />
            ))}
          </section>

          {spareSlot && (
            <button className="btn-ghost text-sm"
              onClick={() => edit(spareSlot.slot, { boxId: spareSlot.boxId, auxChannel: 0, start: 1700, end: 2100 })}>
              + Add mode (slot {spareSlot.slot})
            </button>
          )}

          <div className="panel p-4 flex items-center justify-between gap-4">
            <div className="text-sm text-stack-muted">
              {changedSlots.length
                ? <span className="text-stack-warn font-semibold">{changedSlots.length} slot(s) changed — not yet on the FC</span>
                : 'No pending changes'}
            </div>
            <button className={changedSlots.length ? 'btn-primary text-sm' : 'btn-ghost text-sm opacity-50 cursor-not-allowed'}
              disabled={!changedSlots.length || applying} onClick={() => setConfirm(true)}>
              {applying ? 'Applying…' : 'Apply + save'}
            </button>
          </div>
        </>
      )}

      {confirm && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="panel p-6 max-w-lg w-full">
            <h2 className="text-xl font-semibold text-stack-warn">⚠ Write mode ranges to FC</h2>
            <pre className="mt-3 bg-stack-bg border border-stack-border rounded p-3 text-xs font-mono max-h-40 overflow-auto">
              {changedSlots.map(s => `aux ${s.slot} ${s.boxId} ${s.auxChannel} ${s.start} ${s.end} 0 0`).join('\n') + '\nsave'}
            </pre>
            <p className="text-sm text-stack-muted mt-2">
              Wrong ARM ranges are how quads arm in your hand. Verify with props OFF before any battery test.
            </p>
            <div className="mt-5 flex gap-3 justify-end">
              <button className="btn-ghost" onClick={() => setConfirm(false)}>Cancel</button>
              <button className="btn-primary" onClick={apply}>I have a backup — write it</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ModeRow({ s, rc, connected, onEdit }) {
  // aux channel 0 = AUX1 = RC channel index 4
  const liveValue = connected ? rc[s.auxChannel + 4] : null;
  const inRange = liveValue != null && liveValue >= s.start && liveValue <= s.end;
  const pos = liveValue != null ? Math.max(0, Math.min(100, ((liveValue - 900) / 1200) * 100)) : null;
  const left = ((s.start - 900) / 1200) * 100;
  const width = Math.max(0, ((s.end - s.start) / 1200) * 100);
  const boxKnown = COMMON_BOXES.some(b => b.id === s.boxId);

  return (
    <div className={['panel p-4', inRange ? 'border-stack-accent/70' : ''].join(' ')}>
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <select value={s.boxId} onChange={e => onEdit({ boxId: +e.target.value })}
          className="bg-stack-bg border border-stack-border rounded px-2 py-1 text-sm font-mono">
          {COMMON_BOXES.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          {!boxKnown && <option value={s.boxId}>{s.boxName}</option>}
        </select>
        <select value={s.auxChannel} onChange={e => onEdit({ auxChannel: +e.target.value })}
          className="bg-stack-bg border border-stack-border rounded px-2 py-1 text-sm font-mono">
          {Array.from({ length: 12 }, (_, i) => <option key={i} value={i}>AUX{i + 1}</option>)}
        </select>
        <label className="text-xs text-stack-muted flex items-center gap-1.5">from
          <input value={s.start} onChange={e => onEdit({ start: +e.target.value || 900 })}
            className="w-16 bg-stack-bg border border-stack-border rounded px-2 py-1 font-mono text-xs" />
        </label>
        <label className="text-xs text-stack-muted flex items-center gap-1.5">to
          <input value={s.end} onChange={e => onEdit({ end: +e.target.value || 900 })}
            className="w-16 bg-stack-bg border border-stack-border rounded px-2 py-1 font-mono text-xs" />
        </label>
        {inRange && <span className="pill-ok ml-auto">ACTIVE</span>}
        {connected && !inRange && liveValue != null && <span className="pill-muted ml-auto">{liveValue}</span>}
      </div>

      <div className="h-4 bg-stack-bg border border-stack-border rounded relative overflow-hidden">
        <div className="absolute inset-y-0 bg-stack-accent/30 border-x border-stack-accent"
          style={{ left: `${left}%`, width: `${width}%` }} />
        {pos != null && (
          <div className={`absolute inset-y-0 w-0.5 ${inRange ? 'bg-stack-accent' : 'bg-stack-text'}`}
            style={{ left: `${pos}%`, transition: 'left 80ms linear' }} />
        )}
        <div className="absolute inset-y-0 left-1/2 w-px bg-stack-border" />
      </div>
      <div className="flex justify-between text-[10px] font-mono text-stack-muted mt-1">
        <span>900</span><span>1500</span><span>2100</span>
      </div>
    </div>
  );
}
