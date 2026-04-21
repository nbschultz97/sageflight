import React, { useState } from 'react';
import Sidebar from './components/Sidebar';
import DetectTab from './components/DetectTab';
import MotorsTab from './components/MotorsTab';
import ChatTab from './components/ChatTab';
import HeaderBar from './components/HeaderBar';

const TABS = [
  { id: 'detect',  label: 'Detect',  icon: 'usb' },
  { id: 'motors',  label: 'Motors',  icon: 'rotor' },
  { id: 'chat',    label: 'Chat',    icon: 'chat', badge: 'LLM' },
  { id: 'config',  label: 'Config',  icon: 'cog',    disabled: true, badge: 'later' },
  { id: 'flash',   label: 'Flash',   icon: 'zap',    disabled: true, badge: 'later' },
];

export default function App() {
  const [tab, setTab] = useState('detect');

  return (
    <div className="flex h-full">
      <Sidebar tabs={TABS} active={tab} onSelect={setTab} />
      <div className="flex-1 flex flex-col min-w-0">
        <HeaderBar />
        <main className="flex-1 overflow-auto p-6">
          {tab === 'detect' && <DetectTab />}
          {tab === 'motors' && <MotorsTab />}
          {tab === 'chat'   && <ChatTab />}
          {(tab === 'config' || tab === 'flash') && (
            <div className="panel p-8 text-center">
              <div className="text-stack-muted">Coming later — {TABS.find(t => t.id === tab)?.label}</div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
