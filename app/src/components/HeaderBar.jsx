import React, { useEffect, useState } from 'react';

// Betaflight Configurator-style top bar: logo block on the left, connection
// state on the right. The whole app polls detection through this bar.
export default function HeaderBar() {
  const [detection, setDetection] = useState(null);
  const [ollama, setOllama] = useState(null);
  const [error, setError] = useState(null);

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

  const usbPill = () => {
    if (error) return <span className="pill-err">server unreachable</span>;
    if (!detection) return <span className="pill-muted">polling…</span>;
    switch (detection.type) {
      case 'ALIVE':       return <span className="pill-ok">connected · {detection.comPort}</span>;
      case 'FAILED_ENUM': return <span className="pill-err">failed enum</span>;
      case 'DFU':         return <span className="pill-warn">DFU bootloader</span>;
      case 'NOT_FOUND':   return <span className="pill-muted">no FC detected</span>;
      default:            return <span className="pill-muted">{detection.type}</span>;
    }
  };

  return (
    <header className="h-14 bg-stack-header border-b border-stack-border px-4 flex items-center justify-between shrink-0">
      <div className="flex items-baseline gap-3">
        <div className="font-mono font-bold text-lg leading-none">
          <span className="text-stack-accent">SAGE</span>
          <span className="text-stack-text">FLIGHT</span>
        </div>
        <div className="font-mono text-[11px] text-stack-muted">AI-native configurator &amp; troubleshooter · v0.3</div>
      </div>

      <div className="flex items-center gap-3 text-sm">
        {ollama && (
          <span className={ollama.ok ? 'pill-ok' : 'pill-muted'} title={ollama.ok ? `Ollama at ${ollama.host}` : 'Ollama offline — Chat tab disabled'}>
            AI {ollama.ok ? 'ready' : 'offline'}
          </span>
        )}
        <span className="text-stack-muted text-xs">USB</span>
        {usbPill()}
        {detection?.description && (
          <span className="text-stack-muted font-mono text-xs truncate max-w-xs" title={detection.description}>
            {detection.description}
          </span>
        )}
      </div>
    </header>
  );
}
