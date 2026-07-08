// Pure parsers over Betaflight CLI output — the data layer behind the Tune
// and Modes editor tabs. No serial I/O here; fully unit-testable.

// ---------- `dump` / `diff` settings ----------

// Parse every `set name = value` line into a flat map.
function parseSetLines(text) {
  const out = {};
  const re = /^set ([a-z0-9_]+) = (.+?)\s*$/gm;
  let m;
  while ((m = re.exec(String(text || ''))) !== null) out[m[1]] = m[2];
  return out;
}

// Tuning surface shown in the Tune tab. Covers BF 4.4/4.5 names with 4.3-era
// fallbacks — only keys present on the connected firmware are displayed.
const TUNE_GROUPS = [
  {
    group: 'pids',
    label: 'PIDs (current profile)',
    keys: [
      'p_roll', 'i_roll', 'd_roll', 'd_min_roll', 'f_roll',
      'p_pitch', 'i_pitch', 'd_pitch', 'd_min_pitch', 'f_pitch',
      'p_yaw', 'i_yaw', 'd_yaw', 'd_min_yaw', 'f_yaw',
    ],
  },
  {
    group: 'rates',
    label: 'Rates (current rate profile)',
    keys: [
      'rates_type',
      'roll_rc_rate', 'pitch_rc_rate', 'yaw_rc_rate',
      'roll_expo', 'pitch_expo', 'yaw_expo',
      'roll_srate', 'pitch_srate', 'yaw_srate',
      'thr_mid', 'thr_expo',
    ],
  },
  {
    group: 'filters',
    label: 'Filters',
    keys: [
      // BF 4.4+
      'gyro_lpf1_static_hz', 'gyro_lpf2_static_hz',
      'gyro_lpf1_dyn_min_hz', 'gyro_lpf1_dyn_max_hz',
      'dterm_lpf1_static_hz', 'dterm_lpf2_static_hz',
      'dterm_lpf1_dyn_min_hz', 'dterm_lpf1_dyn_max_hz',
      // BF 4.3 and earlier names
      'gyro_lowpass_hz', 'gyro_lowpass2_hz', 'dterm_lowpass_hz', 'dterm_lowpass2_hz',
      // dynamic notch + RPM filter
      'dyn_notch_count', 'dyn_notch_q', 'dyn_notch_min_hz', 'dyn_notch_max_hz',
      'gyro_rpm_notch_harmonics', 'gyro_rpm_notch_q', 'gyro_rpm_notch_min_hz',
      'dshot_bidir',
    ],
  },
  {
    group: 'simplified',
    label: 'Simplified tuning',
    keys: [
      'simplified_pids_mode', 'simplified_master_multiplier', 'simplified_i_gain',
      'simplified_d_gain', 'simplified_pi_gain', 'simplified_dmin_ratio',
      'simplified_feedforward_gain', 'simplified_pitch_d_gain', 'simplified_pitch_pi_gain',
      'simplified_dterm_filter', 'simplified_dterm_filter_multiplier',
      'simplified_gyro_filter', 'simplified_gyro_filter_multiplier',
    ],
  },
];

// Reduce a full settings map to the tune surface: [{group, label, values: {key: value}}]
function extractTune(settings) {
  return TUNE_GROUPS.map(g => {
    const values = {};
    for (const k of g.keys) if (k in settings) values[k] = settings[k];
    return { group: g.group, label: g.label, values };
  }).filter(g => Object.keys(g.values).length > 0);
}

// ---------- `aux` mode ranges ----------

// Betaflight permanent box ids → human names (common subset; unknown ids
// render as BOX <id> rather than being hidden).
const BOX_NAMES = {
  0: 'ARM', 1: 'ANGLE', 2: 'HORIZON', 3: 'ANTI GRAVITY', 5: 'MAG',
  6: 'HEADFREE', 7: 'HEADADJ', 13: 'BEEPER', 15: 'LEDLOW',
  19: 'OSD DISABLE', 20: 'TELEMETRY', 26: 'BLACKBOX', 27: 'FAILSAFE',
  28: 'AIR MODE', 30: '3D DISABLE', 32: 'FPV ANGLE MIX', 33: 'BLACKBOX ERASE',
  34: 'CAMERA CONTROL 1', 35: 'CAMERA CONTROL 2', 36: 'CAMERA CONTROL 3',
  37: 'FLIP OVER AFTER CRASH', 38: 'PREARM', 39: 'BEEP GPS COUNT',
  40: 'VTX PIT MODE', 41: 'USER1', 42: 'USER2', 43: 'USER3', 44: 'USER4',
  45: 'PID AUDIO', 46: 'PARALYZE', 47: 'GPS RESCUE', 48: 'ACRO TRAINER',
  49: 'VTX CONTROL DISABLE', 50: 'LAUNCH CONTROL', 51: 'MSP OVERRIDE',
  52: 'STICK COMMANDS DISABLE', 53: 'BEEPER MUTE', 54: 'READY',
};

// Parse `aux` CLI output: aux <slot> <boxId> <auxCh> <start> <end> <logic> <linkedTo>
function parseAuxLines(text) {
  const slots = [];
  const re = /^aux (\d+) (\d+) (\d+) (\d+) (\d+)(?: (\d+))?(?: (\d+))?\s*$/gm;
  let m;
  while ((m = re.exec(String(text || ''))) !== null) {
    slots.push({
      slot: +m[1],
      boxId: +m[2],
      boxName: BOX_NAMES[+m[2]] ?? `BOX ${m[2]}`,
      auxChannel: +m[3],          // 0 = AUX1 (RC channel 5)
      start: +m[4],
      end: +m[5],
      logic: m[6] != null ? +m[6] : 0,
      linkedTo: m[7] != null ? +m[7] : 0,
      active: +m[4] < +m[5],      // start >= end means slot unused
    });
  }
  return slots;
}

function buildAuxCommand(s) {
  return `aux ${s.slot} ${s.boxId} ${s.auxChannel} ${s.start} ${s.end} ${s.logic || 0} ${s.linkedTo || 0}`;
}

// ---------- `serial` port configuration ----------

// Serial function bitmask (Betaflight serial.h serialPortFunction_e).
const SERIAL_FUNCTIONS = [
  { bit: 1, name: 'MSP' },
  { bit: 2, name: 'GPS' },
  { bit: 32, name: 'TELEMETRY SMARTPORT' },
  { bit: 64, name: 'SERIAL RX' },
  { bit: 128, name: 'BLACKBOX' },
  { bit: 512, name: 'TELEMETRY MAVLINK' },
  { bit: 1024, name: 'ESC SENSOR' },
  { bit: 2048, name: 'VTX SMARTAUDIO' },
  { bit: 4096, name: 'TELEMETRY IBUS' },
  { bit: 8192, name: 'VTX TRAMP' },
  { bit: 16384, name: 'RCDEVICE CAMERA' },
  { bit: 131072, name: 'VTX MSP / DJI' },
];

function portLabel(id) {
  if (id === 20) return 'USB VCP';
  if (id >= 30) return `SOFTSERIAL${id - 29}`;
  return `UART${id + 1}`;
}

// serial <id> <functionMask> <mspBaud> <gpsBaud> <telemetryBaud> <blackboxBaud>
function parseSerialLines(text) {
  const ports = [];
  const re = /^serial (\d+) (\d+) (\d+) (\d+) (\d+) (\d+)\s*$/gm;
  let m;
  while ((m = re.exec(String(text || ''))) !== null) {
    const id = +m[1];
    const mask = +m[2];
    ports.push({
      id,
      label: portLabel(id),
      mask,
      functions: SERIAL_FUNCTIONS.filter(f => mask & f.bit).map(f => f.name),
      unknownBits: mask & ~SERIAL_FUNCTIONS.reduce((a, f) => a | f.bit, 0),
      baud: { msp: +m[3], gps: +m[4], telemetry: +m[5], blackbox: +m[6] },
    });
  }
  return ports;
}

function buildSerialCommand(p) {
  return `serial ${p.id} ${p.mask} ${p.baud.msp} ${p.baud.gps} ${p.baud.telemetry} ${p.baud.blackbox}`;
}

module.exports = {
  parseSetLines, extractTune, TUNE_GROUPS,
  parseAuxLines, buildAuxCommand, BOX_NAMES,
  parseSerialLines, buildSerialCommand, SERIAL_FUNCTIONS, portLabel,
};
