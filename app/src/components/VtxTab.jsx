import React, { useEffect, useState } from 'react';

// VTX table editor — Betaflight's VTX tab. Reads `vtxtable` + `get vtx` from
// the CLI; writes go through the token-gated /api/cli/batch (auto pre-write
// snapshot included). Mirrors lib/vtx.js parsing/validation rules.

const LOW_POWER_DISARM_OPTIONS = ['OFF', 'ON', 'UNTIL_FIRST_ARM'];

function cloneTable(t) {
  return JSON.parse(JSON.stringify(t));
}

function buildTableCommands(t) {
  const cmds = [
    `vtxtable bands ${t.bands}`,
    `vtxtable channels ${t.channels}`,
  ];
  for (const row of t.bandRows) {
    cmds.push(`vtxtable band ${row.index} ${row.name} ${row.letter} ${row.factory ? 'FACTORY' : 'CUSTOM'} ${row.frequencies.join(' ')}`);
  }
  cmds.push(`vtxtable powerlevels ${t.powerLevels}`);
  cmds.push(`vtxtable powervalues ${t.powerValues.join(' ')}`);
  cmds.push(`vtxtable powerlabels ${t.powerLabels.join(' ')}`);
  return cmds;
}

function validateTable(t) {
  const errors = [];
  if (!(t.bands >= 1 && t.bands <= 8)) errors.push('bands must be 1-8');
  if (!(t.channels >= 1 && t.channels <= 8)) errors.push('channels must be 1-8');
  for (const row of t.bandRows) {
    if (!/^[A-Za-z0-9_#\-.]{1,8}$/.test(row.name || '')) errors.push(`band ${row.index}: name must be 1-8 chars, no spaces`);
    if (!/^\S$/.test(row.letter || '')) errors.push(`band ${row.index}: letter must be one character`);
    for (const f of row.frequencies) {
      if (!(f === 0 || (f >= 4800 && f <= 6200))) errors.push(`band ${row.index}: ${f} MHz out of range (0 or 4800-6200)`);
    }
  }
  if (t.powerValues.some(v => !Number.isInteger(v) || v < 0 || v > 10000)) errors.push('power values must be integers 0-10000');
  if (t.powerLabels.some(l => !/^\S{1,3}$/.test(l || ''))) errors.push('power labels must be 1-3 chars, no spaces');
  return [...new Set(errors)];
}

export default function VtxTab() {
  const [original, setOriginal] = useState(null); // { table, settings }
  const [table, setTable] = useState(null);       // edited copy
  const [settingsEdits, setSettingsEdits] = useState({});
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState(null);

  async function load() {
    setLoading(true); setError(null); setSettingsEdits({});
    try {
      const j = await (await fetch('/api/vtx')).json();
      if (!j.ok) throw new Error(j.error || 'read failed');
      setOriginal(j);
      setTable(j.table?.supported ? cloneTable(j.table) : null);
    } catch (e) { setError(e.message); setOriginal(null); setTable(null); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  const settings = original?.settings || {};
  const settingValue = (k) => (k in settingsEdits ? settingsEdits[k] : settings[k]);

  const tableDirty = table && original?.table && JSON.stringify(table) !== JSON.stringify(original.table);
  const changedSettings = Object.entries(settingsEdits).filter(([k, v]) => String(v) !== String(settings[k]));
  const validationErrors = table ? validateTable(table) : [];

  const commands = [
    ...(tableDirty ? buildTableCommands(table) : []),
    ...changedSettings.map(([k, v]) => `set ${k} = ${v}`),
  ];
  const canApply = commands.length > 0 && validationErrors.length === 0 && !applying;

  // ---- table structure edits ----

  function update(fn) {
    setTable(t => { const c = cloneTable(t); fn(c); return c; });
  }

  function setBandCount(n) {
    update(t => {
      t.bands = n;
      while (t.bandRows.length < n) {
        const i = t.bandRows.length + 1;
        t.bandRows.push({ index: i, name: `BAND${i}`, letter: String.fromCharCode(64 + i), factory: false, frequencies: Array(t.channels).fill(0) });
      }
      t.bandRows.length = n;
    });
  }

  function setChannelCount(n) {
    update(t => {
      t.channels = n;
      for (const row of t.bandRows) {
        while (row.frequencies.length < n) row.frequencies.push(0);
        row.frequencies.length = n;
      }
    });
  }

  function setPowerCount(n) {
    update(t => {
      t.powerLevels = n;
      while (t.powerValues.length < n) t.powerValues.push(0);
      while (t.powerLabels.length < n) t.powerLabels.push(`P${t.powerLabels.length + 1}`);
      t.powerValues.length = n;
      t.powerLabels.length = n;
    });
  }

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
        body: JSON.stringify({ token: tj.token, commands: [...commands, 'save'] }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'apply failed');
      await new Promise(r2 => setTimeout(r2, 3500)); // FC reboots on save
      await load();
    } catch (e) { setError(e.message); }
    finally { setApplying(false); }
  }

  const bandName = (i) => table?.bandRows?.[i - 1] ? `${table.bandRows[i - 1].name} (${table.bandRows[i - 1].letter})` : `band ${i}`;

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">VTX</h1>
          <p className="text-stack-muted mt-1">
            Video transmitter table (bands, frequencies, power levels) and the active channel/power selection.
            Changes go to the VTX over SmartAudio / Tramp / MSP after save.
          </p>
        </div>
        <button className="btn-ghost text-sm shrink-0" disabled={loading || applying} onClick={load}>
          {loading ? 'Reading…' : 'Re-read from FC'}
        </button>
      </div>

      <div className="note">
        <span className="font-semibold">This table is device- and region-specific.</span> Power values are the
        raw codes your VTX firmware expects (SmartAudio dBm, Tramp mW) — copy them from your VTX manufacturer's
        table, don't guess. A wrong table can transmit on frequencies that are illegal in your region or jam
        other pilots.
      </div>

      {error && <div className="panel p-4 border-stack-err text-stack-err text-sm">{error}</div>}
      {!original && !error && (
        <div className="panel p-4 text-sm text-stack-muted">{loading ? 'Reading VTX config…' : 'Plug in an FC to read the VTX table.'}</div>
      )}
      {original && !table && (
        <div className="panel p-4 text-sm text-stack-muted">
          This firmware has no VTX table support (or the table is empty and unsupported). Betaflight 4.1+ with
          <span className="font-mono"> VTX_TABLE</span> built in is required.
        </div>
      )}

      {table && (
        <>
          <section className="panel p-5 overflow-x-auto">
            <div className="flex items-center gap-6 mb-4 text-sm">
              <div className="text-xs uppercase tracking-wide text-stack-muted">Frequency table</div>
              <label className="flex items-center gap-2">
                <span className="text-stack-muted text-xs">bands</span>
                <select className="bg-stack-bg border border-stack-border rounded px-2 py-1 text-xs font-mono"
                  value={table.bands} onChange={e => setBandCount(+e.target.value)}>
                  {[1, 2, 3, 4, 5, 6, 7, 8].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-2">
                <span className="text-stack-muted text-xs">channels</span>
                <select className="bg-stack-bg border border-stack-border rounded px-2 py-1 text-xs font-mono"
                  value={table.channels} onChange={e => setChannelCount(+e.target.value)}>
                  {[1, 2, 3, 4, 5, 6, 7, 8].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            </div>

            <table className="w-full text-sm">
              <thead className="text-xs text-stack-muted uppercase">
                <tr>
                  <th className="text-left pb-2 pr-3">#</th>
                  <th className="text-left pb-2 pr-3">Name</th>
                  <th className="text-left pb-2 pr-3">Ltr</th>
                  <th className="text-left pb-2 pr-3" title="FACTORY = frequencies locked by the VTX; CUSTOM = user-defined">Fact.</th>
                  {Array.from({ length: table.channels }, (_, c) => (
                    <th key={c} className="text-left pb-2 px-1 font-normal normal-case text-[11px]">CH{c + 1}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.bandRows.map((row, ri) => (
                  <tr key={row.index} className="border-t border-stack-border">
                    <td className="py-1.5 pr-3 font-mono text-xs text-stack-muted">{row.index}</td>
                    <td className="py-1.5 pr-3">
                      <input className="w-24 bg-stack-bg border border-stack-border rounded px-2 py-1 text-xs font-mono"
                        value={row.name} onChange={e => update(t => { t.bandRows[ri].name = e.target.value.toUpperCase(); })} />
                    </td>
                    <td className="py-1.5 pr-3">
                      <input className="w-9 bg-stack-bg border border-stack-border rounded px-2 py-1 text-xs font-mono text-center"
                        maxLength={1} value={row.letter}
                        onChange={e => update(t => { t.bandRows[ri].letter = e.target.value.toUpperCase(); })} />
                    </td>
                    <td className="py-1.5 pr-3 text-center">
                      <input type="checkbox" className="w-4 h-4 accent-stack-accent" checked={row.factory}
                        onChange={e => update(t => { t.bandRows[ri].factory = e.target.checked; })} />
                    </td>
                    {row.frequencies.map((f, ci) => (
                      <td key={ci} className="py-1.5 px-1">
                        <input className={[
                          'w-14 bg-stack-bg border rounded px-1.5 py-1 text-xs font-mono text-right',
                          f === 0 || (f >= 4800 && f <= 6200) ? 'border-stack-border' : 'border-stack-err',
                        ].join(' ')}
                          value={f}
                          onChange={e => update(t => { t.bandRows[ri].frequencies[ci] = parseInt(e.target.value, 10) || 0; })} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-2 text-xs text-stack-muted">Frequency 0 = slot unused. Valid range 4800–6200 MHz.</div>
          </section>

          <section className="panel p-5">
            <div className="flex items-center gap-6 mb-4">
              <div className="text-xs uppercase tracking-wide text-stack-muted">Power levels</div>
              <select className="bg-stack-bg border border-stack-border rounded px-2 py-1 text-xs font-mono"
                value={table.powerLevels} onChange={e => setPowerCount(+e.target.value)}>
                {[1, 2, 3, 4, 5, 6, 7, 8].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <table className="text-sm">
              <thead className="text-xs text-stack-muted uppercase">
                <tr>
                  <th className="text-left pb-2 pr-4">Level</th>
                  <th className="text-left pb-2 pr-4" title="Raw code sent to the VTX (SmartAudio dBm / Tramp mW)">Value (device code)</th>
                  <th className="text-left pb-2" title="Shown in OSD, max 3 chars">Label</th>
                </tr>
              </thead>
              <tbody>
                {table.powerValues.map((v, i) => (
                  <tr key={i} className="border-t border-stack-border">
                    <td className="py-1.5 pr-4 font-mono text-xs text-stack-muted">{i + 1}</td>
                    <td className="py-1.5 pr-4">
                      <input className="w-24 bg-stack-bg border border-stack-border rounded px-2 py-1 text-xs font-mono"
                        value={v} onChange={e => update(t => { t.powerValues[i] = parseInt(e.target.value, 10) || 0; })} />
                    </td>
                    <td className="py-1.5">
                      <input className="w-16 bg-stack-bg border border-stack-border rounded px-2 py-1 text-xs font-mono"
                        maxLength={3} value={table.powerLabels[i] || ''}
                        onChange={e => update(t => { t.powerLabels[i] = e.target.value.replace(/\s/g, ''); })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="panel p-5">
            <div className="text-xs uppercase tracking-wide text-stack-muted mb-4">Active selection</div>
            <div className="grid md:grid-cols-3 gap-5 text-sm">
              {'vtx_band' in settings && (
                <label className="block">
                  <span className="text-stack-muted text-xs block mb-1">Band (0 = direct frequency)</span>
                  <select className="w-full bg-stack-bg border border-stack-border rounded px-2 py-1.5 text-sm font-mono"
                    value={settingValue('vtx_band')} onChange={e => setSettingsEdits(s => ({ ...s, vtx_band: e.target.value }))}>
                    <option value="0">0 — use vtx_freq</option>
                    {Array.from({ length: table.bands }, (_, i) => (
                      <option key={i + 1} value={i + 1}>{i + 1} — {bandName(i + 1)}</option>
                    ))}
                  </select>
                </label>
              )}
              {'vtx_channel' in settings && (
                <label className="block">
                  <span className="text-stack-muted text-xs block mb-1">Channel</span>
                  <select className="w-full bg-stack-bg border border-stack-border rounded px-2 py-1.5 text-sm font-mono"
                    value={settingValue('vtx_channel')} onChange={e => setSettingsEdits(s => ({ ...s, vtx_channel: e.target.value }))}>
                    {Array.from({ length: table.channels }, (_, i) => {
                      const b = parseInt(settingValue('vtx_band'), 10);
                      const f = b >= 1 ? table.bandRows[b - 1]?.frequencies?.[i] : null;
                      return <option key={i + 1} value={i + 1}>{i + 1}{f ? ` — ${f} MHz` : ''}</option>;
                    })}
                  </select>
                </label>
              )}
              {'vtx_power' in settings && (
                <label className="block">
                  <span className="text-stack-muted text-xs block mb-1">Power level</span>
                  <select className="w-full bg-stack-bg border border-stack-border rounded px-2 py-1.5 text-sm font-mono"
                    value={settingValue('vtx_power')} onChange={e => setSettingsEdits(s => ({ ...s, vtx_power: e.target.value }))}>
                    {Array.from({ length: table.powerLevels }, (_, i) => (
                      <option key={i + 1} value={i + 1}>{i + 1} — {table.powerLabels[i] || '?'}</option>
                    ))}
                  </select>
                </label>
              )}
              {'vtx_freq' in settings && (
                <label className="block">
                  <span className="text-stack-muted text-xs block mb-1">Direct frequency (band 0 only)</span>
                  <input className="w-full bg-stack-bg border border-stack-border rounded px-2 py-1.5 text-sm font-mono"
                    value={settingValue('vtx_freq')} onChange={e => setSettingsEdits(s => ({ ...s, vtx_freq: e.target.value.replace(/\D/g, '') }))} />
                </label>
              )}
              {'vtx_low_power_disarm' in settings && (
                <label className="block">
                  <span className="text-stack-muted text-xs block mb-1">Low power on disarm</span>
                  <select className="w-full bg-stack-bg border border-stack-border rounded px-2 py-1.5 text-sm font-mono"
                    value={settingValue('vtx_low_power_disarm')}
                    onChange={e => setSettingsEdits(s => ({ ...s, vtx_low_power_disarm: e.target.value }))}>
                    {[...new Set([...LOW_POWER_DISARM_OPTIONS, settings.vtx_low_power_disarm])].filter(Boolean).map(o => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                </label>
              )}
              {'vtx_pit_mode_freq' in settings && (
                <label className="block">
                  <span className="text-stack-muted text-xs block mb-1">Pit mode frequency</span>
                  <input className="w-full bg-stack-bg border border-stack-border rounded px-2 py-1.5 text-sm font-mono"
                    value={settingValue('vtx_pit_mode_freq')}
                    onChange={e => setSettingsEdits(s => ({ ...s, vtx_pit_mode_freq: e.target.value.replace(/\D/g, '') }))} />
                </label>
              )}
            </div>
          </section>

          {validationErrors.length > 0 && (
            <div className="panel p-4 border-stack-err text-sm">
              <div className="text-stack-err font-semibold mb-1">Fix before applying:</div>
              <ul className="list-disc pl-5 text-stack-err/90 text-xs space-y-0.5">
                {validationErrors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}

          <div className="panel p-4 flex items-center justify-between gap-4">
            <div className="text-sm text-stack-muted">
              {commands.length
                ? <span className="text-stack-warn font-semibold">{tableDirty ? 'table edited' : ''}{tableDirty && changedSettings.length ? ' · ' : ''}{changedSettings.length ? `${changedSettings.length} setting(s) changed` : ''} — not yet on the FC</span>
                : 'No pending changes'}
            </div>
            <button className={canApply ? 'btn-primary text-sm' : 'btn-ghost text-sm opacity-50 cursor-not-allowed'}
              disabled={!canApply} onClick={() => setConfirm(true)}>
              {applying ? 'Applying…' : 'Apply + save'}
            </button>
          </div>
        </>
      )}

      {confirm && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="panel p-6 max-w-lg w-full">
            <h2 className="text-xl font-semibold text-stack-warn">⚠ Write VTX configuration</h2>
            <pre className="mt-3 bg-stack-bg border border-stack-border rounded p-3 text-xs font-mono max-h-48 overflow-auto">
              {[...commands, 'save'].join('\n')}
            </pre>
            <p className="text-sm text-stack-muted mt-2">
              Confirm the frequencies and power codes match your VTX's documentation and your region's rules.
              A pre-write snapshot is taken automatically.
            </p>
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
