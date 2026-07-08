// Local RAG over the official Betaflight documentation — the anti-hallucination
// layer. Build once (needs internet), then fully offline: the docs corpus is
// chunked, embedded via Ollama (nomic-embed-text), and stored as a flat JSON
// index. At chat time the agent's search_docs tool retrieves the top chunks
// so answers cite real documentation instead of model memory.

const fs = require('fs');
const path = require('path');

// ---------- Pure helpers (unit-testable) ----------

// Chunk markdown, carrying the nearest heading as context. Greedy paragraph
// packing up to maxChars with light overlap between chunks.
function chunkMarkdown(text, { maxChars = 1400, minChars = 200 } = {}) {
  const chunks = [];
  let heading = '';
  let buf = '';

  const flush = () => {
    const t = buf.trim();
    if (t.length >= minChars) chunks.push({ heading, text: t });
    buf = '';
  };

  for (const block of String(text || '').split(/\n{2,}/)) {
    const h = block.match(/^#{1,4}\s+(.+)$/m);
    if (h && block.trim().startsWith('#')) {
      flush();
      heading = h[1].trim();
      continue;
    }
    if (buf.length + block.length > maxChars) flush();
    buf += (buf ? '\n\n' : '') + block.trim();
  }
  flush();
  return chunks;
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}

function search(index, queryEmbedding, k = 4) {
  if (!index?.chunks?.length || !queryEmbedding) return [];
  return index.chunks
    .map(c => ({ score: cosine(queryEmbedding, c.embedding), c }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map(({ score, c }) => ({ score: +score.toFixed(3), source: c.source, heading: c.heading, text: c.text }));
}

// Strip markdown/MDX noise that wastes embedding tokens.
function cleanDoc(text) {
  return String(text || '')
    .replace(/^---[\s\S]*?---\s*/m, '')          // frontmatter
    .replace(/^import .*$/gm, '')                 // MDX imports
    .replace(/<\/?[A-Z][a-zA-Z]*[^>]*>/g, '')     // JSX components
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')         // images
    .replace(/\n{3,}/g, '\n\n');
}

// ---------- Index persistence ----------

const DATA_DIR = process.env.STACK_DATA_DIR || path.join(__dirname, '..', 'data');
const INDEX_FILE = path.join(DATA_DIR, 'rag', 'index.json');

function loadIndex() {
  try { return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8')); }
  catch { return null; }
}

function saveIndex(index) {
  fs.mkdirSync(path.dirname(INDEX_FILE), { recursive: true });
  fs.writeFileSync(INDEX_FILE, JSON.stringify(index), 'utf8');
}

function indexStatus() {
  const idx = loadIndex();
  if (!idx) return { built: false };
  let sizeMb = null;
  try { sizeMb = +(fs.statSync(INDEX_FILE).size / 1024 / 1024).toFixed(1); } catch {}
  return { built: true, builtAt: idx.builtAt, chunks: idx.chunks?.length || 0, sources: idx.sources || null, embedModel: idx.model, sizeMb };
}

module.exports = { chunkMarkdown, cosine, search, cleanDoc, loadIndex, saveIndex, indexStatus, INDEX_FILE };
