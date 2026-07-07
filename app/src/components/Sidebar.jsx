import React from 'react';
import Icon from './Icon';

// Betaflight Configurator-style tab rail: dark column, uppercase labels,
// yellow left bar + yellow text on the active tab.
export default function Sidebar({ tabs, active, onSelect }) {
  return (
    <aside className="w-52 shrink-0 bg-stack-header border-r border-stack-border flex flex-col">
      <nav className="flex-1 py-2">
        {tabs.map(t => t.divider ? (
          <div key={t.id} className="my-2 border-t border-stack-border/60" />
        ) : (
          <button
            key={t.id}
            disabled={t.disabled}
            onClick={() => !t.disabled && onSelect(t.id)}
            className={[
              'w-full text-left pl-4 pr-3 py-2.5 flex items-center gap-3 border-l-4 text-sm tracking-wide',
              active === t.id
                ? 'border-stack-accent bg-stack-panel text-stack-accent font-semibold'
                : 'border-transparent text-stack-text/80 hover:bg-stack-panel/60 hover:text-stack-text',
              t.disabled ? 'opacity-40 cursor-not-allowed' : '',
            ].join(' ')}
          >
            <Icon name={t.icon} className="w-5 h-5 shrink-0" />
            <span className="flex-1 truncate">{t.label}</span>
            {t.badge && <span className="pill-muted">{t.badge}</span>}
          </button>
        ))}
      </nav>
      <div className="p-3 border-t border-stack-border text-xs text-stack-muted font-mono">
        <div>active companion to</div>
        <div className="text-stack-text">stack-forensic</div>
      </div>
    </aside>
  );
}
