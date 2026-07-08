// Local file persistence: config backups + test history.
// Everything lives in <repo>/data — plain files, no database, greppable.

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.STACK_DATA_DIR || path.join(__dirname, '..', 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const FIRMWARE_DIR = path.join(DATA_DIR, 'firmware');
const BLACKBOX_DIR = path.join(DATA_DIR, 'blackbox');
const HISTORY_FILE = path.join(DATA_DIR, 'history.jsonl');

function ensureDirs() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  fs.mkdirSync(FIRMWARE_DIR, { recursive: true });
  fs.mkdirSync(BLACKBOX_DIR, { recursive: true });
}

function sanitizeId(id) {
  return String(id || '').replace(/[^a-zA-Z0-9._-]/g, '');
}

// ---------- Config backups ----------

function saveBackup(content, meta = {}) {
  ensureDirs();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const board = sanitizeId(meta.boardName || 'unknown-board');
  const id = `${stamp}_${board}`;
  fs.writeFileSync(path.join(BACKUP_DIR, `${id}.txt`), content, 'utf8');
  fs.writeFileSync(path.join(BACKUP_DIR, `${id}.json`), JSON.stringify({
    id,
    createdAt: new Date().toISOString(),
    bytes: Buffer.byteLength(content, 'utf8'),
    ...meta,
  }, null, 2), 'utf8');
  return { id };
}

function listBackups() {
  ensureDirs();
  return fs.readdirSync(BACKUP_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try { return JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, f), 'utf8')); }
      catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

function readBackup(id) {
  const safe = sanitizeId(id);
  const file = path.join(BACKUP_DIR, `${safe}.txt`);
  if (!safe || !fs.existsSync(file)) return null;
  return fs.readFileSync(file, 'utf8');
}

// ---------- Staged firmware files (for the Flash tab) ----------

function saveFirmware(name, hexText, meta = {}) {
  ensureDirs();
  const safe = sanitizeId(name).replace(/\.hex$/i, '') || 'firmware';
  fs.writeFileSync(path.join(FIRMWARE_DIR, `${safe}.hex`), hexText, 'utf8');
  fs.writeFileSync(path.join(FIRMWARE_DIR, `${safe}.json`), JSON.stringify({
    name: safe,
    uploadedAt: new Date().toISOString(),
    bytes: Buffer.byteLength(hexText, 'utf8'),
    ...meta,
  }, null, 2), 'utf8');
  return { name: safe };
}

function listFirmwares() {
  ensureDirs();
  return fs.readdirSync(FIRMWARE_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try { return JSON.parse(fs.readFileSync(path.join(FIRMWARE_DIR, f), 'utf8')); }
      catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => (b.uploadedAt || '').localeCompare(a.uploadedAt || ''));
}

function readFirmware(name) {
  const safe = sanitizeId(name);
  const file = path.join(FIRMWARE_DIR, `${safe}.hex`);
  if (!safe || !fs.existsSync(file)) return null;
  return fs.readFileSync(file, 'utf8');
}

function firmwareBinPath(name) {
  ensureDirs();
  return path.join(FIRMWARE_DIR, `${sanitizeId(name)}.bin`);
}

// ---------- Blackbox logs (for the Blackbox tab) ----------

function saveBlackbox(name, buf, meta = {}) {
  ensureDirs();
  const safe = sanitizeId(name).replace(/\.(bbl|bfl|txt)$/i, '') || 'log';
  fs.writeFileSync(path.join(BLACKBOX_DIR, `${safe}.bbl`), buf);
  fs.writeFileSync(path.join(BLACKBOX_DIR, `${safe}.json`), JSON.stringify({
    name: safe,
    uploadedAt: new Date().toISOString(),
    bytes: buf.length,
    ...meta,
  }, null, 2), 'utf8');
  return { name: safe };
}

function listBlackboxes() {
  ensureDirs();
  return fs.readdirSync(BLACKBOX_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try { return JSON.parse(fs.readFileSync(path.join(BLACKBOX_DIR, f), 'utf8')); }
      catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => (b.uploadedAt || '').localeCompare(a.uploadedAt || ''));
}

function readBlackbox(name) {
  const safe = sanitizeId(name);
  const file = path.join(BLACKBOX_DIR, `${safe}.bbl`);
  if (!safe || !fs.existsSync(file)) return null;
  return fs.readFileSync(file);
}

// ---------- Current loadout (imported from COTS-Architect) ----------

const LOADOUT_FILE = path.join(DATA_DIR, 'loadout.json');

function saveLoadout(loadout) {
  ensureDirs();
  fs.writeFileSync(LOADOUT_FILE, JSON.stringify({ importedAt: new Date().toISOString(), ...loadout }, null, 2), 'utf8');
}

function readLoadout() {
  try { return JSON.parse(fs.readFileSync(LOADOUT_FILE, 'utf8')); }
  catch { return null; }
}

function clearLoadout() {
  try { fs.unlinkSync(LOADOUT_FILE); } catch {}
}

// ---------- Test history (append-only JSONL) ----------

function appendHistory(entry) {
  ensureDirs();
  const rec = { at: new Date().toISOString(), ...entry };
  fs.appendFileSync(HISTORY_FILE, JSON.stringify(rec) + '\n', 'utf8');
  return rec;
}

function readHistory(limit = 50) {
  if (!fs.existsSync(HISTORY_FILE)) return [];
  const lines = fs.readFileSync(HISTORY_FILE, 'utf8').trim().split('\n').filter(Boolean);
  return lines
    .slice(-limit)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean)
    .reverse();
}

module.exports = {
  DATA_DIR, BACKUP_DIR, FIRMWARE_DIR, BLACKBOX_DIR, HISTORY_FILE,
  saveBackup, listBackups, readBackup,
  saveFirmware, listFirmwares, readFirmware, firmwareBinPath,
  saveBlackbox, listBlackboxes, readBlackbox,
  saveLoadout, readLoadout, clearLoadout,
  appendHistory, readHistory,
};
