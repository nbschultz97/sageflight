import React, { useEffect, useState } from 'react';
import { useDirty } from '../dirty';

// UART function assignment — Betaflight's Ports tab. Function bitmask table
// mirrors lib/cli-parsers.js SERIAL_FUNCTIONS.
const FUNCTIONS = [
  { bit: 1, name: 'MSP' },
  { bit: 2, name: 'GPS' },
  { bit: 64, name: 'Serial RX' },
  { bit: 128, name: 'Blackbox' },
  { bit: 32, name: 'SmartPort telem' },
  { bit: 512, name: 'MAVLink telem' },
  { bit: 1024, name: 'ESC sensor' },
  { bit: 2048, name: 'VTX SmartAudio' },
  { bit: 8192, name: 'VTX Tramp' },
  { bit: 131072, name: 'VTX MSP / DJI' },
  { bit: 16384, name: 'RC camera' },
];

export default function PortsTab() {
  const [ports, setPorts] = useState(null);
  const [edits, setEdits] = useState({}); // id -> mask
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState(null);
  // Real backup gate for the confirm dialog: a write is only allowed once a
  // config backup actually exists (found on the server or taken here).
  const [backupOk, setBackupOk] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupInfo, setBackupInfo] = useState(null); // { id, board }
  const [backupErr, setBackupErr] = useState(null);
  const { setDirty } = useDirty();

  async function load() {
    setLoading(true); setError(null); setEdits({});
    try {
      const j = await (await fetch('/api/ports/config')).json();
      if (!j.ok) throw new Error(j.error || 'read failed');
      setPorts(j.ports);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  const mask = (p) => (p.id in edits ? edits[p.id] : p.mask);
  const changed = (ports || []).filter(p => p.id in edits && edits[p.id] !== p.mask);

  // Report unsaved edits so switching tabs warns instead of silently dropping
  // them. load() clears edits (on mount, re-read, and post-save); cleanup
  // clears the flag on unmount.
  useEffect(() => {
    setDirty('ports', changed.length > 0);
    return () => setDirty('ports', false);
  }, [changed.length, setDirty]);

  // When the confirm dialog opens, verify against the server whether a real
  // backup exists, so the "I have a backup" claim reflects reality.
  useEffect(() => {
    if (!confirm) return;
    let cancelled = false;
    setBackupOk(false); setBackupInfo(null); setBackupErr(null);
    (async () => {
      try {
        const j = await (await fetch('/api/config/backups')).json();
        if (!cancelled && j.ok && Array.isArray(j.backups) && j.backups.length) setBackupOk(true);
      } catch { /* leave the gate closed; user can take one now */ }
    })();
    return () => { cancelled = true; };
  }, [confirm]);

  async function takeBackupNow() {
    setBackupBusy(true); setBackupErr(null);
    try {
      const r = await fetch('/api/config/backup', { method: 'POST' });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'backup failed');
      setBackupOk(true);
      setBackupInfo({ id: j.id, board: j.boardName });
    } catch (e) { setBackupErr(e.message); }
    finally { setBackupBusy(false); }
  }

  function toggle(p, bit) {
    const current = mask(p);
    let next = current ^ bit;
    // Serial RX is exclusive per BF convention: one UART only.
    if (bit === 64 && (next & 64)) {
      for (const other of ports) {
        if (other.id !== p.id && (mask(other) & 64)) {
          setEdits(e => ({ ...e, [other.id]: mask(other) & ~64 }));
        }
      }
    }
    setEdits(e => ({ ...e, [p.id]: next }));
  }

  async function apply() {
    if (!backupOk) return; // never write, or claim a backup, without one
    setConfirm(false); setApplying(true); setError(null);
    try {
      const commands = [
        ...changed.map(p => `serial ${p.id} ${edits[p.id]} ${p.baud.msp} ${p.baud.gps} ${p.baud.telemetry} ${p.baud.blackbox}`),
        'save',
      ];
      const tr = await fetch('/api/safety/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'config.write', acknowledged: true, backupTaken: backupOk }),
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

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Ports</h1>
          <p className="text-stack-muted mt-1">Assign functions to UARTs. Serial RX is exclusive — enabling it on one UART clears it elsewhere.</p>
        </div>
        <button className="btn-ghost text-sm shrink-0" disabled={loading || applying} onClick={load}>
          {loading ? 'Reading…' : 'Re-read from FC'}
        </button>
      </div>

      <div className="note">
        <span className="font-semibold">Careful:</span> removing MSP from the port you're connected on,
        or moving Serial RX to the wrong UART, can lock you out or kill your radio link. Take a backup first.
      </div>

      {error && <div className="panel p-4 border-stack-err text-stack-err text-sm">{error}</div>}
      {!ports && !error && <div className="panel p-4 text-sm text-stack-muted">{loading ? 'Reading serial config…' : 'Plug in an FC to read ports.'}</div>}

      {ports && (
        <>
          <section className="panel p-5 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-stack-muted uppercase">
                <tr>
                  <th className="text-left pb-2 pr-4">Port</th>
                  {FUNCTIONS.map(f => (
                    <th key={f.bit} className="pb-2 px-1.5 text-center whitespace-nowrap font-normal normal-case text-[11px]">{f.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ports.map(p => (
                  <tr key={p.id} className="border-t border-stack-border">
                    <td className="py-2 pr-4 font-mono text-xs whitespace-nowrap">
                      {p.label}
                      {p.unknownBits ? <span className="pill-muted ml-2" title={`unrecognized function bits: ${p.unknownBits}`}>+?</span> : null}
                    </td>
                    {FUNCTIONS.map(f => (
                      <td key={f.bit} className="py-2 px-1.5 text-center">
                        <input type="checkbox" className="w-4 h-4 accent-stack-accent"
                          checked={!!(mask(p) & f.bit)}
                          onChange={() => toggle(p, f.bit)} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <div className="panel p-4 flex items-center justify-between gap-4">
            <div className="text-sm text-stack-muted">
              {changed.length
                ? <span className="text-stack-warn font-semibold">{changed.length} port(s) changed — not yet on the FC</span>
                : 'No pending changes'}
            </div>
            <button className={changed.length ? 'btn-primary text-sm' : 'btn-ghost text-sm opacity-50 cursor-not-allowed'}
              disabled={!changed.length || applying} onClick={() => setConfirm(true)}>
              {applying ? 'Applying…' : 'Apply + save'}
            </button>
          </div>
        </>
      )}

      {confirm && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="panel p-6 max-w-lg w-full">
            <h2 className="text-xl font-semibold text-stack-warn">⚠ Write port configuration</h2>
            <pre className="mt-3 bg-stack-bg border border-stack-border rounded p-3 text-xs font-mono max-h-40 overflow-auto">
              {changed.map(p => `serial ${p.id} ${edits[p.id]} ${p.baud.msp} ${p.baud.gps} ${p.baud.telemetry} ${p.baud.blackbox}`).join('\n') + '\nsave'}
            </pre>
            <p className="text-sm text-stack-muted mt-2">A wrong port map can disable your receiver or USB connection. Have a backup.</p>

            <div className="mt-4 flex items-center justify-between gap-3 bg-stack-bg border border-stack-border rounded p-3">
              <div className="text-sm">
                {backupOk
                  ? <span className="text-stack-ok">✓ Config backup ready{backupInfo ? ` — ${backupInfo.id}` : ''}</span>
                  : <span className="text-stack-err">No config backup yet — take one before writing.</span>}
              </div>
              <button
                className={backupBusy ? 'btn-ghost text-sm opacity-50 cursor-not-allowed' : 'btn-ghost text-sm shrink-0'}
                disabled={backupBusy} onClick={takeBackupNow}>
                {backupBusy ? 'Backing up…' : 'Take backup now'}
              </button>
            </div>
            {backupErr && <p className="text-sm text-stack-err mt-2">{backupErr}</p>}

            <div className="mt-5 flex gap-3 justify-end">
              <button className="btn-ghost" onClick={() => setConfirm(false)}>Cancel</button>
              <button
                className={backupOk ? 'btn-primary' : 'btn-primary opacity-50 cursor-not-allowed'}
                disabled={!backupOk} onClick={apply}>I have a backup — write it</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
