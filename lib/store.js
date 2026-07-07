// Local file persistence: config backups + test history.
// Everything lives in <repo>/data — plain files, no database, greppable.

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.STACK_DATA_DIR || path.join(__dirname, '..', 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const FIRMWARE_DIR = path.join(DATA_DIR, 'firmware');
const HISTORY_FILE = path.join(DATA_DIR, 'history.jsonl');

function ensureDirs() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  fs.mkdirSync(FIRMWARE_DIR, { recursive: true });
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
  DATA_DIR, BACKUP_DIR, FIRMWARE_DIR, HISTORY_FILE,
  saveBackup, listBackups, readBackup,
  saveFirmware, listFirmwares, readFirmware, firmwareBinPath,
  appendHistory, readHistory,
};
