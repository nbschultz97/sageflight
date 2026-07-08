// Official Betaflight community presets (betaflight/firmware-presets).
//
// A preset file is CLI text with `#$` metadata directives. Optional blocks:
//   #$ OPTION BEGIN (UNCHECKED): Some option name
//   ...cli lines...
//   #$ OPTION END
// parsePreset() splits base lines from options so the UI can offer the same
// checkboxes the Betaflight Configurator preset dialog does. Applying a
// preset goes through the token-gated batch endpoint like every other write.

const PRESETS_REPO = 'betaflight/firmware-presets';
const INDEX_URL = `https://raw.githubusercontent.com/${PRESETS_REPO}/master/index.json`;
const RAW_BASE = `https://raw.githubusercontent.com/${PRESETS_REPO}/master/`;

// Pure — parse a preset file into base CLI lines + named option blocks.
function parsePreset(text) {
  const base = [];
  const options = [];
  let current = null;

  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    const begin = line.match(/^#\$\s*OPTION\s+BEGIN\s*\((CHECKED|UNCHECKED)\)\s*:\s*(.+)$/i);
    if (begin) {
      current = { name: begin[2].trim(), checkedByDefault: begin[1].toUpperCase() === 'CHECKED', lines: [] };
      continue;
    }
    if (/^#\$\s*OPTION\s+END/i.test(line)) {
      if (current) options.push(current);
      current = null;
      continue;
    }
    if (line.startsWith('#$')) continue;   // other metadata directives
    if (!line || line.startsWith('#')) continue; // comments / blanks
    (current ? current.lines : base).push(line);
  }
  if (current) options.push(current); // unterminated block — keep it visible

  return { base, options };
}

// Pure — final CLI lines for a preset given the user's option choices.
function buildPresetCommands(parsed, checkedNames = []) {
  const lines = [...parsed.base];
  for (const opt of parsed.options) {
    if (checkedNames.includes(opt.name)) lines.push(...opt.lines);
  }
  if (lines.length && lines[lines.length - 1].toLowerCase() !== 'save') lines.push('save');
  return lines;
}

// Pure — filter the repo index by search terms / category / firmware version.
function filterIndex(index, { query = '', category = '', firmware = '' } = {}) {
  const presets = index?.presets ? Object.values(index.presets) : [];
  const terms = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  return presets.filter(p => {
    if (p.hidden) return false;
    if (category && String(p.category || '').toLowerCase() !== String(category).toLowerCase()) return false;
    if (firmware && Array.isArray(p.firmware_version) && p.firmware_version.length) {
      const major = String(firmware).split('.').slice(0, 2).join('.');
      if (!p.firmware_version.some(v => String(v).startsWith(major))) return false;
    }
    if (terms.length) {
      const hay = [p.title, p.author, p.category, ...(p.keywords || [])].filter(Boolean).join(' ').toLowerCase();
      if (!terms.every(t => hay.includes(t))) return false;
    }
    return true;
  }).map(p => ({
    title: p.title, author: p.author, category: p.category,
    keywords: p.keywords || [], firmware: p.firmware_version || [],
    path: p.fullPath || p.path, official: !!p.official,
  }));
}

module.exports = { parsePreset, buildPresetCommands, filterIndex, INDEX_URL, RAW_BASE, PRESETS_REPO };
