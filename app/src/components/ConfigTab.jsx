import React, { useEffect, useRef, useState } from 'react';

export default function ConfigTab() {
  const [backups, setBackups] = useState([]);
  const [backingUp, setBackingUp] = useState(false);
  const [viewing, setViewing] = useState(null); // { id, content }
  const [compare, setCompare] = useState([]);   // up to 2 backup ids
  const [diff, setDiff] = useState(null);
  const [error, setError] = useState(null);

  async function toggleCompare(id) {
    setDiff(null);
    const next = compare.includes(id) ? compare.filter(c => c !== id) : [...compare.slice(-1), id];
    setCompare(next);
    if (next.length === 2) {
      const [a, b] = [...next].sort(); // ids are timestamped — older first
      try {
        const j = await (await fetch(`/api/config/backups/${encodeURIComponent(a)}/diff/${encodeURIComponent(b)}`)).json();
        if (!j.ok) throw new Error(j.error || 'diff failed');
        setDiff(j);
      } catch (e) { setError(e.message); }
    }
  }

  async function refreshBackups() {
    try {
      const j = await (await fetch('/api/config/backups')).json();
      if (j.ok) setBackups(j.backups);
    } catch {}
  }

  useEffect(() => { refreshBackups(); }, []);

  async function takeBackup() {
    setBackingUp(true); setError(null);
    try {
      const r = await fetch('/api/config/backup', { method: 'POST' });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'backup failed');
      setViewing({ id: j.id, content: j.content });
      await refreshBackups();
    } catch (e) { setError(e.message); }
    finally { setBackingUp(false); }
  }

  async function openBackup(id) {
    setError(null);
    try {
      const j = await (await fetch(`/api/config/backups/${encodeURIComponent(id)}`)).json();
      if (!j.ok) throw new Error(j.error || 'could not read backup');
      setViewing({ id, content: j.content });
    } catch (e) { setError(e.message); }
  }

  function downloadBackup(id, content) {
    const blob = new Blob([content], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${id}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Config</h1>
        <p className="text-stack-muted mt-1">
          Back up the FC configuration before you touch anything, browse past backups,
          and run CLI commands. Write commands require a confirmation and a fresh backup.
        </p>
      </div>

      <section className="panel p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="text-xs uppercase tracking-wide text-stack-muted">Config backups</div>
          <button onClick={takeBackup} disabled={backingUp}
            className={backingUp ? 'btn-ghost opacity-50 cursor-not-allowed' : 'btn-primary'}>
            {backingUp ? 'Reading diff all…' : 'Backup now'}
          </button>
        </div>

        {backups.length === 0 && <div className="text-sm text-stack-muted">No backups yet. Plug in an FC and take one.</div>}
        {backups.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-xs text-stack-muted uppercase">
              <tr>
                <th className="text-left pb-2 pr-3" title="pick two to compare">Δ</th>
                <th className="text-left pb-2 pr-4">When</th>
                <th className="text-left pb-2 pr-4">Board / kind</th>
                <th className="text-left pb-2 pr-4">Size</th>
                <th className="text-left pb-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {backups.map(b => (
                <tr key={b.id} className="border-t border-stack-border">
                  <td className="py-2 pr-3">
                    <input type="checkbox" className="w-4 h-4 accent-stack-accent"
                      checked={compare.includes(b.id)} onChange={() => toggleCompare(b.id)} />
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs">{b.createdAt?.replace('T', ' ').slice(0, 19)}</td>
                  <td className="py-2 pr-4">
                    {b.boardName || '—'}
                    {b.auto && <span className="pill-muted ml-2" title={b.reason}>auto</span>}
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs">{b.bytes != null ? `${(b.bytes / 1024).toFixed(1)} KB` : '—'}</td>
                  <td className="py-2 space-x-3">
                    <button className="text-stack-accent hover:underline" onClick={() => openBackup(b.id)}>view</button>
                    <button className="text-stack-accent hover:underline"
                      onClick={async () => {
                        const j = await (await fetch(`/api/config/backups/${encodeURIComponent(b.id)}`)).json();
                        if (j.ok) downloadBackup(b.id, j.content);
                      }}>download</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {compare.length === 1 && <div className="mt-3 text-xs text-stack-muted">Pick a second backup to see what changed between them.</div>}
        {diff && <BackupDiff diff={diff} onClose={() => { setDiff(null); setCompare([]); }} />}

        {viewing && (
          <div className="mt-4 border-t border-stack-border pt-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-mono text-stack-muted">{viewing.id}</div>
              <div className="space-x-3 text-sm">
                <button className="text-stack-accent hover:underline" onClick={() => downloadBackup(viewing.id, viewing.content)}>download</button>
                <button className="text-stack-muted hover:underline" onClick={() => setViewing(null)}>close</button>
              </div>
            </div>
            <pre className="bg-stack-bg border border-stack-border rounded p-3 text-xs font-mono overflow-auto max-h-80 whitespace-pre-wrap">{viewing.content}</pre>
          </div>
        )}
      </section>

      {error && <div className="panel p-4 border-stack-err text-stack-err text-sm">{error}</div>}

      <CliConsole hasBackup={backups.length > 0} />
    </div>
  );
}

// "What changed between these two configs" — the timeline view.
function BackupDiff({ diff, onClose }) {
  const total = diff.changed.length + diff.added.length + diff.removed.length + diff.otherAdded.length + diff.otherRemoved.length;
  return (
    <div className="mt-4 border-t border-stack-border pt-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-mono text-stack-muted">
          {diff.from} → {diff.to} · {total ? `${total} difference(s)` : 'identical configs'}
        </div>
        <button className="text-stack-muted hover:underline text-sm" onClick={onClose}>close</button>
      </div>
      {total > 0 && (
        <div className="bg-stack-bg border border-stack-border rounded p-3 text-xs font-mono max-h-80 overflow-auto space-y-0.5">
          {diff.changed.map(c => (
            <div key={c.key}><span className="text-stack-warn">~ set {c.key}</span> <span className="text-stack-muted line-through">{c.from}</span> → <span className="text-stack-text">{c.to}</span></div>
          ))}
          {diff.added.map(c => <div key={c.key} className="text-stack-ok">+ set {c.key} = {c.value}</div>)}
          {diff.removed.map(c => <div key={c.key} className="text-stack-err">- set {c.key} = {c.value}</div>)}
          {diff.otherAdded.map((l, i) => <div key={`oa${i}`} className="text-stack-ok">+ {l}</div>)}
          {diff.otherRemoved.map((l, i) => <div key={`or${i}`} className="text-stack-err">- {l}</div>)}
        </div>
      )}
    </div>
  );
}

function CliConsole({ hasBackup }) {
  const [command, setCommand] = useState('');
  const [log, setLog] = useState([]); // { command, output, kind, error }
  const [running, setRunning] = useState(false);
  const [confirmWrite, setConfirmWrite] = useState(null); // pending command line
  const logRef = useRef(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  async function run(line, token) {
    setRunning(true);
    try {
      const r = await fetch('/api/cli', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: line, token }),
      });
      const j = await r.json();
      if (!j.ok && j.kind === 'write' && !token) {
        // Needs a write token — surface the confirmation flow.
        setConfirmWrite(line);
        return;
      }
      setLog(l => [...l, { command: line, output: j.ok ? j.output : null, kind: j.kind, error: j.ok ? null : j.error }]);
      if (j.ok) setCommand('');
    } catch (e) {
      setLog(l => [...l, { command: line, output: null, error: e.message }]);
    } finally {
      setRunning(false);
    }
  }

  async function confirmAndRun() {
    const line = confirmWrite;
    setConfirmWrite(null);
    try {
      const r = await fetch('/api/safety/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'config.write', acknowledged: true, backupTaken: true }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'token refused');
      await run(line, j.token);
    } catch (e) {
      setLog(l => [...l, { command: line, output: null, error: e.message }]);
    }
  }

  return (
    <section className="panel p-5">
      <div className="text-xs uppercase tracking-wide text-stack-muted mb-1">CLI console</div>
      <p className="text-xs text-stack-muted mb-3">
        Read commands (<span className="font-mono">status, get, diff, dump, resource show…</span>) run directly.
        Write commands (<span className="font-mono">set x = y, save, aux…</span>) require confirmation.
        Destructive commands (<span className="font-mono">defaults, flash_erase, motor</span>) are blocked here.
      </p>

      <div ref={logRef} className="bg-stack-bg border border-stack-border rounded p-3 text-xs font-mono overflow-auto h-64 space-y-3">
        {log.length === 0 && <div className="text-stack-muted"># output appears here — try “status” or “get gyro”</div>}
        {log.map((entry, i) => (
          <div key={i}>
            <div className="text-stack-accent"># {entry.command}</div>
            {entry.error
              ? <div className="text-stack-err whitespace-pre-wrap">{entry.error}</div>
              : <div className="whitespace-pre-wrap text-stack-text">{entry.output || '(no output)'}</div>}
          </div>
        ))}
      </div>

      <form className="mt-3 flex gap-2" onSubmit={e => { e.preventDefault(); if (command.trim() && !running) run(command.trim()); }}>
        <input
          value={command}
          onChange={e => setCommand(e.target.value)}
          placeholder="Betaflight CLI command…"
          disabled={running}
          className="flex-1 bg-stack-panel border border-stack-border rounded-md px-4 py-2 font-mono text-sm outline-none focus:border-stack-accent disabled:opacity-50"
        />
        <button type="submit" disabled={running || !command.trim()}
          className={!running && command.trim() ? 'btn-primary' : 'btn-ghost opacity-50'}>
          {running ? 'Running…' : 'Run'}
        </button>
      </form>

      {confirmWrite && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="panel p-6 max-w-lg w-full">
            <h2 className="text-xl font-semibold text-stack-warn">⚠ Write to flight controller</h2>
            <p className="text-sm text-stack-muted mt-2">
              <span className="font-mono text-stack-text">{confirmWrite}</span> modifies FC configuration.
              A wrong value can make the aircraft unflyable or unsafe.
            </p>
            {!hasBackup && (
              <p className="text-sm text-stack-err mt-3">
                No config backup exists yet — take one above before writing.
              </p>
            )}
            <div className="mt-6 flex gap-3 justify-end">
              <button className="btn-ghost" onClick={() => setConfirmWrite(null)}>Cancel</button>
              <button
                className={hasBackup ? 'btn-primary' : 'btn-ghost opacity-50 cursor-not-allowed'}
                disabled={!hasBackup}
                onClick={confirmAndRun}
              >I have a backup — write it</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
