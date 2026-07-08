// Local backend for the Sageflight web app.
// Serves /api endpoints wrapping our protocol libraries.
// Hardware actuation endpoints require an explicit safety-confirmation token.
// All serial access is serialized through a mutex — the FC has one port. The
// persistent telemetry connection is suspended around every exclusive op.

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
const forensic = require('../lib/forensic-db');
const { interrogateAll } = require('../lib/esc-4way');
const { parseIntelHex } = require('../lib/intel-hex');
const { findDfuUtil, listDfuDevices, enterDfu, flashWithDfuUtil } = require('../lib/flash');
const { createConnection, mspOneShot, CMD: MSP_CMD } = require('../lib/fc-connection');
const {
  parseSetLines, extractTune, parseAuxLines, parseSerialLines,
  parseRxfailLines, FAILSAFE_GROUPS, GPS_KEYS, extractKeys,
} = require('../lib/cli-parsers');
const catalog = require('../lib/catalog');
const presets = require('../lib/presets');

const VERSION = '0.6.0';

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

const serial = createMutex();
const conn = createConnection();

// Every exclusive serial operation goes through here: the live telemetry
// connection releases the port first and reconnects afterwards.
function serialOp(fn) {
  return serial.runExclusive(async () => {
    await conn.suspend();
    try { return await fn(); }
    finally { await conn.resume(); }
  });
}

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

// ---------- Persistent connection + live telemetry ----------
app.post('/api/connect', async (req, res) => {
  try {
    let target = req.body?.port;
    if (!target) {
      const det = await detectFC();
      if (det.type !== 'ALIVE') return res.status(400).json({ ok: false, error: `no FC on USB (${det.type})` });
      target = det.comPort;
    }
    const r = await serial.runExclusive(() => conn.connect(target));
    res.json({ ok: true, ...r });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/disconnect', async (_req, res) => {
  await conn.disconnect();
  res.json({ ok: true });
});

app.get('/api/connection', (_req, res) => {
  res.json({ ok: true, ...conn.getState() });
});

// Live telemetry stream — one SSE event ~5×/s while connected.
app.get('/api/telemetry/stream', (req, res) => {
  sseHeaders(res);
  const timer = setInterval(() => {
    sseSend(res, conn.getState());
  }, 200);
  req.on('close', () => clearInterval(timer));
});

// ---------- Scan FC ----------
app.post('/api/scan', async (_req, res) => {
  try {
    const det = await detectFC();
    if (det.type !== 'ALIVE') {
      return res.status(400).json({ ok: false, error: `No FC detected on USB (${det.type})`, detection: det });
    }
    const fc = await serialOp(() => scanFC(det.comPort));
    res.json({ ok: true, detection: det, fc });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---------- Safety token issue ----------
app.post('/api/safety/confirm', (req, res) => {
  const { action, propsOff, batteryOn, restrained, acknowledged, backupTaken } = req.body || {};
  if (!action) return res.status(400).json({ ok: false, error: 'missing action' });

  if (action.startsWith('motor.') || action === 'esc.interrogate') {
    // ESC interrogation is read-only but powers the ESCs from battery and can
    // twitch motors on reset — same physical posture as a motor test.
    if (!propsOff || !restrained) {
      return res.status(400).json({
        ok: false,
        error: 'Must confirm propsOff=true AND restrained=true before actuation token is issued.',
      });
    }
    if (!batteryOn) {
      return res.status(400).json({ ok: false, error: 'This action requires batteryOn=true confirmation.' });
    }
  } else if (action === 'config.write' || action === 'flash.write') {
    if (!acknowledged || !backupTaken) {
      return res.status(400).json({
        ok: false,
        error: 'This action requires acknowledged=true AND backupTaken=true (take a backup in the Config tab first).',
      });
    }
  } else if (action === 'sensor.calibrate') {
    // Accel calibration: harmless but writes calibration values. Quad must be
    // level and still — that's on the human.
    if (!acknowledged) {
      return res.status(400).json({ ok: false, error: 'Calibration requires acknowledged=true (quad level and still).' });
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
    const result = await serialOp(() => withCli(det.comPort, async ({ send }) => {
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
    const results = await serialOp(() => withCli(det.comPort, async ({ send }) => {
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

// ---------- ESC interrogation (BLHeli 4-way, read-only) ----------
app.post('/api/esc/interrogate', async (req, res) => {
  const { token } = req.body || {};
  if (!consumeToken(token, 'esc.interrogate')) {
    return res.status(403).json({ ok: false, error: 'invalid or missing safety token' });
  }
  const det = await detectFC();
  if (det.type !== 'ALIVE') return res.status(400).json({ ok: false, error: `no FC on USB (${det.type})` });

  try {
    const result = await serialOp(() => interrogateAll(det.comPort));
    store.appendHistory({ kind: 'esc.interrogate', ...result });
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---------- stack-forensic DB (read-only context) ----------
app.get('/api/forensic/status', (_req, res) => {
  res.json({ ok: true, ...forensic.getStatus() });
});

app.get('/api/forensic/units', (_req, res) => {
  res.json({ ok: true, units: forensic.listAllUnits() });
});

app.get('/api/forensic/unit/:mcuId', (req, res) => {
  const status = forensic.getStatus();
  if (!status.available) return res.json({ ok: true, available: false, record: null, hint: status.hint });
  const record = forensic.findUnitByMcuId(req.params.mcuId);
  res.json({ ok: true, available: true, record });
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

    const { boardName, diff } = await serialOp(() => withCli(det.comPort, async ({ send }) => {
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
    const output = await serialOp(() =>
      withCli(det.comPort, async ({ send }) => send(line, waitMs))
    );
    res.json({ ok: true, command: line, kind: cls.kind, output: output.trim() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Apply a batch of CLI commands in one session — the execution path for
// AI-proposed config changes after the human clicks Apply. Every line is
// re-validated here; one config.write token covers the batch.
app.post('/api/cli/batch', async (req, res) => {
  const { commands, token } = req.body || {};
  const list = Array.isArray(commands) ? commands.map(c => String(c).trim()).filter(Boolean) : [];
  if (list.length === 0) return res.status(400).json({ ok: false, error: 'commands must be a non-empty array' });
  if (list.length > 300) return res.status(400).json({ ok: false, error: 'max 300 commands per batch' });

  for (const line of list) {
    if (line.length > 200 || /[\r\n]/.test(line)) {
      return res.status(400).json({ ok: false, error: `invalid command line: ${line.slice(0, 50)}` });
    }
    const cls = classifyCliCommand(line);
    if (cls.kind === 'forbidden' || cls.kind === 'unknown' || cls.kind === 'invalid') {
      return res.status(403).json({ ok: false, error: `"${line}" is not allowed (${cls.kind})` });
    }
  }
  if (!consumeToken(token, 'config.write')) {
    return res.status(403).json({ ok: false, error: 'batch apply requires a config.write safety token' });
  }

  const det = await detectFC();
  if (det.type !== 'ALIVE') return res.status(400).json({ ok: false, error: `no FC on USB (${det.type})` });

  const savesLast = list[list.length - 1]?.toLowerCase() === 'save';
  try {
    let autoBackupId = null;
    const results = await serialOp(() => withCli(det.comPort, async ({ send }) => {
      // Safety net + config timeline: snapshot the config in the same CLI
      // session before any write lands, regardless of UI checkboxes.
      try {
        const diff = (await send('diff all', 8000)).trim();
        if (diff.length > 20) {
          autoBackupId = store.saveBackup(diff, { auto: true, reason: 'pre-write snapshot', comPort: det.comPort }).id;
        }
      } catch {}
      const out = [];
      for (const line of list) {
        // `save` reboots the FC and drops the port — tolerate a dead write.
        const output = await send(line, line.toLowerCase() === 'save' ? 1500 : 150).catch(() => '');
        out.push({ command: line, output: String(output).trim() });
      }
      return out;
    }));
    store.appendHistory({ kind: 'config.batch', commands: list.length, saved: savesLast, autoBackupId });
    res.json({ ok: true, results, saved: savesLast, autoBackupId });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Line-level diff between two backups — the config timeline's "what
// changed". Compares `set` lines plus everything else as raw lines.
app.get('/api/config/backups/:a/diff/:b', (req, res) => {
  const a = store.readBackup(req.params.a);
  const b = store.readBackup(req.params.b);
  if (a == null || b == null) return res.status(404).json({ ok: false, error: 'backup not found' });

  const setsA = parseSetLines(a);
  const setsB = parseSetLines(b);
  const changed = [];
  const removed = [];
  const added = [];
  for (const [k, v] of Object.entries(setsA)) {
    if (!(k in setsB)) removed.push({ key: k, value: v });
    else if (setsB[k] !== v) changed.push({ key: k, from: v, to: setsB[k] });
  }
  for (const [k, v] of Object.entries(setsB)) {
    if (!(k in setsA)) added.push({ key: k, value: v });
  }
  // Non-`set` lines (aux, serial, feature...) — set-difference both ways.
  const otherLines = (t) => new Set(t.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#') && !l.startsWith('set ')));
  const oa = otherLines(a), ob = otherLines(b);
  const otherRemoved = [...oa].filter(l => !ob.has(l));
  const otherAdded = [...ob].filter(l => !oa.has(l));

  res.json({ ok: true, from: req.params.a, to: req.params.b, changed, added, removed, otherAdded, otherRemoved });
});

// ---------- Firmware flash (backup-first, dfu-util, verify-after) ----------
const fsPromises = fs.promises;

app.get('/api/flash/status', async (_req, res) => {
  try {
    const dfuUtil = findDfuUtil();
    const detection = await detectFC();
    const backups = store.listBackups();
    res.json({
      ok: true,
      dfuUtil,
      detection,
      firmwares: store.listFirmwares(),
      latestBackup: backups[0] || null,
      dfuDevices: dfuUtil.found && detection.type === 'DFU' ? listDfuDevices(dfuUtil.path) : [],
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Body is the raw .hex text (content-type text/plain), name via query param.
app.post('/api/flash/upload', express.text({ limit: '32mb', type: () => true }), (req, res) => {
  const name = String(req.query.name || 'firmware.hex');
  const text = typeof req.body === 'string' ? req.body : '';
  if (!text.trim()) return res.status(400).json({ ok: false, error: 'empty upload' });
  try {
    const parsed = parseIntelHex(text);
    const meta = {
      baseAddress: parsed.baseAddressHex,
      totalBytes: parsed.totalBytes,
      dataBytes: parsed.dataBytes,
    };
    const { name: savedName } = store.saveFirmware(name, text, meta);
    res.json({ ok: true, name: savedName, ...meta });
  } catch (e) {
    res.status(400).json({ ok: false, error: `not a valid Intel HEX file: ${e.message}` });
  }
});

// Firmware releases (online, optional). Sources: Betaflight and INAV GitHub
// releases. Cached per source; fails soft when offline — the Flash tab falls
// back to local .hex upload.
const RELEASE_SOURCES = {
  betaflight: 'betaflight/betaflight',
  inav: 'iNavFlight/inav',
};
const releasesCache = {}; // src -> { at, data }
app.get('/api/flash/releases', async (req, res) => {
  const src = String(req.query.src || 'betaflight').toLowerCase();
  const repo = RELEASE_SOURCES[src];
  if (!repo) return res.status(400).json({ ok: false, error: `unknown source: ${src}` });
  try {
    const cached = releasesCache[src];
    if (!cached || Date.now() - cached.at > 10 * 60 * 1000) {
      const r = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=6`, {
        headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'sageflight' },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) throw new Error(`GitHub API: ${r.status}`);
      const raw = await r.json();
      releasesCache[src] = {
        at: Date.now(),
        data: raw.filter(rel => !rel.draft).map(rel => ({
          tag: rel.tag_name,
          name: rel.name,
          prerelease: rel.prerelease,
          assets: (rel.assets || [])
            .filter(a => a.name.endsWith('.hex'))
            .map(a => ({ name: a.name, url: a.browser_download_url, sizeKb: Math.round(a.size / 1024) })),
        })),
      };
    }
    res.json({ ok: true, online: true, source: src, releases: releasesCache[src].data });
  } catch (e) {
    res.json({ ok: true, online: false, source: src, error: e.message, releases: [] });
  }
});

// Download a release asset server-side and stage it. Locked to official
// Betaflight/INAV GitHub releases so this can't fetch arbitrary URLs.
app.post('/api/flash/fetch', async (req, res) => {
  const { url, name } = req.body || {};
  if (!/^https:\/\/github\.com\/(betaflight\/betaflight|iNavFlight\/inav)\/releases\/download\//.test(String(url))) {
    return res.status(400).json({ ok: false, error: 'only official Betaflight/INAV release assets can be fetched' });
  }
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!r.ok) throw new Error(`download failed: ${r.status}`);
    const text = await r.text();
    const parsed = parseIntelHex(text);
    const meta = { baseAddress: parsed.baseAddressHex, totalBytes: parsed.totalBytes, dataBytes: parsed.dataBytes, source: url };
    const { name: savedName } = store.saveFirmware(name || url.split('/').pop(), text, meta);
    res.json({ ok: true, name: savedName, ...meta });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---------- Cloud build (build.betaflight.com — custom firmware) ----------
const cloudBuild = require('../lib/cloud-build');

let cloudTargetsCache = { at: 0, data: null };

app.get('/api/flash/cloud/targets', async (_req, res) => {
  try {
    if (!cloudTargetsCache.data || Date.now() - cloudTargetsCache.at > 30 * 60 * 1000) {
      cloudTargetsCache = { at: Date.now(), data: await cloudBuild.fetchTargets() };
    }
    res.json({ ok: true, online: true, targets: cloudTargetsCache.data });
  } catch (e) {
    res.json({ ok: true, online: false, error: e.message, targets: [] });
  }
});

app.get('/api/flash/cloud/releases', async (req, res) => {
  const target = String(req.query.target || '');
  if (!target) return res.status(400).json({ ok: false, error: 'missing target' });
  try {
    const detail = await cloudBuild.fetchTargetReleases(target);
    res.json({ ok: true, online: true, ...detail });
  } catch (e) {
    res.json({ ok: true, online: false, error: e.message, releases: [] });
  }
});

app.get('/api/flash/cloud/options', async (req, res) => {
  const release = String(req.query.release || '');
  if (!release) return res.status(400).json({ ok: false, error: 'missing release' });
  try {
    res.json({ ok: true, online: true, options: await cloudBuild.fetchOptions(release) });
  } catch (e) {
    res.json({ ok: true, online: false, error: e.message, options: null });
  }
});

// Submit a cloud build, poll to completion, stage the resulting hex into the
// firmware store (same place uploads/release fetches land). SSE progress.
// No hardware is touched here — flashing stays behind /api/flash/run.
app.post('/api/flash/cloud/build', async (req, res) => {
  const { target, release, selections = {} } = req.body || {};
  sseHeaders(res);
  try {
    const request = cloudBuild.assembleBuildRequest(String(target || ''), String(release || ''), selections);
    sseSend(res, { stage: 'request', msg: `Options: ${request.options.join(', ')}` });
    const result = await cloudBuild.runCloudBuild(request, (ev) => sseSend(res, { stage: ev.phase, msg: ev.msg }));

    const parsed = parseIntelHex(result.hexText);
    const meta = {
      baseAddress: parsed.baseAddressHex,
      totalBytes: parsed.totalBytes,
      dataBytes: parsed.dataBytes,
      source: `cloud-build ${target}@${release}`,
      buildKey: result.key,
      buildLog: result.logUrl,
      buildOptions: request.options,
    };
    const { name } = store.saveFirmware(result.file, result.hexText, meta);
    store.appendHistory({ kind: 'flash.cloudbuild', target, release, options: request.options.length, firmware: name });
    sseSend(res, { done: true, name, logUrl: result.logUrl, ...meta });
    res.end();
  } catch (e) {
    sseSend(res, { error: e.message });
    res.end();
  }
});

// The full guarded flash sequence, streamed as SSE stages.
app.post('/api/flash/run', async (req, res) => {
  const { token, firmware } = req.body || {};
  sseHeaders(res);
  const stage = (name, msg) => sseSend(res, { stage: name, msg });
  const fail = (msg) => { sseSend(res, { error: msg }); res.end(); };

  if (!consumeToken(token, 'flash.write')) return fail('invalid or missing safety token');

  // 1. Preconditions: staged firmware + at least one config backup.
  const hexText = store.readFirmware(firmware);
  if (!hexText) return fail(`staged firmware "${firmware}" not found — upload it first`);
  const backups = store.listBackups();
  if (backups.length === 0) return fail('no config backup exists — take one in the Config tab before flashing');
  stage('preflight', `Using backup ${backups[0].id} as the pre-flash config record.`);

  const dfuUtil = findDfuUtil();
  if (!dfuUtil.found) return fail('dfu-util not found on PATH — install it (see Flash tab instructions) and retry');
  stage('preflight', `${dfuUtil.version}`);

  let parsed;
  try {
    parsed = parseIntelHex(hexText);
  } catch (e) {
    return fail(`firmware file failed re-validation: ${e.message}`);
  }
  const binPath = store.firmwareBinPath(firmware);
  await fsPromises.writeFile(binPath, parsed.image);
  stage('preflight', `Image: ${(parsed.totalBytes / 1024).toFixed(0)} KB at ${parsed.baseAddressHex}`);

  try {
    // 2. Get the board into DFU.
    let det = await detectFC();
    if (det.type === 'ALIVE') {
      stage('dfu', `Rebooting ${det.comPort} into DFU bootloader (CLI "bl")...`);
      await serialOp(() => enterDfu(det.comPort));
    } else if (det.type !== 'DFU') {
      return fail(`FC must be ALIVE or already in DFU mode (currently: ${det.type})`);
    }

    const dfuDeadline = Date.now() + 30000;
    let inDfu = det.type === 'DFU';
    while (!inDfu && Date.now() < dfuDeadline) {
      await new Promise(r => setTimeout(r, 1500));
      det = await detectFC();
      inDfu = det.type === 'DFU' || listDfuDevices(dfuUtil.path).length > 0;
    }
    if (!inDfu) return fail('FC did not enumerate in DFU mode within 30s. Unplug/replug while holding BOOT, then retry.');
    stage('dfu', 'DFU bootloader detected.');

    const devices = listDfuDevices(dfuUtil.path);
    const uniqueIds = [...new Set(devices.map(d => `${d.vid}:${d.pid}`))];
    if (uniqueIds.length > 1) {
      return fail(`multiple DFU devices attached (${uniqueIds.join(', ')}) — unplug the others and retry`);
    }

    // 3. Flash.
    stage('flash', 'Writing firmware — do NOT unplug...');
    const { code } = await flashWithDfuUtil(dfuUtil.path, binPath, parsed.baseAddress,
      line => sseSend(res, { stage: 'flash', msg: line }));
    if (code !== 0) {
      store.appendHistory({ kind: 'flash.run', firmware, ok: false, exitCode: code });
      return fail(`dfu-util exited with code ${code} — firmware may not have been written. Check the log above.`);
    }
    stage('flash', 'dfu-util finished OK. FC should reboot into the new firmware.');

    // 4. Verify: wait for the FC to come back, then scan it.
    stage('verify', 'Waiting for FC to re-enumerate...');
    const aliveDeadline = Date.now() + 60000;
    let back = null;
    while (Date.now() < aliveDeadline) {
      await new Promise(r => setTimeout(r, 2000));
      const d = await detectFC();
      if (d.type === 'ALIVE') { back = d; break; }
    }
    if (!back) {
      store.appendHistory({ kind: 'flash.run', firmware, ok: true, verified: false });
      sseSend(res, { done: true, verified: false, warning: 'Flash completed but the FC has not re-enumerated within 60s. Unplug and replug USB, then Detect.' });
      return res.end();
    }

    stage('verify', `FC back on ${back.comPort} — reading identity...`);
    const fc = await serialOp(() => scanFC(back.comPort));
    const { rawStatus, rawDiff, ...summary } = fc;
    store.appendHistory({ kind: 'flash.run', firmware, ok: true, verified: true, boardName: fc.boardName, firmwareVersion: fc.firmware });
    sseSend(res, { done: true, verified: true, fc: summary });
    res.end();
  } catch (e) {
    store.appendHistory({ kind: 'flash.run', firmware, ok: false, error: e.message });
    fail(e.message);
  }
});

// Replay a saved config backup onto the FC line-by-line, then `save`.
// This is the post-flash restore path. Requires a config.write token.
app.post('/api/config/restore', async (req, res) => {
  const { token, backupId } = req.body || {};
  sseHeaders(res);
  const fail = (msg) => { sseSend(res, { error: msg }); res.end(); };

  if (!consumeToken(token, 'config.write')) return fail('invalid or missing config.write safety token');
  const content = store.readBackup(backupId);
  if (content == null) return fail(`backup "${backupId}" not found`);

  const lines = content.split('\n')
    .map(l => l.replace(/\r$/, ''))
    .filter(l => l.trim() && !l.trim().startsWith('#'))
    .filter(l => l.trim().toLowerCase() !== 'save'); // we issue save ourselves, once
  if (lines.length === 0) return fail('backup contains no applicable lines');
  if (lines.length > 2000) return fail('backup is implausibly large — refusing to replay');

  const det = await detectFC();
  if (det.type !== 'ALIVE') return fail(`no FC on USB (${det.type})`);

  try {
    await serialOp(() => withCli(det.comPort, async ({ send }) => {
      sseSend(res, { stage: 'restore', msg: `Replaying ${lines.length} config lines from ${backupId}...` });
      for (let i = 0; i < lines.length; i++) {
        await send(lines[i], 120);
        if ((i + 1) % 25 === 0 || i === lines.length - 1) {
          sseSend(res, { stage: 'restore', msg: `${i + 1}/${lines.length} lines applied` });
        }
      }
      sseSend(res, { stage: 'restore', msg: 'Saving — FC will reboot.' });
      await send('save', 1500).catch(() => {}); // port drops as the FC reboots
    }));
    store.appendHistory({ kind: 'config.restore', backupId, lines: lines.length });
    sseSend(res, { done: true, lines: lines.length });
    res.end();
  } catch (e) {
    fail(e.message);
  }
});

// ---------- RAG (local docs grounding for the AI) ----------
const rag = require('../lib/rag');
const EMBED_MODEL = 'nomic-embed-text';
const DOCS_REPO = 'betaflight/betaflight.com';
let ragIndexCache = null; // reload lazily after builds

async function embedTexts(texts) {
  const r = await fetch(OLLAMA_HOST + '/api/embed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, input: texts }),
    signal: AbortSignal.timeout(120000),
  });
  if (!r.ok) throw new Error(`Ollama embed: ${r.status} ${(await r.text()).slice(0, 150)}`);
  const data = await r.json();
  return data.embeddings;
}

async function searchDocs(query, k = 4) {
  if (!ragIndexCache) ragIndexCache = rag.loadIndex();
  if (!ragIndexCache) return null;
  const [qe] = await embedTexts([query]);
  return rag.search(ragIndexCache, qe, k);
}

app.get('/api/rag/status', (_req, res) => {
  res.json({ ok: true, ...rag.indexStatus() });
});

// Build the docs index: fetch official Betaflight docs from GitHub, chunk,
// embed locally. Needs internet + Ollama once; afterwards fully offline.
app.post('/api/rag/build', async (_req, res) => {
  sseHeaders(res);
  const stage = (msg) => sseSend(res, { stage: 'build', msg });
  try {
    // Verify the embedding model is available before a long fetch.
    const tags = await (await fetch(OLLAMA_HOST + '/api/tags', { signal: AbortSignal.timeout(3000) })).json();
    if (!(tags.models || []).some(m => m.name.startsWith(EMBED_MODEL))) {
      throw new Error(`embedding model missing — run: ollama pull ${EMBED_MODEL}`);
    }

    stage(`Listing docs in ${DOCS_REPO}...`);
    const tree = await (await fetch(`https://api.github.com/repos/${DOCS_REPO}/git/trees/HEAD?recursive=1`, {
      headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'sageflight' },
      signal: AbortSignal.timeout(15000),
    })).json();
    const files = (tree.tree || [])
      .filter(f => f.type === 'blob' && /^docs\/.*\.(md|mdx)$/.test(f.path) && !/\/(archive|development)\//.test(f.path))
      .slice(0, 250);
    if (files.length === 0) throw new Error('no docs found — GitHub API unreachable or repo layout changed');
    stage(`${files.length} docs files. Fetching + chunking...`);

    const chunks = [];
    let fetched = 0;
    for (const f of files) {
      try {
        const raw = await (await fetch(`https://raw.githubusercontent.com/${DOCS_REPO}/HEAD/${f.path}`, {
          signal: AbortSignal.timeout(15000),
        })).text();
        for (const c of rag.chunkMarkdown(rag.cleanDoc(raw))) {
          chunks.push({ source: f.path.replace(/^docs\//, ''), ...c });
        }
      } catch {}
      if (++fetched % 40 === 0) stage(`${fetched}/${files.length} files fetched, ${chunks.length} chunks so far`);
    }
    stage(`Embedding ${chunks.length} chunks with ${EMBED_MODEL} (local)...`);

    for (let i = 0; i < chunks.length; i += 24) {
      const batch = chunks.slice(i, i + 24);
      const embeddings = await embedTexts(batch.map(c => `${c.heading}\n${c.text}`.slice(0, 2000)));
      batch.forEach((c, j) => { c.embedding = embeddings[j]; });
      if ((i / 24) % 10 === 0) stage(`embedded ${Math.min(i + 24, chunks.length)}/${chunks.length}`);
    }

    rag.saveIndex({ builtAt: new Date().toISOString(), model: EMBED_MODEL, sources: DOCS_REPO, chunks });
    ragIndexCache = null;
    sseSend(res, { done: true, chunks: chunks.length });
    res.end();
  } catch (e) {
    sseSend(res, { error: e.message });
    res.end();
  }
});

// ---------- Tune (PIDs / rates / filters editor) ----------
// Read via CLI `dump` (includes defaults, unlike diff); write path is the
// existing token-gated /api/cli/batch — this endpoint is read-only.
app.get('/api/tune', async (_req, res) => {
  const det = await detectFC();
  if (det.type !== 'ALIVE') return res.status(400).json({ ok: false, error: `no FC on USB (${det.type})` });
  try {
    const dump = await serialOp(() => withCli(det.comPort, async ({ send }) => send('dump', 9000)));
    const settings = parseSetLines(dump);
    if (Object.keys(settings).length < 10) {
      return res.status(500).json({ ok: false, error: 'dump returned too little data — FC may not be in a healthy CLI state' });
    }
    res.json({ ok: true, groups: extractTune(settings) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// AI sanity-check of current + pending tune values — streamed markdown.
app.post('/api/tune/review', async (req, res) => {
  const { groups = [], changes = {}, model = 'llama3.2:3b' } = req.body || {};
  sseHeaders(res);
  const prompt = [
    'You are an expert FPV tuner. Review this Betaflight tune.',
    '',
    'Current values by group:',
    JSON.stringify(groups).slice(0, 8000),
    '',
    Object.keys(changes).length
      ? `The user is about to change these values (key: new value):\n${JSON.stringify(changes)}`
      : 'No pending changes — review the current state.',
    '',
    'Answer concisely: 1) anything out-of-family or dangerous (filters too low, D too high, RPM filter without bidir dshot), 2) whether the pending changes are sensible, 3) up to 3 concrete `set` suggestions. If it all looks sane, say so briefly.',
  ].join('\n');

  try {
    const r = await fetch(OLLAMA_HOST + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], stream: true }),
    });
    if (!r.ok || !r.body) throw new Error(`Ollama: ${r.status}`);
    const reader = r.body.getReader();
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

// ---------- OSD (element layout editor) ----------
const osd = require('../lib/osd');

app.get('/api/osd', async (_req, res) => {
  const det = await detectFC();
  if (det.type !== 'ALIVE') return res.status(400).json({ ok: false, error: `no FC on USB (${det.type})` });
  try {
    const dump = await serialOp(() => withCli(det.comPort, async ({ send }) => send('dump', 9000)));
    const settings = parseSetLines(dump);
    const elements = osd.extractOsdElements(settings);
    if (elements.length === 0) return res.status(422).json({ ok: false, error: 'no OSD elements found — OSD may be disabled in this firmware build' });
    res.json({ ok: true, canvas: osd.canvasFromSettings(settings), elements });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---------- Power & battery calibration values ----------
const POWER_KEYS = [
  'vbat_scale', 'vbat_divider', 'vbat_multiplier',
  'ibata_scale', 'ibata_offset',
  'vbat_max_cell_voltage', 'vbat_min_cell_voltage', 'vbat_warning_cell_voltage',
  'force_battery_cell_count', 'current_meter', 'battery_meter',
];

app.get('/api/power', async (_req, res) => {
  const det = await detectFC();
  if (det.type !== 'ALIVE') return res.status(400).json({ ok: false, error: `no FC on USB (${det.type})` });
  try {
    const dump = await serialOp(() => withCli(det.comPort, async ({ send }) => send('dump', 9000)));
    const settings = parseSetLines(dump);
    const values = {};
    for (const k of POWER_KEYS) if (k in settings) values[k] = settings[k];
    res.json({ ok: true, values });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---------- Ports (UART function assignment) ----------
app.get('/api/ports/config', async (_req, res) => {
  const det = await detectFC();
  if (det.type !== 'ALIVE') return res.status(400).json({ ok: false, error: `no FC on USB (${det.type})` });
  try {
    const out = await serialOp(() => withCli(det.comPort, async ({ send }) => send('serial', 2000)));
    res.json({ ok: true, ports: parseSerialLines(out) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---------- VTX table + channel/power settings ----------
const vtxLib = require('../lib/vtx');

app.get('/api/vtx', async (_req, res) => {
  const det = await detectFC();
  if (det.type !== 'ALIVE') return res.status(400).json({ ok: false, error: `no FC on USB (${det.type})` });
  try {
    const { tableRaw, getRaw } = await serialOp(() => withCli(det.comPort, async ({ send }) => {
      const tableRaw = await send('vtxtable', 2500);
      const getRaw = await send('get vtx', 2500);
      return { tableRaw, getRaw };
    }));
    const table = vtxLib.parseVtxTable(tableRaw);
    const settings = vtxLib.extractVtxSettings(vtxLib.parseGetLines(getRaw));
    res.json({ ok: true, table, settings });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---------- Failsafe (stage 1 rxfail + stage 2 procedure + GPS Rescue) ----------
app.get('/api/failsafe', async (_req, res) => {
  const det = await detectFC();
  if (det.type !== 'ALIVE') return res.status(400).json({ ok: false, error: `no FC on USB (${det.type})` });
  try {
    const { dump, rxfailRaw } = await serialOp(() => withCli(det.comPort, async ({ send }) => {
      const dump = await send('dump', 9000);
      const rxfailRaw = await send('rxfail', 2000);
      return { dump, rxfailRaw };
    }));
    const settings = parseSetLines(dump);
    const groups = FAILSAFE_GROUPS.map(g => ({
      group: g.group, label: g.label, values: extractKeys(settings, g.keys),
    })).filter(g => Object.keys(g.values).length > 0);
    // Prefer the dedicated command output; fall back to rxfail lines in dump
    // for firmware that doesn't echo the full table.
    let rxfail = parseRxfailLines(rxfailRaw);
    if (rxfail.length === 0) rxfail = parseRxfailLines(dump);
    res.json({ ok: true, groups, rxfail });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---------- GPS receiver configuration ----------
app.get('/api/gps/config', async (_req, res) => {
  const det = await detectFC();
  if (det.type !== 'ALIVE') return res.status(400).json({ ok: false, error: `no FC on USB (${det.type})` });
  try {
    const dump = await serialOp(() => withCli(det.comPort, async ({ send }) => send('dump', 9000)));
    const settings = parseSetLines(dump);
    const values = extractKeys(settings, GPS_KEYS);
    const featureLine = dump.match(/^feature (-?GPS)\s*$/m)?.[1] || null;
    res.json({ ok: true, values, gpsFeature: featureLine !== null ? featureLine === 'GPS' : null });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---------- cots-catalog (hardware spec lookups, read-only) ----------
app.get('/api/catalog/status', (_req, res) => {
  res.json({ ok: true, ...catalog.catalogStatus() });
});

app.post('/api/catalog/fetch', async (_req, res) => {
  try {
    const saved = await catalog.fetchCatalog();
    res.json({ ok: true, saved, ...catalog.catalogStatus() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/catalog/search', (req, res) => {
  const { catalog: cat } = catalog.loadCatalog();
  if (!cat) return res.json({ ok: true, available: false, results: [] });
  res.json({ ok: true, available: true, results: catalog.searchParts(cat, req.query.q || '', 8) });
});

// ---------- Betaflight community presets ----------
let presetsIndexCache = { at: 0, data: null };

async function getPresetsIndex() {
  if (!presetsIndexCache.data || Date.now() - presetsIndexCache.at > 30 * 60 * 1000) {
    const r = await fetch(presets.INDEX_URL, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`presets index: ${r.status}`);
    presetsIndexCache = { at: Date.now(), data: await r.json() };
  }
  return presetsIndexCache.data;
}

app.get('/api/presets', async (req, res) => {
  try {
    const index = await getPresetsIndex();
    const results = presets.filterIndex(index, {
      query: req.query.q || '',
      category: req.query.category || '',
      firmware: req.query.firmware || '',
    }).slice(0, 60);
    res.json({ ok: true, online: true, results });
  } catch (e) {
    res.json({ ok: true, online: false, error: e.message, results: [] });
  }
});

app.get('/api/presets/file', async (req, res) => {
  const p = String(req.query.path || '');
  if (!/^[\w\-./]+\.txt$/.test(p) || p.includes('..')) {
    return res.status(400).json({ ok: false, error: 'invalid preset path' });
  }
  try {
    const r = await fetch(presets.RAW_BASE + p, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`preset fetch: ${r.status}`);
    const text = await r.text();
    const parsed = presets.parsePreset(text);
    res.json({ ok: true, path: p, raw: text, ...parsed });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---------- Modes (aux switch ranges) ----------
app.get('/api/modes', async (_req, res) => {
  const det = await detectFC();
  if (det.type !== 'ALIVE') return res.status(400).json({ ok: false, error: `no FC on USB (${det.type})` });
  try {
    const out = await serialOp(() => withCli(det.comPort, async ({ send }) => send('aux', 2000)));
    res.json({ ok: true, slots: parseAuxLines(out) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---------- Sensor calibration ----------
app.post('/api/calibrate/acc', async (req, res) => {
  const { token } = req.body || {};
  if (!consumeToken(token, 'sensor.calibrate')) {
    return res.status(403).json({ ok: false, error: 'invalid or missing safety token' });
  }
  const det = await detectFC();
  if (det.type !== 'ALIVE') return res.status(400).json({ ok: false, error: `no FC on USB (${det.type})` });
  try {
    await serialOp(() => mspOneShot(det.comPort, MSP_CMD.ACC_CALIBRATION));
    // FC needs a moment to settle the calibration before further traffic.
    await new Promise(r => setTimeout(r, 2500));
    store.appendHistory({ kind: 'calibrate.acc' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---------- Loadout (COTS-Architect bridge) ----------
const loadoutLib = require('../lib/loadout');

app.post('/api/loadout', (req, res) => {
  const v = loadoutLib.validateLoadout(req.body);
  if (!v.ok) return res.status(400).json({ ok: false, error: 'invalid loadout', errors: v.errors });
  store.saveLoadout(req.body);
  res.json({ ok: true, summary: loadoutLib.summarizeLoadout(req.body) });
});

app.get('/api/loadout', (_req, res) => {
  const loadout = store.readLoadout();
  res.json({ ok: true, loadout, summary: loadoutLib.summarizeLoadout(loadout) });
});

app.delete('/api/loadout', (_req, res) => {
  store.clearLoadout();
  res.json({ ok: true });
});

// As-designed vs. as-built. The client sends its last scan (it owns that
// state); the last ESC interrogation comes from server-side history.
app.post('/api/loadout/verify', (req, res) => {
  const loadout = store.readLoadout();
  if (!loadout) return res.status(400).json({ ok: false, error: 'no loadout imported' });
  const escScan = store.readHistory(200).find(h => h.kind === 'esc.interrogate') || null;
  const result = loadoutLib.verifyAgainstBench(loadout, { scan: req.body?.scan || null, escScan });
  res.json({ ok: true, loadout: loadoutLib.summarizeLoadout(loadout), ...result });
});

// ---------- Blackbox (header/settings + frame-level flight analysis) ----------
const { parseHeaders, selectTuningSettings } = require('../lib/blackbox-header');
const { analyzeBuffer, metricsForLlm } = require('../lib/blackbox-analyze');

// Frame-level analysis: gyro noise spectra, motor stats. CPU-bound for a few
// seconds on big logs; results are computed on demand.
app.get('/api/blackbox/analyze/:name', (req, res) => {
  const buf = store.readBlackbox(req.params.name);
  if (!buf) return res.status(404).json({ ok: false, error: 'log not found' });
  try {
    const analysis = analyzeBuffer(buf);
    res.json({ ok: true, analysis });
  } catch (e) {
    res.status(422).json({ ok: false, error: `frame decode failed: ${e.message}` });
  }
});

app.post('/api/blackbox/upload', express.raw({ limit: '128mb', type: () => true }), (req, res) => {
  const name = String(req.query.name || 'log.bbl');
  const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  if (buf.length === 0) return res.status(400).json({ ok: false, error: 'empty upload' });
  const parsed = parseHeaders(buf);
  if (!parsed) return res.status(400).json({ ok: false, error: 'no blackbox headers found — is this a .bbl/.bfl log?' });
  const meta = {
    firmware: parsed.firmware,
    board: parsed.board,
    craft: parsed.craft,
    logCount: parsed.logCount,
  };
  const { name: savedName } = store.saveBlackbox(name, buf, meta);
  res.json({ ok: true, name: savedName, ...meta, tuning: selectTuningSettings(parsed.settings) });
});

app.get('/api/blackbox/logs', (_req, res) => {
  res.json({ ok: true, logs: store.listBlackboxes() });
});

app.get('/api/blackbox/logs/:name', (req, res) => {
  const buf = store.readBlackbox(req.params.name);
  if (!buf) return res.status(404).json({ ok: false, error: 'log not found' });
  const parsed = parseHeaders(buf);
  if (!parsed) return res.status(500).json({ ok: false, error: 'could not parse headers' });
  const { settings, ...summary } = parsed;
  res.json({ ok: true, ...summary, tuning: selectTuningSettings(settings) });
});

// AI tune review from the log's embedded settings — streamed like chat.
app.post('/api/blackbox/review', async (req, res) => {
  const { name, model = 'llama3.1:8b' } = req.body || {};
  sseHeaders(res);
  const buf = store.readBlackbox(name);
  if (!buf) { sseSend(res, { error: 'log not found' }); return res.end(); }
  const parsed = parseHeaders(buf);
  if (!parsed) { sseSend(res, { error: 'could not parse headers' }); return res.end(); }

  const tuning = selectTuningSettings(parsed.settings);
  // Include measured flight data when the frame decoder can read this log.
  let measured = null;
  try { measured = metricsForLlm(analyzeBuffer(buf)); } catch {}

  const prompt = [
    'Review this Betaflight tune from a blackbox log. You are an expert FPV tuner.',
    `Firmware: ${parsed.firmware || 'unknown'} · Board: ${parsed.board || 'unknown'} · Craft: ${parsed.craft || 'unnamed'}`,
    '',
    'Tuning state at time of flight (key:value):',
    JSON.stringify(tuning, null, 1).slice(0, 10000),
    '',
    measured
      ? 'MEASURED flight data from decoding the log frames (gyro noise in deg/s, spectral peaks in Hz, motor outputs, per-axis step response, noise-vs-throttle):\n' +
        JSON.stringify(measured, null, 1).slice(0, 8000)
      : 'No frame-level data available for this log (decoder could not read it) — review settings only and say so.',
    '',
    'Give a structured review:',
    '1. **Noise** — interpret the gyro spectral peaks and band RMS: frame resonance (~80-150Hz)? motor noise tracking? Use noiseVsThrottle: a dominant frequency that climbs with throttle is motor/prop noise (RPM filter territory); constant-frequency energy is frame resonance. Is filtering matched to the measured noise, or is there headroom to reduce filter delay?',
    '2. **Step response** — riseMs is the 10→90% rise, steadyState 1.0 = perfect tracking, overshootPct >15-20% means too much P (or too little D); riseMs > ~60ms means sluggish gains or heavy filtering. Compare axes.',
    '3. **Motors** — imbalance between motor averages (mechanical issue on the high one), saturation percentage.',
    '4. **Filters & PIDs vs the measurements** — concrete conflicts (e.g. dyn notch range missing a measured peak, RPM filter off with strong motor peaks, step overshoot with high P/D ratio).',
    '5. **Top 3 concrete suggestions** — exact `set x = y` lines, most impactful first, justified by the measurements.',
    'Be direct and cite the measured numbers. If the flight looks clean, say so.',
  ].join('\n');

  try {
    const r = await fetch(OLLAMA_HOST + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], stream: true }),
    });
    if (!r.ok || !r.body) throw new Error(`Ollama: ${r.status}`);
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buf2 = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf2 += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf2.indexOf('\n')) !== -1) {
        const line = buf2.slice(0, nl).trim();
        buf2 = buf2.slice(nl + 1);
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

// ---------- AI config migration (old firmware diff → new firmware) ----------
// Community pain point: pasting an old `diff all` into new firmware silently
// drops renamed parameters (e.g. filter settings), which can burn motors.
// The LLM translates the old diff for the target version; every returned
// line is re-validated, and application still requires human approval +
// a config.write token via /api/cli/batch.
app.post('/api/config/migrate', async (req, res) => {
  const { backupId, model = 'llama3.1:8b', targetVersion = 'unknown' } = req.body || {};
  const content = store.readBackup(backupId);
  if (content == null) return res.status(404).json({ ok: false, error: `backup "${backupId}" not found` });

  const oldVersionLine = content.split('\n').find(l => /# Betaflight/i.test(l)) || 'unknown';

  const prompt = [
    'You are migrating a Betaflight configuration between firmware versions.',
    `OLD firmware header: ${oldVersionLine.trim()}`,
    `TARGET firmware version: Betaflight ${targetVersion}`,
    '',
    'Translate the old `diff all` below into commands that are SAFE to replay on the target version:',
    '- Keep settings whose parameter names are unchanged on the target version.',
    '- Rename parameters that were renamed between the versions.',
    '- DROP parameters that were removed or that you are not sure still exist — list each dropped line in notes with a one-line reason.',
    '- Always keep: board/serial/aux/feature/map lines, PIDs, rates.',
    '- Never emit destructive commands (defaults, flash_erase, motor, dfu, bl).',
    '- The final command must be exactly: save',
    '',
    'Respond with ONLY valid JSON: {"commands": ["...", ...], "notes": ["...", ...]}',
    '',
    'OLD DIFF:',
    '```',
    content.slice(0, 24000),
    '```',
  ].join('\n');

  try {
    const r = await fetch(OLLAMA_HOST + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        format: 'json',
        options: { temperature: 0.1 },
      }),
      signal: AbortSignal.timeout(180000),
    });
    if (!r.ok) throw new Error(`Ollama: ${r.status} ${(await r.text()).slice(0, 200)}`);
    const data = await r.json();
    let parsed;
    try { parsed = JSON.parse(data.message?.content || '{}'); }
    catch { throw new Error('model returned invalid JSON — try a larger model'); }

    const notes = Array.isArray(parsed.notes) ? parsed.notes.map(String) : [];
    const commands = [];
    const rejected = [];
    for (const raw of Array.isArray(parsed.commands) ? parsed.commands : []) {
      const line = String(raw).trim();
      if (!line || line.startsWith('#')) continue;
      const cls = classifyCliCommand(line);
      if (cls.kind === 'forbidden' || cls.kind === 'unknown' || cls.kind === 'invalid') rejected.push(line);
      else commands.push(line);
    }
    if (commands.length === 0) throw new Error('model produced no valid commands');
    if (commands[commands.length - 1].toLowerCase() !== 'save') commands.push('save');

    res.json({
      ok: true,
      backupId,
      oldVersion: oldVersionLine.trim(),
      targetVersion,
      commands,
      notes,
      rejected,
      warning: 'AI-translated config. Review every line before applying — especially filter and PID settings.',
    });
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
  runExclusive: serialOp,
  store,
  forensic,
  connection: conn,
  searchDocs,
  searchCatalog: (query) => {
    const { catalog: cat } = catalog.loadCatalog();
    return cat ? catalog.searchParts(cat, query, 5) : null;
  },
});

const MAX_AGENT_ROUNDS = 6;

app.post('/api/agent/chat', async (req, res) => {
  const { model = 'llama3.1:8b', messages = [] } = req.body || {};
  sseHeaders(res);

  const convo = [
    { role: 'system', content: readSystemPrompt() +
      '\n\nYou have live tools: detect_fc, scan_fc, get_config_diff, get_motor_history, list_config_backups,' +
      ' get_forensic_record, list_forensic_units, get_last_esc_scan, get_live_telemetry, get_loadout,' +
      ' search_docs, search_catalog, propose_config_changes.' +
      ' Use them to look at the aircraft instead of asking the user for information a tool can fetch.' +
      ' For "why won\'t it arm" questions, call get_live_telemetry first — it decodes the arming-disable flags.' +
      ' Before answering questions about CLI settings, features, or procedures, call search_docs and ground your answer in what it returns.' +
      ' To change configuration, use propose_config_changes — the user reviews and approves the commands before they run.' +
      ' You can NOT spin motors or flash firmware — direct the user to the Motors/Flash tabs for that.' },
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
  console.log(`[sageflight] API server v${VERSION} on http://localhost:${PORT}`);
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[sageflight] Vite dev server on http://localhost:5173 (open this one)`);
  }
});
