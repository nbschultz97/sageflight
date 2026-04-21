import React, { useState } from 'react';

export default function SafetyModal({ action, requireBattery = true, onConfirm, onCancel }) {
  const [propsOff, setPropsOff] = useState(false);
  const [restrained, setRestrained] = useState(false);
  const [batteryOn, setBatteryOn] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const canProceed = propsOff && restrained && (!requireBattery || batteryOn);

  async function handleConfirm() {
    setSubmitting(true); setError(null);
    try {
      const r = await fetch('/api/safety/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, propsOff, restrained, batteryOn }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'safety check failed');
      onConfirm(j.token);
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="panel p-6 max-w-lg w-full">
        <h2 className="text-xl font-semibold text-stack-warn flex items-center gap-2">
          <span>⚠</span> Safety check — {action}
        </h2>
        <p className="text-sm text-stack-muted mt-2">
          This action spins motors and requires every box to be checked. Do not check a box unless it is truthfully the case.
        </p>

        <div className="mt-5 space-y-3">
          <Check label="Props removed from ALL four motors" checked={propsOff} onChange={setPropsOff} />
          <Check label="Quad restrained so it cannot move or flip off the bench" checked={restrained} onChange={setRestrained} />
          {requireBattery && (
            <Check label="Battery connected (bypass smoke stopper if used)" checked={batteryOn} onChange={setBatteryOn} />
          )}
        </div>

        {error && <div className="mt-4 p-3 rounded bg-stack-err/10 border border-stack-err/30 text-stack-err text-sm">{error}</div>}

        <div className="mt-6 flex gap-3 justify-end">
          <button onClick={onCancel} className="btn-ghost" disabled={submitting}>Cancel</button>
          <button
            onClick={handleConfirm}
            disabled={!canProceed || submitting}
            className={canProceed && !submitting ? 'btn-primary' : 'btn-ghost opacity-50 cursor-not-allowed'}
          >
            {submitting ? 'Issuing token…' : 'Confirm — proceed'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Check({ label, checked, onChange }) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
        className="mt-1 w-4 h-4 accent-stack-accent" />
      <span className="text-sm text-stack-text">{label}</span>
    </label>
  );
}
