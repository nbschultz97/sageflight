import React, { useEffect, useRef, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({ breaks: true });

function renderMarkdown(text) {
  return { __html: DOMPurify.sanitize(marked.parse(text || '')) };
}

const STORAGE_KEY = 'st:chat:messages';

// ---------- Model ranking ----------
// Auto-pick the strongest tool-capable model the user has pulled. Family
// weight prefers models with reliable tool-calling; size breaks ties.
const FAMILY_WEIGHT = [
  [/^qwen3/, 50], [/^qwen2\.5/, 45], [/^llama3\.3/, 42], [/^llama3\.1/, 35],
  [/^mistral-nemo/, 30], [/^mistral/, 25], [/^command-r/, 25], [/^hermes3/, 22],
  [/^llama3(?![.\d])/, 10], [/^gemma/, 5], [/^phi/, 5],
];

function scoreModel(name) {
  const n = name.toLowerCase();
  let family = 0;
  for (const [re, w] of FAMILY_WEIGHT) { if (re.test(n)) { family = w; break; } }
  const size = parseFloat(n.match(/(\d+(?:\.\d+)?)b/)?.[1] || '0');
  return family * 1000 + size;
}

function bestModel(models) {
  if (!models?.length) return null;
  return [...models].sort((a, b) => scoreModel(b) - scoreModel(a))[0];
}

export default function ChatTab() {
  const [ollama, setOllama] = useState(null);
  const [model, setModel] = useState(() => localStorage.getItem('st:chat:model') || '');
  const [messages, setMessages] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } catch { return []; }
  }); // { role, content, tools?: [{name, ok}], proposal?: {commands, reason, status, results?} }
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState(null);
  const [agentMode, setAgentMode] = useState(() => localStorage.getItem('st:chat:agent') !== '0');
  const [includeContext, setIncludeContext] = useState(true);
  const [applyConfirm, setApplyConfirm] = useState(null); // message index pending apply
  const scrollRef = useRef(null);

  useEffect(() => {
    fetch('/api/ollama/health').then(r => r.json()).then(j => {
      setOllama(j);
      // Auto-select the strongest available model unless the user's saved
      // pick is still installed.
      if (j?.ok && j.models?.length) {
        const saved = localStorage.getItem('st:chat:model');
        if (!saved || !j.models.includes(saved)) {
          const best = bestModel(j.models);
          if (best) setModel(best);
        }
      }
    }).catch(() => setOllama({ ok: false }));
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-60)));
  }, [messages]);

  useEffect(() => { if (model) localStorage.setItem('st:chat:model', model); }, [model]);
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
              const update = { ...last, tools: [...(last.tools || []), { name: obj.tool_call.name, pending: true }] };
              // A config proposal becomes a reviewable Apply card on this message.
              if (obj.tool_call.name === 'propose_config_changes' && obj.tool_call.args?.commands) {
                update.proposal = {
                  commands: (obj.tool_call.args.commands || []).map(String),
                  reason: String(obj.tool_call.args.reason || ''),
                  status: 'pending',
                };
              }
              copy[copy.length - 1] = update;
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
              const update = { ...last, tools };
              if (obj.tool_result.name === 'propose_config_changes' && !obj.tool_result.ok && last.proposal) {
                update.proposal = { ...last.proposal, status: 'invalid', error: obj.tool_result.error };
              }
              copy[copy.length - 1] = update;
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

  async function applyProposal(msgIndex) {
    setApplyConfirm(null);
    const proposal = messages[msgIndex]?.proposal;
    if (!proposal) return;
    const patch = (p) => setMessages(m => m.map((msg, i) => i === msgIndex ? { ...msg, proposal: { ...msg.proposal, ...p } } : msg));
    patch({ status: 'applying' });
    try {
      const tr = await fetch('/api/safety/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'config.write', acknowledged: true, backupTaken: true }),
      });
      const tj = await tr.json();
      if (!tj.ok) throw new Error(tj.error || 'token refused');

      const r = await fetch('/api/cli/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tj.token, commands: proposal.commands }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'apply failed');
      patch({ status: 'applied', results: j.results, saved: j.saved });
    } catch (e) {
      patch({ status: 'failed', error: e.message });
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

  const hasBackup = useHasBackup();
  const smallModel = ollama?.ok && model &&
    parseFloat(model.toLowerCase().match(/(\d+(?:\.\d+)?)b/)?.[1] || '0') < 14;

  return (
    <div className="max-w-4xl h-full flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">AI Assistant</h1>
          <p className="text-stack-muted text-sm mt-1">Offline LLM via Ollama. No cloud, no data exfil. It inspects your aircraft with tools and proposes fixes you approve.</p>
        </div>
        <OllamaStatus ollama={ollama} model={model} setModel={setModel} />
      </div>

      {smallModel && (
        <div className="note text-xs">
          <span className="font-semibold">Tip:</span> <span className="font-mono">{model}</span> works, but a larger
          model gives noticeably better diagnosis and proposals. If your machine can run it:{' '}
          <span className="font-mono">ollama pull qwen2.5:32b</span> (or <span className="font-mono">qwen2.5:14b</span>) — Sageflight will auto-select it.
        </div>
      )}

      <DocsIndexPanel ok={!!ollama?.ok} />

      <div className="flex flex-wrap items-center gap-4 text-sm">
        <Toggle
          checked={agentMode}
          onChange={setAgentMode}
          label="Tools"
          hint="Let the LLM inspect the aircraft (detect, scan, config, history, forensic DB) and propose config changes you approve. It can never actuate hardware itself."
        />
        <Toggle
          checked={includeContext && hasScan}
          disabled={!hasScan}
          onChange={setIncludeContext}
          label="FC context"
          hint={hasScan ? 'Include your last FC scan in the conversation' : 'Run a scan in the Setup tab first'}
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
              <li>"set me up for DSHOT600 with bidirectional dshot" <span className="pill-muted ml-1">proposes changes</span></li>
              <li>"what's the forensic history on this board?"</li>
            </ul>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            <div className={[
              'max-w-[85%] rounded px-4 py-2.5',
              m.role === 'user' ? 'bg-stack-accent/15 border border-stack-accent/30' : 'bg-stack-bg border border-stack-border',
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
              {m.proposal && (
                <ProposalCard
                  proposal={m.proposal}
                  hasBackup={hasBackup}
                  onApply={() => setApplyConfirm(i)}
                />
              )}
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
          placeholder={ollama?.ok ? (agentMode ? 'Ask — the AI can inspect your FC and propose fixes…' : 'Ask about your build…') : 'Ollama not reachable — check status above'}
          disabled={!ollama?.ok || streaming}
          className="flex-1 bg-stack-panel border border-stack-border rounded px-4 py-2.5 font-sans outline-none focus:border-stack-accent disabled:opacity-50"
        />
        <button type="submit" disabled={!ollama?.ok || streaming || !draft.trim()}
          className={(ollama?.ok && !streaming && draft.trim()) ? 'btn-primary' : 'btn-ghost opacity-50'}>
          {streaming ? 'Streaming…' : 'Send'}
        </button>
      </form>

      {applyConfirm != null && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="panel p-6 max-w-lg w-full">
            <h2 className="text-xl font-semibold text-stack-warn">⚠ Apply AI-proposed config</h2>
            <p className="text-sm text-stack-muted mt-2">
              These commands will be written to the flight controller. Review them in the card —
              a wrong value can make the aircraft unflyable or unsafe.
            </p>
            {!hasBackup && (
              <p className="text-sm text-stack-err mt-3">No config backup exists yet — take one in the Config tab first.</p>
            )}
            <div className="mt-6 flex gap-3 justify-end">
              <button className="btn-ghost" onClick={() => setApplyConfirm(null)}>Cancel</button>
              <button
                className={hasBackup ? 'btn-primary' : 'btn-ghost opacity-50 cursor-not-allowed'}
                disabled={!hasBackup}
                onClick={() => applyProposal(applyConfirm)}
              >I have a backup — apply it</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Local Betaflight docs index — grounds the AI in real documentation
// (search_docs tool) instead of model memory. Build needs internet once.
function DocsIndexPanel({ ok }) {
  const [status, setStatus] = useState(null);
  const [building, setBuilding] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState(null);

  async function refresh() {
    try { setStatus(await (await fetch('/api/rag/status')).json()); } catch {}
  }
  useEffect(() => { refresh(); }, []);

  async function build() {
    setBuilding(true); setError(null); setProgress('starting…');
    try {
      const res = await fetch('/api/rag/build', { method: 'POST' });
      if (!res.ok || !res.body) throw new Error('build stream failed');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n\n')) !== -1) {
          const chunk = buf.slice(0, nl); buf = buf.slice(nl + 2);
          if (!chunk.startsWith('data:')) continue;
          try {
            const obj = JSON.parse(chunk.slice(5).trim());
            if (obj.error) setError(obj.error);
            if (obj.stage) setProgress(obj.msg);
            if (obj.done) setProgress(`done — ${obj.chunks} chunks indexed`);
          } catch {}
        }
      }
      await refresh();
    } catch (e) { setError(e.message); }
    finally { setBuilding(false); }
  }

  if (!status) return null;
  return (
    <div className="panel p-3 flex items-center justify-between gap-3 text-sm">
      <div className="flex items-center gap-2 min-w-0">
        {status.built
          ? <span className="pill-ok shrink-0">docs grounded</span>
          : <span className="pill-warn shrink-0">no docs index</span>}
        <span className="text-stack-muted text-xs truncate">
          {building ? progress
            : status.built ? `${status.chunks} chunks of official Betaflight docs · built ${status.builtAt?.slice(0, 10)} · answers cite real documentation`
            : 'Build a local Betaflight docs index so the AI cites documentation instead of guessing. Needs internet once (~5 min); offline forever after.'}
        </span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {error && <span className="text-stack-err text-xs">{error}</span>}
        <button className="btn-ghost text-xs" disabled={building || !ok} onClick={build}
          title={!ok ? 'Ollama must be running' : undefined}>
          {building ? 'Building…' : status.built ? 'Rebuild' : 'Build docs index'}
        </button>
      </div>
    </div>
  );
}

function useHasBackup() {
  const [has, setHas] = useState(false);
  useEffect(() => {
    fetch('/api/config/backups').then(r => r.json())
      .then(j => setHas(!!(j.ok && j.backups?.length)))
      .catch(() => {});
  }, []);
  return has;
}

function ProposalCard({ proposal, hasBackup, onApply }) {
  const border =
    proposal.status === 'applied' ? 'border-stack-ok/60' :
    proposal.status === 'failed' || proposal.status === 'invalid' ? 'border-stack-err/60' :
    'border-stack-accent/60';
  return (
    <div className={`mt-3 border ${border} rounded bg-stack-panel`}>
      <div className="px-3 py-2 border-b border-stack-border flex items-center justify-between">
        <div className="text-xs uppercase tracking-wide text-stack-accent font-semibold">Proposed config change</div>
        {proposal.status === 'pending' && <span className="pill-warn">awaiting your approval</span>}
        {proposal.status === 'applying' && <span className="pill-muted">applying…</span>}
        {proposal.status === 'applied' && <span className="pill-ok">applied{proposal.saved ? ' + saved' : ''}</span>}
        {proposal.status === 'failed' && <span className="pill-err">failed</span>}
        {proposal.status === 'invalid' && <span className="pill-err">rejected</span>}
      </div>
      {proposal.reason && <div className="px-3 py-2 text-sm text-stack-muted">{proposal.reason}</div>}
      <pre className="px-3 py-2 text-xs font-mono whitespace-pre-wrap text-stack-text">
        {proposal.commands.join('\n')}
      </pre>
      {proposal.error && <div className="px-3 py-2 text-xs text-stack-err">{proposal.error}</div>}
      {proposal.status === 'pending' && (
        <div className="px-3 py-2 border-t border-stack-border flex justify-end">
          <button className="btn-primary text-sm py-1.5" onClick={onApply}>
            Review &amp; apply…
          </button>
        </div>
      )}
      {proposal.status === 'applied' && proposal.results?.some(r => r.output) && (
        <details className="px-3 py-2 border-t border-stack-border text-xs">
          <summary className="cursor-pointer text-stack-muted">FC output</summary>
          <pre className="mt-1 font-mono whitespace-pre-wrap text-stack-muted">
            {proposal.results.map(r => `# ${r.command}\n${r.output}`).join('\n')}
          </pre>
        </details>
      )}
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
          : <option value={model}>{model || 'no models pulled'}</option>}
      </select>
    </div>
  );
}
