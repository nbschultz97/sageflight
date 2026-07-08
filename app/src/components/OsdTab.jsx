import React, { useEffect, useState } from 'react';

// OSD element layout editor: select an element, click the grid to move it,
// toggle per-profile visibility. Writes go through the gated batch endpoint
// (which auto-snapshots the config first).
export default function OsdTab() {
  const [data, setData] = useState(null); // { canvas, elements }
  const [edits, setEdits] = useState({}); // key -> { x, y, profiles }
  const [selectedKey, setSelectedKey] = useState(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState(null);

  async function load() {
    setLoading(true); setError(null); setEdits({}); setSelectedKey(null);
    try {
      const j = await (await fetch('/api/osd')).json();
      if (!j.ok) throw new Error(j.error || 'read failed');
      setData(j);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  const elements = (data?.elements || []).map(el => edits[el.key] ? { ...el, ...edits[el.key] } : el);
  const visible = elements.filter(el => el.profiles.some(Boolean));
  const hidden = elements.filter(el => !el.profiles.some(Boolean));
  const changed = elements.filter(el => {
    const orig = data.elements.find(o => o.key === el.key);
    return orig && (el.x !== orig.x || el.y !== orig.y || el.profiles.join() !== orig.profiles.join());
  });

  // Mirror of lib/osd.js encodeOsdPos.
  const encode = (el) => {
    let v = (el.x & 0x1f) | ((el.x << 5) & 0x400) | ((el.y & 0x1f) << 5);
    [0x800, 0x1000, 0x2000].forEach((f, i) => { if (el.profiles[i]) v |= f; });
    return v;
  };

  function edit(key, patch) {
    const el = elements.find(e => e.key === key);
    setEdits(ed => ({ ...ed, [key]: { x: el.x, y: el.y, profiles: el.profiles, ...(ed[key] || {}), ...patch } }));
  }

  function placeAt(x, y) {
    if (!selectedKey) return;
    edit(selectedKey, { x, y });
  }

  async function apply() {
    setConfirm(false); setApplying(true); setError(null);
    try {
      const commands = [...changed.map(el => `set ${el.key} = ${encode(el)}`), 'save'];
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

  const cols = data?.canvas?.cols || 30;
  const rows = data?.canvas?.rows || 16;

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">OSD</h1>
          <p className="text-stack-muted mt-1">
            Select an element on the right, click the grid to place it. P1–P3 toggle visibility per OSD profile.
            {data?.canvas && <span className="font-mono text-xs"> · canvas {cols}×{rows}{data.canvas.hd ? ' (HD)' : ' (analog)'}</span>}
          </p>
        </div>
        <button className="btn-ghost text-sm shrink-0" disabled={loading || applying} onClick={load}>
          {loading ? 'Reading…' : 'Re-read from FC'}
        </button>
      </div>

      {error && <div className="panel p-4 border-stack-err text-stack-err text-sm">{error}</div>}
      {!data && !error && <div className="panel p-4 text-sm text-stack-muted">{loading ? 'Reading OSD layout…' : 'Plug in an FC to edit the OSD.'}</div>}

      {data && (
        <div className="flex gap-4 items-start">
          {/* Grid */}
          <div className="panel p-3 flex-1 min-w-0 overflow-x-auto">
            <div
              className="relative bg-stack-header rounded"
              style={{ aspectRatio: `${cols * 12} / ${rows * 18}`, minWidth: 480 }}
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const x = Math.min(cols - 1, Math.max(0, Math.floor(((e.clientX - rect.left) / rect.width) * cols)));
                const y = Math.min(rows - 1, Math.max(0, Math.floor(((e.clientY - rect.top) / rect.height) * rows)));
                placeAt(x, y);
              }}
            >
              {/* grid lines */}
              <svg className="absolute inset-0 w-full h-full pointer-events-none" preserveAspectRatio="none" viewBox={`0 0 ${cols} ${rows}`}>
                {Array.from({ length: cols + 1 }, (_, i) => <line key={`v${i}`} x1={i} y1="0" x2={i} y2={rows} stroke="#2e332f" strokeWidth="0.02" />)}
                {Array.from({ length: rows + 1 }, (_, i) => <line key={`h${i}`} x1="0" y1={i} x2={cols} y2={i} stroke="#2e332f" strokeWidth="0.02" />)}
              </svg>
              {visible.map(el => (
                <div key={el.key}
                  onClick={(e) => { e.stopPropagation(); setSelectedKey(el.key); }}
                  className={[
                    'absolute px-0.5 rounded-sm text-[10px] font-mono leading-tight whitespace-nowrap cursor-pointer',
                    selectedKey === el.key ? 'bg-stack-accent text-stack-header z-10' : 'bg-stack-panel/90 text-stack-text border border-stack-border',
                  ].join(' ')}
                  style={{ left: `${(el.x / cols) * 100}%`, top: `${(el.y / rows) * 100}%` }}
                  title={`${el.name} (${el.x},${el.y})`}
                >
                  {el.name}
                </div>
              ))}
            </div>
            {selectedKey && (
              <div className="mt-2 text-xs text-stack-muted">
                Placing: <span className="text-stack-accent font-semibold">{elements.find(e => e.key === selectedKey)?.name}</span> — click a grid cell.
              </div>
            )}
          </div>

          {/* Element list */}
          <div className="panel p-3 w-72 shrink-0 max-h-[560px] overflow-y-auto">
            <div className="text-xs uppercase tracking-wide text-stack-muted mb-2">Elements</div>
            {[...visible, ...hidden].map(el => (
              <div key={el.key}
                className={[
                  'px-2 py-1.5 rounded text-xs flex items-center gap-2 cursor-pointer',
                  selectedKey === el.key ? 'bg-stack-accent/20 border border-stack-accent/50' : 'hover:bg-stack-border/40',
                  el.profiles.some(Boolean) ? '' : 'opacity-50',
                ].join(' ')}
                onClick={() => setSelectedKey(el.key)}
              >
                <span className="flex-1 truncate">{el.name}</span>
                {[0, 1, 2].map(i => (
                  <button key={i}
                    onClick={(e) => {
                      e.stopPropagation();
                      const profiles = [...el.profiles];
                      profiles[i] = !profiles[i];
                      edit(el.key, { profiles });
                    }}
                    className={el.profiles[i] ? 'pill-ok !px-1 !py-0' : 'pill-muted !px-1 !py-0'}
                  >P{i + 1}</button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {data && (
        <div className="panel p-4 flex items-center justify-between gap-4">
          <div className="text-sm text-stack-muted">
            {changed.length
              ? <span className="text-stack-warn font-semibold">{changed.length} element(s) moved/toggled — not yet on the FC</span>
              : 'No pending changes'}
          </div>
          <button className={changed.length ? 'btn-primary text-sm' : 'btn-ghost text-sm opacity-50 cursor-not-allowed'}
            disabled={!changed.length || applying} onClick={() => setConfirm(true)}>
            {applying ? 'Applying…' : 'Apply + save'}
          </button>
        </div>
      )}

      {confirm && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="panel p-6 max-w-lg w-full">
            <h2 className="text-xl font-semibold text-stack-warn">⚠ Write OSD layout</h2>
            <pre className="mt-3 bg-stack-bg border border-stack-border rounded p-3 text-xs font-mono max-h-40 overflow-auto">
              {changed.map(el => `set ${el.key} = ${encode(el)}`).join('\n') + '\nsave'}
            </pre>
            <p className="text-sm text-stack-muted mt-2">Layout only — worst case is a messy OSD, and a pre-write snapshot is taken automatically.</p>
            <div className="mt-5 flex gap-3 justify-end">
              <button className="btn-ghost" onClick={() => setConfirm(false)}>Cancel</button>
              <button className="btn-primary" onClick={apply}>Write it</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
