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
