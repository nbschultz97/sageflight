import React, { useEffect, useState } from 'react';

// Fleet — every board this bench has touched, each with its own timeline of
// config backups and blackbox logs, and one-click "what changed between
// these two configs" diffs. The answer to "why does it fly worse than last
// month" starts here.

function fmtWhen(s) {
  return s ? s.replace('T', ' ').slice(0, 16) : '—';
}

export default function FleetTab() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [openBoard, setOpenBoard] = useState(null);

  async function load() {
    setError(null);
    try {
      const j = await (await fetch('/api/fleet')).json();
      if (!j.ok) throw new Error(j.error || 'fleet read failed');
      setData(j);
      if (j.boards.length === 1) setOpenBoard(j.boards[0].board);
    } catch (e) { setError(e.message); }
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Fleet</h1>
        <p className="text-stack-muted mt-1">
          Every board this bench has seen — config history, logs, and what changed between sessions.
        </p>
      </div>

      {error && <div className="panel p-4 border-stack-err text-stack-err text-sm">{error}</div>}
      {data && data.boards.length === 0 && (
        <div className="panel p-6 text-sm text-stack-muted">
          Nothing here yet. Take a config backup or upload a blackbox log and the board appears automatically.
        </div>
      )}

      {data?.boards.map(b => (
        <section key={b.board} className="panel">
          <button className="w-full flex items-center justify-between px-5 py-4 text-left"
            onClick={() => setOpenBoard(openBoard === b.board ? null : b.board)}>
            <div className="flex items-baseline gap-3 min-w-0">
              <span className="font-mono font-semibold text-stack-accent">{b.board}</span>
              {b.crafts.length > 0 && <span className="text-xs text-stack-muted truncate">{b.crafts.join(' · ')}</span>}
            </div>
            <div className="flex items-center gap-3 text-xs text-stack-muted font-mono shrink-0">
              <span>{b.backupCount} config{b.backupCount === 1 ? '' : 's'}</span>
              <span>{b.logCount} log{b.logCount === 1 ? '' : 's'}</span>
              <span>last {fmtWhen(b.lastSeen)}</span>
              <span>{openBoard === b.board ? '▾' : '▸'}</span>
            </div>
          </button>

          {openBoard === b.board && (
            <div className="px-5 pb-5 space-y-4">
              {b.diffPairs.length > 0 && (
                <div>
                  <div className="text-xs uppercase tracking-wide text-stack-muted mb-2">What changed between sessions</div>
                  <div className="space-y-2">
                    {b.diffPairs.slice(0, 8).map(p => <DiffRow key={`${p.from}-${p.to}`} pair={p} />)}
                  </div>
                </div>
              )}
              <div>
                <div className="text-xs uppercase tracking-wide text-stack-muted mb-2">Timeline</div>
                <div className="space-y-1">
                  {b.events.map((ev, i) => (
                    <div key={i} className="flex items-center gap-3 text-sm">
                      <span className="font-mono text-xs text-stack-muted w-32 shrink-0">{fmtWhen(ev.at)}</span>
                      <span className={ev.type === 'log' ? 'pill-ok' : 'pill-muted'}>{ev.type}</span>
                      <span className="text-stack-text truncate">{ev.label}</span>
                      {ev.bytes != null && <span className="text-xs text-stack-muted font-mono shrink-0">{Math.round(ev.bytes / 1024)} KB</span>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </section>
      ))}

      {data?.caseHistory?.length > 0 && (
        <section className="panel p-5">
          <div className="text-xs uppercase tracking-wide text-stack-muted mb-3">Case-history database (read-only)</div>
          <table className="w-full text-sm">
            <thead className="text-xs text-stack-muted uppercase">
              <tr>
                <th className="text-left pb-2 pr-4">Label</th>
                <th className="text-left pb-2 pr-4">Status</th>
                <th className="text-left pb-2 pr-4">Batch</th>
                <th className="text-left pb-2">Last scan</th>
              </tr>
            </thead>
            <tbody>
              {data.caseHistory.map((u, i) => (
                <tr key={i} className="border-t border-stack-border">
                  <td className="py-1.5 pr-4">{u.label || `#${u.unitNumber}`}</td>
                  <td className="py-1.5 pr-4">
                    <span className={u.status === 'DEAD' ? 'pill-err' : u.status === 'HEALTHY' ? 'pill-ok' : 'pill-warn'}>{u.status || '?'}</span>
                  </td>
                  <td className="py-1.5 pr-4 font-mono text-xs">{u.batch}</td>
                  <td className="py-1.5 font-mono text-xs">{fmtWhen(u.lastScanAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {data?.benchActivity?.length > 0 && (
        <section className="panel p-5">
          <div className="text-xs uppercase tracking-wide text-stack-muted mb-3">Recent bench activity</div>
          <div className="space-y-1">
            {data.benchActivity.slice(0, 20).map((h, i) => (
              <div key={i} className="flex items-center gap-3 text-sm">
                <span className="font-mono text-xs text-stack-muted w-32 shrink-0">{fmtWhen(h.at)}</span>
                <span className="font-mono text-xs text-stack-text">{h.kind}</span>
                <span className="text-xs text-stack-muted truncate">
                  {h.kind === 'motor.spin' && `M${h.motor} @ ${h.pwm}`}
                  {h.kind === 'config.batch' && `${h.commands} command(s)${h.saved ? ' + save' : ''}`}
                  {h.kind === 'flash.cloudbuild' && `${h.target}@${h.release}`}
                  {h.kind === 'blackbox.download' && `${Math.round((h.bytes || 0) / 1024)} KB`}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function DiffRow({ pair }) {
  const [diff, setDiff] = useState(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  async function toggle() {
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (!diff) {
      setLoading(true);
      try {
        const j = await (await fetch(`/api/config/backups/${encodeURIComponent(pair.from)}/diff/${encodeURIComponent(pair.to)}`)).json();
        if (j.ok) setDiff(j);
      } catch {}
      setLoading(false);
    }
  }

  const total = diff ? diff.changed.length + diff.added.length + diff.removed.length + diff.otherAdded.length + diff.otherRemoved.length : null;

  return (
    <div className="bg-stack-bg border border-stack-border rounded">
      <button className="w-full flex items-center justify-between px-3 py-2 text-xs font-mono" onClick={toggle}>
        <span className="text-stack-muted truncate">…{pair.from.slice(-24)} → …{pair.to.slice(-24)}</span>
        <span className="text-stack-accent shrink-0 ml-3">
          {loading ? 'diffing…' : diff ? (total === 0 ? 'identical' : `${total} change(s)`) : 'diff'}
        </span>
      </button>
      {open && diff && total > 0 && (
        <div className="px-3 pb-2 text-xs font-mono space-y-0.5 max-h-48 overflow-auto">
          {diff.changed.map(c => <div key={c.key}><span className="text-stack-warn">~</span> {c.key}: {c.from} → {c.to}</div>)}
          {diff.added.map(c => <div key={c.key}><span className="text-stack-ok">+</span> {c.key} = {c.value}</div>)}
          {diff.removed.map(c => <div key={c.key}><span className="text-stack-err">-</span> {c.key} = {c.value}</div>)}
          {diff.otherAdded.map((l, i) => <div key={`oa${i}`}><span className="text-stack-ok">+</span> {l}</div>)}
          {diff.otherRemoved.map((l, i) => <div key={`or${i}`}><span className="text-stack-err">-</span> {l}</div>)}
        </div>
      )}
    </div>
  );
}
