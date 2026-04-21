import React, { useEffect, useState } from 'react';

export default function HeaderBar() {
  const [detection, setDetection] = useState(null);
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
    poll();
    const interval = setInterval(poll, 2000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  const statusPill = () => {
    if (error) return <span className="pill-err">server unreachable</span>;
    if (!detection) return <span className="pill-muted">polling…</span>;
    switch (detection.type) {
      case 'ALIVE':        return <span className="pill-ok">FC on {detection.comPort}</span>;
      case 'FAILED_ENUM':  return <span className="pill-err">failed enum</span>;
      case 'DFU':          return <span className="pill-warn">DFU mode</span>;
      case 'NOT_FOUND':    return <span className="pill-muted">no FC</span>;
      default:             return <span className="pill-muted">{detection.type}</span>;
    }
  };

  return (
    <header className="h-12 border-b border-stack-border bg-stack-panel/60 px-4 flex items-center justify-between">
      <div className="flex items-center gap-3 text-sm">
        <span className="text-stack-muted">USB:</span>
        {statusPill()}
        {detection?.description && (
          <span className="text-stack-muted font-mono text-xs truncate max-w-md">{detection.description}</span>
        )}
      </div>
      <div className="text-xs text-stack-muted font-mono">
        {error ? error : detection?.type === 'ALIVE' ? 'ready' : 'waiting for hardware'}
      </div>
    </header>
  );
}
