import React, { useEffect, useState } from 'react';
import { useTelemetry } from '../telemetry';

// Betaflight Configurator-style top bar: logo left, USB state + the big
// Connect/Disconnect action right.
export default function HeaderBar() {
  const [detection, setDetection] = useState(null);
  const [ollama, setOllama] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const { connected, suspended, comPort, connect, disconnect } = useTelemetry();

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const r = await fetch('/api/detect');
        const j = await r.json();
        if (!cancelled) { setDetection(j); setError(null); }
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    }
    async function pollOllama() {
      try {
        const j = await (await fetch('/api/ollama/health')).json();
        if (!cancelled) setOllama(j);
      } catch { if (!cancelled) setOllama({ ok: false }); }
    }
    poll(); pollOllama();
    const i = setInterval(poll, 2000);
    const io = setInterval(pollOllama, 15000);
    return () => { cancelled = true; clearInterval(i); clearInterval(io); };
  }, []);

  async function toggleConnection() {
    setBusy(true);
    try {
      if (connected || suspended) await disconnect();
      else await connect();
    } catch (e) {
      setError(e.message);
      setTimeout(() => setError(null), 4000);
    } finally {
      setBusy(false);
    }
  }

  const usbPill = () => {
    if (error) return <span className="pill-err">{error}</span>;
    if (connected) return <span className="pill-ok">connected · {comPort}</span>;
    if (suspended) return <span className="pill-warn">busy (operation running)</span>;
    if (!detection) return <span className="pill-muted">polling…</span>;
    switch (detection.type) {
      case 'ALIVE':       return <span className="pill-ok">FC detected · {detection.comPort}</span>;
      case 'FAILED_ENUM': return <span className="pill-err">failed enum</span>;
      case 'DFU':         return <span className="pill-warn">DFU bootloader</span>;
      case 'NOT_FOUND':   return <span className="pill-muted">no FC detected</span>;
      default:            return <span className="pill-muted">{detection.type}</span>;
    }
  };

  const canConnect = detection?.type === 'ALIVE' || connected || suspended;

  return (
    <header className="h-14 bg-stack-header border-b border-stack-border px-4 flex items-center justify-between shrink-0">
      <div className="flex items-center gap-3">
        <img src="/sageflight-logo.svg" alt="Sageflight" className="w-8 h-8 rounded-md shrink-0" />
        <div className="flex items-baseline gap-3">
          <div className="font-mono font-bold text-lg leading-none">
            <span className="text-stack-accent">SAGE</span>
            <span className="text-stack-text">FLIGHT</span>
          </div>
          <div className="font-mono text-[11px] text-stack-muted">AI-native configurator &amp; troubleshooter · v0.6</div>
        </div>
      </div>

      <div className="flex items-center gap-3 text-sm">
        {ollama && (
          <span className={ollama.ok ? 'pill-ok' : 'pill-muted'} title={ollama.ok ? `Ollama at ${ollama.host}` : 'Ollama offline — AI Assistant disabled'}>
            AI {ollama.ok ? 'ready' : 'offline'}
          </span>
        )}
        {usbPill()}
        <button
          onClick={toggleConnection}
          disabled={busy || !canConnect}
          className={[
            'btn text-sm font-semibold',
            (connected || suspended)
              ? 'border border-stack-accent text-stack-accent hover:bg-stack-accent/10'
              : canConnect ? 'bg-stack-accent text-stack-header hover:brightness-110' : 'border border-stack-border text-stack-muted opacity-50 cursor-not-allowed',
          ].join(' ')}
        >
          {busy ? '…' : (connected || suspended) ? 'Disconnect' : 'Connect'}
        </button>
      </div>
    </header>
  );
}
