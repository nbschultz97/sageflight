import React, { useEffect, useState } from 'react';

// GPS receiver configuration. Live position/satellite telemetry is on the
// roadmap behind bench validation — this covers the setup side: enabling the
// feature, protocol, and the settings that commonly go wrong.

const FIELD_HELP = {
  gps_provider: 'UBLOX for nearly every modern GPS module (M8/M9/M10). NMEA only for very old units. MSP for DJI-style digital systems that forward GPS.',
  gps_sbas_mode: 'Regional correction satellites: AUTO is fine everywhere; WAAS = North America, EGNOS = Europe, MSAS = Japan, GAGAN = India.',
  gps_auto_config: 'ON: Betaflight configures the module (rate, messages) itself on boot. Leave ON unless you pre-configured the module in u-center.',
  gps_auto_baud: 'ON: try several baud rates until the module answers. Helps with modules that were left at odd baud rates.',
  gps_ublox_use_galileo: 'Use the Galileo constellation too (M8+ modules). More satellites, faster fix in Europe; harmless elsewhere.',
  gps_set_home_point_once: 'ON: home is fixed at first fix after power-up and never moves. OFF: home updates at every arm — with GPS Rescue this means "return to where I last armed".',
  gps_use_3d_speed: 'Use 3D (incl. vertical) speed for OSD/rescue instead of ground speed.',
  gps_update_rate_hz: 'Position update rate requested from the module. 10 Hz is the usual target for M10 units.',
};

export default function GpsTab() {
  const [data, setData] = useState(null); // { values, gpsFeature }
  const [edits, setEdits] = useState({});
  const [featureEdit, setFeatureEdit] = useState(null); // null = untouched
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState(null);

  async function load() {
    setLoading(true); setError(null); setEdits({}); setFeatureEdit(null);
    try {
      const j = await (await fetch('/api/gps/config')).json();
      if (!j.ok) throw new Error(j.error || 'read failed');
      setData(j);
    } catch (e) { setError(e.message); setData(null); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  const value = (k) => (k in edits ? edits[k] : data?.values?.[k]);
  const featureOn = featureEdit != null ? featureEdit : !!data?.gpsFeature;

  const changed = Object.entries(edits).filter(([k, v]) => String(v) !== String(data?.values?.[k]));
  const featureChanged = featureEdit != null && featureEdit !== !!data?.gpsFeature;
  const commands = [
    ...(featureChanged ? [`feature ${featureOn ? '' : '-'}GPS`] : []),
    ...changed.map(([k, v]) => `set ${k} = ${v}`),
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

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">GPS</h1>
          <p className="text-stack-muted mt-1">
            GPS module setup — the prerequisite for GPS Rescue, OSD coordinates, and the blackbox home arrow.
          </p>
        </div>
        <button className="btn-ghost text-sm shrink-0" disabled={loading || applying} onClick={load}>
          {loading ? 'Reading…' : 'Re-read from FC'}
        </button>
      </div>

      <div className="note">
        Wiring checklist: GPS TX → UART RX, GPS RX → UART TX, and that UART assigned the
        <span className="font-semibold"> GPS</span> function in the Ports tab. Live satellite/position
        telemetry lands here after bench validation.
      </div>

      {error && <div className="panel p-4 border-stack-err text-stack-err text-sm">{error}</div>}
      {!data && !error && (
        <div className="panel p-4 text-sm text-stack-muted">{loading ? 'Reading GPS config…' : 'Plug in an FC to read GPS settings.'}</div>
      )}

      {data && (
        <>
          <section className="panel p-5">
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" className="w-4 h-4 accent-stack-accent"
                checked={featureOn} onChange={e => setFeatureEdit(e.target.checked)} />
              <div>
                <div className="text-sm font-semibold">GPS feature enabled</div>
                <div className="text-xs text-stack-muted">Master switch — without it every setting below is ignored.</div>
              </div>
            </label>
          </section>

          {Object.keys(data.values).length > 0 ? (
            <section className="panel p-5 space-y-4">
              <div className="text-xs uppercase tracking-wide text-stack-muted">Module settings</div>
              {Object.entries(data.values).map(([k]) => (
                <div key={k} className="grid md:grid-cols-[16rem_10rem_1fr] gap-x-4 gap-y-1 items-start">
                  <div className="font-mono text-xs text-stack-text pt-1.5">{k}</div>
                  <input className="bg-stack-bg border border-stack-border rounded px-2 py-1 text-xs font-mono"
                    value={value(k) ?? ''} onChange={e => setEdits(ed => ({ ...ed, [k]: e.target.value }))} />
                  <div className="text-xs text-stack-muted pt-1.5">{FIELD_HELP[k] || ''}</div>
                </div>
              ))}
            </section>
          ) : (
            <div className="panel p-4 text-sm text-stack-muted">
              No GPS settings found in this firmware build (GPS support may not be compiled in — use a
              cloud build with the GPS option enabled).
            </div>
          )}

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
            <h2 className="text-xl font-semibold text-stack-warn">⚠ Write GPS configuration</h2>
            <pre className="mt-3 bg-stack-bg border border-stack-border rounded p-3 text-xs font-mono max-h-48 overflow-auto">
              {[...commands, 'save'].join('\n')}
            </pre>
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
