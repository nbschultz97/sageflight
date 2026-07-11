import React, { useEffect, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { useDirty } from '../dirty';

// PID / rates / filters editor — Betaflight's PID Tuning tab, with an AI
// reviewer instead of guesswork. Values load via CLI `dump`; changed values
// apply through the token-gated batch endpoint (backup required).
const PID_AXES = ['roll', 'pitch', 'yaw'];
const PID_TERMS = [
  { key: 'p', label: 'P' }, { key: 'i', label: 'I' }, { key: 'd', label: 'D' },
  { key: 'd_min', label: 'D min' }, { key: 'f', label: 'FF' },
];
const RATE_TERMS = [
  { suffix: 'rc_rate', label: 'RC Rate' }, { suffix: 'expo', label: 'Expo' }, { suffix: 'srate', label: 'Super Rate' },
];

export default function TuneTab() {
  const [groups, setGroups] = useState(null); // [{group,label,values}]
  const [edits, setEdits] = useState({});     // key -> new value (string)
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [review, setReview] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState(null);
  // Real backup gate for the confirm dialog: a write is only allowed once a
  // config backup actually exists (found on the server or taken here).
  const [backupOk, setBackupOk] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupInfo, setBackupInfo] = useState(null); // { id, board }
  const [backupErr, setBackupErr] = useState(null);
  const { setDirty } = useDirty();
  const model = localStorage.getItem('st:chat:model') || 'llama3.1:8b';

  async function load() {
    setLoading(true); setError(null); setEdits({}); setReview('');
    try {
      const j = await (await fetch('/api/tune')).json();
      if (!j.ok) throw new Error(j.error || 'read failed');
      setGroups(j.groups);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  const flat = {};
  for (const g of groups || []) Object.assign(flat, g.values);
  const get = (key) => (key in edits ? edits[key] : flat[key]);
  const changed = Object.fromEntries(Object.entries(edits).filter(([k, v]) => String(v) !== String(flat[k]) && v !== ''));
  const changedCount = Object.keys(changed).length;

  // Report unsaved edits so switching tabs warns instead of silently dropping
  // them. load() clears edits (on mount, re-read, and post-save) which zeroes
  // changedCount; the cleanup clears the flag on unmount.
  useEffect(() => {
    setDirty('tune', changedCount > 0);
    return () => setDirty('tune', false);
  }, [changedCount, setDirty]);

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

  function setVal(key, value) {
    setEdits(e => ({ ...e, [key]: value }));
  }

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

  async function apply() {
    if (!backupOk) return; // never write, or claim a backup, without one
    setConfirm(false); setApplying(true); setError(null);
    try {
      const commands = [...Object.entries(changed).map(([k, v]) => `set ${k} = ${v}`), 'save'];
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
      // FC reboots on save — give it a moment, then re-read.
      await new Promise(r2 => setTimeout(r2, 3500));
      await load();
    } catch (e) { setError(e.message); }
    finally { setApplying(false); }
  }

  async function runReview() {
    setReviewing(true); setReview(''); setError(null);
    try {
      const res = await fetch('/api/tune/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groups, changes: changed, model }),
      });
      if (!res.ok || !res.body) throw new Error('review stream failed');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n\n')) !== -1) {
          const chunk = buf.slice(0, nl); buf = buf.slice(nl + 2);
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

  const pids = groups?.find(g => g.group === 'pids');
  const rates = groups?.find(g => g.group === 'rates');
  const filters = groups?.find(g => g.group === 'filters');
  const simplified = groups?.find(g => g.group === 'simplified');

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Tune</h1>
          <p className="text-stack-muted mt-1">PIDs, rates, and filters — edit values, let the AI sanity-check them, apply with a backup-gated save.</p>
        </div>
        <button className="btn-ghost text-sm shrink-0" disabled={loading || applying} onClick={load}>
          {loading ? 'Reading…' : 'Re-read from FC'}
        </button>
      </div>

      {error && <div className="panel p-4 border-stack-err text-stack-err text-sm">{error}</div>}
      {!groups && !error && <div className="panel p-4 text-sm text-stack-muted">{loading ? 'Reading dump from FC…' : 'Plug in an FC to read the tune.'}</div>}

      {pids && (
        <section className="panel p-5">
          <div className="text-xs uppercase tracking-wide text-stack-muted mb-3">{pids.label}</div>
          <table className="w-full text-sm">
            <thead className="text-xs text-stack-muted uppercase">
              <tr><th className="text-left pb-2 pr-3"></th>{PID_TERMS.map(t => <th key={t.key} className="text-left pb-2 pr-3">{t.label}</th>)}</tr>
            </thead>
            <tbody>
              {PID_AXES.map(axis => (
                <tr key={axis} className="border-t border-stack-border">
                  <td className="py-2 pr-3 uppercase text-xs text-stack-muted">{axis}</td>
                  {PID_TERMS.map(t => {
                    const key = `${t.key}_${axis}`;
                    return (
                      <td key={key} className="py-1.5 pr-3">
                        {key in flat
                          ? <NumInput value={get(key)} changed={key in changed} onChange={v => setVal(key, v)} />
                          : <span className="text-stack-muted">—</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {rates && (
        <section className="panel p-5">
          <div className="text-xs uppercase tracking-wide text-stack-muted mb-3">{rates.label}{flat.rates_type ? ` · type: ${flat.rates_type}` : ''}</div>
          <table className="w-full text-sm">
            <thead className="text-xs text-stack-muted uppercase">
              <tr><th className="text-left pb-2 pr-3"></th>{RATE_TERMS.map(t => <th key={t.suffix} className="text-left pb-2 pr-3">{t.label}</th>)}</tr>
            </thead>
            <tbody>
              {PID_AXES.map(axis => (
                <tr key={axis} className="border-t border-stack-border">
                  <td className="py-2 pr-3 uppercase text-xs text-stack-muted">{axis}</td>
                  {RATE_TERMS.map(t => {
                    const key = `${axis}_${t.suffix}`;
                    return (
                      <td key={key} className="py-1.5 pr-3">
                        {key in flat
                          ? <NumInput value={get(key)} changed={key in changed} onChange={v => setVal(key, v)} />
                          : <span className="text-stack-muted">—</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {(flat.thr_mid != null || flat.thr_expo != null) && (
            <div className="mt-3 flex gap-6 text-sm">
              {flat.thr_mid != null && <label className="flex items-center gap-2 text-stack-muted">thr_mid <NumInput value={get('thr_mid')} changed={'thr_mid' in changed} onChange={v => setVal('thr_mid', v)} /></label>}
              {flat.thr_expo != null && <label className="flex items-center gap-2 text-stack-muted">thr_expo <NumInput value={get('thr_expo')} changed={'thr_expo' in changed} onChange={v => setVal('thr_expo', v)} /></label>}
            </div>
          )}
        </section>
      )}

      {filters && <KeyValueGroup group={filters} get={get} changed={changed} setVal={setVal} />}
      {simplified && <KeyValueGroup group={simplified} get={get} changed={changed} setVal={setVal} />}

      {groups && (
        <div className="panel p-4 flex items-center justify-between gap-4 sticky bottom-2">
          <div className="text-sm text-stack-muted">
            {changedCount ? <span className="text-stack-warn font-semibold">{changedCount} value(s) changed — not yet on the FC</span> : 'No pending changes'}
          </div>
          <div className="flex gap-2">
            <button className="btn-ghost text-sm" disabled={reviewing} onClick={runReview}>
              {reviewing ? 'Reviewing…' : 'AI review'}
            </button>
            <button className={changedCount ? 'btn-primary text-sm' : 'btn-ghost text-sm opacity-50 cursor-not-allowed'}
              disabled={!changedCount || applying} onClick={() => setConfirm(true)}>
              {applying ? 'Applying…' : `Apply ${changedCount || ''} change(s) + save`}
            </button>
          </div>
        </div>
      )}

      {review && (
        <div className="panel p-4 chat-markdown text-sm"
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(review)) }} />
      )}

      {confirm && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="panel p-6 max-w-lg w-full">
            <h2 className="text-xl font-semibold text-stack-warn">⚠ Write tune to FC</h2>
            <pre className="mt-3 bg-stack-bg border border-stack-border rounded p-3 text-xs font-mono max-h-48 overflow-auto">
              {Object.entries(changed).map(([k, v]) => `set ${k} = ${v}`).join('\n') + '\nsave'}
            </pre>
            <p className="text-sm text-stack-muted mt-2">The FC saves and reboots. Bad filter/PID values can make the aircraft dangerous — have a config backup.</p>

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

function NumInput({ value, changed, onChange }) {
  return (
    <input
      value={value ?? ''}
      onChange={e => onChange(e.target.value)}
      className={[
        'w-20 bg-stack-bg border rounded px-2 py-1 font-mono text-xs outline-none focus:border-stack-accent',
        changed ? 'border-stack-warn text-stack-warn' : 'border-stack-border',
      ].join(' ')}
    />
  );
}

function KeyValueGroup({ group, get, changed, setVal }) {
  return (
    <section className="panel p-5">
      <div className="text-xs uppercase tracking-wide text-stack-muted mb-3">{group.label}</div>
      <div className="grid md:grid-cols-2 gap-x-10 gap-y-2">
        {Object.keys(group.values).map(key => (
          <label key={key} className="flex items-center justify-between gap-3 text-sm">
            <span className="font-mono text-xs text-stack-muted">{key}</span>
            <NumInput value={get(key)} changed={key in changed} onChange={v => setVal(key, v)} />
          </label>
        ))}
      </div>
    </section>
  );
}
