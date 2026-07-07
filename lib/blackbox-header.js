// Betaflight blackbox log header parsing (v1 — header/settings only).
//
// A .bbl/.bfl file starts every log with plain-text header lines of the form
// "H <key>:<value>" before the binary frame stream begins. Those headers
// embed the ENTIRE tuning state at the time of the flight — firmware, PIDs,
// rates, every filter setting. That alone supports a meaningful AI tune
// review (the community's PIDtoolbox-shaped hole) without decoding frames.
// Frame-level analysis (noise spectra, step response) is the roadmap step.

// Keys worth showing a human / feeding an LLM for a tune review.
const TUNING_KEY_RE = /pid|rate|filter|gyro|dterm|d_min|dyn_notch|rpm|tpa|ff_|feedforward|anti_gravity|thrust_linear|motor|dshot|vbat|looptime|debug_mode/i;

function parseHeaders(buf) {
  // Header lines are ASCII; binary frame data between logs won't match the
  // line regex, so a single text pass over the whole file is safe.
  const text = Buffer.isBuffer(buf) ? buf.toString('latin1') : String(buf || '');
  const settings = {};
  let logCount = 0;
  const re = /^H ([^:\r\n]+):(.*)$/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    const key = m[1].trim();
    const value = m[2].trim();
    if (key === 'Product') logCount++;
    // Multiple logs per file: last log's value wins, which is what a tune
    // review wants (the most recent flight).
    settings[key] = value;
  }
  if (Object.keys(settings).length === 0) return null;

  return {
    logCount: Math.max(1, logCount),
    firmware: settings['Firmware revision'] || null,
    board: settings['Board information'] || null,
    craft: settings['Craft name'] || null,
    dataVersion: settings['Data version'] || null,
    settings,
  };
}

// Reduce the full header map to tuning-relevant keys for LLM context.
function selectTuningSettings(settings) {
  const out = {};
  for (const [k, v] of Object.entries(settings || {})) {
    if (k.startsWith('Field ')) continue; // frame field definitions — noise
    if (TUNING_KEY_RE.test(k)) out[k] = v;
  }
  return out;
}

module.exports = { parseHeaders, selectTuningSettings };
