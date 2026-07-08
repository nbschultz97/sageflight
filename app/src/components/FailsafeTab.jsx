import React, { useEffect, useState } from 'react';

// Failsafe editor — Betaflight's most misunderstood safety-critical tab.
// Stage 1: signal just dropped — per-channel rxfail behavior.
// Stage 2: signal has been gone for failsafe_delay — the procedure runs.
// Every field carries a plain-English explanation; writes ride the gated
// auto-snapshot batch path like every other editor.

const FIELD_HELP = {
  failsafe_procedure: 'What the quad does when the link is truly gone. DROP = motors off instantly (falls out of the sky — safest around people). AUTO-LAND = descend at failsafe_throttle (needs a sane hover value or it flies away/slams down). GPS-RESCUE = fly itself home (needs GPS fix + tuned rescue settings).',
  failsafe_delay: 'How long after signal loss before stage 2 runs, in 0.1s units (10 = 1 second). Shorter = safer but brief RF blips trigger it.',
  failsafe_off_delay: 'AUTO-LAND only: how long to keep "landing" before motors shut off, in 0.1s units.',
  failsafe_throttle: 'AUTO-LAND only: throttle used while landing. Set to slightly below hover throttle — too high and it flies away.',
  failsafe_throttle_low_delay: 'If throttle was already low this long (0.1s units) when signal dropped, assume you already landed and just disarm.',
  failsafe_switch_mode: 'What the failsafe aux switch does: STAGE1 = simulate signal loss, STAGE2 = jump straight to the procedure, KILL = instant disarm (use for arming-switch-style kill).',
  failsafe_recovery_delay: 'How much continuous good signal (0.1s units) before control is handed back.',
  failsafe_stick_threshold: 'Stick movement (%) that cancels GPS Rescue and gives you control back.',
  gps_rescue_min_start_dist: 'Closer than this (meters) and rescue refuses to start — too close to fly a return.',
  gps_rescue_return_alt: 'Altitude (m) flown during the return leg.',
  gps_rescue_initial_climb: 'Climb (m) before turning home.',
  gps_rescue_ground_speed: 'Return speed in cm/s.',
  gps_rescue_min_sats: 'Minimum satellites for rescue to engage. Below this it DROPS instead.',
  gps_rescue_allow_arming_without_fix: 'OFF = you cannot arm until GPS has a fix. Leave OFF for long-range — a rescue without a home point flies to nowhere.',
  gps_rescue_sanity_checks: 'Abort rescue if it is not actually getting closer to home. Leave RESCUE_SANITY_ON.',
};

const RXFAIL_MODES = [
  { id: 'a', label: 'Auto', hint: 'Flight channels: center sticks, throttle low. The right default.' },
  { id: 'h', label: 'Hold', hint: 'Keep the last received value. Risky on throttle.' },
  { id: 's', label: 'Set', hint: 'Force a fixed value (aux channels: e.g. keep ARM active so stage 2 can run).' },
];

const CHANNEL_NAMES = ['Roll', 'Pitch', 'Yaw', 'Throttle'];

function channelName(i) {
  return i < 4 ? `${CHANNEL_NAMES[i]}` : `AUX${i - 3}`;
}

export default function FailsafeTab() {
  const [data, setData] = useState(null); // { groups, rxfail }
  const [edits, setEdits] = useState({});           // settings key -> value
  const [rxEdits, setRxEdits] = useState({});       // channel -> {mode, value}
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState(null);

  async function load() {
    setLoading(true); setError(null); setEdits({}); setRxEdits({});
    try {
      const j = await (await fetch('/api/failsafe')).json();
      if (!j.ok) throw new Error(j.error || 'read failed');
      setData(j);
    } catch (e) { setError(e.message); setData(null); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  const allValues = Object.assign({}, ...(data?.groups || []).map(g => g.values));
  const value = (k) => (k in edits ? edits[k] : allValues[k]);
  const rxState = (c) => rxEdits[c.channel] || { mode: c.mode, value: c.value };

  const changedSettings = Object.entries(edits).filter(([k, v]) => String(v) !== String(allValues[k]));
  const changedRx = (data?.rxfail || []).filter(c => {
    const s = rxState(c);
    return s.mode !== c.mode || (s.mode === 's' && s.value !== c.value);
  });

  const commands = [
    ...changedSettings.map(([k, v]) => `set ${k} = ${v}`),
    ...changedRx.map(c => {
      const s = rxState(c);
      return s.mode === 's' ? `rxfail ${c.channel} s ${s.value ?? 1500}` : `rxfail ${c.channel} ${s.mode}`;
    }),
  ];

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
      await new Promise(r2 => setTimeout(r2, 3500));
      await load();
    } catch (e) { setError(e.message); }
    finally { setApplying(false); }
  }

  const procedure = String(value('failsafe_procedure') || '').toUpperCase();

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Failsafe</h1>
          <p className="text-stack-muted mt-1">
            What happens when the radio link dies. Stage 1 fires the instant signal drops;
            stage 2 runs the procedure once it has been gone for the delay.
          </p>
        </div>
        <button className="btn-ghost text-sm shrink-0" disabled={loading || applying} onClick={load}>
          {loading ? 'Reading…' : 'Re-read from FC'}
        </button>
      </div>

      <div className="note">
        <span className="font-semibold">This is the setting that decides whether a lost quad falls, lands, or
        flies home.</span> Bench-test it: arm (props off), turn the transmitter off, and watch what the FC does.
        Never trust a failsafe you haven't triggered on purpose.
      </div>

      {error && <div className="panel p-4 border-stack-err text-stack-err text-sm">{error}</div>}
      {!data && !error && (
        <div className="panel p-4 text-sm text-stack-muted">{loading ? 'Reading failsafe config…' : 'Plug in an FC to read failsafe settings.'}</div>
      )}

      {data && (
        <>
          {data.groups.filter(g => g.group === 'stage2').map(g => (
            <section key={g.group} className="panel p-5">
              <div className="text-xs uppercase tracking-wide text-stack-muted mb-4">{g.label}</div>
              <div className="space-y-4">
                {Object.entries(g.values).map(([k]) => (
                  <SettingRow key={k} k={k} value={value(k)} help={FIELD_HELP[k]}
                    onChange={v => setEdits(e => ({ ...e, [k]: v }))} />
                ))}
              </div>
              {procedure === 'GPS-RESCUE' && (
                <div className="mt-4 text-xs text-stack-warn">
                  GPS-RESCUE selected — verify the GPS Rescue block below and confirm the GPS has a fix before every flight.
                </div>
              )}
              {procedure === 'AUTO-LAND' && (
                <div className="mt-4 text-xs text-stack-warn">
                  AUTO-LAND selected — failsafe_throttle must be close to (slightly under) your hover throttle or the quad will climb away or drop hard.
                </div>
              )}
            </section>
          ))}

          <section className="panel p-5">
            <div className="text-xs uppercase tracking-wide text-stack-muted mb-1">Stage 1 — per-channel behavior on signal loss</div>
            <p className="text-xs text-stack-muted mb-4">
              Applied the moment frames stop arriving, before stage 2 kicks in. Flight channels default to Auto.
              A common aux setup: <span className="font-mono">Set</span> the ARM channel to its armed value so stage 2 can actually run.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-stack-muted uppercase">
                  <tr>
                    <th className="text-left pb-2 pr-4">Channel</th>
                    <th className="text-left pb-2 pr-4">Mode</th>
                    <th className="text-left pb-2">Set value (μs)</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rxfail.map(c => {
                    const s = rxState(c);
                    return (
                      <tr key={c.channel} className="border-t border-stack-border">
                        <td className="py-1.5 pr-4 font-mono text-xs">{channelName(c.channel)}</td>
                        <td className="py-1.5 pr-4">
                          <div className="flex gap-1">
                            {RXFAIL_MODES.map(m => (
                              <button key={m.id} title={m.hint}
                                onClick={() => setRxEdits(e => ({ ...e, [c.channel]: { ...s, mode: m.id } }))}
                                className={['px-2 py-0.5 rounded text-xs font-mono border',
                                  s.mode === m.id ? 'border-stack-accent text-stack-accent bg-stack-accent/10' : 'border-stack-border text-stack-muted hover:border-stack-accent/50',
                                ].join(' ')}>{m.label}</button>
                            ))}
                          </div>
                        </td>
                        <td className="py-1.5">
                          {s.mode === 's' && (
                            <input className="w-20 bg-stack-bg border border-stack-border rounded px-2 py-1 text-xs font-mono"
                              value={s.value ?? 1500}
                              onChange={e => setRxEdits(ed => ({ ...ed, [c.channel]: { ...s, value: parseInt(e.target.value, 10) || 0 } }))} />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {data.groups.filter(g => g.group === 'gpsRescue').map(g => (
            <section key={g.group} className="panel p-5">
              <div className="text-xs uppercase tracking-wide text-stack-muted mb-4">{g.label}</div>
              <div className="space-y-4">
                {Object.entries(g.values).map(([k]) => (
                  <SettingRow key={k} k={k} value={value(k)} help={FIELD_HELP[k]}
                    onChange={v => setEdits(e => ({ ...e, [k]: v }))} />
                ))}
              </div>
            </section>
          ))}

          <div className="panel p-4 flex items-center justify-between gap-4">
            <div className="text-sm text-stack-muted">
              {commands.length
                ? <span className="text-stack-warn font-semibold">{commands.length} change(s) — not yet on the FC</span>
                : 'No pending changes'}
            </div>
            <button className={commands.length && !applying ? 'btn-primary text-sm' : 'btn-ghost text-sm opacity-50 cursor-not-allowed'}
              disabled={!commands.length || applying} onClick={() => setConfirm(true)}>
              {applying ? 'Applying…' : 'Apply + save'}
            </button>
          </div>
        </>
      )}

      {confirm && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="panel p-6 max-w-lg w-full">
            <h2 className="text-xl font-semibold text-stack-warn">⚠ Write failsafe configuration</h2>
            <pre className="mt-3 bg-stack-bg border border-stack-border rounded p-3 text-xs font-mono max-h-48 overflow-auto">
              {[...commands, 'save'].join('\n')}
            </pre>
            <p className="text-sm text-stack-muted mt-2">
              Wrong failsafe settings can make a lost quad fly away or refuse to disarm.
              Bench-test after saving: props off, arm, transmitter off, observe.
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

function SettingRow({ k, value, help, onChange }) {
  return (
    <div className="grid md:grid-cols-[16rem_10rem_1fr] gap-x-4 gap-y-1 items-start">
      <div className="font-mono text-xs text-stack-text pt-1.5">{k}</div>
      <input className="bg-stack-bg border border-stack-border rounded px-2 py-1 text-xs font-mono"
        value={value ?? ''} onChange={e => onChange(e.target.value)} />
      <div className="text-xs text-stack-muted pt-1.5">{help || ''}</div>
    </div>
  );
}
