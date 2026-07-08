import React, { useEffect, useRef, useState } from 'react';

const AIRFRAMES = [
  { id: 'freestyle5', label: '5" Freestyle' },
  { id: 'cinewhoop', label: 'Cinewhoop' },
  { id: 'longrange7', label: '7" Long-range' },
  { id: 'whoop', label: 'Tiny Whoop' },
];

// Map a loadout's airframe class onto our checklist sets (mirror of lib/loadout.js).
function loadoutAirframe(loadout) {
  const c = String(loadout?.airframeClass || '').toLowerCase();
  if (/cine/.test(c)) return 'cinewhoop';
  if (/whoop|65|75mm/.test(c)) return 'whoop';
  if (/7|long/.test(c)) return 'longrange7';
  if (/5|freestyle|race/.test(c)) return 'freestyle5';
  return null;
}

// A loadout adds one stage up front: verify the delivered kit matches the plan.
function loadoutStage(loadout) {
  if (!loadout?.components?.length) return null;
  return {
    stage: `Kit check — ${loadout.name}`,
    items: loadout.components.map(c => {
      const qty = c.quantity && c.quantity > 1 ? `${c.quantity}× ` : '';
      const pn = c.part_number ? ` (${c.part_number})` : '';
      return `${qty}${c.name}${pn} — present, undamaged, matches the plan`;
    }),
  };
}

// Shared core stages, with per-airframe extras injected where they matter.
function buildChecklist(airframe) {
  const lr = airframe === 'longrange7';
  const cw = airframe === 'cinewhoop';
  const whoop = airframe === 'whoop';

  return [
    {
      stage: 'Bench — before power',
      items: [
        'Frame bolts torqued, no cracked arms or standoffs',
        'Motor screws correct length (not touching windings) and threadlocked',
        'ESC/FC stack mounted on grommets, nothing pinched under it',
        'XT connector solder joints solid, no stray strands',
        'Smoke stopper ready for first power-up',
        ...(whoop ? ['Canopy clears the FC — no pressure on solder joints'] : []),
        ...(cw ? ['Duct screws tight, ducts not rubbing prop tips'] : []),
      ],
    },
    {
      stage: 'First power-up (props OFF)',
      items: [
        'Power through smoke stopper first — no glow, then direct',
        'FC enumerates on USB (Detect tab shows ALIVE)',
        'All 4 ESCs beep the startup tone',
        'Gyro responds in Betaflight setup view (move the quad)',
        'Battery voltage reads correctly (Detect tab · scan)',
      ],
    },
    {
      stage: 'Configuration',
      items: [
        'Take a config backup (Config tab) BEFORE changing anything',
        'Receiver bound and channels move correctly (AETR check)',
        'Arm switch set, arms only when you mean it',
        'Failsafe set to DROP and verified by turning TX off',
        'Motor direction verified (Motors tab spin test, props OFF)',
        'Motor order verified — Betaflight motor map matches wiring',
        ...(lr ? ['GPS lock indoors-window test, rescue mode configured and bench-tested', 'Home point set logic verified before maiden'] : []),
        ...(cw ? ['Air mode + turtle mode configured for duct strikes'] : []),
      ],
    },
    {
      stage: 'Motor & ESC verification (props OFF)',
      items: [
        'Spin each motor individually — listen for grinding (Motors tab)',
        'Run 4-motor voltage-sag compare — no outlier beyond ±150 mV',
        'Motors stop instantly on disarm',
        'No ESC desync twitches across the throttle range',
      ],
    },
    {
      stage: 'Preflight — field',
      items: [
        'Props on LAST, correct rotation, nuts torqued',
        'VTX channel/power set — not stomping on other pilots',
        'RSSI/link quality sane at arm distance',
        'Battery secured, leads clear of props',
        'Arm at low throttle, hover check for oscillation before flying out',
        ...(lr ? ['Verify RTH altitude clears terrain along the whole route'] : []),
      ],
    },
  ];
}

export default function ChecklistsTab() {
  const [airframe, setAirframe] = useState(() => localStorage.getItem('st:checklist:airframe') || 'freestyle5');
  const storageKey = `st:checklist:${airframe}`;
  const [done, setDone] = useState({});
  const [loadout, setLoadout] = useState(null);

  useEffect(() => {
    fetch('/api/loadout').then(r => r.json()).then(j => {
      if (j.ok && j.loadout) {
        setLoadout(j.loadout);
        const mapped = loadoutAirframe(j.loadout);
        if (mapped) setAirframe(mapped);
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    localStorage.setItem('st:checklist:airframe', airframe);
    try { setDone(JSON.parse(localStorage.getItem(storageKey)) || {}); }
    catch { setDone({}); }
  }, [airframe]);

  function toggle(key) {
    setDone(d => {
      const next = { ...d, [key]: !d[key] };
      localStorage.setItem(storageKey, JSON.stringify(next));
      return next;
    });
  }

  function reset() {
    localStorage.removeItem(storageKey);
    setDone({});
  }

  const kitStage = loadoutStage(loadout);
  const checklist = [...(kitStage ? [kitStage] : []), ...buildChecklist(airframe)];
  const total = checklist.reduce((n, s) => n + s.items.length, 0);
  const checked = checklist.reduce((n, s) => n + s.items.filter(it => done[`${s.stage}|${it}`]).length, 0);

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Checklists</h1>
          <p className="text-stack-muted mt-1">Guided build → configuration → preflight, tuned per airframe class. Progress is saved locally.</p>
        </div>
        <button onClick={reset} className="btn-ghost text-sm shrink-0">Reset</button>
      </div>

      <LoadoutPanel loadout={loadout} setLoadout={setLoadout} />

      <div className="flex flex-wrap gap-2">
        {AIRFRAMES.map(a => (
          <button key={a.id} onClick={() => setAirframe(a.id)}
            className={[
              'px-4 py-2 rounded-md border text-sm',
              airframe === a.id
                ? 'bg-stack-accent/15 border-stack-accent text-stack-accent'
                : 'border-stack-border text-stack-muted hover:border-stack-accent/60',
            ].join(' ')}>
            {a.label}
          </button>
        ))}
      </div>

      <div className="panel p-4 flex items-center gap-4">
        <div className="flex-1 h-2 bg-stack-border rounded overflow-hidden">
          <div className="h-full bg-stack-accent transition-all" style={{ width: `${total ? (checked / total) * 100 : 0}%` }} />
        </div>
        <div className="font-mono text-sm text-stack-muted shrink-0">{checked}/{total}</div>
      </div>

      {checklist.map(section => (
        <ChecklistSection key={section.stage} section={section} done={done} toggle={toggle} />
      ))}
    </div>
  );
}

function ChecklistSection({ section, done, toggle }) {
  return (
    <section className="panel p-5">
      <div className="text-xs uppercase tracking-wide text-stack-muted mb-3">{section.stage}</div>
      <div className="space-y-2">
        {section.items.map(item => {
          const key = `${section.stage}|${item}`;
          return (
            <label key={key} className="flex items-start gap-3 cursor-pointer group">
              <input type="checkbox" checked={!!done[key]} onChange={() => toggle(key)}
                className="mt-1 w-4 h-4 accent-stack-accent" />
              <span className={['text-sm', done[key] ? 'text-stack-muted line-through' : 'text-stack-text group-hover:text-white'].join(' ')}>
                {item}
              </span>
            </label>
          );
        })}
      </div>
    </section>
  );
}

// Optional COTS-Architect bridge: import a planned build to get a kit-check
// stage and as-built verification. Sageflight works fully without one.
function LoadoutPanel({ loadout, setLoadout }) {
  const [error, setError] = useState(null);
  const [verify, setVerify] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const fileRef = useRef(null);

  async function importFile(file) {
    setError(null); setVerify(null);
    try {
      const json = JSON.parse(await file.text());
      const r = await fetch('/api/loadout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(json),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.errors ? j.errors.join('; ') : (j.error || 'import failed'));
      setLoadout(json);
    } catch (e) { setError(e.message); }
    finally { if (fileRef.current) fileRef.current.value = ''; }
  }

  async function clear() {
    await fetch('/api/loadout', { method: 'DELETE' });
    setLoadout(null); setVerify(null);
  }

  async function runVerify() {
    setVerifying(true); setError(null);
    try {
      let scan = null;
      try { scan = JSON.parse(localStorage.getItem('st:lastScan'))?.fc || null; } catch {}
      const r = await fetch('/api/loadout/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scan }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'verify failed');
      setVerify(j);
    } catch (e) { setError(e.message); }
    finally { setVerifying(false); }
  }

  return (
    <section className="panel p-4">
      <input ref={fileRef} type="file" accept=".json" className="hidden"
        onChange={e => e.target.files?.[0] && importFile(e.target.files[0])} />
      {!loadout ? (
        <div className="flex items-center justify-between text-sm">
          <div className="text-stack-muted">
            Planned this build in COTS-Architect? Import its loadout JSON for a kit-check stage and
            as-built verification. <span className="text-stack-text">Optional</span> — everything here works without it.
          </div>
          <button className="btn-ghost text-sm shrink-0 ml-3" onClick={() => fileRef.current?.click()}>
            Import loadout
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm">
              <span className="text-xs uppercase tracking-wide text-stack-muted mr-2">Loadout</span>
              <span className="font-semibold">{loadout.name}</span>
              <span className="text-stack-muted"> · {loadout.components?.length} components{loadout.firmware?.target ? ` · target ${loadout.firmware.target}` : ''}</span>
            </div>
            <div className="flex gap-2 shrink-0">
              <button className="btn-ghost text-sm" disabled={verifying} onClick={runVerify}>
                {verifying ? 'Checking…' : 'Verify as-built'}
              </button>
              <button className="text-stack-muted hover:text-stack-err text-sm" onClick={clear}>remove</button>
            </div>
          </div>

          {verify && (
            <div>
              <div className="mb-2">
                {verify.verdict === 'MATCHES_PLAN' && <span className="pill-ok">matches plan · {verify.passed} checks passed</span>}
                {verify.verdict === 'MISMATCH' && <span className="pill-err">{verify.failed} mismatch(es) vs plan</span>}
                {verify.verdict === 'INSUFFICIENT_DATA' && <span className="pill-muted">not enough bench data — run a scan (Setup) and an ESC interrogation first</span>}
              </div>
              <table className="w-full text-xs">
                <tbody>
                  {verify.checks.map((c, i) => (
                    <tr key={i} className="border-t border-stack-border">
                      <td className="py-1.5 pr-3 text-stack-muted">{c.check}</td>
                      <td className="py-1.5 pr-3 font-mono">{c.expected ?? '—'}</td>
                      <td className="py-1.5 pr-3 font-mono">{c.actual ?? '—'}</td>
                      <td className="py-1.5">
                        {c.status === 'pass' && <span className="pill-ok">pass</span>}
                        {c.status === 'fail' && <span className="pill-err">FAIL</span>}
                        {c.status === 'unknown' && <span className="pill-muted">no data</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {error && <div className="mt-2 text-sm text-stack-err">{error}</div>}
    </section>
  );
}

