// Local backend for stack-troubleshooter web app.
// Serves /api endpoints wrapping our existing protocol libraries.
// Hardware actuation endpoints require an explicit safety-confirmation token.
// All serial access is serialized through a mutex — the FC has one port.

import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { detectFC, listPorts } = require('../lib/usb-detect');
const { scanFC } = require('../lib/betaflight-cli');
const { withCli, parseVoltage, classifyCliCommand } = require('../lib/fc-cli');
const { createMutex } = require('../lib/serial-mutex');
const store = require('../lib/store');
const { TOOL_DEFINITIONS, createToolExecutor } = require('../lib/agent-tools');

const VERSION = '0.2.0';

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

const serial = createMutex();

// ---------- Safety tokens ----------
// Clients request a token per hardware action; token expires in 60s.
// Token is required in /api/motor/* and config-write requests. Prevents
// accidental direct curl hits.
const liveTokens = new Map(); // token -> { action, expiresAt }

function issueToken(action) {
  const t = crypto.randomBytes(16).toString('hex');
  liveTokens.set(t, { action, expiresAt: Date.now() + 60000 });
  return t;
}

function consumeToken(token, action) {
  const rec = liveTokens.get(token);
  if (!rec) return false;
  liveTokens.delete(token);
  if (rec.action !== action) return false;
  if (Date.now() > rec.expiresAt) return false;
  return true;
}

// Periodically purge expired
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of liveTokens) if (v.expiresAt < now) liveTokens.delete(k);
}, 30000).unref();

// ---------- Health ----------
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, version: VERSION, serialBusy: serial.isBusy(), time: new Date().toISOString() });
});

// ---------- USB / FC detect ----------
app.get('/api/detect', async (_req, res) => {
  try {
    const result = await detectFC();
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/ports', async (_req, res) => {
  try {
    res.json({ ok: true, ports: await listPorts() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---------- Scan FC ----------
app.post('/api/scan', async (_req, res) => {
  try {
    const det = await detectFC();
    if (det.type !== 'ALIVE') {
      return res.status(400).json({ ok: false, error: `No FC detected on USB (${det.type})`, detection: det });
    }
    const fc = await serial.runExclusive(() => scanFC(det.comPort));
    res.json({ ok: true, detection: det, fc });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---------- Safety token issue ----------
app.post('/api/safety/confirm', (req, res) => {
  const { action, propsOff, batteryOn, restrained, acknowledged, backupTaken } = req.body || {};
  if (!action) return res.status(400).json({ ok: false, error: 'missing action' });

  if (action.startsWith('motor.')) {
    if (!propsOff || !restrained) {
      return res.status(400).json({
        ok: false,
        error: 'Must confirm propsOff=true AND restrained=true before actuation token is issued.',
      });
    }
    if (!batteryOn) {
      return res.status(400).json({ ok: false, error: 'Motor actuation requires batteryOn=true confirmation.' });
    }
  } else if (action === 'config.write') {
    if (!acknowledged || !backupTaken) {
      return res.status(400).json({
        ok: false,
        error: 'Config writes require acknowledged=true AND backupTaken=true (take a backup in the Config tab first).',
      });
    }
  } else {
    return res.status(400).json({ ok: false, error: `unknown action: ${action}` });
  }

  const token = issueToken(action);
  res.json({ ok: true, token, expiresInSec: 60, action });
});

// ---------- Motor actuation ----------
app.post('/api/motor/spin', async (req, res) => {
  const { token, motor, pwm = 1070, seconds = 2 } = req.body || {};
  if (!consumeToken(token, 'motor.spin')) {
    return res.status(403).json({ ok: false, error: 'invalid or missing safety token' });
  }
  const m = parseInt(motor, 10);
  const p = parseInt(pwm, 10);
  const s = parseFloat(seconds);
  if (!m || m < 1 || m > 4) return res.status(400).json({ ok: false, error: 'motor must be 1-4' });
  if (p < 1000 || p > 1300)  return res.status(400).json({ ok: false, error: 'pwm must be 1000-1300' });
  if (s > 5)                 return res.status(400).json({ ok: false, error: 'seconds must be <= 5' });

  const det = await detectFC();
  if (det.type !== 'ALIVE') return res.status(400).json({ ok: false, error: 'no FC on USB' });

  try {
    const result = await serial.runExclusive(() => withCli(det.comPort, async ({ send }) => {
      const idleBuf = await send('status', 2000);
      const vIdle = parseVoltage(idleBuf);
      await send(`motor ${m - 1} ${p}`, 200);
      await new Promise(r => setTimeout(r, 700));
      const loadBuf = await send('status', 1500);
      const vLoad = parseVoltage(loadBuf);
      await new Promise(r => setTimeout(r, Math.max(0, s * 1000 - 2400)));
      await send(`motor ${m - 1} 1000`, 200);
      return { motor: m, pwm: p, seconds: s, vIdle, vLoad, sag: (vIdle != null && vLoad != null) ? +(vIdle - vLoad).toFixed(3) : null };
    }));
    store.appendHistory({ kind: 'motor.spin', ...result });
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/motor/compare', async (req, res) => {
  const { token, pwm = 1080, seconds = 2 } = req.body || {};
  if (!consumeToken(token, 'motor.compare')) {
    return res.status(403).json({ ok: false, error: 'invalid or missing safety token' });
  }
  const p = parseInt(pwm, 10);
  const s = parseFloat(seconds);
  if (p < 1000 || p > 1300) return res.status(400).json({ ok: false, error: 'pwm must be 1000-1300' });
  if (s > 5)                return res.status(400).json({ ok: false, error: 'seconds must be <= 5' });

  const det = await detectFC();
  if (det.type !== 'ALIVE') return res.status(400).json({ ok: false, error: 'no FC on USB' });

  try {
    const results = await serial.runExclusive(() => withCli(det.comPort, async ({ send }) => {
      const out = [];
      for (let m = 0; m < 4; m++) {
        const idleBuf = await send('status', 1500);
        const vIdle = parseVoltage(idleBuf);
        await send(`motor ${m} ${p}`, 200);
        await new Promise(r => setTimeout(r, 700));
        const loadBuf = await send('status', 1500);
        const vLoad = parseVoltage(loadBuf);
        await new Promise(r => setTimeout(r, Math.max(0, s * 1000 - 2400)));
        await send(`motor ${m} 1000`, 200);
        const sag = (vIdle != null && vLoad != null) ? +(vIdle - vLoad).toFixed(3) : null;
        out.push({ motor: m + 1, vIdle, vLoad, sag });
        await new Promise(r => setTimeout(r, 600));
      }
      return out;
    }));

    const sags = results.filter(r => r.sag != null).map(r => r.sag);
    let verdict = null;
    if (sags.length === 4) {
      const mean = sags.reduce((a, b) => a + b, 0) / 4;
      const outliers = results.filter(r => r.sag != null && Math.abs(r.sag - mean) > 0.15);
      verdict = {
        meanSag: +mean.toFixed(3),
        outliers: outliers.map(o => ({ motor: o.motor, deviation: +(o.sag - mean).toFixed(3) })),
      };
    }
    store.appendHistory({ kind: 'motor.compare', pwm: p, seconds: s, results, verdict });
    res.json({ ok: true, pwm: p, seconds: s, results, verdict });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---------- Test history ----------
app.get('/api/history', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  res.json({ ok: true, history: store.readHistory(limit) });
});

// ---------- Config backups ----------
app.post('/api/config/backup', async (_req, res) => {
  try {
    const det = await detectFC();
    if (det.type !== 'ALIVE') return res.status(400).json({ ok: false, error: `no FC on USB (${det.type})` });

    const { boardName, diff } = await serial.runExclusive(() => withCli(det.comPort, async ({ send }) => {
      const nameRaw = await send('board_name', 1000);
      const nameLine = nameRaw.split('\n').map(l => l.trim()).filter(l => l.startsWith('board_name')).pop();
      const boardName = nameLine ? nameLine.replace('board_name', '').trim() : 'unknown-board';
      const diff = await send('diff all', 8000);
      return { boardName, diff: diff.trim() };
    }));

    if (!diff || diff.length < 20) {
      return res.status(500).json({ ok: false, error: 'diff all returned no data — FC may not be in a healthy CLI state' });
    }
    const { id } = store.saveBackup(diff, { boardName, comPort: det.comPort });
    res.json({ ok: true, id, boardName, bytes: Buffer.byteLength(diff, 'utf8'), content: diff });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/config/backups', (_req, res) => {
  res.json({ ok: true, backups: store.listBackups() });
});

app.get('/api/config/backups/:id', (req, res) => {
  const content = store.readBackup(req.params.id);
  if (content == null) return res.status(404).json({ ok: false, error: 'backup not found' });
  res.json({ ok: true, id: req.params.id, content });
});

// ---------- CLI console ----------
// Read-only commands run freely. Write commands need a config.write token.
// Forbidden commands (defaults, flash_erase, motor, ...) are refused outright.
app.post('/api/cli', async (req, res) => {
  const { command, token } = req.body || {};
  const line = String(command || '').trim();
  if (!line) return res.status(400).json({ ok: false, error: 'missing command' });
  if (line.length > 200) return res.status(400).json({ ok: false, error: 'command too long' });
  if (/[\r\n]/.test(line)) return res.status(400).json({ ok: false, error: 'one command per request' });

  const cls = classifyCliCommand(line);
  if (cls.kind === 'forbidden') {
    return res.status(403).json({ ok: false, error: `"${cls.verb}" is not allowed from the web console`, kind: cls.kind });
  }
  if (cls.kind === 'unknown' || cls.kind === 'invalid') {
    return res.status(400).json({ ok: false, error: `"${cls.verb}" is not a recognized safe CLI command`, kind: cls.kind });
  }
  if (cls.kind === 'write' && !consumeToken(token, 'config.write')) {
    return res.status(403).json({ ok: false, error: 'write command requires a config.write safety token', kind: cls.kind });
  }

  const det = await detectFC();
  if (det.type !== 'ALIVE') return res.status(400).json({ ok: false, error: `no FC on USB (${det.type})` });

  try {
    const waitMs = /^(diff|dump)/.test(cls.verb) ? 8000 : 1500;
    const output = await serial.runExclusive(() =>
      withCli(det.comPort, async ({ send }) => send(line, waitMs))
    );
    res.json({ ok: true, command: line, kind: cls.kind, output: output.trim() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---------- Ollama ----------
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const SYSTEM_PROMPT_PATH = path.join(__dirname, '..', 'llm', 'prompts', 'system.md');

function readSystemPrompt() {
  try { return fs.readFileSync(SYSTEM_PROMPT_PATH, 'utf8'); }
  catch { return 'You are an expert FPV drone build and troubleshooting assistant.'; }
}

app.get('/api/ollama/health', async (_req, res) => {
  try {
    const r = await fetch(OLLAMA_HOST + '/api/tags', { signal: AbortSignal.timeout(1500) });
    if (!r.ok) throw new Error(`status ${r.status}`);
    const data = await r.json();
    res.json({ ok: true, host: OLLAMA_HOST, models: (data.models || []).map(m => m.name) });
  } catch (e) {
    res.json({ ok: false, host: OLLAMA_HOST, error: e.message });
  }
});

function sseHeaders(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
}

function sseSend(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

// Plain streaming chat — server-sent events
app.post('/api/ollama/chat', async (req, res) => {
  const { model = 'llama3.1:8b', messages = [] } = req.body || {};
  sseHeaders(res);

  // Main system prompt lives server-side (llm/prompts/system.md). Client may
  // still send additional system messages (e.g. STACK_CONTEXT) — keep them.
  const convo = [{ role: 'system', content: readSystemPrompt() }, ...messages];

  try {
    const ollamaRes = await fetch(OLLAMA_HOST + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: convo, stream: true }),
    });
    if (!ollamaRes.ok || !ollamaRes.body) throw new Error(`Ollama /api/chat: ${ollamaRes.status}`);

    const reader = ollamaRes.body.getReader();
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
          if (chunk.message?.content) sseSend(res, { token: chunk.message.content });
          if (chunk.done) { sseSend(res, { done: true }); res.end(); return; }
        } catch {}
      }
    }
    res.end();
  } catch (e) {
    sseSend(res, { error: e.message });
    res.end();
  }
});

// ---------- LLM agent loop (tool-calling, read-only tools) ----------
const execTool = createToolExecutor({
  detectFC,
  scanFC,
  withCli,
  runExclusive: serial.runExclusive,
  store,
});

const MAX_AGENT_ROUNDS = 6;

app.post('/api/agent/chat', async (req, res) => {
  const { model = 'llama3.1:8b', messages = [] } = req.body || {};
  sseHeaders(res);

  const convo = [
    { role: 'system', content: readSystemPrompt() +
      '\n\nYou have live tools: detect_fc, scan_fc, get_config_diff, get_motor_history, list_config_backups.' +
      ' Use them to look at the aircraft instead of asking the user for information a tool can fetch.' +
      ' You can NOT spin motors or write config — direct the user to the Motors/Config tabs for that.' },
    ...messages,
  ];

  try {
    for (let round = 0; round < MAX_AGENT_ROUNDS; round++) {
      const r = await fetch(OLLAMA_HOST + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: convo, tools: TOOL_DEFINITIONS, stream: false }),
      });
      if (!r.ok) {
        const text = await r.text();
        if (/does not support tools/i.test(text)) {
          throw new Error(`Model "${model}" does not support tool calling. Try llama3.1:8b or qwen2.5:7b, or turn Tools off.`);
        }
        throw new Error(`Ollama /api/chat: ${r.status} ${text.slice(0, 200)}`);
      }
      const data = await r.json();
      const msg = data.message || {};
      const toolCalls = msg.tool_calls || [];

      if (toolCalls.length === 0) {
        if (msg.content) sseSend(res, { token: msg.content });
        sseSend(res, { done: true });
        res.end();
        return;
      }

      convo.push(msg);
      for (const call of toolCalls) {
        const name = call.function?.name;
        const args = call.function?.arguments || {};
        sseSend(res, { tool_call: { name, args } });
        const result = await execTool(name, args);
        sseSend(res, { tool_result: { name, ok: !result?.error, error: result?.error || null } });
        convo.push({ role: 'tool', content: JSON.stringify(result) });
      }
    }
    sseSend(res, { error: `Agent hit the ${MAX_AGENT_ROUNDS}-round tool limit without a final answer.` });
    res.end();
  } catch (e) {
    sseSend(res, { error: e.message });
    res.end();
  }
});

// ---------- Static (production) ----------
if (process.env.NODE_ENV === 'production') {
  const distDir = path.join(__dirname, 'dist');
  app.use(express.static(distDir));
  app.get('*', (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`[stack-troubleshooter] API server v${VERSION} on http://localhost:${PORT}`);
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[stack-troubleshooter] Vite dev server on http://localhost:5173 (open this one)`);
  }
});
