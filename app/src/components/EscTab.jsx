import React, { useEffect, useState } from 'react';
import SafetyModal from './SafetyModal';

// ESC interrogation via BLHeli 4-way passthrough (read-only).
// Requires battery (ESCs are powered from VBAT) and props off.
export default function EscTab() {
  const [modal, setModal] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  // Show the most recent interrogation on mount so the tab has memory.
  useEffect(() => {
    (async () => {
      try {
        const j = await (await fetch('/api/history?limit=200')).json();
        if (j.ok) {
          const last = j.history.find(h => h.kind === 'esc.interrogate');
          if (last) setResult(last);
        }
      } catch {}
    })();
  }, []);

  async function interrogate(token) {
    setRunning(true); setError(null);
    try {
      const r = await fetch('/api/esc/interrogate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'interrogation failed');
      setResult(j);
    } catch (e) { setError(e.message); }
    finally { setRunning(false); }
  }

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">ESC</h1>
        <p className="text-stack-muted mt-1">
          Interrogate all four ESCs through the FC's BLHeli 4-way passthrough — chip signature,
          firmware family and version, per-slot responsiveness. Read-only: nothing is written to the ESCs.
        </p>
      </div>

      <div className="note">
        <span className="font-semibold">Note:</span> ESCs are powered from the flight battery, so the
        battery must be connected. 4-way mode disables motor output, but ESC reset can twitch motors —
        props off, always. An unresponsive slot is itself a finding (broken signal wire or dead ESC MCU).
      </div>

      <section className="panel p-5 flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-stack-muted">BLHeli 4-way interrogation</div>
          <div className="text-sm text-stack-muted mt-1">Takes ~10–20 seconds. The FC reboots afterwards to restore clean DShot output.</div>
        </div>
        <button
          disabled={running}
          onClick={() => { setError(null); setModal(true); }}
          className={!running ? 'btn-primary' : 'btn-ghost opacity-50 cursor-not-allowed'}
        >
          {running ? 'Interrogating…' : 'Interrogate ESCs'}
        </button>
      </section>

      {error && <div className="panel p-4 border-stack-err text-stack-err text-sm">{error}</div>}

      {result && (
        <>
          <div className="flex items-center gap-3">
            <span className={
              result.stackStatus === 'HEALTHY' ? 'pill-ok' :
              result.stackStatus === 'PARTIAL' ? 'pill-warn' : 'pill-err'
            }>
              {result.stackStatus}
            </span>
            <span className="text-xs text-stack-muted font-mono">
              {result.at ? `scanned ${result.at.replace('T', ' ').slice(0, 19)}` : 'just now'}
              {result.slotCount ? ` · ${result.slotCount} slot(s) reported by FC` : ''}
            </span>
          </div>

          <section className="grid md:grid-cols-2 gap-4">
            {(result.results || []).map(r => <EscCard key={r.motor} r={r} />)}
          </section>
        </>
      )}

      {modal && (
        <SafetyModal
          action="esc.interrogate"
          requireBattery={true}
          onCancel={() => setModal(false)}
          onConfirm={(token) => { setModal(false); interrogate(token); }}
        />
      )}
    </div>
  );
}

function EscCard({ r }) {
  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="font-mono font-semibold">ESC {r.motor + 1}</div>
        {r.responsive
          ? <span className="pill-ok">responsive</span>
          : <span className="pill-err">unresponsive</span>}
      </div>

      {r.responsive ? (
        <table className="w-full text-sm">
          <tbody>
            <Row k="Signature" v={r.signature} mono />
            <Row k="MCU" v={r.mcu} />
            <Row k="Firmware" v={r.family} />
            {r.settings?.fwRevision && <Row k="Version" v={r.settings.fwRevision} mono />}
            {r.settings?.name && <Row k="Name" v={r.settings.name} mono />}
            {r.settings?.layout && <Row k="Layout" v={r.settings.layout} mono />}
            {r.flashKb && <Row k="Flash" v={`${r.flashKb} KB`} />}
          </tbody>
        </table>
      ) : (
        <div className="text-sm text-stack-muted">
          <div className="font-mono text-xs mb-2">last response: {r.lastAck}</div>
          {r.reason}
        </div>
      )}
    </div>
  );
}

function Row({ k, v, mono }) {
  return (
    <tr className="border-t border-stack-border">
      <td className="py-1.5 pr-4 text-stack-muted text-xs uppercase tracking-wide">{k}</td>
      <td className={`py-1.5 ${mono ? 'font-mono text-xs' : ''}`}>{v ?? '—'}</td>
    </tr>
  );
}
