import React, { useState } from 'react';
import { TelemetryProvider } from './telemetry';
import Sidebar from './components/Sidebar';
import HeaderBar from './components/HeaderBar';
import StatusBar from './components/StatusBar';
import DetectTab from './components/DetectTab';
import ReceiverTab from './components/ReceiverTab';
import MotorsTab from './components/MotorsTab';
import EscTab from './components/EscTab';
import ConfigTab from './components/ConfigTab';
import ChecklistsTab from './components/ChecklistsTab';
import ChatTab from './components/ChatTab';
import BlackboxTab from './components/BlackboxTab';
import FlashTab from './components/FlashTab';

const TABS = [
  { id: 'detect',     label: 'Setup',            icon: 'setup' },
  { id: 'receiver',   label: 'Receiver',         icon: 'receiver' },
  { id: 'motors',     label: 'Motors',           icon: 'motors' },
  { id: 'esc',        label: 'ESC',              icon: 'esc' },
  { id: 'config',     label: 'Config / CLI',     icon: 'config' },
  { id: 'blackbox',   label: 'Blackbox',         icon: 'blackbox' },
  { id: 'checklists', label: 'Checklists',       icon: 'checklists' },
  { id: 'chat',       label: 'AI Assistant',     icon: 'chat', badge: 'LLM' },
  { id: 'div1',       divider: true },
  { id: 'flash',      label: 'Firmware Flasher', icon: 'flash' },
];

export default function App() {
  const [tab, setTab] = useState('detect');

  return (
    <TelemetryProvider>
      <div className="flex flex-col h-full">
        <HeaderBar />
        <div className="flex-1 flex min-h-0">
          <Sidebar tabs={TABS} active={tab} onSelect={setTab} />
          <main className="flex-1 overflow-auto p-6 min-w-0">
            {tab === 'detect'     && <DetectTab />}
            {tab === 'receiver'   && <ReceiverTab />}
            {tab === 'motors'     && <MotorsTab />}
            {tab === 'esc'        && <EscTab />}
            {tab === 'config'     && <ConfigTab />}
            {tab === 'blackbox'   && <BlackboxTab />}
            {tab === 'checklists' && <ChecklistsTab />}
            {tab === 'chat'       && <ChatTab />}
            {tab === 'flash'      && <FlashTab />}
          </main>
        </div>
        <StatusBar />
      </div>
    </TelemetryProvider>
  );
}
