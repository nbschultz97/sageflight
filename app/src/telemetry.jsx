import React, { createContext, useContext, useEffect, useState } from 'react';

// Live-connection state shared across the app, fed by the server's SSE
// telemetry stream. `connected` + `telemetry` update ~5×/s while a FC is
// connected; EventSource auto-reconnects if the backend restarts.
const TelemetryContext = createContext({
  connected: false,
  suspended: false,
  comPort: null,
  telemetry: null,
  connect: async () => {},
  disconnect: async () => {},
});

export function TelemetryProvider({ children }) {
  const [state, setState] = useState({ connected: false, suspended: false, comPort: null, telemetry: null });

  useEffect(() => {
    const es = new EventSource('/api/telemetry/stream');
    es.onmessage = (e) => {
      try { setState(JSON.parse(e.data)); } catch {}
    };
    return () => es.close();
  }, []);

  async function connect(port) {
    const r = await fetch('/api/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(port ? { port } : {}),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'connect failed');
    return j;
  }

  async function disconnect() {
    await fetch('/api/disconnect', { method: 'POST' });
  }

  return (
    <TelemetryContext.Provider value={{ ...state, connect, disconnect }}>
      {children}
    </TelemetryContext.Provider>
  );
}

export function useTelemetry() {
  return useContext(TelemetryContext);
}
