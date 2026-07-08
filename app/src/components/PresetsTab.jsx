import React, { useEffect, useState } from 'react';

// Official Betaflight community presets (betaflight/firmware-presets) —
// browse, filter by your firmware version, review the exact CLI, pick
// options, apply through the token-gated batch endpoint.
const CATEGORIES = ['', 'TUNE', 'RATES', 'FILTERS', 'RC_SMOOTHING', 'RC_LINK', 'OSD', 'VTX', 'MODES', 'BNF', 'OTHER'];

export default function PresetsTab() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [results, setResults] = useState(null);
  const [online, setOnline] = useState(true);
  const [selected, setSelected] = useState(null); // { path, title, base, options, raw }
  const [checked, setChecked] = useState({});     // option name -> bool
  const [applying, setApplying] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [applied, setApplied] = useState(false);
  const [error, setError] = useState(null);

  const firmware = (() => {
    try { return JSON.parse(localStorage.getItem('st:lastScan'))?.fc?.firmware || ''; } catch { return ''; }
  })();

  async function search() {
    setError(null);
    try {
      const params = new URLSearchParams({ q: query, category, firmware });
      const j = await (await fetch(`/api/presets?${params}`)).json();
      setOnline(j.online);
      setResults(j.results);
      if (!j.online && j.error) setError(`Presets need internet: ${j.error}`);
    } catch (e) { setError(e.message); }
  }

  useEffect(() => { search(); }, [category]);

  async function open(p) {
    setError(null); setSelected(null); setApplied(false);
    try {
      const j = await (await fetch(`/api/presets/file?path=${encodeURIComponent(p.path)}`)).json();
      if (!j.ok) throw new Error(j.error || 'could not load preset');
      setSelected({ ...p, ...j });
      setChecked(Object.fromEntries(j.options.map(o => [o.name, o.checkedByDefault])));
    } catch (e) { setError(e.message); }
  }

  const finalCommands = selected
    ? [...selected.base, ...selected.options.filter(o => checked[o.name]).flatMap(o => o.lines),
       ...(selected.base.length || selected.options.some(o => checked[o.name]) ? ['save'] : [])]
    : [];

  async function apply() {
    setConfirm(false); setApplying(true); setError(null);
    try {
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
        body: JSON.stringify({ token: tj.token, commands: finalCommands }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'apply failed');
      setApplied(true);
    } catch (e) { setError(e.message); }
    finally { setApplying(false); }
  }

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Presets</h1>
        <p className="text-stack-muted mt-1">
          Official Betaflight community presets{firmware ? ` filtered for BF ${firmware}` : ''}. Review the
          exact CLI before anything runs. Needs internet to browse.
        </p>
      </div>

      <form className="flex gap-2" onSubmit={e => { e.preventDefault(); search(); }}>
        <input value={query} onChange={e => setQuery(e.target.value)}
          placeholder="Search presets — e.g. freestyle tune, ELRS, DJI OSD…"
          className="flex-1 bg-stack-panel border border-stack-border rounded px-4 py-2 text-sm outline-none focus:border-stack-accent" />
        <select value={category} onChange={e => setCategory(e.target.value)}
          className="bg-stack-panel border border-stack-border rounded px-2 py-1 text-xs font-mono">
          {CATEGORIES.map(c => <option key={c} value={c}>{c || 'all categories'}</option>)}
        </select>
        <button type="submit" className="btn-primary text-sm">Search</button>
      </form>

      {error && <div className="panel p-4 border-stack-err text-stack-err text-sm">{error}</div>}
      {!online && !error && <div className="note">Offline — preset browsing needs internet. Everything else in Sageflight keeps working.</div>}

      {results && !selected && (
        <section className="space-y-1.5">
          {results.length === 0 && <div className="panel p-4 text-sm text-stack-muted">No presets match.</div>}
          {results.map(p => (
            <button key={p.path} onClick={() => open(p)}
              className="w-full text-left panel px-4 py-3 hover:border-stack-accent/60 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate">{p.title}</div>
                <div className="text-xs text-stack-muted truncate">
                  {p.category} · {p.author}{p.keywords?.length ? ` · ${p.keywords.slice(0, 5).join(', ')}` : ''}
                </div>
              </div>
              <span className="pill-muted shrink-0">{(p.firmware || []).join(' ')}</span>
            </button>
          ))}
        </section>
      )}

      {selected && (
        <section className="panel p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">{selected.title}</div>
              <div className="text-xs text-stack-muted">{selected.category} · {selected.author} · {selected.path}</div>
            </div>
            <button className="text-stack-muted hover:underline text-sm shrink-0" onClick={() => setSelected(null)}>← back to results</button>
          </div>

          {selected.options.length > 0 && (
            <div>
              <div className="text-xs uppercase tracking-wide text-stack-muted mb-2">Options</div>
              <div className="space-y-1.5">
                {selected.options.map(o => (
                  <label key={o.name} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" className="w-4 h-4 accent-stack-accent"
                      checked={!!checked[o.name]}
                      onChange={e => setChecked(c => ({ ...c, [o.name]: e.target.checked }))} />
                    {o.name} <span className="text-stack-muted text-xs">({o.lines.length} lines)</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="text-xs uppercase tracking-wide text-stack-muted mb-2">Exactly what will run ({finalCommands.length} lines)</div>
            <pre className="bg-stack-bg border border-stack-border rounded p-3 text-xs font-mono max-h-72 overflow-auto">{finalCommands.join('\n')}</pre>
          </div>

          <div className="flex items-center justify-end gap-3">
            {applied && <span className="pill-ok">applied + saved</span>}
            <button className="btn-primary text-sm" disabled={applying || finalCommands.length <= 1}
              onClick={() => setConfirm(true)}>
              {applying ? 'Applying…' : 'Apply preset'}
            </button>
          </div>
        </section>
      )}

      {confirm && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="panel p-6 max-w-lg w-full">
            <h2 className="text-xl font-semibold text-stack-warn">⚠ Apply preset to FC</h2>
            <p className="text-sm text-stack-muted mt-2">
              {finalCommands.length} CLI lines from <span className="font-mono">{selected?.title}</span> will
              be written and saved. Community presets vary in quality — you reviewed the list, right?
            </p>
            <div className="mt-5 flex gap-3 justify-end">
              <button className="btn-ghost" onClick={() => setConfirm(false)}>Cancel</button>
              <button className="btn-primary" onClick={apply}>I have a backup — apply it</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
