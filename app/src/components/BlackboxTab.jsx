import React, { useEffect, useRef, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

// Blackbox v1: upload a .bbl/.bfl, read the embedded tuning state from the
// log headers, and get an AI tune review. (Frame-level noise / step-response
// analysis is on the roadmap — this covers the "what should I change?"
// question PIDtoolbox never answered.)
const AXIS_COLORS = { roll: '#e05d52', pitch: '#79c26d', yaw: '#6ba3d6' };

function FlightAnalysis({ a }) {
  return (
    <div className="mb-4 space-y-4">
      <div className="flex flex-wrap gap-4 text-xs font-mono text-stack-muted">
        <span>{a.durationSec}s flight</span>
        <span>{a.sampleRateHz} Hz log rate</span>
        <span>{a.frames.toLocaleString()} frames</span>
        <span className={a.coverage > 0.95 ? 'text-stack-ok' : 'text-stack-warn'}>
          decode coverage {(a.coverage * 100).toFixed(1)}%
        </span>
        {a.logsInFile > 1 && <span>last of {a.logsInFile} flights in file</span>}
      </div>

      <div>
        <div className="text-xs uppercase tracking-wide text-stack-muted mb-2">Gyro noise spectrum (deg/s amplitude vs Hz)</div>
        <SpectrumChart axes={a.gyro} />
        <div className="mt-2 grid md:grid-cols-3 gap-3 text-xs">
          {a.gyro.filter(g => g.available).map(g => (
            <div key={g.axis} className="bg-stack-bg border border-stack-border rounded p-2">
              <div className="font-semibold mb-1" style={{ color: AXIS_COLORS[g.axis] }}>{g.axis}</div>
              <div className="text-stack-muted">RMS {g.rmsDegS}°/s</div>
              {g.peaks.length > 0
                ? g.peaks.map((p, i) => <div key={i} className="font-mono">peak {p.hz} Hz ×{p.ratioToFloor}</div>)
                : <div className="text-stack-muted">no dominant peaks</div>}
            </div>
          ))}
        </div>
      </div>

      {a.stepResponse?.some(sr => sr.available) && (
        <div>
          <div className="text-xs uppercase tracking-wide text-stack-muted mb-2">
            Step response (setpoint → gyro, Wiener deconvolution)
          </div>
          <StepResponseChart series={a.stepResponse} />
          <div className="mt-2 grid md:grid-cols-3 gap-3 text-xs">
            {a.stepResponse.filter(sr => sr.available).map(sr => (
              <div key={sr.axis} className="bg-stack-bg border border-stack-border rounded p-2">
                <div className="font-semibold mb-1" style={{ color: AXIS_COLORS[sr.axis] }}>{sr.axis}</div>
                <div className="font-mono">rise {sr.riseMs != null ? `${sr.riseMs}ms` : '—'} · peak {sr.peak} @ {sr.peakMs}ms</div>
                <div className={sr.overshootPct > 20 ? 'text-stack-warn' : 'text-stack-muted'}>
                  overshoot {sr.overshootPct != null ? `${sr.overshootPct}%` : '—'} · settles at {sr.steadyState}
                </div>
                <div className="text-stack-muted">{sr.windows} windows</div>
              </div>
            ))}
          </div>
          <div className="mt-1 text-xs text-stack-muted">
            1.0 = perfect tracking. Big overshoot → too much P or too little D; slow rise → gains too low or heavy filtering.
          </div>
        </div>
      )}

      {a.throttleHeatmaps?.some(h => h.available) && <ThrottleHeatmapPanel heatmaps={a.throttleHeatmaps} />}

      <div>
        <div className="text-xs uppercase tracking-wide text-stack-muted mb-2">Motors</div>
        <div className="grid grid-cols-4 gap-3 text-xs">
          {a.motors.filter(m => m.available).map(m => (
            <div key={m.motor} className="bg-stack-bg border border-stack-border rounded p-2 font-mono">
              <div className="text-stack-muted">M{m.motor}</div>
              <div>avg {m.avg}</div>
              <div className="text-stack-muted">{m.min}–{m.max}</div>
              {m.saturationPct > 1 && <div className="text-stack-warn">sat {m.saturationPct}%</div>}
            </div>
          ))}
        </div>
        {a.motorImbalance != null && a.motorImbalance > 60 && (
          <div className="mt-2 text-xs text-stack-warn">
            Motor average spread {a.motorImbalance} — one corner is working harder (weight balance, bent prop/shaft, or drag).
          </div>
        )}
      </div>
    </div>
  );
}

function SpectrumChart({ axes }) {
  const W = 800, H = 180;
  const series = axes.filter(g => g.available && g.spectrum?.length);
  if (series.length === 0) return null;
  const maxF = Math.max(...series.map(g => g.spectrum[g.spectrum.length - 1].f));
  const maxM = Math.max(...series.flatMap(g => g.spectrum.map(p => p.m))) || 1;
  const x = (f) => (f / maxF) * W;
  const y = (m) => H - 6 - (Math.sqrt(m / maxM)) * (H - 16); // sqrt scale keeps small peaks visible

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full bg-stack-bg border border-stack-border rounded" preserveAspectRatio="none" style={{ height: 180 }}>
        {[100, 200, 300, 400, 500].filter(f => f < maxF).map(f => (
          <g key={f}>
            <line x1={x(f)} y1="0" x2={x(f)} y2={H} stroke="#454d43" strokeWidth="0.5" />
            <text x={x(f) + 3} y="12" fill="#9aa294" fontSize="10" fontFamily="monospace">{f}Hz</text>
          </g>
        ))}
        {series.map(g => (
          <polyline key={g.axis} fill="none" stroke={AXIS_COLORS[g.axis]} strokeWidth="1.3"
            points={g.spectrum.map(p => `${x(p.f)},${y(p.m)}`).join(' ')} />
        ))}
      </svg>
    </div>
  );
}

function StepResponseChart({ series }) {
  const W = 800, H = 180;
  const avail = series.filter(sr => sr.available && sr.points?.length);
  if (avail.length === 0) return null;
  const maxT = Math.max(...avail.map(sr => sr.points[sr.points.length - 1].t));
  const maxV = Math.max(1.3, ...avail.flatMap(sr => sr.points.map(p => p.v)));
  const minV = Math.min(0, ...avail.flatMap(sr => sr.points.map(p => p.v)));
  const x = (t) => (t / maxT) * W;
  const y = (v) => H - 8 - ((v - minV) / (maxV - minV)) * (H - 20);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full bg-stack-bg border border-stack-border rounded" preserveAspectRatio="none" style={{ height: 180 }}>
      <line x1="0" y1={y(1)} x2={W} y2={y(1)} stroke="#6a7266" strokeWidth="0.7" strokeDasharray="5 4" />
      <text x="4" y={y(1) - 4} fill="#9aa294" fontSize="10" fontFamily="monospace">1.0</text>
      <line x1="0" y1={y(0)} x2={W} y2={y(0)} stroke="#454d43" strokeWidth="0.5" />
      {[100, 200, 300, 400].filter(t => t < maxT).map(t => (
        <g key={t}>
          <line x1={x(t)} y1="0" x2={x(t)} y2={H} stroke="#454d43" strokeWidth="0.5" />
          <text x={x(t) + 3} y={H - 4} fill="#9aa294" fontSize="10" fontFamily="monospace">{t}ms</text>
        </g>
      ))}
      {avail.map(sr => (
        <polyline key={sr.axis} fill="none" stroke={AXIS_COLORS[sr.axis]} strokeWidth="1.4"
          points={sr.points.map(p => `${x(p.t)},${y(p.v)}`).join(' ')} />
      ))}
    </svg>
  );
}

// Magma-ish colormap over normalized log magnitude.
function heatColor(v) {
  const t = Math.max(0, Math.min(1, v));
  const r = Math.round(20 + 235 * Math.min(1, t * 1.6));
  const g = Math.round(16 + 200 * Math.max(0, t - 0.35) / 0.65);
  const b = Math.round(38 + 60 * Math.max(0, 0.5 - t));
  return `rgb(${r},${g},${b})`;
}

function ThrottleHeatmapPanel({ heatmaps }) {
  const [axis, setAxis] = React.useState('roll');
  const hm = heatmaps.find(h => h.axis === axis && h.available) || heatmaps.find(h => h.available);
  if (!hm) return null;

  // normalize on log scale against the axis max
  let maxV = 0;
  for (const row of hm.matrix) if (row) for (const v of row) if (v > maxV) maxV = v;
  const norm = (v) => maxV > 0 ? Math.log1p(v * 1000) / Math.log1p(maxV * 1000) : 0;

  const FB = hm.freqs.length, TB = hm.matrix.length;
  const W = 800, H = 220, padL = 34, padB = 18;
  const cw = (W - padL) / FB, ch = (H - padB) / TB;

  return (
    <div>
      <div className="flex items-center gap-3 mb-2">
        <div className="text-xs uppercase tracking-wide text-stack-muted">Noise vs throttle (freq × throttle)</div>
        <div className="flex gap-1">
          {heatmaps.filter(h => h.available).map(h => (
            <button key={h.axis} onClick={() => setAxis(h.axis)}
              className={['px-2 py-0.5 rounded text-xs font-mono border',
                hm.axis === h.axis ? 'border-stack-accent text-stack-accent bg-stack-accent/10' : 'border-stack-border text-stack-muted hover:border-stack-accent/50',
              ].join(' ')}>{h.axis}</button>
          ))}
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full bg-stack-bg border border-stack-border rounded" preserveAspectRatio="none" style={{ height: 220 }}>
        {hm.matrix.map((row, t) => row && row.map((v, f) => (
          <rect key={`${t}-${f}`} x={padL + f * cw} y={H - padB - (t + 1) * ch}
            width={cw + 0.5} height={ch + 0.5} fill={heatColor(norm(v))} />
        )))}
        {[0, 25, 50, 75, 100].map(p => (
          <text key={p} x="2" y={H - padB - (p / 100) * (H - padB) + 4} fill="#9aa294" fontSize="9" fontFamily="monospace">{p}%</text>
        ))}
        {[100, 200, 300, 400, 500].filter(f => f < hm.freqs[FB - 1]).map(f => {
          const fi = hm.freqs.findIndex(x => x >= f);
          return fi > 0 ? (
            <text key={f} x={padL + fi * cw} y={H - 5} fill="#9aa294" fontSize="9" fontFamily="monospace">{f}Hz</text>
          ) : null;
        })}
      </svg>
      <div className="mt-1 text-xs text-stack-muted">
        Bright ridges that climb with throttle = motor/frame resonance (check props, soft-mount, RPM filter).
        A bright band at constant frequency = frame resonance or a filter gap. Gray rows were never visited.
      </div>
    </div>
  );
}

// Cross-flight trends: the same craft's logs side by side. Rising noise =
// mechanical wear; drifting step response = tune/battery aging. The AI reads
// the trajectory and names the bench check to do next.
function TrendsPanel({ logCount, model }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [review, setReview] = useState({}); // craft -> text
  const [reviewing, setReviewing] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (logCount < 2) return;
    setLoading(true);
    fetch('/api/blackbox/trends').then(r => r.json()).then(j => {
      if (j.ok) setData(j);
      else setError(j.error);
    }).catch(e => setError(e.message)).finally(() => setLoading(false));
  }, [logCount]);

  async function runReview(craft) {
    setReviewing(craft); setError(null);
    setReview(r => ({ ...r, [craft]: '' }));
    try {
      const res = await fetch('/api/blackbox/trends/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ craft, model }),
      });
      if (!res.ok || !res.body) throw new Error('review stream failed to open');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n\n')) !== -1) {
          const chunk = buf.slice(0, nl);
          buf = buf.slice(nl + 2);
          if (!chunk.startsWith('data:')) continue;
          try {
            const obj = JSON.parse(chunk.slice(5).trim());
            if (obj.error) setError(obj.error);
            if (obj.token) setReview(r => ({ ...r, [craft]: (r[craft] || '') + obj.token }));
          } catch {}
        }
      }
    } catch (e) { setError(e.message); }
    finally { setReviewing(null); }
  }

  if (logCount < 2) return null;
  if (!data && !loading && !error) return null;

  return (
    <section className="panel p-5 space-y-4">
      <div className="text-xs uppercase tracking-wide text-stack-muted">Trends across flights (tune coach)</div>
      {loading && <div className="text-sm text-stack-muted">analyzing flight history…</div>}
      {error && <div className="text-sm text-stack-err">{error}</div>}
      {data && data.crafts.length === 0 && (
        <div className="text-sm text-stack-muted">
          Need at least two decodable logs of the same craft (same craft name in the log header) to trend.
        </div>
      )}
      {data?.crafts.map(c => (
        <div key={c.craft} className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-sm">
              <span className="font-mono font-semibold">{c.craft}</span>
              <span className="text-stack-muted"> · {c.points.length} analyzed flight{c.points.length === 1 ? '' : 's'}{c.missing ? ` · ${c.missing} not decodable` : ''}</span>
            </div>
            <button className="btn-ghost text-sm" disabled={!!reviewing} onClick={() => runReview(c.craft)}>
              {reviewing === c.craft ? 'Coaching…' : 'AI trend review'}
            </button>
          </div>
          <TrendChart points={c.points} />
          {review[c.craft] && (
            <div className="chat-markdown text-sm bg-stack-bg border border-stack-border rounded p-4"
              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(review[c.craft])) }} />
          )}
        </div>
      ))}
    </section>
  );
}

function TrendChart({ points }) {
  const W = 800, H = 130;
  const n = points.length;
  if (n < 2) return null;
  const x = (i) => 30 + (i / (n - 1)) * (W - 60);
  const series = [
    { label: 'roll RMS', color: AXIS_COLORS.roll, vals: points.map(p => p.rms?.roll) },
    { label: 'pitch RMS', color: AXIS_COLORS.pitch, vals: points.map(p => p.rms?.pitch) },
    { label: 'imbalance', color: '#c9a86a', vals: points.map(p => p.motorImbalance) },
  ].filter(s => s.vals.some(v => v != null));
  const maxV = Math.max(1, ...series.flatMap(s => s.vals.filter(v => v != null)));
  const y = (v) => H - 18 - (v / maxV) * (H - 34);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full bg-stack-bg border border-stack-border rounded" preserveAspectRatio="none" style={{ height: 130 }}>
        {series.map(s => (
          <g key={s.label}>
            <polyline fill="none" stroke={s.color} strokeWidth="1.4"
              points={s.vals.map((v, i) => v != null ? `${x(i)},${y(v)}` : null).filter(Boolean).join(' ')} />
            {s.vals.map((v, i) => v != null && <circle key={i} cx={x(i)} cy={y(v)} r="2.4" fill={s.color} />)}
          </g>
        ))}
        {points.map((p, i) => (
          <text key={i} x={x(i)} y={H - 4} fill="#9aa294" fontSize="9" fontFamily="monospace" textAnchor="middle">
            {p.at ? p.at.slice(5, 10) : `#${i + 1}`}
          </text>
        ))}
      </svg>
      <div className="mt-1 flex gap-4 text-xs text-stack-muted">
        {series.map(s => (
          <span key={s.label} className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-0.5" style={{ background: s.color }} /> {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// Pull logs straight off the FC's onboard flash chip over MSP — no more
// Configurator side-trip in the fly → download → analyze loop. Read is
// harmless; erase is irreversible and token-gated.
function OnboardFlashPanel({ onDownloaded }) {
  const [summary, setSummary] = useState(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(null); // 'download' | 'erase'
  const [progress, setProgress] = useState(null); // { msg, pct }
  const [confirmErase, setConfirmErase] = useState(false);
  const [error, setError] = useState(null);

  async function check() {
    setChecking(true); setError(null); setSummary(null);
    try {
      const j = await (await fetch('/api/blackbox/flash/summary')).json();
      if (!j.ok) throw new Error(j.error || 'summary failed');
      setSummary(j.summary);
    } catch (e) { setError(e.message); }
    finally { setChecking(false); }
  }

  async function readSse(res, onEvent) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n\n')) !== -1) {
        const chunk = buf.slice(0, nl);
        buf = buf.slice(nl + 2);
        if (!chunk.startsWith('data:')) continue;
        try { onEvent(JSON.parse(chunk.slice(5).trim())); } catch {}
      }
    }
  }

  async function download() {
    setBusy('download'); setError(null); setProgress({ msg: 'starting…', pct: 0 });
    try {
      const res = await fetch('/api/blackbox/flash/download', { method: 'POST' });
      if (!res.ok || !res.body) throw new Error('download stream failed to open');
      let saved = null;
      await readSse(res, (obj) => {
        if (obj.error) setError(obj.error);
        else if (obj.done) saved = obj;
        else if (obj.stage) setProgress({ msg: obj.msg, pct: obj.pct ?? null });
      });
      if (saved) {
        setProgress({ msg: `saved ${saved.name} (${Math.round(saved.bytes / 1024)} KB)`, pct: 100 });
        await check();
        await onDownloaded(saved.name);
      }
    } catch (e) { setError(e.message); }
    finally { setBusy(null); }
  }

  async function erase() {
    setConfirmErase(false); setBusy('erase'); setError(null); setProgress({ msg: 'requesting erase…', pct: null });
    try {
      const tr = await fetch('/api/safety/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'blackbox.erase', acknowledged: true }),
      });
      const tj = await tr.json();
      if (!tj.ok) throw new Error(tj.error || 'token refused');
      const res = await fetch('/api/blackbox/flash/erase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tj.token }),
      });
      if (!res.ok || !res.body) throw new Error('erase stream failed to open');
      let done = false;
      await readSse(res, (obj) => {
        if (obj.error) setError(obj.error);
        else if (obj.done) done = true;
        else if (obj.stage) setProgress({ msg: obj.msg, pct: null });
      });
      if (done) { setProgress({ msg: 'chip erased', pct: null }); await check(); }
    } catch (e) { setError(e.message); }
    finally { setBusy(null); }
  }

  const usedKb = summary ? Math.round(summary.usedSize / 1024) : 0;

  return (
    <section className="panel p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-stack-muted">Onboard flash (download from FC)</div>
          <div className="text-xs text-stack-muted mt-1">
            Reads the blackbox flash chip over MSP — experimental until bench-validated.
          </div>
        </div>
        <button className="btn-ghost text-sm" disabled={checking || !!busy} onClick={check}>
          {checking ? 'Checking…' : 'Check flash'}
        </button>
      </div>

      {summary && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {!summary.supported && <span className="pill-muted">no onboard flash on this FC</span>}
          {summary.supported && (
            <>
              <span className={summary.ready ? 'pill-ok' : 'pill-warn'}>{summary.ready ? 'ready' : 'busy'}</span>
              <span className="font-mono text-xs text-stack-muted">
                {usedKb} KB used of {Math.round(summary.totalSize / 1024 / 1024)} MB
                {summary.totalSize > 0 ? ` (${Math.round((summary.usedSize / summary.totalSize) * 100)}%)` : ''}
              </span>
              <button className={summary.usedSize > 0 && !busy ? 'btn-primary text-sm' : 'btn-ghost text-sm opacity-50 cursor-not-allowed'}
                disabled={summary.usedSize === 0 || !!busy} onClick={download}>
                {busy === 'download' ? 'Downloading…' : 'Download logs'}
              </button>
              <button className="text-stack-err hover:underline text-sm" disabled={!!busy}
                onClick={() => setConfirmErase(true)}>
                {busy === 'erase' ? 'Erasing…' : 'Erase chip'}
              </button>
            </>
          )}
        </div>
      )}

      {progress && (
        <div className="text-xs font-mono text-stack-muted flex items-center gap-3">
          {progress.pct != null && (
            <div className="w-40 h-1.5 bg-stack-bg border border-stack-border rounded overflow-hidden">
              <div className="h-full bg-stack-accent" style={{ width: `${progress.pct}%` }} />
            </div>
          )}
          <span>{progress.msg}</span>
        </div>
      )}
      {error && <div className="text-sm text-stack-err">{error}</div>}

      {confirmErase && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="panel p-6 max-w-lg w-full">
            <h2 className="text-xl font-semibold text-stack-warn">⚠ Erase onboard flash</h2>
            <p className="text-sm text-stack-muted mt-2">
              Every flight log on the chip ({usedKb} KB) is gone forever. Download first if you want them.
              The erase takes up to a minute — don't unplug.
            </p>
            <div className="mt-5 flex gap-3 justify-end">
              <button className="btn-ghost" onClick={() => setConfirmErase(false)}>Cancel</button>
              <button className="btn-primary" onClick={erase}>Logs are safe — erase it</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export default function BlackboxTab() {
  const [logs, setLogs] = useState([]);
  const [selected, setSelected] = useState(null); // { name, firmware, craft, tuning, ... }
  const [uploading, setUploading] = useState(false);
  const [review, setReview] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState(null);
  const [error, setError] = useState(null);
  const fileRef = useRef(null);
  const model = localStorage.getItem('st:chat:model') || 'llama3.1:8b';

  async function analyze(name) {
    setAnalyzing(true); setAnalysis(null); setAnalysisError(null);
    try {
      const j = await (await fetch(`/api/blackbox/analyze/${encodeURIComponent(name)}`)).json();
      if (!j.ok) throw new Error(j.error || 'analysis failed');
      setAnalysis(j.analysis);
    } catch (e) { setAnalysisError(e.message); }
    finally { setAnalyzing(false); }
  }

  async function refresh() {
    try {
      const j = await (await fetch('/api/blackbox/logs')).json();
      if (j.ok) setLogs(j.logs);
    } catch {}
  }
  useEffect(() => { refresh(); }, []);

  async function upload(file) {
    setUploading(true); setError(null);
    try {
      const buf = await file.arrayBuffer();
      const r = await fetch(`/api/blackbox/upload?name=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: buf,
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'upload failed');
      setSelected(j);
      setReview('');
      await refresh();
    } catch (e) { setError(e.message); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  }

  async function open(name) {
    setError(null); setReview(''); setAnalysis(null); setAnalysisError(null);
    try {
      const j = await (await fetch(`/api/blackbox/logs/${encodeURIComponent(name)}`)).json();
      if (!j.ok) throw new Error(j.error || 'could not read log');
      setSelected({ name, ...j });
      analyze(name);
    } catch (e) { setError(e.message); }
  }

  async function runReview() {
    if (!selected) return;
    setReviewing(true); setReview(''); setError(null);
    try {
      const res = await fetch('/api/blackbox/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: selected.name, model }),
      });
      if (!res.ok || !res.body) throw new Error('review stream failed to open');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n\n')) !== -1) {
          const chunk = buf.slice(0, nl);
          buf = buf.slice(nl + 2);
          if (!chunk.startsWith('data:')) continue;
          try {
            const obj = JSON.parse(chunk.slice(5).trim());
            if (obj.error) setError(obj.error);
            if (obj.token) setReview(r => r + obj.token);
          } catch {}
        }
      }
    } catch (e) { setError(e.message); }
    finally { setReviewing(false); }
  }

  const tuningEntries = Object.entries(selected?.tuning || {});

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Blackbox</h1>
        <p className="text-stack-muted mt-1">
          Upload a blackbox log (.bbl / .bfl). Sageflight reads the complete tuning state embedded in
          the log header and the AI reviews it — filters, PIDs, dangerous combinations, and what to change.
        </p>
      </div>

      <div className="note">
        <span className="font-semibold">Frame decoder is experimental:</span> gyro spectra and motor
        stats are decoded straight from the log's binary frames. Check the decode-coverage figure —
        if it's low, treat numbers with suspicion and tell Noah which firmware wrote the log.
      </div>

      <section className="panel p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs uppercase tracking-wide text-stack-muted">Logs</div>
          <div>
            <input ref={fileRef} type="file" accept=".bbl,.bfl,.txt" className="hidden"
              onChange={e => e.target.files?.[0] && upload(e.target.files[0])} />
            <button className="btn-primary text-sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
              {uploading ? 'Parsing…' : 'Upload log'}
            </button>
          </div>
        </div>
        {logs.length === 0 && <div className="text-sm text-stack-muted">No logs yet. Pull one off your FC's flash/SD (Betaflight Configurator → Blackbox → Save) and upload it.</div>}
        {logs.length > 0 && (
          <div className="space-y-1.5">
            {logs.map(l => (
              <button key={l.name} onClick={() => open(l.name)}
                className={[
                  'w-full text-left bg-stack-bg border rounded px-3 py-2 text-sm flex items-center justify-between',
                  selected?.name === l.name ? 'border-stack-accent' : 'border-stack-border hover:border-stack-accent/50',
                ].join(' ')}>
                <span className="font-mono text-xs">{l.name}</span>
                <span className="text-stack-muted text-xs">
                  {l.craft ? `${l.craft} · ` : ''}{l.firmware ? l.firmware.replace('Betaflight ', 'BF ') : ''} · {(l.bytes / 1024 / 1024).toFixed(1)} MB · {l.logCount} flight{l.logCount > 1 ? 's' : ''}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      <OnboardFlashPanel onDownloaded={async (name) => { await refresh(); open(name); }} />

      <TrendsPanel logCount={logs.length} model={model} />

      {error && <div className="panel p-4 border-stack-err text-stack-err text-sm">{error}</div>}

      {selected && (
        <section className="panel p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-xs uppercase tracking-wide text-stack-muted">Tune at time of flight</div>
              <div className="text-sm mt-1">
                <span className="font-mono">{selected.craft || 'unnamed craft'}</span>
                <span className="text-stack-muted"> · {selected.firmware || 'unknown firmware'}</span>
              </div>
            </div>
            <button className="btn-primary text-sm" disabled={reviewing} onClick={runReview}>
              {reviewing ? 'Reviewing…' : 'AI tune review'}
            </button>
          </div>

          {analyzing && <div className="text-sm text-stack-muted mb-4">decoding flight frames…</div>}
          {analysisError && (
            <div className="text-sm text-stack-warn mb-4">
              Frame decode unavailable: {analysisError} — the AI review will use settings only.
            </div>
          )}
          {analysis && <FlightAnalysis a={analysis} />}

          {review && (
            <div className="chat-markdown text-sm bg-stack-bg border border-stack-border rounded p-4 mb-4"
              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(review)) }} />
          )}
          {reviewing && !review && <div className="text-sm text-stack-muted mb-4">thinking…</div>}

          <details>
            <summary className="cursor-pointer text-xs uppercase tracking-wide text-stack-muted">
              Raw tuning settings ({tuningEntries.length})
            </summary>
            <div className="mt-2 max-h-72 overflow-auto">
              <table className="w-full text-xs font-mono">
                <tbody>
                  {tuningEntries.map(([k, v]) => (
                    <tr key={k} className="border-t border-stack-border">
                      <td className="py-1 pr-4 text-stack-muted">{k}</td>
                      <td className="py-1 break-all">{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </section>
      )}
    </div>
  );
}
