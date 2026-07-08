// Copies the server tree into desktop/bundle/ for packaging, preserving the
// repo-relative layout server.js expects (../lib, ../llm, ./dist).
// Run automatically by `npm run dist` (predist hook).

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const BUNDLE = path.join(__dirname, 'bundle');

const COPIES = [
  ['app/server.js', 'app/server.js'],
  ['app/dist', 'app/dist'],
  ['lib', 'lib'],
  ['llm', 'llm'],
];

fs.rmSync(BUNDLE, { recursive: true, force: true });

for (const [from, to] of COPIES) {
  const src = path.join(REPO, from);
  const dst = path.join(BUNDLE, to);
  if (!fs.existsSync(src)) {
    console.error(`[bundle] MISSING: ${src}` + (from === 'app/dist' ? ' — run `cd app && npm run build` first' : ''));
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.cpSync(src, dst, { recursive: true });
  console.log(`[bundle] ${from} -> bundle/${to}`);
}

console.log('[bundle] done');
