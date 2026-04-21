// Minimal Ollama HTTP client. Zero dependencies — talks to the local Ollama daemon
// on http://127.0.0.1:11434 using the built-in fetch API (Node 18+).
//
// Docs: https://github.com/ollama/ollama/blob/main/docs/api.md
//
// Usage:
//   const { chat, isAvailable } = require('./lib/ollama-client');
//   if (await isAvailable()) {
//     const reply = await chat('llama3.1:8b', [
//       { role: 'system', content: 'You are a drone build assistant...' },
//       { role: 'user',   content: 'My quad has a loud motor 3.' }
//     ]);
//     console.log(reply);
//   }

const HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';

async function isAvailable() {
  try {
    const res = await fetch(HOST + '/api/tags', { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function listModels() {
  const res = await fetch(HOST + '/api/tags');
  if (!res.ok) throw new Error(`Ollama /api/tags returned ${res.status}`);
  const data = await res.json();
  return (data.models || []).map(m => m.name);
}

async function chat(model, messages, opts = {}) {
  const body = {
    model,
    messages,
    stream: false,
    options: opts.options || {},
  };
  const res = await fetch(HOST + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Ollama /api/chat returned ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.message?.content || '';
}

async function chatStream(model, messages, onToken, opts = {}) {
  const body = {
    model, messages,
    stream: true,
    options: opts.options || {},
  };
  const res = await fetch(HOST + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) throw new Error(`Ollama /api/chat stream failed: ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try {
        const chunk = JSON.parse(line);
        if (chunk.message?.content) onToken(chunk.message.content);
        if (chunk.done) return;
      } catch { /* ignore non-JSON lines */ }
    }
  }
}

module.exports = { HOST, isAvailable, listModels, chat, chatStream };
