import React from 'react';
import Icon from './Icon';

const GROUP_BY_ID = {
  detect: 'Setup',
  receiver: 'Configure', modes: 'Configure', failsafe: 'Configure', ports: 'Configure',
  tune: 'Configure', presets: 'Configure', osd: 'Configure', vtx: 'Configure',
  gps: 'Configure', sensors: 'Configure',
  motors: 'Bench', esc: 'Bench',
  config: 'Records & Diagnostics', blackbox: 'Records & Diagnostics',
  fleet: 'Records & Diagnostics', checklists: 'Records & Diagnostics',
  chat: 'AI',
};

const GROUP_ORDER = ['Setup', 'Configure', 'Bench', 'Records & Diagnostics', 'AI'];

export default function Sidebar({ tabs, active, onSelect }) {
  const renderTab = (tab) => (
    <button
      key={tab.id}
      disabled={tab.disabled}
      onClick={() => !tab.disabled && onSelect(tab.id)}
      aria-current={active === tab.id ? 'page' : undefined}
      className={[
        'w-full text-left pl-4 pr-3 py-2 flex items-center gap-3 border-l-4 text-sm tracking-wide transition-colors',
        active === tab.id
          ? 'border-stack-accent bg-stack-panel text-stack-accent font-semibold'
          : 'border-transparent text-stack-text/80 hover:bg-stack-panel/60 hover:text-stack-text',
        tab.disabled ? 'opacity-40 cursor-not-allowed' : '',
      ].join(' ')}
    >
      <Icon name={tab.icon} className="w-5 h-5 shrink-0" />
      <span className="flex-1 truncate">{tab.label}</span>
      {tab.badge && <span className="pill-muted">{tab.badge}</span>}
    </button>
  );

  const groupedTabs = GROUP_ORDER.map(label => ({
    label,
    tabs: tabs.filter(tab => !tab.divider && GROUP_BY_ID[tab.id] === label),
  })).filter(group => group.tabs.length);
  const knownIds = new Set(Object.keys(GROUP_BY_ID).concat('flash'));
  const otherTabs = tabs.filter(tab => !tab.divider && !knownIds.has(tab.id));
  const firmwareTabs = tabs.filter(tab => !tab.divider && tab.id === 'flash');

  return (
    <aside className="w-52 min-h-0 shrink-0 bg-stack-header border-r border-stack-border flex flex-col">
      <nav className="flex-1 min-h-0 overflow-y-auto py-2" aria-label="Workbench">
        {groupedTabs.map(group => (
          <div key={group.label} className="mb-2">
            <div className="px-4 pt-2 pb-1 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-stack-muted">
              {group.label}
            </div>
            {group.tabs.map(renderTab)}
          </div>
        ))}
        {otherTabs.length > 0 && (
          <div className="mb-2">
            <div className="px-4 pt-2 pb-1 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-stack-muted">
              More
            </div>
            {otherTabs.map(renderTab)}
          </div>
        )}
        {firmwareTabs.length > 0 && (
          <div className="mt-3 pt-3 border-t border-stack-border/60">
            <div className="px-4 pb-1 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-stack-warn">
              Firmware
            </div>
            {firmwareTabs.map(renderTab)}
          </div>
        )}
      </nav>
      <div className="p-3 border-t border-stack-border text-xs text-stack-muted font-mono flex items-center gap-2">
        <img src="/sageflight-logo.svg" alt="" className="w-6 h-6 rounded opacity-80" />
        <div>
          <div>offline-first</div>
          <div className="text-stack-text">no cloud · no data exfil</div>
        </div>
      </div>
    </aside>
  );
}
