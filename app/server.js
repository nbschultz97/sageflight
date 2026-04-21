// Local backend for stack-troubleshooter web app.
// Serves /api endpoints wrapping our existing protocol libraries.
// Hardware actuation endpoints require an explicit safety-confirmation token.

import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { detectFC } = require('../lib/usb-detect');
const { scanFC } = require('../lib/betaflight-cli');
const { SerialPort } = require('serialport');

const app = express();
app.use(cors());
app.use(express.json());

// ---------- Safety tokens ----------
// Clients request a token per hardware action; token expires in 60s.
// Token is required in /api/motor/* requests. Prevents accidental direct curl hits.
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
  res.json({ ok: true, version: '0.1.0', time: new Date().toISOString() });
});

// ---------- USB / FC detect ----------
app.get('/api/detect', (_req, res) => {
  try {
    const result = detectFC();
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---------- Scan FC ----------
app.post('/api/scan', async (_req, res) => {
  try {
    const det = detectFC();
    if (det.type !== 'ALIVE') {
      return res.status(400).json({ ok: false, error: `No FC detected on USB (${det.type})`, detection: det });
    }
    const fc = await scanFC(det.comPort);
    res.json({ ok: true, detection: det, fc });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---------- Safety token issue ----------
app.post('/api/safety/confirm', (req, res) => {
  const { action, propsOff, batteryOn, restrained } = req.body || {};
  if (!action) return res.status(400).json({ ok: false, error: 'missing action' });
  if (!propsOff || !restrained) {
    return res.status(400).json({
      ok: false,
      error: 'Must confirm propsOff=true AND restrained=true before actuation token is issued.',
    });
  }
  if (action.startsWith('motor.') && !batteryOn) {
    return res.status(400).json({ ok: false, error: 'Motor actuation requires batteryOn=true confirmation.' });
  }
  const token = issueToken(action);
  res.json({ ok: true, token, expiresInSec: 60, action });
});

// ---------- Motor actuation ----------
// Shared serial helper — CLI mode enter, command, stop, exit.
async function withCli(comPort, asyncFn) {
  const port = new SerialPort({ path: comPort, baudRate: 115200 });
  await new Promise((r, e) => { port.on('open', r); port.on('error', e); });
  let buf = '';
  const handler = (d) => { buf += d.toString(); };
  port.on('data', handler);
  await new Promise(r => setTimeout(r, 500));
  port.write('#');
  await new Promise(r => setTimeout(r, 1500));
  try {
    return await asyncFn({
      port,
      async send(cmd, waitMs = 300) {
        buf = '';
        port.write(cmd + '\r\n');
        await new Promise(r => setTimeout(r, waitMs));
        return buf;
      },
    });
  } finally {
    // Always stop all motors + exit CLI cleanly
    try {
      for (let i = 0; i < 4; i++) {
        port.write(`motor ${i} 1000\r\n`);
        await new Promise(r => setTimeout(r, 50));
      }
      port.write('exit\r\n');
      await new Promise(r => setTimeout(r, 400));
    } catch {}
    port.removeListener('data', handler);
    await new Promise(r => port.close(() => r()));
  }
}

function parseVoltage(buf) {
  const mult = buf.match(/Voltage:\s*(\d+)\s*\*\s*([\d.]+)V/);
  if (mult) return +(parseFloat(mult[1]) * parseFloat(mult[2])).toFixed(2);
  const plain = buf.match(/Voltage:\s*([\d.]+)V/);
  return plain ? parseFloat(plain[1]) : null;
}

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

  const det = detectFC();
  if (det.type !== 'ALIVE') return res.status(400).json({ ok: false, error: 'no FC on USB' });

  try {
    const result = await withCli(det.comPort, async ({ send }) => {
      const idleBuf = await send('status', 2000);
      const vIdle = parseVoltage(idleBuf);
      await send(`motor ${m - 1} ${p}`, 200);
      await new Promise(r => setTimeout(r, 700));
      const loadBuf = await send('status', 1500);
      const vLoad = parseVoltage(loadBuf);
      await new Promise(r => setTimeout(r, Math.max(0, s * 1000 - 2400)));
      await send(`motor ${m - 1} 1000`, 200);
      return { motor: m, pwm: p, seconds: s, vIdle, vLoad, sag: (vIdle != null && vLoad != null) ? +(vIdle - vLoad).toFixed(3) : null };
    });
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

  const det = detectFC();
  if (det.type !== 'ALIVE') return res.status(400).json({ ok: false, error: 'no FC on USB' });

  try {
    const results = await withCli(det.comPort, async ({ send }) => {
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
    });

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
    res.json({ ok: true, pwm: p, seconds: s, results, verdict });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---------- Ollama chat ----------
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';

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

// Streaming chat — server-sent events
app.post('/api/ollama/chat', async (req, res) => {
  const { model = 'llama3.1:8b', messages = [] } = req.body || {};
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const ollamaRes = await fetch(OLLAMA_HOST + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: true }),
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
          if (chunk.message?.content) {
            res.write(`data: ${JSON.stringify({ token: chunk.message.content })}\n\n`);
          }
          if (chunk.done) {
            res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
            res.end();
            return;
          }
        } catch {}
      }
    }
    res.end();
  } catch (e) {
    res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
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
  console.log(`[stack-troubleshooter] API server on http://localhost:${PORT}`);
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[stack-troubleshooter] Vite dev server on http://localhost:5173 (open this one)`);
  }
});
