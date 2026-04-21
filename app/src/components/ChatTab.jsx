import React, { useEffect, useRef, useState } from 'react';

const SYSTEM_PROMPT = `You are an expert FPV drone build and troubleshooting assistant.
Your user is configuring or repairing Betaflight-based drones.

Style: concise, direct, technical. Safety first — always confirm props off before any motor actuation.
When unsure, ask for a specific measurement instead of guessing.
Differentiate electrical vs mechanical failure modes explicitly.
Never instruct the user to spin motors without explicit props-off confirmation.
Never recommend firmware flashing without a backup first.`;

export default function ChatTab() {
  const [ollama, setOllama] = useState(null);
  const [model, setModel] = useState('llama3.1:8b');
  const [messages, setMessages] = useState([]); // { role, content }
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    fetch('/api/ollama/health').then(r => r.json()).then(setOllama).catch(() => setOllama({ ok: false }));
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, streaming]);

  async function send() {
    const content = draft.trim();
    if (!content || streaming) return;
    const next = [...messages, { role: 'user', content }];
    setMessages(next);
    setDraft('');
    setStreaming(true);
    setError(null);

    try {
      const res = await fetch('/api/ollama/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...next],
        }),
      });
      if (!res.ok || !res.body) throw new Error('chat stream failed to open');

      setMessages(m => [...m, { role: 'assistant', content: '' }]);
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
          try {
            const obj = JSON.parse(chunk.slice(5).trim());
            if (obj.error) { setError(obj.error); break; }
            if (obj.token) {
              setMessages(m => {
                const copy = [...m];
                copy[copy.length - 1] = { ...copy[copy.length - 1], content: copy[copy.length - 1].content + obj.token };
                return copy;
              });
            }
          } catch {}
        }
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setStreaming(false);
    }
  }

  return (
    <div className="max-w-4xl h-full flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Chat</h1>
          <p className="text-stack-muted text-sm mt-1">Offline LLM via Ollama. No cloud, no data exfil.</p>
        </div>
        <OllamaStatus ollama={ollama} model={model} setModel={setModel} />
      </div>

      <div ref={scrollRef} className="flex-1 panel p-4 overflow-y-auto min-h-[300px] space-y-4">
        {messages.length === 0 && (
          <div className="text-stack-muted text-sm">
            Ask a question about your build. Examples:
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>"my quad won't arm, what do I check?"</li>
              <li>"how do I configure ELRS on betaflight 4.5?"</li>
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
              <div className="text-sm whitespace-pre-wrap">{m.content}{streaming && i === messages.length - 1 ? '▊' : ''}</div>
            </div>
          </div>
        ))}
      </div>

      {error && <div className="panel p-3 border-stack-err text-stack-err text-sm">{error}</div>}

      <form onSubmit={e => { e.preventDefault(); send(); }} className="flex gap-2">
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder={ollama?.ok ? 'Ask about your build…' : 'Ollama not reachable — check sidebar status'}
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
