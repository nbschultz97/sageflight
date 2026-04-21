import React from 'react';

export default function Sidebar({ tabs, active, onSelect }) {
  return (
    <aside className="w-56 shrink-0 bg-stack-panel border-r border-stack-border flex flex-col">
      <div className="p-4 border-b border-stack-border">
        <div className="font-mono text-lg font-bold text-stack-accent leading-none">STACK</div>
        <div className="font-mono text-xs text-stack-muted mt-1">TROUBLESHOOTER v0.1</div>
      </div>
      <nav className="flex-1 p-2 space-y-1">
        {tabs.map(t => (
          <button
            key={t.id}
            disabled={t.disabled}
            onClick={() => !t.disabled && onSelect(t.id)}
            className={[
              'w-full text-left px-3 py-2 rounded-md flex items-center justify-between',
              active === t.id ? 'bg-stack-accent/15 text-stack-accent border border-stack-accent/30' : 'text-stack-text hover:bg-stack-border',
              t.disabled ? 'opacity-40 cursor-not-allowed' : '',
            ].join(' ')}
          >
            <span>{t.label}</span>
            {t.badge && <span className="pill-muted">{t.badge}</span>}
          </button>
        ))}
      </nav>
      <div className="p-3 border-t border-stack-border text-xs text-stack-muted font-mono">
        <div>companion to</div>
        <div className="text-stack-text">stack-forensic</div>
      </div>
    </aside>
  );
}
