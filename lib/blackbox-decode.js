// Betaflight blackbox binary frame decoder (v2 — implemented from the
// published format spec: betaflight/blackbox-log-viewer "Blackbox Internals").
//
// The log header defines, per field: name, signedness, predictor, and
// encoding for I (intra) and P (inter) frames. This decoder follows those
// definitions, so it adapts to whatever fields the firmware logged.
//
// Scope: main I/P frames plus S (slow) frames; E (event) frames are parsed
// enough to skip or end cleanly; G/H (GPS) frames are skipped by resync.
// On corruption it resyncs to the next plausible frame and reports decode
// coverage, so partial logs still analyze. EXPERIMENTAL until validated
// against a broad set of real logs — coverage stats are surfaced to the UI.

// ---------- Bit-level readers ----------

class Stream {
  constructor(buf, start = 0, end = buf.length) {
    this.buf = buf;
    this.pos = start;
    this.end = end;
  }
  get eof() { return this.pos >= this.end; }
  byte() {
    if (this.pos >= this.end) throw new Error('EOF');
    return this.buf[this.pos++];
  }
  peek() { return this.pos < this.end ? this.buf[this.pos] : -1; }

  // Unsigned variable-byte: 7 bits per byte, high bit = continuation.
  uvb() {
    let result = 0, shift = 0;
    for (let i = 0; i < 5; i++) {
      const b = this.byte();
      result |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) return result >>> 0;
      shift += 7;
    }
    throw new Error('uvb too long');
  }

  // Signed VB: zigzag over uvb.
  svb() {
    const u = this.uvb();
    return (u >>> 1) ^ -(u & 1);
  }
}

// Sign-extend helpers for the tag encodings.
const signExtend = (v, bits) => (v << (32 - bits)) >> (32 - bits);

// ---------- Field encodings (per spec ids) ----------
const ENC = {
  SIGNED_VB: 0,
  UNSIGNED_VB: 1,
  NEG_14BIT: 3,
  TAG8_8SVB: 6,
  TAG2_3S32: 7,
  TAG8_4S16: 8,
  NULL: 9,
};

// Decode a run of fields that may include group encodings (which consume
// several fields at once). Returns array of raw (pre-predictor) values.
function decodeFieldBlock(stream, encodings) {
  const values = new Array(encodings.length).fill(0);
  let i = 0;
  while (i < encodings.length) {
    const enc = encodings[i];
    switch (enc) {
      case ENC.SIGNED_VB: values[i++] = stream.svb(); break;
      case ENC.UNSIGNED_VB: values[i++] = stream.uvb(); break;
      case ENC.NEG_14BIT: values[i++] = -signExtend(stream.uvb(), 14); break;
      case ENC.NULL: values[i++] = 0; break;

      case ENC.TAG8_8SVB: {
        // Group of up to 8 fields with this encoding: header byte has one
        // bit per field; set bit → signed VB follows, clear → 0.
        let count = 0;
        while (count < 8 && i + count < encodings.length && encodings[i + count] === ENC.TAG8_8SVB) count++;
        if (count === 1) {
          values[i++] = stream.svb();
        } else {
          const tag = stream.byte();
          for (let j = 0; j < count; j++) {
            values[i + j] = (tag & (1 << j)) ? stream.svb() : 0;
          }
          i += count;
        }
        break;
      }

      case ENC.TAG2_3S32: {
        // 3 fields; leading 2-bit selector in a header byte.
        const lead = stream.byte();
        const sel = lead >> 6;
        const out = [0, 0, 0];
        if (sel === 0) {           // 3 × 2-bit in the same byte
          out[0] = signExtend((lead >> 4) & 3, 2);
          out[1] = signExtend((lead >> 2) & 3, 2);
          out[2] = signExtend(lead & 3, 2);
        } else if (sel === 1) {    // 3 × 4-bit: low nibble + next byte
          out[0] = signExtend(lead & 0x0f, 4);
          const b = stream.byte();
          out[1] = signExtend(b >> 4, 4);
          out[2] = signExtend(b & 0x0f, 4);
        } else if (sel === 2) {    // 3 × 6-bit: low 6 of lead + 2 bytes
          out[0] = signExtend(lead & 0x3f, 6);
          out[1] = signExtend(stream.byte() & 0x3f, 6);
          out[2] = signExtend(stream.byte() & 0x3f, 6);
        } else {                   // per-value 2-bit sizes in lead byte
          for (let j = 0; j < 3; j++) {
            const size = (lead >> (4 - j * 2)) & 3;
            if (size === 0) { out[j] = signExtend(stream.byte(), 8); }
            else if (size === 1) { const a = stream.byte(), b = stream.byte(); out[j] = signExtend(a | (b << 8), 16); }
            else if (size === 2) { let v = 0; for (let k = 0; k < 3; k++) v |= stream.byte() << (8 * k); out[j] = signExtend(v, 24); }
            else { let v = 0; for (let k = 0; k < 4; k++) v |= stream.byte() << (8 * k); out[j] = v | 0; }
          }
        }
        for (let j = 0; j < 3 && i < encodings.length; j++) values[i++] = out[j];
        break;
      }

      case ENC.TAG8_4S16: {
        // 4 fields; tag byte gives 2-bit size per field (0,4/8,16 variants).
        const tag = stream.byte();
        for (let j = 0; j < 4 && i < encodings.length; j++) {
          const size = (tag >> (j * 2)) & 3;
          if (size === 0) values[i++] = 0;
          else if (size === 1) values[i++] = signExtend(stream.byte(), 8);   // v2: 8-bit
          else if (size === 2) { const a = stream.byte(), b = stream.byte(); values[i++] = signExtend(a | (b << 8), 16); }
          else { const a = stream.byte(), b = stream.byte(); values[i++] = signExtend(a | (b << 8), 16); }
        }
        break;
      }

      default:
        throw new Error(`unsupported encoding ${enc}`);
    }
  }
  return values;
}

// ---------- Predictors (per spec ids) ----------
const PRED = {
  ZERO: 0, PREVIOUS: 1, STRAIGHT_LINE: 2, AVERAGE_2: 3,
  MINTHROTTLE: 4, MOTOR_0: 5, INCREMENT: 6, HOME_COORD: 7,
  P1500: 8, VBATREF: 9, LAST_MAIN_FRAME_TIME: 10, MINMOTOR: 11,
};

function applyPredictor(pred, raw, ctx, fieldIndex) {
  switch (pred) {
    case PRED.ZERO: return raw;
    case PRED.PREVIOUS: return raw + (ctx.prev ? ctx.prev[fieldIndex] : 0);
    case PRED.STRAIGHT_LINE:
      return raw + (ctx.prev && ctx.prev2 ? 2 * ctx.prev[fieldIndex] - ctx.prev2[fieldIndex] : (ctx.prev ? ctx.prev[fieldIndex] : 0));
    case PRED.AVERAGE_2:
      return raw + (ctx.prev && ctx.prev2 ? ((ctx.prev[fieldIndex] + ctx.prev2[fieldIndex]) / 2) | 0 : (ctx.prev ? ctx.prev[fieldIndex] : 0));
    case PRED.MINTHROTTLE: return raw + ctx.minthrottle;
    case PRED.MOTOR_0: return raw + ctx.currentMotor0;
    case PRED.INCREMENT: return raw + (ctx.prev ? ctx.prev[fieldIndex] : 0) + ctx.frameIncrement;
    case PRED.P1500: return raw + 1500;
    case PRED.VBATREF: return raw + ctx.vbatref;
    case PRED.MINMOTOR: return raw + ctx.minmotor;
    default: return raw; // unknown predictor — keep raw, better than dying
  }
}

// ---------- Header parsing ----------

function parseCsvNumbers(s) { return String(s || '').split(',').map(v => +v.trim()); }
function parseCsvNames(s) { return String(s || '').split(',').map(v => v.trim()); }

// Parse "0x3089705f" hex-encoded IEEE754 float (gyro_scale).
function parseHexFloat(s) {
  const m = String(s || '').match(/^0x([0-9a-f]{8})$/i);
  if (!m) { const f = parseFloat(s); return Number.isFinite(f) ? f : null; }
  const buf = Buffer.alloc(4);
  buf.writeUInt32BE(parseInt(m[1], 16), 0);
  return buf.readFloatBE(0);
}

// Locate each log in the file (a file can hold several flights) and pull the
// header key/values for the LAST complete log, plus the binary region after
// its headers.
const LOG_MARKER = Buffer.from('H Product:Blackbox flight data recorder', 'latin1');

function findLogs(buf) {
  const starts = [];
  let idx = 0;
  while ((idx = buf.indexOf(LOG_MARKER, idx)) !== -1) { starts.push(idx); idx += LOG_MARKER.length; }
  return starts.map((s, i) => ({ start: s, end: i + 1 < starts.length ? starts[i + 1] : buf.length }));
}

function parseLogHeaders(buf, region) {
  const headers = {};
  let pos = region.start;
  while (pos < region.end) {
    if (buf[pos] !== 0x48 /* 'H' */ || buf[pos + 1] !== 0x20) break;
    let nl = buf.indexOf(0x0a, pos);
    if (nl === -1 || nl > region.end) nl = region.end;
    const line = buf.slice(pos + 2, nl).toString('latin1').replace(/\r$/, '');
    const ci = line.indexOf(':');
    if (ci > 0) headers[line.slice(0, ci).trim()] = line.slice(ci + 1).trim();
    pos = nl + 1;
  }
  return { headers, dataStart: pos };
}

// ---------- Main decode ----------

function decodeLog(buf, { maxFrames = 400000 } = {}) {
  const logs = findLogs(buf);
  if (logs.length === 0) throw new Error('no blackbox logs in file');
  const region = logs[logs.length - 1]; // analyze the most recent flight

  const { headers, dataStart } = parseLogHeaders(buf, region);
  const names = parseCsvNames(headers['Field I name']);
  if (!names.length || !headers['Field I encoding']) throw new Error('missing main frame field definitions');

  const iEnc = parseCsvNumbers(headers['Field I encoding']);
  const iPred = parseCsvNumbers(headers['Field I predictor']);
  const pEnc = parseCsvNumbers(headers['Field P encoding'] || headers['Field I encoding']);
  const pPred = parseCsvNumbers(headers['Field P predictor'] || headers['Field I predictor']);

  const sNames = headers['Field S name'] ? parseCsvNames(headers['Field S name']) : [];
  const sEnc = headers['Field S encoding'] ? parseCsvNumbers(headers['Field S encoding']) : [];
  const sPred = headers['Field S predictor'] ? parseCsvNumbers(headers['Field S predictor']) : [];

  const ctx = {
    minthrottle: +(headers.minthrottle || 1000),
    minmotor: +(headers.motorOutput?.split(',')[0] || headers.minthrottle || 1000),
    vbatref: +(headers.vbatref || 0),
    frameIncrement: (() => {
      // "P interval:1/2" → a P frame advances loopIteration by denom/num.
      const m = String(headers['P interval'] || '1/1').match(/(\d+)\/(\d+)/);
      return m ? Math.max(1, Math.round(+m[2] / +m[1])) : 1;
    })(),
    currentMotor0: 0,
    prev: null,
    prev2: null,
  };

  const motor0Index = names.indexOf('motor[0]');
  const stream = new Stream(buf, dataStart, region.end);
  const frames = [];
  let badBytes = 0;
  let ended = false;

  const decodeMain = (enc, pred) => {
    const raw = decodeFieldBlock(stream, enc);
    const out = new Array(raw.length);
    // motor[0] must be resolved before fields with MOTOR_0 predictor.
    if (motor0Index >= 0) {
      out[motor0Index] = applyPredictor(pred[motor0Index], raw[motor0Index], ctx, motor0Index);
      ctx.currentMotor0 = out[motor0Index];
    }
    for (let i = 0; i < raw.length; i++) {
      if (i === motor0Index) continue;
      out[i] = applyPredictor(pred[i], raw[i], ctx, i);
    }
    return out;
  };

  while (!stream.eof && frames.length < maxFrames && !ended) {
    const framePos = stream.pos;
    const type = stream.byte();
    try {
      switch (type) {
        case 0x49: { // 'I'
          const saved = { prev: ctx.prev, prev2: ctx.prev2 };
          ctx.prev = null; ctx.prev2 = null; // I frames are absolute
          const vals = decodeMain(iEnc, iPred.map(p => (p === PRED.PREVIOUS || p === PRED.STRAIGHT_LINE || p === PRED.AVERAGE_2 || p === PRED.INCREMENT) ? PRED.ZERO : p));
          void saved;
          frames.push(vals);
          ctx.prev2 = ctx.prev = vals;
          break;
        }
        case 0x50: { // 'P'
          if (!ctx.prev) throw new Error('P before I');
          const vals = decodeMain(pEnc, pPred);
          frames.push(vals);
          ctx.prev2 = ctx.prev;
          ctx.prev = vals;
          break;
        }
        case 0x53: { // 'S' slow frame — decode to keep stream aligned
          if (sEnc.length) decodeFieldBlock(stream, sEnc);
          void sPred; void sNames;
          break;
        }
        case 0x45: { // 'E' event
          const event = stream.byte();
          if (event === 255) {
            // "End of log" ASCII marker follows
            ended = true;
          } else if (event === 0 || event === 30) {
            stream.uvb(); if (event === 30) stream.uvb();
          } else if (event === 13) {
            const flags = stream.byte();
            stream.svb();
            if (flags & 0x80) stream.uvb();
          } else if (event === 10) { // disarm
            stream.uvb();
          } else if (event === 15) { // flight mode
            stream.uvb(); stream.uvb();
          } else {
            throw new Error(`unknown event ${event}`);
          }
          break;
        }
        case 0x47: case 0x48: // 'G'/'H' GPS frames — not field-defined here
          throw new Error('gps frame');
        default:
          throw new Error('bad frame byte');
      }
    } catch {
      // Corruption or unsupported frame: resync to the next candidate frame
      // start after this position.
      stream.pos = framePos + 1;
      while (!stream.eof) {
        const b = stream.peek();
        if (b === 0x49 || b === 0x45 || b === 0x53 || b === 0x50) break;
        stream.pos++;
        badBytes++;
      }
      // After resync only an I frame can safely re-anchor P prediction.
      ctx.prev = null; ctx.prev2 = null;
      if (stream.peek() === 0x50) { stream.pos++; badBytes++; continue; }
    }
  }

  const totalBytes = region.end - dataStart;
  return {
    headers,
    fieldNames: names,
    frames,
    stats: {
      frames: frames.length,
      badBytes,
      coverage: totalBytes > 0 ? +(1 - badBytes / totalBytes).toFixed(3) : 0,
      logsInFile: logs.length,
    },
  };
}

// Extract named columns as arrays, plus derived timing.
function extractSeries(decoded) {
  const { fieldNames, frames, headers } = decoded;
  const col = (name) => {
    const i = fieldNames.indexOf(name);
    return i >= 0 ? frames.map(f => f[i]) : null;
  };
  const time = col('time');
  let sampleRateHz = null;
  if (time && time.length > 100) {
    const deltas = [];
    for (let i = 1; i < Math.min(time.length, 2000); i++) {
      const d = time[i] - time[i - 1];
      if (d > 0 && d < 100000) deltas.push(d);
    }
    deltas.sort((a, b) => a - b);
    const median = deltas[Math.floor(deltas.length / 2)];
    if (median > 0) sampleRateHz = Math.round(1e6 / median);
  }
  const gyroScale = parseHexFloat(headers.gyro_scale);
  const gyro = [0, 1, 2].map(a => col(`gyroADC[${a}]`));
  // gyro_scale converts raw to rad/s (spec); present on BF logs.
  const gyroDeg = gyro.map(g => g && gyroScale
    ? g.map(v => v * gyroScale * (180 / Math.PI))
    : g);

  return {
    sampleRateHz,
    durationSec: time && time.length > 1 ? +((time[time.length - 1] - time[0]) / 1e6).toFixed(1) : null,
    time,
    gyro: gyroDeg,
    setpoint: [0, 1, 2].map(a => col(`setpoint[${a}]`)),
    motors: [0, 1, 2, 3].map(m => col(`motor[${m}]`)),
    rcCommandThrottle: col('rcCommand[3]'),
  };
}

module.exports = { decodeLog, extractSeries, decodeFieldBlock, applyPredictor, parseHexFloat, Stream, ENC, PRED };
