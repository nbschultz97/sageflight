// cots-catalog bridge — read-only hardware-spec lookups for the AI and UI.
//
// Same loose-coupling rule as every Ceradon integration: Sageflight works
// fully without the catalog. Sources, in priority order:
//   1. COTS_CATALOG_PATH env var (a parts_library.json or a checkout dir)
//   2. a sibling cots-catalog checkout
//   3. a copy downloaded once into data/catalog/ (public GitHub repo)

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.STACK_DATA_DIR || path.join(__dirname, '..', 'data');
const LOCAL_COPY = path.join(DATA_DIR, 'catalog', 'parts_library.json');
const CATALOG_URL = 'https://raw.githubusercontent.com/nbschultz97/cots-catalog/HEAD/data/parts_library.json';

function candidatePaths() {
  const cands = [];
  const env = process.env.COTS_CATALOG_PATH;
  if (env) {
    cands.push(env.endsWith('.json') ? env : path.join(env, 'data', 'parts_library.json'));
  }
  cands.push(path.join(__dirname, '..', '..', 'cots-catalog', 'data', 'parts_library.json'));
  cands.push(LOCAL_COPY);
  return cands;
}

function loadCatalog() {
  for (const p of candidatePaths()) {
    try { return { catalog: JSON.parse(fs.readFileSync(p, 'utf8')), source: p }; }
    catch {}
  }
  return { catalog: null, source: null };
}

async function fetchCatalog() {
  const r = await fetch(CATALOG_URL, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`catalog download failed: ${r.status}`);
  const text = await r.text();
  JSON.parse(text); // validate before writing
  fs.mkdirSync(path.dirname(LOCAL_COPY), { recursive: true });
  fs.writeFileSync(LOCAL_COPY, text, 'utf8');
  return LOCAL_COPY;
}

// Flatten category arrays into [{category, ...part}]. Pure.
function flattenParts(catalog) {
  const out = [];
  for (const [key, val] of Object.entries(catalog || {})) {
    if (!Array.isArray(val)) continue;
    for (const part of val) {
      if (part && typeof part === 'object' && (part.name || part.id)) {
        out.push({ category: key, ...part });
      }
    }
  }
  return out;
}

// Keyword search with simple field-weighted scoring. Pure.
function searchParts(catalog, query, k = 5) {
  const terms = String(query || '').toLowerCase().split(/\s+/).filter(t => t.length > 1);
  if (terms.length === 0) return [];
  const scored = [];
  for (const part of flattenParts(catalog)) {
    const name = String(part.name || '').toLowerCase();
    const strong = [part.id, part.part_number, part.manufacturer, part.category, ...(part.tags || [])]
      .filter(Boolean).join(' ').toLowerCase();
    const weak = JSON.stringify(part).toLowerCase();
    let score = 0;
    for (const t of terms) {
      if (name.includes(t)) score += 5;
      if (strong.includes(t)) score += 3;
      else if (weak.includes(t)) score += 1;
    }
    if (score > 0) scored.push({ score, part });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, k).map(s => s.part);
}

function catalogStatus() {
  const { catalog, source } = loadCatalog();
  if (!catalog) return { available: false, hint: 'Set COTS_CATALOG_PATH, clone cots-catalog next to this repo, or fetch a copy (POST /api/catalog/fetch).' };
  const counts = {};
  for (const [key, val] of Object.entries(catalog)) {
    if (Array.isArray(val)) counts[key] = val.length;
  }
  return { available: true, source, name: catalog.meta?.name || null, updated: catalog.meta?.lastUpdated || null, counts };
}

module.exports = { loadCatalog, fetchCatalog, flattenParts, searchParts, catalogStatus, CATALOG_URL };
