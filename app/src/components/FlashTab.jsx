import React, { useEffect, useRef, useState } from 'react';

// Firmware Flasher — the firmware-safe workflow:
//   1. prerequisites (dfu-util, FC state)
//   2. stage firmware (recommended online release for the detected board, or local .hex)
//   3. config backup (required before the flash token is issued)
//   4. flash with live dfu-util log + post-flash verify scan
//   5. restore config from a backup
export default function FlashTab() {
  const [status, setStatus] = useState(null);
  const [releases, setReleases] = useState(null);
  const [selected, setSelected] = useState(null); // staged firmware name
  const [uploading, setUploading] = useState(false);
  const [fetching, setFetching] = useState(null); // asset url being fetched
  const [backingUp, setBackingUp] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState([]); // { stage, msg } | { error } | { done... }
  const [outcome, setOutcome] = useState(null); // { verified, fc?, warning? }
  const [restore, setRestore] = useState(null); // backupId pending confirm
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState(null);
  const logRef = useRef(null);
  const fileRef = useRef(null);

  const boardName = (() => {
    try { return JSON.parse(localStorage.getItem('st:lastScan'))?.fc?.boardName || null; }
    catch { return null; }
  })();

  async function refresh() {
    try {
      const j = await (await fetch('/api/flash/status')).json();
      if (j.ok) {
        setStatus(j);
        if (!selected && j.firmwares?.length) setSelected(j.firmwares[0].name);
      }
    } catch {}
  }

  const [releaseSrc, setReleaseSrc] = useState('betaflight');

  useEffect(() => { refresh(); }, []);

  useEffect(() => {
    setReleases(null);
    fetch(`/api/flash/releases?src=${releaseSrc}`).then(r => r.json()).then(setReleases)
      .catch(() => setReleases({ online: false, releases: [] }));
  }, [releaseSrc]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  async function uploadHex(file) {
    setUploading(true); setError(null);
    try {
      const text = await file.text();
      const r = await fetch(`/api/flash/upload?name=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: text,
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'upload failed');
      setSelected(j.name);
      await refresh();
    } catch (e) { setError(e.message); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  }

  async function fetchAsset(asset) {
    setFetching(asset.url); setError(null);
    try {
      const r = await fetch('/api/flash/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: asset.url, name: asset.name }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'fetch failed');
      setSelected(j.name);
      await refresh();
    } catch (e) { setError(e.message); }
    finally { setFetching(null); }
  }

  async function takeBackup() {
    setBackingUp(true); setError(null);
    try {
      const r = await fetch('/api/config/backup', { method: 'POST' });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'backup failed');
      await refresh();
    } catch (e) { setError(e.message); }
    finally { setBackingUp(false); }
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

  async function runFlash() {
    setConfirm(false); setRunning(true); setError(null); setLog([]); setOutcome(null);
    try {
      const tr = await fetch('/api/safety/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'flash.write', acknowledged: true, backupTaken: true }),
      });
      const tj = await tr.json();
      if (!tj.ok) throw new Error(tj.error || 'token refused');

      const res = await fetch('/api/flash/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tj.token, firmware: selected }),
      });
      if (!res.ok || !res.body) throw new Error('flash stream failed to open');

      await readSse(res, (obj) => {
        if (obj.error) { setError(obj.error); setLog(l => [...l, { stage: 'error', msg: obj.error }]); }
        else if (obj.done) setOutcome(obj);
        else if (obj.stage) setLog(l => [...l, obj]);
      });
      await refresh();
    } catch (e) { setError(e.message); }
    finally { setRunning(false); }
  }

  async function runRestore(backupId) {
    setRestore(null); setRestoring(true); setError(null); setLog([]);
    try {
      const tr = await fetch('/api/safety/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'config.write', acknowledged: true, backupTaken: true }),
      });
      const tj = await tr.json();
      if (!tj.ok) throw new Error(tj.error || 'token refused');

      const res = await fetch('/api/config/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tj.token, backupId }),
      });
      if (!res.ok || !res.body) throw new Error('restore stream failed to open');

      await readSse(res, (obj) => {
        if (obj.error) setError(obj.error);
        else if (obj.done) setLog(l => [...l, { stage: 'restore', msg: `Done — ${obj.lines} lines applied, FC rebooting.` }]);
        else if (obj.stage) setLog(l => [...l, obj]);
      });
    } catch (e) { setError(e.message); }
    finally { setRestoring(false); }
  }

  const dfu = status?.dfuUtil;
  const det = status?.detection;
  const firmwares = status?.firmwares || [];
  const hasBackup = !!status?.latestBackup;
  const busy = running || restoring;

  const recommendedAssets = (releases?.releases || []).flatMap(rel =>
    rel.assets
      .filter(a => boardName && a.name.toUpperCase().includes(`_${boardName.toUpperCase()}.HEX`))
      .map(a => ({ ...a, tag: rel.tag, prerelease: rel.prerelease }))
  ).slice(0, 4);

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Firmware Flasher</h1>
        <p className="text-stack-muted mt-1">
          Firmware-safe flashing: config backup first, DFU via dfu-util, automatic post-flash
          verification, one-click config restore after.
        </p>
      </div>

      <div className="note">
        <span className="font-semibold">Note:</span> flashing erases your configuration. The flash
        button stays locked until a config backup exists. Never unplug USB while the log is running.
      </div>

      {/* 1 · Prerequisites */}
      <section className="panel p-5">
        <div className="text-xs uppercase tracking-wide text-stack-muted mb-3">1 · Prerequisites</div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {dfu?.found
            ? <span className="pill-ok">dfu-util · {dfu.version}</span>
            : <span className="pill-err">dfu-util not found</span>}
          {det?.type === 'ALIVE' && <span className="pill-ok">FC connected · {det.comPort}</span>}
          {det?.type === 'DFU' && <span className="pill-warn">FC already in DFU</span>}
          {det && det.type !== 'ALIVE' && det.type !== 'DFU' && <span className="pill-muted">FC: {det.type}</span>}
        </div>
        {!dfu?.found && (
          <div className="mt-3 text-sm text-stack-muted">
            Install dfu-util and make sure it is on PATH:
            <span className="font-mono text-stack-text"> winget install dfu-util</span> (Windows) ·
            <span className="font-mono text-stack-text"> brew install dfu-util</span> (macOS) ·
            <span className="font-mono text-stack-text"> sudo apt install dfu-util</span> (Linux).
            Windows may also need the WinUSB driver on the DFU device (ImpulseRC Driver Fixer or Zadig).
          </div>
        )}
      </section>

      {/* 2 · Firmware */}
      <section className="panel p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="text-xs uppercase tracking-wide text-stack-muted">2 · Firmware</div>
          <div className="flex items-center gap-2">
            <input ref={fileRef} type="file" accept=".hex" className="hidden"
              onChange={e => e.target.files?.[0] && uploadHex(e.target.files[0])} />
            <button className="btn-ghost text-sm" disabled={uploading || busy}
              onClick={() => fileRef.current?.click()}>
              {uploading ? 'Validating…' : 'Upload local .hex'}
            </button>
          </div>
        </div>

        {boardName && (
          <div className="text-sm">
            <span className="text-stack-muted">Detected board target: </span>
            <span className="font-mono text-stack-accent">{boardName}</span>
            {releases && !releases.online && (
              <span className="text-stack-muted"> · offline — release lookup unavailable, upload a local file</span>
            )}
          </div>
        )}
        {!boardName && (
          <div className="text-sm text-stack-muted">Run a scan in Setup to get a board-matched firmware recommendation.</div>
        )}

        <div className="flex items-center gap-2 text-xs">
          <span className="text-stack-muted">Firmware source:</span>
          {['betaflight', 'inav'].map(s => (
            <button key={s} onClick={() => setReleaseSrc(s)}
              className={releaseSrc === s ? 'pill-ok' : 'pill-muted hover:text-stack-text'}>
              {s === 'betaflight' ? 'Betaflight' : 'INAV'}
            </button>
          ))}
        </div>

        {recommendedAssets.length > 0 && (
          <div>
            <div className="text-xs text-stack-muted mb-2">Official {releaseSrc === 'inav' ? 'INAV' : 'Betaflight'} releases for your board:</div>
            <div className="space-y-1.5">
              {recommendedAssets.map(a => (
                <div key={a.url} className="flex items-center justify-between bg-stack-bg border border-stack-border rounded px-3 py-2 text-sm">
                  <div className="font-mono text-xs">
                    {a.name} <span className="text-stack-muted">· {a.tag}{a.prerelease ? ' · RC' : ''} · {a.sizeKb} KB</span>
                  </div>
                  <button className="text-stack-accent hover:underline text-sm" disabled={!!fetching || busy}
                    onClick={() => fetchAsset(a)}>
                    {fetching === a.url ? 'downloading…' : 'stage'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <div className="text-xs text-stack-muted mb-2">Staged firmware (select one):</div>
          {firmwares.length === 0 && <div className="text-sm text-stack-muted">Nothing staged yet.</div>}
          <div className="space-y-1.5">
            {firmwares.map(f => (
              <label key={f.name} className="flex items-center gap-3 bg-stack-bg border border-stack-border rounded px-3 py-2 text-sm cursor-pointer">
                <input type="radio" name="fw" checked={selected === f.name} onChange={() => setSelected(f.name)}
                  className="accent-stack-accent" />
                <span className="font-mono text-xs flex-1">{f.name}</span>
                <span className="text-stack-muted text-xs font-mono">
                  {f.baseAddress} · {f.totalBytes ? `${Math.round(f.totalBytes / 1024)} KB` : ''}
                </span>
              </label>
            ))}
          </div>
        </div>
      </section>

      {/* 3 · Backup */}
      <section className="panel p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-wide text-stack-muted mb-1">3 · Config backup</div>
            {hasBackup
              ? <div className="text-sm">Latest: <span className="font-mono text-xs">{status.latestBackup.id}</span></div>
              : <div className="text-sm text-stack-err">No backup exists — required before flashing.</div>}
          </div>
          <button className="btn-ghost text-sm" disabled={backingUp || busy || det?.type !== 'ALIVE'} onClick={takeBackup}>
            {backingUp ? 'Reading diff all…' : 'Backup now'}
          </button>
        </div>
      </section>

      {/* 4 · Flash */}
      <section className="panel p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="text-xs uppercase tracking-wide text-stack-muted">4 · Flash</div>
          <button
            disabled={busy || !dfu?.found || !selected || !hasBackup || !det || (det.type !== 'ALIVE' && det.type !== 'DFU')}
            onClick={() => setConfirm(true)}
            className={(!busy && dfu?.found && selected && hasBackup && det && (det.type === 'ALIVE' || det.type === 'DFU'))
              ? 'btn-primary' : 'btn-ghost opacity-50 cursor-not-allowed'}
          >
            {running ? 'Flashing…' : `Flash ${selected || ''}`}
          </button>
        </div>

        {(log.length > 0 || busy) && (
          <div ref={logRef} className="bg-stack-bg border border-stack-border rounded p-3 text-xs font-mono overflow-auto h-56 space-y-0.5">
            {log.map((e, i) => (
              <div key={i} className={e.stage === 'error' ? 'text-stack-err' : ''}>
                <span className="text-stack-accent">[{e.stage}]</span> {e.msg}
              </div>
            ))}
            {busy && <div className="text-stack-muted">…</div>}
          </div>
        )}

        {outcome && (
          outcome.verified
            ? <div className="note">
                <span className="font-semibold">Verified:</span> FC is back —{' '}
                <span className="font-mono">{outcome.fc?.boardName}</span> running Betaflight{' '}
                <span className="font-mono">{outcome.fc?.firmware}</span>. Restore your config below.
              </div>
            : <div className="panel p-4 border-stack-warn text-stack-warn text-sm">{outcome.warning}</div>
        )}
      </section>

      {/* 5 · Restore */}
      <section className="panel p-5 space-y-4">
        <div className="text-xs uppercase tracking-wide text-stack-muted">5 · Restore config (after flash)</div>
        {!hasBackup && <div className="text-sm text-stack-muted">No backups to restore.</div>}
        {hasBackup && (
          <>
            <div className="flex items-center justify-between text-sm">
              <div>
                <span className="text-stack-text">Same firmware version?</span>{' '}
                <span className="text-stack-muted">Replay <span className="font-mono text-xs">{status.latestBackup.id}</span> verbatim.</span>
              </div>
              <button className="btn-ghost text-sm" disabled={busy || det?.type !== 'ALIVE'}
                onClick={() => setRestore(status.latestBackup.id)}>
                {restoring ? 'Restoring…' : 'Restore latest backup'}
              </button>
            </div>
            <MigrationAssistant
              backupId={status.latestBackup.id}
              busy={busy}
              detAlive={det?.type === 'ALIVE'}
            />
          </>
        )}
      </section>

      {error && <div className="panel p-4 border-stack-err text-stack-err text-sm">{error}</div>}

      {confirm && (
        <ConfirmModal
          title="Flash firmware"
          warning={`This erases the FC and writes ${selected}. The configuration will be reset — your backup will be used to restore it afterwards.`}
          confirmLabel="I have a backup — flash it"
          onCancel={() => setConfirm(false)}
          onConfirm={runFlash}
        />
      )}
      {restore && (
        <ConfirmModal
          title="Restore configuration"
          warning={`This replays every line of ${restore} onto the FC and saves. Only restore a backup taken from this same board.`}
          confirmLabel="Restore and save"
          onCancel={() => setRestore(null)}
          onConfirm={() => runRestore(restore)}
        />
      )}
    </div>
  );
}

// Upgraded firmware versions? Blind diff replay silently drops renamed
// parameters (classic: filter settings → burned motors). The AI translates
// the old diff for the new version; you review every line before applying.
function MigrationAssistant({ backupId, busy, detAlive }) {
  const [result, setResult] = useState(null); // { commands, notes, rejected, ... }
  const [lines, setLines] = useState('');
  const [running, setRunning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const model = localStorage.getItem('st:chat:model') || 'llama3.1:8b';

  async function migrate() {
    setRunning(true); setError(null); setResult(null); setDone(false);
    try {
      let targetVersion = 'unknown';
      try { targetVersion = JSON.parse(localStorage.getItem('st:lastScan'))?.fc?.firmware || 'unknown'; } catch {}
      const r = await fetch('/api/config/migrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backupId, model, targetVersion }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'migration failed');
      setResult(j);
      setLines(j.commands.join('\n'));
    } catch (e) { setError(e.message); }
    finally { setRunning(false); }
  }

  async function apply() {
    setConfirm(false); setApplying(true); setError(null);
    try {
      const commands = lines.split('\n').map(l => l.trim()).filter(Boolean);
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
      setDone(true);
    } catch (e) { setError(e.message); }
    finally { setApplying(false); }
  }

  return (
    <div className="border-t border-stack-border pt-4">
      <div className="flex items-center justify-between text-sm">
        <div>
          <span className="text-stack-text">Different firmware version?</span>{' '}
          <span className="text-stack-muted">Let the AI translate the old diff — renamed parameters fixed, dead ones dropped, every line reviewable.</span>
        </div>
        <button className="btn-ghost text-sm shrink-0 ml-3" disabled={busy || running} onClick={migrate}>
          {running ? 'Translating…' : 'AI migration review'}
        </button>
      </div>

      {error && <div className="mt-3 text-sm text-stack-err">{error}</div>}

      {result && (
        <div className="mt-3 space-y-3">
          <div className="text-xs text-stack-muted font-mono">
            {result.oldVersion} → BF {result.targetVersion}
          </div>
          {result.notes?.length > 0 && (
            <div className="note text-xs">
              <div className="font-semibold mb-1">Dropped / changed by the AI:</div>
              <ul className="list-disc pl-4 space-y-0.5">
                {result.notes.map((n, i) => <li key={i}>{n}</li>)}
              </ul>
            </div>
          )}
          {result.rejected?.length > 0 && (
            <div className="text-xs text-stack-err">
              Rejected by the validator: <span className="font-mono">{result.rejected.join(' · ')}</span>
            </div>
          )}
          <textarea
            value={lines}
            onChange={e => setLines(e.target.value)}
            spellCheck={false}
            rows={Math.min(18, lines.split('\n').length + 1)}
            className="w-full bg-stack-bg border border-stack-border rounded p-3 font-mono text-xs outline-none focus:border-stack-accent"
          />
          <div className="flex items-center justify-between">
            <div className="text-xs text-stack-muted">Edit freely — this is what will run. Review filters and PIDs especially.</div>
            <button className="btn-primary text-sm" disabled={applying || !detAlive || !lines.trim()}
              onClick={() => setConfirm(true)}>
              {applying ? 'Applying…' : done ? 'Applied ✓ — apply again' : 'Apply migrated config'}
            </button>
          </div>
        </div>
      )}

      {confirm && (
        <ConfirmModal
          title="Apply migrated configuration"
          warning="These AI-translated commands will be written to the FC and saved. A wrong filter or PID value can make the aircraft dangerous — confirm you reviewed the list."
          confirmLabel="I reviewed every line — apply"
          onCancel={() => setConfirm(false)}
          onConfirm={apply}
        />
      )}
    </div>
  );
}

function ConfirmModal({ title, warning, confirmLabel, onCancel, onConfirm }) {
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="panel p-6 max-w-lg w-full">
        <h2 className="text-xl font-semibold text-stack-warn">⚠ {title}</h2>
        <p className="text-sm text-stack-muted mt-2">{warning}</p>
        <div className="mt-6 flex gap-3 justify-end">
          <button className="btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn-primary" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
