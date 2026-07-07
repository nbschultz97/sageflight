import React, { useEffect, useRef, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

// Blackbox v1: upload a .bbl/.bfl, read the embedded tuning state from the
// log headers, and get an AI tune review. (Frame-level noise / step-response
// analysis is on the roadmap — this covers the "what should I change?"
// question PIDtoolbox never answered.)
export default function BlackboxTab() {
  const [logs, setLogs] = useState([]);
  const [selected, setSelected] = useState(null); // { name, firmware, craft, tuning, ... }
  const [uploading, setUploading] = useState(false);
  const [review, setReview] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState(null);
  const fileRef = useRef(null);
  const model = localStorage.getItem('st:chat:model') || 'llama3.1:8b';

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
    setError(null); setReview('');
    try {
      const j = await (await fetch(`/api/blackbox/logs/${encodeURIComponent(name)}`)).json();
      if (!j.ok) throw new Error(j.error || 'could not read log');
      setSelected({ name, ...j });
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
        <span className="font-semibold">v1 scope:</span> header/settings analysis. Frame-level analysis
        (gyro noise spectra, step response) is on the roadmap — for now pair this with your eyes on
        Blackbox Explorer for the traces, and let the AI sanity-check the tune itself.
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
