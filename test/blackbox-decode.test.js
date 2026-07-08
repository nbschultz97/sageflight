const { test } = require('node:test');
const assert = require('node:assert/strict');
const { decodeLog, decodeFieldBlock, parseHexFloat, Stream, ENC } = require('../lib/blackbox-decode');
const { fftRadix2, welchSpectrum, findPeaks } = require('../lib/dsp');

// ---------- encoding helpers (synthetic encoder for round-trip tests) ----------

function encodeUvb(v) {
  const out = [];
  let u = v >>> 0;
  do { out.push((u & 0x7f) | (u > 0x7f ? 0x80 : 0)); u >>>= 7; } while (u);
  return out;
}
function encodeSvb(v) {
  return encodeUvb((v << 1) ^ (v >> 31));
}

test('uvb/svb round-trip through the Stream reader', () => {
  for (const v of [0, 1, 127, 128, 300, 100000]) {
    const s = new Stream(Buffer.from(encodeUvb(v)));
    assert.equal(s.uvb(), v);
  }
  for (const v of [0, 1, -1, 63, -64, 5000, -123456]) {
    const s = new Stream(Buffer.from(encodeSvb(v)));
    assert.equal(s.svb(), v);
  }
});

test('TAG8_8SVB group: tag bit set → signed VB, clear → zero', () => {
  // 4 grouped fields, values [5, 0, -3, 0] → tag bits 0b0101
  const bytes = [0b0101, ...encodeSvb(5), ...encodeSvb(-3)];
  const vals = decodeFieldBlock(new Stream(Buffer.from(bytes)), [ENC.TAG8_8SVB, ENC.TAG8_8SVB, ENC.TAG8_8SVB, ENC.TAG8_8SVB]);
  assert.deepEqual(vals, [5, 0, -3, 0]);
});

test('TAG2_3S32 selector 0 packs three 2-bit values in one byte', () => {
  // sel=0, values 1, -2, 0 → bits: 01 10 00
  const lead = (0 << 6) | (0b01 << 4) | (0b10 << 2) | 0b00;
  const vals = decodeFieldBlock(new Stream(Buffer.from([lead])), [ENC.TAG2_3S32, ENC.TAG2_3S32, ENC.TAG2_3S32]);
  assert.deepEqual(vals, [1, -2, 0]);
});

test('NEG_14BIT decodes as negated 14-bit value', () => {
  const vals = decodeFieldBlock(new Stream(Buffer.from(encodeUvb(100))), [ENC.NEG_14BIT]);
  assert.deepEqual(vals, [-100]);
});

test('parseHexFloat reads hex-encoded IEEE754 floats', () => {
  assert.equal(parseHexFloat('0x3f800000'), 1);
  assert.ok(Math.abs(parseHexFloat('0x40490fdb') - Math.PI) < 1e-6);
  assert.equal(parseHexFloat('1.5'), 1.5);
});

// ---------- full log round-trip ----------

const FIELD_NAMES = 'loopIteration,time,axisP[0],gyroADC[0],gyroADC[1],gyroADC[2],motor[0],motor[1]';

function buildLog(frameCount = 40) {
  const header = [
    'H Product:Blackbox flight data recorder by Nicholas Sherlock',
    'H Data version:2',
    'H Firmware revision:Betaflight 4.5.0 (test) SYNTH',
    `H Field I name:${FIELD_NAMES}`,
    'H Field I signed:0,0,1,1,1,1,0,1',
    'H Field I predictor:0,0,0,0,0,0,4,5',
    'H Field I encoding:1,1,0,0,0,0,1,0',
    'H Field P predictor:6,1,1,1,1,1,1,1',
    'H Field P encoding:1,0,0,0,0,0,0,0',
    'H P interval:1/1',
    'H minthrottle:1000',
    '',
  ].join('\n');

  const bytes = [];
  const push = (arr) => bytes.push(...arr);
  const expected = [];
  let prev = null;

  for (let n = 0; n < frameCount; n++) {
    const gyro = [Math.round(50 * Math.sin(n / 3)), (-(n % 7)) || 0, 3];
    const frame = [n, 1000 + n * 125, 10 + n, gyro[0], gyro[1], gyro[2], 1100 + n, 1105 + n];
    expected.push(frame);

    if (n % 16 === 0) { // I frame
      bytes.push(0x49);
      push(encodeUvb(frame[0]));
      push(encodeUvb(frame[1]));
      push(encodeSvb(frame[2]));
      push(encodeSvb(frame[3]));
      push(encodeSvb(frame[4]));
      push(encodeSvb(frame[5]));
      push(encodeUvb(frame[6] - 1000));      // predictor MINTHROTTLE
      push(encodeSvb(frame[7] - frame[6]));  // predictor MOTOR_0
    } else {          // P frame — deltas vs predictors
      bytes.push(0x50);
      push(encodeUvb(frame[0] - (prev[0] + 1)));  // INCREMENT
      push(encodeSvb(frame[1] - prev[1]));        // PREVIOUS
      for (let i = 2; i < 8; i++) push(encodeSvb(frame[i] - prev[i]));
    }
    prev = frame;
  }
  bytes.push(0x45, 255); // end-of-log event
  return { buf: Buffer.concat([Buffer.from(header, 'latin1'), Buffer.from(bytes)]), expected };
}

test('decodeLog round-trips a synthetic I/P frame stream exactly', () => {
  const { buf, expected } = buildLog(40);
  const d = decodeLog(buf);
  assert.equal(d.stats.frames, expected.length);
  assert.equal(d.stats.coverage, 1);
  assert.deepEqual(d.frames[0], expected[0]);
  assert.deepEqual(d.frames[17], expected[17]);   // P frame after second I
  assert.deepEqual(d.frames[39], expected[39]);
});

test('decodeLog resyncs after corruption and keeps decoding', () => {
  const { buf, expected } = buildLog(40);
  const corrupted = Buffer.from(buf);
  // Stomp a few bytes in the middle of the frame stream.
  const stompAt = buf.length - 120;
  for (let i = 0; i < 5; i++) corrupted[stompAt + i] = 0xff;
  const d = decodeLog(corrupted);
  assert.ok(d.stats.frames > expected.length / 2, `only ${d.stats.frames} frames decoded`);
  assert.ok(d.stats.coverage < 1);
  assert.deepEqual(d.frames[0], expected[0]); // pre-corruption data intact
});

// ---------- DSP ----------

test('FFT + Welch spectrum finds a 100Hz sine peak', () => {
  const rate = 1000;
  const samples = Array.from({ length: 4096 }, (_, i) =>
    100 * Math.sin(2 * Math.PI * 100 * (i / rate)) + (Math.sin(i * 7.13) * 2));
  const spec = welchSpectrum(samples, rate, { segment: 512 });
  assert.ok(spec);
  const peaks = findPeaks(spec, { count: 1 });
  assert.equal(peaks.length, 1);
  assert.ok(Math.abs(peaks[0].hz - 100) < 4, `peak at ${peaks[0].hz}Hz`);
});

test('fftRadix2 rejects non-power-of-2 sizes', () => {
  assert.throws(() => fftRadix2(new Array(300).fill(0), new Array(300).fill(0)), /power of 2/);
});
