import React, { useEffect, useState } from 'react';

const AIRFRAMES = [
  { id: 'freestyle5', label: '5" Freestyle' },
  { id: 'cinewhoop', label: 'Cinewhoop' },
  { id: 'longrange7', label: '7" Long-range' },
  { id: 'whoop', label: 'Tiny Whoop' },
];

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

  const checklist = buildChecklist(airframe);
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
        <section key={section.stage} className="panel p-5">
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
      ))}
    </div>
  );
}
