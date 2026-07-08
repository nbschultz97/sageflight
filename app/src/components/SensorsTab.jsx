import React, { useEffect, useRef, useState } from 'react';
import { useTelemetry } from '../telemetry';

// Live gyro/accel traces from the telemetry stream (~5 Hz — enough to spot a
// dead axis, stuck sensor, DC offset, or gross vibration; full-rate spectral
// analysis belongs to Blackbox v2). Plus accelerometer calibration.
const WINDOW = 120; // samples kept per trace (~24s)
const AXES = ['X', 'Y', 'Z'];
const AXIS_COLORS = ['#e05d52', '#79c26d', '#6ba3d6'];

export default function SensorsTab() {
  const { connected, telemetry } = useTelemetry();
  const [gyroHist, setGyroHist] = useState([]);
  const [accHist, setAccHist] = useState([]);
  const lastAt = useRef(null);

  useEffect(() => {
    const imu = telemetry?.imu;
    if (!imu || telemetry.at === lastAt.current) return;
    lastAt.current = telemetry.at;
    setGyroHist(h => [...h.slice(-(WINDOW - 1)), imu.gyro]);
    setAccHist(h => [...h.slice(-(WINDOW - 1)), imu.acc]);
  }, [telemetry]);

  useEffect(() => {
    if (!connected) { setGyroHist([]); setAccHist([]); }
  }, [connected]);

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Sensors</h1>
        <p className="text-stack-muted mt-1">
          Live gyro and accelerometer traces (raw sensor units, ~5 Hz). Move the quad — all three axes
          should respond. A flat line on one axis is a dead sensor channel; a large standing offset on
          the gyro at rest means it needs a power-cycle calibration.
        </p>
      </div>

      {!connected && (
        <div className="note">
          <span className="font-semibold">Not connected.</span> Click <span className="font-semibold">Connect</span> in the header to stream sensor data.
        </div>
      )}

      {connected && (
        <>
          <TraceChart title="Gyro (raw)" history={gyroHist} />
          <TraceChart title="Accelerometer (raw)" history={accHist} />
          <AccCalPanel />
        </>
      )}
    </div>
  );
}

function TraceChart({ title, history }) {
  const W = 800, H = 160;
  const flat = history.flat();
  const max = Math.max(600, ...flat.map(v => Math.abs(v)));
  const y = (v) => H / 2 - (v / max) * (H / 2 - 8);
  const x = (i) => (i / (WINDOW - 1)) * W;

  const latest = history[history.length - 1] || [];

  return (
    <section className="panel p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs uppercase tracking-wide text-stack-muted">{title}</div>
        <div className="flex gap-4 font-mono text-xs">
          {AXES.map((a, i) => (
            <span key={a} style={{ color: AXIS_COLORS[i] }}>{a}: {latest[i] ?? '—'}</span>
          ))}
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full bg-stack-bg border border-stack-border rounded" preserveAspectRatio="none" style={{ height: 160 }}>
        <line x1="0" y1={H / 2} x2={W} y2={H / 2} stroke="#454d43" strokeWidth="1" />
        {AXES.map((_, axis) => (
          <polyline
            key={axis}
            fill="none"
            stroke={AXIS_COLORS[axis]}
            strokeWidth="1.5"
            points={history.map((s, i) => `${x(i)},${y(s[axis])}`).join(' ')}
          />
        ))}
      </svg>
    </section>
  );
}

function AccCalPanel() {
  const [confirm, setConfirm] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  async function calibrate() {
    setConfirm(false); setRunning(true); setError(null); setResult(null);
    try {
      const tr = await fetch('/api/safety/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sensor.calibrate', acknowledged: true }),
      });
      const tj = await tr.json();
      if (!tj.ok) throw new Error(tj.error || 'token refused');
      const r = await fetch('/api/calibrate/acc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tj.token }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'calibration failed');
      setResult('Accelerometer calibrated. Check the Setup horizon sits level.');
    } catch (e) { setError(e.message); }
    finally { setRunning(false); }
  }

  return (
    <section className="panel p-5 flex items-center justify-between gap-4">
      <div className="text-sm">
        <div className="text-xs uppercase tracking-wide text-stack-muted mb-1">Accelerometer calibration</div>
        <div className="text-stack-muted">Place the quad on a flat, level surface and keep it perfectly still. Takes ~2 seconds.</div>
        {result && <div className="text-stack-ok mt-1">{result}</div>}
        {error && <div className="text-stack-err mt-1">{error}</div>}
      </div>
      <button className="btn-primary text-sm shrink-0" disabled={running} onClick={() => setConfirm(true)}>
        {running ? 'Calibrating…' : 'Calibrate accel'}
      </button>

      {confirm && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="panel p-6 max-w-md w-full">
            <h2 className="text-xl font-semibold text-stack-warn">⚠ Calibrate accelerometer</h2>
            <p className="text-sm text-stack-muted mt-2">
              The quad must be on a flat, level surface and completely still. A calibration done at an
              angle makes Angle mode fly crooked.
            </p>
            <div className="mt-5 flex gap-3 justify-end">
              <button className="btn-ghost" onClick={() => setConfirm(false)}>Cancel</button>
              <button className="btn-primary" onClick={calibrate}>It's level and still — calibrate</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
