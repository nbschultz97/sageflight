import React, { useEffect, useRef, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({ breaks: true });

function renderMarkdown(text) {
  return { __html: DOMPurify.sanitize(marked.parse(text || '')) };
}

const STORAGE_KEY = 'st:chat:messages';

export default function ChatTab() {
  const [ollama, setOllama] = useState(null);
  const [model, setModel] = useState(() => localStorage.getItem('st:chat:model') || 'llama3.1:8b');
  const [messages, setMessages] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } catch { return []; }
  }); // { role, content, tools?: [{name, ok}] }
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState(null);
  const [agentMode, setAgentMode] = useState(() => localStorage.getItem('st:chat:agent') === '1');
  const [includeContext, setIncludeContext] = useState(true);
  const scrollRef = useRef(null);

  useEffect(() => {
    fetch('/api/ollama/health').then(r => r.json()).then(setOllama).catch(() => setOllama({ ok: false }));
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-60)));
  }, [messages]);

  useEffect(() => { localStorage.setItem('st:chat:model', model); }, [model]);
  useEffect(() => { localStorage.setItem('st:chat:agent', agentMode ? '1' : '0'); }, [agentMode]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, streaming]);

  function buildContextMessage() {
    if (!includeContext) return null;
    try {
      const scan = JSON.parse(localStorage.getItem('st:lastScan'));
      if (!scan?.fc) return null;
      const { rawStatus, rawDiff, ...fc } = scan.fc;
      return {
        role: 'system',
        content: `STACK_CONTEXT (last FC scan, ${scan.at || 'unknown time'}): ${JSON.stringify(fc)}`,
      };
    } catch { return null; }
  }

  async function send() {
    const content = draft.trim();
    if (!content || streaming) return;
    const next = [...messages, { role: 'user', content }];
    setMessages(next);
    setDraft('');
    setStreaming(true);
    setError(null);

    const contextMsg = buildContextMessage();
    const outbound = [
      ...(contextMsg ? [contextMsg] : []),
      ...next.map(({ role, content }) => ({ role, content })),
    ];

    try {
      const res = await fetch(agentMode ? '/api/agent/chat' : '/api/ollama/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: outbound }),
      });
      if (!res.ok || !res.body) throw new Error('chat stream failed to open');

      setMessages(m => [...m, { role: 'assistant', content: '', tools: [] }]);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n\n')) !== -1) {
          const chunk = buf.slice(0, nl);
          buf = buf.slice(nl + 2);
          if (!chunk.startsWith('data:')) continue;
          let obj;
          try { obj = JSON.parse(chunk.slice(5).trim()); } catch { continue; }

          if (obj.error) { setError(obj.error); continue; }
          if (obj.tool_call) {
            setMessages(m => {
              const copy = [...m];
              const last = copy[copy.length - 1];
              copy[copy.length - 1] = { ...last, tools: [...(last.tools || []), { name: obj.tool_call.name, pending: true }] };
              return copy;
            });
          }
          if (obj.tool_result) {
            setMessages(m => {
              const copy = [...m];
              const last = copy[copy.length - 1];
              const tools = [...(last.tools || [])];
              const idx = tools.findIndex(t => t.name === obj.tool_result.name && t.pending);
              if (idx >= 0) tools[idx] = { name: obj.tool_result.name, ok: obj.tool_result.ok, error: obj.tool_result.error };
              copy[copy.length - 1] = { ...last, tools };
              return copy;
            });
          }
          if (obj.token) {
            setMessages(m => {
              const copy = [...m];
              const last = copy[copy.length - 1];
              copy[copy.length - 1] = { ...last, content: last.content + obj.token };
              return copy;
            });
          }
        }
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setStreaming(false);
    }
  }

  function clearChat() {
    setMessages([]);
    localStorage.removeItem(STORAGE_KEY);
    setError(null);
  }

  const hasScan = (() => {
    try { return !!JSON.parse(localStorage.getItem('st:lastScan'))?.fc; } catch { return false; }
  })();

  return (
    <div className="max-w-4xl h-full flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Chat</h1>
          <p className="text-stack-muted text-sm mt-1">Offline LLM via Ollama. No cloud, no data exfil.</p>
        </div>
        <OllamaStatus ollama={ollama} model={model} setModel={setModel} />
      </div>

      <div className="flex flex-wrap items-center gap-4 text-sm">
        <Toggle
          checked={agentMode}
          onChange={setAgentMode}
          label="Tools"
          hint="Let the LLM run read-only tools: detect, scan, read config, test history. It can never spin motors."
        />
        <Toggle
          checked={includeContext && hasScan}
          disabled={!hasScan}
          onChange={setIncludeContext}
          label="FC context"
          hint={hasScan ? 'Include your last FC scan in the conversation' : 'Run a scan in the Detect tab first'}
        />
        {messages.length > 0 && (
          <button onClick={clearChat} className="text-stack-muted hover:text-stack-err ml-auto">clear chat</button>
        )}
      </div>

      <div ref={scrollRef} className="flex-1 panel p-4 overflow-y-auto min-h-[300px] space-y-4">
        {messages.length === 0 && (
          <div className="text-stack-muted text-sm">
            Ask a question about your build. Examples:
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>"my quad won't arm, what do I check?"</li>
              <li>"scan my FC and tell me if anything looks wrong" <span className="pill-muted ml-1">Tools on</span></li>
              <li>"one motor is grinding, how do I diagnose it?"</li>
            </ul>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            <div className={[
              'max-w-[85%] rounded-lg px-4 py-2.5',
              m.role === 'user' ? 'bg-stack-accent/15 border border-stack-accent/30' : 'bg-stack-border/50 border border-stack-border',
            ].join(' ')}>
              <div className="text-xs uppercase tracking-wide text-stack-muted mb-1">
                {m.role === 'user' ? 'you' : model}
              </div>
              {m.tools?.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {m.tools.map((t, j) => (
                    <span key={j} className={t.pending ? 'pill-muted' : t.ok ? 'pill-ok' : 'pill-err'}
                      title={t.error || undefined}>
                      ⚙ {t.name}{t.pending ? '…' : ''}
                    </span>
                  ))}
                </div>
              )}
              {m.role === 'user'
                ? <div className="text-sm whitespace-pre-wrap">{m.content}</div>
                : <div className="text-sm chat-markdown" dangerouslySetInnerHTML={renderMarkdown(m.content)} />}
              {streaming && i === messages.length - 1 && m.role === 'assistant' && !m.content && (
                <div className="text-stack-muted text-sm">{m.tools?.some(t => t.pending) ? 'running tools…' : 'thinking…'}</div>
              )}
            </div>
          </div>
        ))}
      </div>

      {error && <div className="panel p-3 border-stack-err text-stack-err text-sm">{error}</div>}

      <form onSubmit={e => { e.preventDefault(); send(); }} className="flex gap-2">
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder={ollama?.ok ? (agentMode ? 'Ask — the LLM can inspect your FC…' : 'Ask about your build…') : 'Ollama not reachable — check status above'}
          disabled={!ollama?.ok || streaming}
          className="flex-1 bg-stack-panel border border-stack-border rounded-md px-4 py-2.5 font-sans outline-none focus:border-stack-accent disabled:opacity-50"
        />
        <button type="submit" disabled={!ollama?.ok || streaming || !draft.trim()}
          className={(ollama?.ok && !streaming && draft.trim()) ? 'btn-primary' : 'btn-ghost opacity-50'}>
          {streaming ? 'Streaming…' : 'Send'}
        </button>
      </form>
    </div>
  );
}

function Toggle({ checked, onChange, label, hint, disabled }) {
  return (
    <label className={['flex items-center gap-2', disabled ? 'opacity-50' : 'cursor-pointer'].join(' ')} title={hint}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)}
        className="w-4 h-4 accent-stack-accent" />
      <span className="text-stack-text">{label}</span>
    </label>
  );
}

function OllamaStatus({ ollama, model, setModel }) {
  if (!ollama) return <span className="pill-muted">checking Ollama…</span>;
  if (!ollama.ok) {
    return (
      <div className="text-right">
        <span className="pill-err">Ollama offline</span>
        <div className="text-xs text-stack-muted mt-1">Start with <span className="font-mono text-stack-text">ollama serve</span></div>
      </div>
    );
  }
  return (
    <div className="text-right">
      <span className="pill-ok">Ollama up</span>
      <select value={model} onChange={e => setModel(e.target.value)}
        className="ml-2 bg-stack-panel border border-stack-border rounded px-2 py-1 text-xs font-mono">
        {ollama.models?.length > 0
          ? ollama.models.map(m => <option key={m} value={m}>{m}</option>)
          : <option value={model}>{model}</option>}
      </select>
    </div>
  );
}
