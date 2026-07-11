import React, { useState, useEffect, useRef, useId } from 'react';

// Human-readable labels for privileged actions. Falls back to the raw
// action id when an id isn't recognized.
const ACTION_LABELS = {
  'motor.spin': 'Spin a motor',
  'esc.interrogate': 'Interrogate ESCs',
  'config.write': 'Write configuration to the flight controller',
  'flash.write': 'Flash firmware',
  'blackbox.erase': 'Erase blackbox log',
};

function actionLabel(action) {
  if (!action) return 'this action';
  if (ACTION_LABELS[action]) return ACTION_LABELS[action];
  // Family fallback: any motor.* action that isn't explicitly mapped.
  if (action.startsWith('motor.')) return 'Motor test';
  return action;
}

// Selector for focusable descendants used by the Tab focus trap.
const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function SafetyModal({ action, requireBattery = true, onConfirm, onCancel }) {
  const [propsOff, setPropsOff] = useState(false);
  const [restrained, setRestrained] = useState(false);
  const [batteryOn, setBatteryOn] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const dialogRef = useRef(null);
  const titleId = useId();

  // Keep the latest onCancel in a ref so the focus/Escape effect can run once
  // on mount without re-firing (and stealing focus) when the parent passes a
  // new inline onCancel identity on every render.
  const onCancelRef = useRef(onCancel);
  useEffect(() => { onCancelRef.current = onCancel; }, [onCancel]);

  const canProceed = propsOff && restrained && (!requireBattery || batteryOn);

  // Accessibility: focus management, focus trap, and Escape-to-close.
  useEffect(() => {
    const previouslyFocused =
      typeof document !== 'undefined' ? document.activeElement : null;

    // Move focus into the dialog on open.
    const dialog = dialogRef.current;
    if (dialog) {
      const focusables = dialog.querySelectorAll(FOCUSABLE);
      const first = focusables[0] || dialog;
      first.focus();
    }

    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancelRef.current?.();
        return;
      }
      if (e.key !== 'Tab') return;

      const node = dialogRef.current;
      if (!node) return;
      const focusables = Array.from(node.querySelectorAll(FOCUSABLE)).filter(
        el => el.offsetParent !== null || el === document.activeElement
      );
      if (focusables.length === 0) {
        e.preventDefault();
        node.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;

      if (e.shiftKey) {
        if (active === first || !node.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last || !node.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      // Restore focus to whatever was focused before the dialog opened.
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus();
      }
    };
    // Run once on mount: capturing previouslyFocused and moving focus must not
    // repeat on re-render. Escape uses onCancelRef for the latest handler.
  }, []);

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
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="panel p-6 max-w-lg w-full"
      >
        <h2 id={titleId} className="text-xl font-semibold text-stack-warn flex items-center gap-2">
          <span aria-hidden="true">⚠</span> Safety check — {actionLabel(action)}
        </h2>
        <p className="text-sm text-stack-muted mt-2">
          This action spins motors and requires every box to be checked. Do not check a box unless it is truthfully the case.
        </p>

        <div className="mt-5 space-y-3">
          <Check label="Props removed from ALL four motors" checked={propsOff} onChange={setPropsOff} />
          <Check label="Quad restrained so it cannot move or flip off the bench" checked={restrained} onChange={setRestrained} />
          {requireBattery && (
            <Check
              label="Battery connected — smoke stopper bypassed if you use one"
              hint="A smoke stopper current-limits the pack so a wiring short fails safely instead of burning up. Some ESC/motor tests draw more than it allows and won't run through it, so it must be bypassed — meaning a real short is now unprotected. Only check this if props are off and the quad is restrained."
              checked={batteryOn}
              onChange={setBatteryOn}
            />
          )}
        </div>

        {error && <div className="mt-4 p-3 rounded bg-stack-err/10 border border-stack-err/30 text-stack-err text-sm">{error}</div>}

        <div className="mt-6 flex gap-3 justify-end">
          <button onClick={onCancel} className="btn-ghost" disabled={submitting}>Cancel</button>
          <button
            onClick={handleConfirm}
            disabled={!canProceed || submitting}
            className={
              canProceed && !submitting
                ? 'btn bg-stack-err text-white hover:brightness-110'
                : 'btn bg-stack-err/40 text-white/70 cursor-not-allowed'
            }
          >
            {submitting ? 'Issuing token…' : 'Confirm — proceed'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Check({ label, hint, checked, onChange }) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
        className="mt-1 w-4 h-4 accent-stack-accent" />
      <span className="text-sm text-stack-text">
        {label}
        {hint && <span className="block text-xs text-stack-muted mt-0.5">{hint}</span>}
      </span>
    </label>
  );
}
