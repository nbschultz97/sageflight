import React, { useEffect, useState } from 'react';

export default function DetectTab() {
  const [detection, setDetection] = useState(null);
  const [scan, setScan] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState(null);
  const [forensicMatch, setForensicMatch] = useState(null); // { available, record }

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const r = await fetch('/api/detect');
        const j = await r.json();
        if (!cancelled) setDetection(j);
      } catch {}
    }
    poll();
    const i = setInterval(poll, 2000);
    return () => { cancelled = true; clearInterval(i); };
  }, []);

  async function runScan() {
    setScanning(true); setError(null); setScan(null);
    try {
      const r = await fetch('/api/scan', { method: 'POST' });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'scan failed');
      setScan(j);
      // Persist for the Chat tab's "FC context" toggle.
      try { localStorage.setItem('st:lastScan', JSON.stringify({ at: new Date().toISOString(), fc: j.fc })); } catch {}
      // Cross-reference the fc-forensic database by MCU id.
      setForensicMatch(null);
      if (j.fc?.mcuId && j.fc.mcuId !== 'UNKNOWN') {
        try {
          const fj = await (await fetch(`/api/forensic/unit/${encodeURIComponent(j.fc.mcuId)}`)).json();
          if (fj.ok) setForensicMatch(fj);
        } catch {}
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setScanning(false);
    }
  }

  const isAlive = detection?.type === 'ALIVE';

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Setup</h1>
        <p className="text-stack-muted mt-1">Plug in your flight controller via USB. Scan reads board identity, firmware, sensors, and health metrics via Betaflight CLI — and cross-references the fc-forensic case history for this exact board.</p>
      </div>

      <section className="panel p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-stack-muted">USB Detection</div>
            <div className="mt-1 font-mono text-sm text-stack-text">
              {detection ? `${detection.type} · ${detection.description || '(no description)'}` : 'polling…'}
            </div>
          </div>
          <button
            onClick={runScan}
            disabled={!isAlive || scanning}
            className={isAlive && !scanning ? 'btn-primary' : 'btn-ghost opacity-50 cursor-not-allowed'}
          >
            {scanning ? 'Scanning…' : 'Scan FC'}
          </button>
        </div>

        {error && (
          <div className="mt-3 p-3 rounded bg-stack-err/10 border border-stack-err/30 text-stack-err text-sm">
            {error}
          </div>
        )}

        {scan?.fc && <FcReadout fc={scan.fc} />}
      </section>

      {scan?.fc && forensicMatch && <ForensicPanel match={forensicMatch} />}

      {!isAlive && (
        <div className="panel p-4 text-sm text-stack-muted">
          <div className="font-semibold text-stack-text mb-1">Troubleshooting</div>
          <ul className="list-disc pl-5 space-y-1">
            <li><span className="font-mono">COM port access denied</span> — close Betaflight Configurator / Impulse RC Driver Fixer / other serial tools.</li>
            <li><span className="font-mono">FAILED_ENUM</span> — USB cable may be charge-only, or the FC is in a bricked state. Try a different cable.</li>
            <li><span className="font-mono">DFU mode</span> — FC is in bootloader. Unplug + replug USB, or use BF Configurator to exit DFU.</li>
          </ul>
        </div>
      )}
    </div>
  );
}

function ForensicPanel({ match }) {
  if (!match.available) return null;
  const rec = match.record;
  if (!rec) {
    return (
      <section className="panel p-4 text-sm text-stack-muted">
        <span className="text-xs uppercase tracking-wide mr-2">Forensic history</span>
        No fc-forensic record for this board — it has never been through a forensic scan.
      </section>
    );
  }
  const u = rec.unit;
  return (
    <section className="panel p-5">
      <div className="flex items-center gap-3 mb-3">
        <div className="text-xs uppercase tracking-wide text-stack-muted">Forensic history match</div>
        <span className={u.status === 'DEAD' ? 'pill-err' : u.status === 'HEALTHY' ? 'pill-ok' : 'pill-warn'}>
          {u.status || 'UNKNOWN'}
        </span>
      </div>
      <div className="grid md:grid-cols-2 gap-x-8 gap-y-1 text-sm">
        <Info k="Unit" v={`#${u.unitNumber ?? '?'} · ${u.label || 'unlabeled'}`} />
        <Info k="Batch" v={rec.batch} />
        <Info k="Forensic scans" v={`${u.scanCount}${u.lastScanAt ? ` · last ${u.lastScanAt.slice(0, 10)}` : ''}`} />
        {u.notes && <Info k="Notes" v={u.notes} />}
      </div>
      {rec.linkedEscs?.length > 0 && (
        <div className="mt-3 pt-3 border-t border-stack-border text-sm">
          <div className="text-xs uppercase tracking-wide text-stack-muted mb-1">Linked ESC records</div>
          {rec.linkedEscs.map((e, i) => (
            <div key={i} className="text-stack-text">
              {e.label || `ESC #${e.escId}`} — {e.manufacturer} {e.model}
              {e.stackStatus && <span className="pill-muted ml-2">{e.stackStatus}</span>}
            </div>
          ))}
        </div>
      )}
      <div className="mt-3 text-xs text-stack-muted">
        The AI Assistant can pull this record with its <span className="font-mono">get_forensic_record</span> tool.
      </div>
    </section>
  );
}

function Info({ k, v }) {
  return (
    <div>
      <span className="text-stack-muted text-xs uppercase tracking-wide mr-2">{k}</span>
      <span>{v}</span>
    </div>
  );
}

function FcReadout({ fc }) {
  const Row = ({ k, v, mono = false, color }) => (
    <tr className="border-t border-stack-border">
      <td className="py-2 pr-4 text-stack-muted text-xs uppercase tracking-wide">{k}</td>
      <td className={`py-2 ${mono ? 'font-mono' : ''}`} style={color ? { color } : undefined}>{v ?? '—'}</td>
    </tr>
  );

  return (
    <div className="mt-5 pt-5 border-t border-stack-border">
      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <div className="text-xs uppercase tracking-wide text-stack-muted mb-2">Identity</div>
          <table className="w-full text-sm">
            <tbody>
              <Row k="MCU ID" v={fc.mcuId} mono />
              <Row k="Board" v={fc.boardName} />
              <Row k="Manufacturer" v={fc.manufacturerId} />
              <Row k="Firmware" v={fc.firmware ? `Betaflight ${fc.firmware}` : null} />
              <Row k="Build Key" v={fc.buildKey} mono />
              <Row k="MCU Type" v={fc.mcuType} />
              <Row k="Clock" v={fc.clock} />
            </tbody>
          </table>
        </div>

        <div>
          <div className="text-xs uppercase tracking-wide text-stack-muted mb-2">Sensors</div>
          <table className="w-full text-sm">
            <tbody>
              <Row k="Gyro" v={fc.sensors?.gyro} />
              <Row k="Accelerometer" v={fc.sensors?.acc} />
              <Row k="Barometer" v={fc.sensors?.baro} />
              <Row k="OSD" v={fc.sensors?.osd} />
            </tbody>
          </table>

          <div className="text-xs uppercase tracking-wide text-stack-muted mt-5 mb-2">Health</div>
          <table className="w-full text-sm">
            <tbody>
              <Row k="Vref" v={fc.health?.vref ? `${fc.health.vref}V` : null} />
              <Row k="Core Temp" v={fc.health?.coreTemp ? `${fc.health.coreTemp}°C` : null}
                   color={parseInt(fc.health?.coreTemp, 10) > 60 ? '#fbbf24' : undefined} />
              <Row k="CPU Load" v={fc.health?.cpuLoad ? `${fc.health.cpuLoad}%` : null} />
              <Row k="I2C Errors" v={fc.health?.i2cErrors} />
              <Row k="SD Card" v={fc.health?.sdCard} />
              <Row k="Cycle Time" v={fc.health?.cycleTime} />
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
