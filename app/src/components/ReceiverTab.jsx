import React from 'react';
import { useTelemetry } from '../telemetry';

const CHANNEL_NAMES = ['Roll [A]', 'Pitch [E]', 'Throttle [T]', 'Yaw [R]'];

// Live RC channel bars, Betaflight Receiver-tab style.
export default function ReceiverTab() {
  const { connected, telemetry } = useTelemetry();
  const channels = telemetry?.rc?.channels || [];

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Receiver</h1>
        <p className="text-stack-muted mt-1">
          Live RC channel values from the flight controller. Move your sticks — bars should follow
          instantly. Check endpoints (~1000–2000), centering (~1500), and that no channel is frozen.
        </p>
      </div>

      {!connected && (
        <div className="note">
          <span className="font-semibold">Not connected.</span> Click <span className="font-semibold">Connect</span> in
          the header to stream live data. Receiver testing works on USB power — no battery needed
          (unless your receiver is battery-powered).
        </div>
      )}

      {connected && channels.length === 0 && (
        <div className="panel p-4 text-sm text-stack-muted">
          Connected, waiting for RC data… If nothing appears, the receiver may be unbound or unpowered.
        </div>
      )}

      {connected && channels.length > 0 && (
        <section className="panel p-5 space-y-3">
          {channels.map((v, i) => (
            <ChannelBar key={i} label={CHANNEL_NAMES[i] || `AUX ${i - 3}`} index={i} value={v} />
          ))}
        </section>
      )}
    </div>
  );
}

function ChannelBar({ label, index, value }) {
  const pct = Math.max(0, Math.min(100, ((value - 1000) / 1000) * 100));
  const stale = value < 900; // no signal reads ~0
  return (
    <div className="flex items-center gap-3 text-sm">
      <div className="w-28 shrink-0 text-stack-muted text-xs uppercase tracking-wide">{label}</div>
      <div className="flex-1 h-5 bg-stack-bg border border-stack-border rounded overflow-hidden relative">
        <div
          className={stale ? 'h-full bg-stack-err/50' : 'h-full bg-stack-accent/80'}
          style={{ width: `${pct}%`, transition: 'width 80ms linear' }}
        />
        <div className="absolute inset-y-0 left-1/2 w-px bg-stack-border" />
      </div>
      <div className="w-14 shrink-0 text-right font-mono text-xs">{stale ? '—' : value}</div>
    </div>
  );
}
