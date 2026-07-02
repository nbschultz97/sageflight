import React, { useEffect, useState } from 'react';
import SafetyModal from './SafetyModal';

export default function MotorsTab() {
  const [modal, setModal] = useState(null); // { action, onToken }
  const [spinning, setSpinning] = useState(false);
  const [singleResult, setSingleResult] = useState(null);
  const [compareResult, setCompareResult] = useState(null);
  const [error, setError] = useState(null);
  const [selectedMotor, setSelectedMotor] = useState(1);
  const [pwm, setPwm] = useState(1070);
  const [history, setHistory] = useState([]);

  async function refreshHistory() {
    try {
      const j = await (await fetch('/api/history?limit=15')).json();
      if (j.ok) setHistory(j.history);
    } catch {}
  }

  useEffect(() => { refreshHistory(); }, [singleResult, compareResult]);

  function openSafety(action, onToken) {
    setError(null);
    setModal({ action, onToken });
  }

  async function spinOne(token) {
    setSpinning(true); setError(null); setSingleResult(null);
    try {
      const r = await fetch('/api/motor/spin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, motor: selectedMotor, pwm, seconds: 2 }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'spin failed');
      setSingleResult(j.result);
    } catch (e) { setError(e.message); }
    finally { setSpinning(false); }
  }

  async function runCompare(token) {
    setSpinning(true); setError(null); setCompareResult(null);
    try {
      const r = await fetch('/api/motor/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, pwm, seconds: 2 }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'compare failed');
      setCompareResult(j);
    } catch (e) { setError(e.message); }
    finally { setSpinning(false); }
  }

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Motors</h1>
        <p className="text-stack-muted mt-1">
          Spin individual motors or compare all four. Voltage sag under identical PWM identifies
          motors with asymmetric current draw (inter-turn shorts, damaged windings).
        </p>
      </div>

      <section className="panel p-5">
        <div className="text-xs uppercase tracking-wide text-stack-muted mb-3">Parameters</div>
        <div className="grid md:grid-cols-2 gap-5">
          <div>
            <label className="block text-sm mb-2">Motor (for single spin)</label>
            <div className="flex gap-2">
              {[1,2,3,4].map(m => (
                <button key={m}
                  onClick={() => setSelectedMotor(m)}
                  className={[
                    'w-14 h-14 rounded-lg border font-mono text-lg font-semibold',
                    selectedMotor === m ? 'bg-stack-accent/15 border-stack-accent text-stack-accent' : 'border-stack-border text-stack-muted hover:border-stack-accent/60'
                  ].join(' ')}
                >{m}</button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm mb-2">PWM (1000 idle – 1300 max)</label>
            <input type="range" min="1000" max="1300" step="10" value={pwm} onChange={e => setPwm(+e.target.value)}
              className="w-full accent-stack-accent" />
            <div className="mt-1 flex justify-between text-xs text-stack-muted font-mono">
              <span>1000</span>
              <span className="text-stack-accent font-semibold">{pwm}</span>
              <span>1300</span>
            </div>
          </div>
        </div>
      </section>

      <section className="grid md:grid-cols-2 gap-4">
        <button
          disabled={spinning}
          onClick={() => openSafety('motor.spin', spinOne)}
          className={!spinning ? 'btn-primary py-5 text-base' : 'btn-ghost py-5 text-base opacity-50 cursor-not-allowed'}
        >
          {spinning ? 'Spinning…' : `Spin Motor ${selectedMotor}`}
        </button>
        <button
          disabled={spinning}
          onClick={() => openSafety('motor.compare', runCompare)}
          className={!spinning ? 'btn-primary py-5 text-base' : 'btn-ghost py-5 text-base opacity-50 cursor-not-allowed'}
        >
          {spinning ? 'Spinning…' : 'Compare All 4 Motors'}
        </button>
      </section>

      {error && <div className="panel p-4 border-stack-err text-stack-err text-sm">{error}</div>}

      {singleResult && (
        <section className="panel p-5">
          <div className="text-xs uppercase tracking-wide text-stack-muted mb-3">Single-motor result</div>
          <div className="grid grid-cols-4 gap-4">
            <Stat label="Motor" value={`#${singleResult.motor}`} />
            <Stat label="PWM" value={singleResult.pwm} mono />
            <Stat label="V idle" value={`${singleResult.vIdle}V`} mono />
            <Stat label="V under load" value={`${singleResult.vLoad}V`} mono highlight />
          </div>
          {singleResult.sag != null && (
            <div className="mt-4 text-sm text-stack-muted">
              Voltage sag under load: <span className="font-mono text-stack-text">{singleResult.sag}V</span>
            </div>
          )}
        </section>
      )}

      {compareResult && (
        <section className="panel p-5">
          <div className="flex items-baseline justify-between mb-3">
            <div className="text-xs uppercase tracking-wide text-stack-muted">Compare result · PWM {compareResult.pwm}</div>
            {compareResult.verdict && (
              <div className="text-xs text-stack-muted font-mono">mean sag {compareResult.verdict.meanSag}V</div>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-stack-muted uppercase">
                <tr>
                  <th className="text-left pb-2 pr-4">Motor</th>
                  <th className="text-left pb-2 pr-4">Idle V</th>
                  <th className="text-left pb-2 pr-4">Load V</th>
                  <th className="text-left pb-2 pr-4">Sag V</th>
                  <th className="text-left pb-2">Verdict</th>
                </tr>
              </thead>
              <tbody>
                {compareResult.results.map(r => {
                  const outlier = compareResult.verdict?.outliers?.find(o => o.motor === r.motor);
                  return (
                    <tr key={r.motor} className="border-t border-stack-border">
                      <td className="py-2 pr-4 font-mono font-semibold">#{r.motor}</td>
                      <td className="py-2 pr-4 font-mono">{r.vIdle ?? '—'}</td>
                      <td className="py-2 pr-4 font-mono">{r.vLoad ?? '—'}</td>
                      <td className="py-2 pr-4 font-mono">{r.sag ?? '—'}</td>
                      <td className="py-2">
                        {outlier
                          ? <span className="pill-warn">outlier {outlier.deviation > 0 ? '+' : ''}{outlier.deviation}V</span>
                          : <span className="pill-ok">normal</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {compareResult.verdict?.outliers?.length === 0 && (
            <div className="mt-4 text-sm text-stack-ok">All motors within normal variance — no electrical asymmetry.</div>
          )}
          {compareResult.verdict?.outliers?.length > 0 && (
            <div className="mt-4 text-sm text-stack-warn">
              {compareResult.verdict.outliers.length} motor(s) outside ±150mV of mean — investigate further (mechanical or winding).
            </div>
          )}
        </section>
      )}

      {history.length > 0 && (
        <section className="panel p-5">
          <div className="text-xs uppercase tracking-wide text-stack-muted mb-3">Recent tests</div>
          <table className="w-full text-sm">
            <thead className="text-xs text-stack-muted uppercase">
              <tr>
                <th className="text-left pb-2 pr-4">When</th>
                <th className="text-left pb-2 pr-4">Test</th>
                <th className="text-left pb-2">Result</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h, i) => (
                <tr key={i} className="border-t border-stack-border">
                  <td className="py-2 pr-4 font-mono text-xs whitespace-nowrap">{h.at?.replace('T', ' ').slice(0, 19)}</td>
                  <td className="py-2 pr-4">
                    {h.kind === 'motor.spin' ? `Spin M${h.motor} @ ${h.pwm}` : `Compare @ ${h.pwm}`}
                  </td>
                  <td className="py-2 font-mono text-xs">
                    {h.kind === 'motor.spin'
                      ? (h.sag != null ? `sag ${h.sag}V` : '—')
                      : (h.verdict
                          ? (h.verdict.outliers?.length
                              ? `outliers: ${h.verdict.outliers.map(o => `M${o.motor}`).join(', ')}`
                              : `all normal · mean ${h.verdict.meanSag}V`)
                          : '—')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {modal && (
        <SafetyModal
          action={modal.action}
          requireBattery={true}
          onCancel={() => setModal(null)}
          onConfirm={(token) => { setModal(null); modal.onToken(token); }}
        />
      )}
    </div>
  );
}

function Stat({ label, value, mono, highlight }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-stack-muted">{label}</div>
      <div className={[
        'mt-1 text-lg',
        mono ? 'font-mono' : '',
        highlight ? 'text-stack-accent font-semibold' : 'text-stack-text',
      ].join(' ')}>{value ?? '—'}</div>
    </div>
  );
}
