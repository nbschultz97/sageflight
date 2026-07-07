// Read-only bridge into a local fc-forensic (stack-forensic) install.
//
// The forensic tool keeps per-batch JSON databases under
// <fc-forensic>/data/batches/<batch>/{units.json, escs.json, ...}. This module
// finds that install and surfaces its records as context — for the Detect tab
// (match the plugged-in FC by MCU id) and for the LLM agent tools. It NEVER
// writes to the forensic database; forensic defensibility stays intact.

const fs = require('fs');
const path = require('path');

// Directory names we probe when STACK_FORENSIC_DIR is not set — siblings of
// this repo, so the common layout `code/{stack-troubleshooter,fc-forensic}`
// works with zero configuration.
const SIBLING_NAMES = ['fc-forensic', 'stack-forensic'];

function looksLikeForensicInstall(dir) {
  return fs.existsSync(path.join(dir, 'data.template')) ||
         fs.existsSync(path.join(dir, 'data', 'batches'));
}

function resolveRoot() {
  const explicit = process.env.STACK_FORENSIC_DIR;
  if (explicit) {
    return fs.existsSync(explicit) ? path.resolve(explicit) : null;
  }
  const parent = path.join(__dirname, '..', '..');
  for (const name of SIBLING_NAMES) {
    const dir = path.join(parent, name);
    if (fs.existsSync(dir) && looksLikeForensicInstall(dir)) return dir;
  }
  return null;
}

function readJsonSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return null; }
}

function listBatches(root) {
  const batchesDir = path.join(root, 'data', 'batches');
  if (!fs.existsSync(batchesDir)) return [];
  return fs.readdirSync(batchesDir).filter(name => {
    try { return fs.statSync(path.join(batchesDir, name)).isDirectory(); }
    catch { return false; }
  });
}

function loadBatch(root, batch) {
  const dir = path.join(root, 'data', 'batches', batch);
  const units = readJsonSafe(path.join(dir, 'units.json')) || { units: [] };
  const escs = readJsonSafe(path.join(dir, 'escs.json')) || { escs: [] };
  return { batch, units: units.units || [], escs: escs.escs || [] };
}

function normalizeMcuId(id) {
  return String(id || '').toLowerCase().replace(/^0x/, '').replace(/[^a-f0-9]/g, '');
}

// Pure — unit-testable without a filesystem.
function findUnitInDb(units, mcuId) {
  const want = normalizeMcuId(mcuId);
  if (!want) return null;
  return (units || []).find(u => normalizeMcuId(u.mcuId) === want) || null;
}

// Collapse a forensic unit record to what a human (or a 7B model) needs.
// The full record embeds every historical scan — far too big for LLM context.
function summarizeUnit(unit) {
  if (!unit) return null;
  const { scans, ...rest } = unit;
  return {
    ...rest,
    scanCount: Array.isArray(scans) ? scans.length : 0,
    firstScanAt: Array.isArray(scans) && scans.length ? scans[0].timestamp : null,
    lastScanAt: Array.isArray(scans) && scans.length ? scans[scans.length - 1].timestamp : null,
  };
}

function summarizeEsc(esc) {
  if (!esc) return null;
  const { powered, electrical, ...rest } = esc;
  return {
    ...rest,
    stackStatus: powered?.stackStatus || null,
    slotsResponsive: powered?.slotsResponsive ?? null,
    signatures: powered?.uniqueSignatures || null,
    motorsMeasured: electrical?.motors?.length ?? 0,
  };
}

// Search every batch for a unit matching this MCU id. Returns the summary
// plus any ESC records linked to it.
function findUnitByMcuId(mcuId, root = resolveRoot()) {
  if (!root) return null;
  for (const batch of listBatches(root)) {
    const { units, escs } = loadBatch(root, batch);
    const unit = findUnitInDb(units, mcuId);
    if (unit) {
      const want = normalizeMcuId(mcuId);
      const linkedEscs = escs.filter(e =>
        normalizeMcuId(e.linkedFcMcuId) === want ||
        (unit.unitNumber != null && e.linkedFcUnitNumber === unit.unitNumber)
      );
      return { batch, unit: summarizeUnit(unit), linkedEscs: linkedEscs.map(summarizeEsc) };
    }
  }
  return null;
}

function listAllUnits(root = resolveRoot()) {
  if (!root) return [];
  const out = [];
  for (const batch of listBatches(root)) {
    const { units } = loadBatch(root, batch);
    for (const u of units) {
      const s = summarizeUnit(u);
      out.push({ batch, unitNumber: s.unitNumber, label: s.label, status: s.status, mcuId: s.mcuId, lastScanAt: s.lastScanAt });
    }
  }
  return out;
}

function getStatus(root = resolveRoot()) {
  if (!root) {
    return {
      available: false,
      root: null,
      hint: 'Set STACK_FORENSIC_DIR to your fc-forensic checkout, or clone it next to this repo.',
    };
  }
  const batches = listBatches(root).map(name => {
    const { units, escs } = loadBatch(root, name);
    return { name, units: units.length, escs: escs.length };
  });
  return { available: true, root, batches };
}

module.exports = {
  resolveRoot, listBatches, loadBatch,
  normalizeMcuId, findUnitInDb, summarizeUnit, summarizeEsc,
  findUnitByMcuId, listAllUnits, getStatus,
};
