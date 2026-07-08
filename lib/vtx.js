// VTX table + settings parsing/building — the data layer behind the VTX tab.
// Pure functions over Betaflight CLI output; no serial I/O here.
//
// `vtxtable` CLI output (BF 4.1+):
//   vtxtable bands 5
//   vtxtable channels 8
//   vtxtable band 1 BOSCAM_A A FACTORY 5865 5845 5825 5805 5785 5765 5745 5725
//   ...
//   vtxtable powerlevels 3
//   vtxtable powervalues 14 20 26
//   vtxtable powerlabels 25 100 400
//
// The table is device-specific: powervalues are SmartAudio dBm / Tramp mW
// codes the VTX firmware expects, not display numbers. Wrong tables transmit
// on illegal frequencies or wrong power — the UI warns accordingly.

// ---------- parsing ----------

function parseVtxTable(text) {
  const t = String(text || '');
  const num = (re) => {
    const m = t.match(re);
    return m ? parseInt(m[1], 10) : 0;
  };

  const bands = num(/^vtxtable bands (\d+)\s*$/m);
  const channels = num(/^vtxtable channels (\d+)\s*$/m);

  const bandRows = [];
  const bandRe = /^vtxtable band (\d+) (\S+) (\S) (FACTORY|CUSTOM)((?: +\d+)*)\s*$/gm;
  let m;
  while ((m = bandRe.exec(t)) !== null) {
    bandRows.push({
      index: +m[1],
      name: m[2],
      letter: m[3],
      factory: m[4] === 'FACTORY',
      frequencies: m[5].trim() ? m[5].trim().split(/\s+/).map(Number) : [],
    });
  }
  bandRows.sort((a, b) => a.index - b.index);

  const listOf = (re) => {
    const mm = t.match(re);
    return mm ? mm[1].trim().split(/\s+/) : [];
  };
  const powerLevels = num(/^vtxtable powerlevels (\d+)\s*$/m);
  const powerValues = listOf(/^vtxtable powervalues((?: +\d+)*)\s*$/m).map(Number);
  const powerLabels = listOf(/^vtxtable powerlabels((?: +\S+)*)\s*$/m);

  return {
    supported: /vtxtable/i.test(t) && !/unknown command/i.test(t),
    bands, channels, bandRows,
    powerLevels, powerValues, powerLabels,
  };
}

// Parse `get <prefix>` output — lines look like `vtx_band = 5`, each followed
// by range/default lines we ignore.
function parseGetLines(text) {
  const out = {};
  const re = /^([a-z0-9_]+) = (.+?)\s*$/gm;
  let m;
  while ((m = re.exec(String(text || ''))) !== null) out[m[1]] = m[2];
  return out;
}

const VTX_SETTINGS_KEYS = [
  'vtx_band', 'vtx_channel', 'vtx_power', 'vtx_freq',
  'vtx_pit_mode_freq', 'vtx_low_power_disarm',
];

function extractVtxSettings(settings) {
  const values = {};
  for (const k of VTX_SETTINGS_KEYS) if (k in settings) values[k] = settings[k];
  return values;
}

// ---------- validation ----------

function validateVtxTable(table) {
  const errors = [];
  const { bands, channels, bandRows, powerLevels, powerValues, powerLabels } = table;

  if (!(bands >= 1 && bands <= 8)) errors.push(`bands must be 1-8 (got ${bands})`);
  if (!(channels >= 1 && channels <= 8)) errors.push(`channels must be 1-8 (got ${channels})`);
  if (bandRows.length !== bands) errors.push(`expected ${bands} band rows, have ${bandRows.length}`);

  for (const row of bandRows) {
    const tag = `band ${row.index} (${row.name || '?'})`;
    if (!/^[A-Za-z0-9_#\-.]{1,8}$/.test(row.name || '')) errors.push(`${tag}: name must be 1-8 chars, no spaces`);
    if (!/^\S$/.test(row.letter || '')) errors.push(`${tag}: letter must be a single character`);
    if (row.frequencies.length !== channels) errors.push(`${tag}: needs exactly ${channels} frequencies`);
    for (const f of row.frequencies) {
      if (!(f === 0 || (f >= 4800 && f <= 6200))) errors.push(`${tag}: frequency ${f} out of range (0 or 4800-6200 MHz)`);
    }
  }

  if (!(powerLevels >= 1 && powerLevels <= 8)) errors.push(`powerlevels must be 1-8 (got ${powerLevels})`);
  if (powerValues.length !== powerLevels) errors.push(`powervalues: expected ${powerLevels} entries, have ${powerValues.length}`);
  if (powerLabels.length !== powerLevels) errors.push(`powerlabels: expected ${powerLevels} entries, have ${powerLabels.length}`);
  for (const v of powerValues) {
    if (!Number.isInteger(v) || v < 0 || v > 10000) errors.push(`powervalue ${v} out of range (0-10000)`);
  }
  for (const l of powerLabels) {
    if (!/^\S{1,3}$/.test(l || '')) errors.push(`powerlabel "${l}" must be 1-3 chars, no spaces (BF pads to 3)`);
  }
  return errors;
}

// ---------- command building ----------

// Emit the full table in dependency order: counts first (band/power lines are
// validated against them by the firmware), then rows, then a fresh `save` is
// appended by the caller.
function buildVtxTableCommands(table) {
  const cmds = [
    `vtxtable bands ${table.bands}`,
    `vtxtable channels ${table.channels}`,
  ];
  for (const row of table.bandRows) {
    cmds.push(
      `vtxtable band ${row.index} ${row.name} ${row.letter} ${row.factory ? 'FACTORY' : 'CUSTOM'} ${row.frequencies.join(' ')}`
    );
  }
  cmds.push(`vtxtable powerlevels ${table.powerLevels}`);
  cmds.push(`vtxtable powervalues ${table.powerValues.join(' ')}`);
  cmds.push(`vtxtable powerlabels ${table.powerLabels.join(' ')}`);
  return cmds;
}

module.exports = {
  parseVtxTable, parseGetLines, extractVtxSettings, VTX_SETTINGS_KEYS,
  validateVtxTable, buildVtxTableCommands,
};
