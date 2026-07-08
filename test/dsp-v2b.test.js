const { test } = require('node:test');
const assert = require('node:assert/strict');
const { stepResponse, throttleFreqHeatmap, ifftRadix2, fftRadix2 } = require('../lib/dsp');

// Deterministic PRNG so failures reproduce.
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('ifftRadix2 inverts fftRadix2', () => {
  const rnd = mulberry32(7);
  const re = Array.from({ length: 64 }, () => rnd() * 2 - 1);
  const im = new Array(64).fill(0);
  const origRe = [...re];
  fftRadix2(re, im);
  ifftRadix2(re, im);
  for (let i = 0; i < 64; i++) {
    assert.ok(Math.abs(re[i] - origRe[i]) < 1e-9, `re[${i}] drifted`);
    assert.ok(Math.abs(im[i]) < 1e-9, `im[${i}] nonzero`);
  }
});

// Simulate a quad axis as a first-order tracker: gyro chases setpoint with
// time constant tau. The estimated step response must rise to ~1.0 with a
// rise time in the right ballpark and essentially no overshoot.
function simulateFirstOrder({ rate = 2000, seconds = 30, tauMs = 20, gain = 1, seed = 42 }) {
  const rnd = mulberry32(seed);
  const n = rate * seconds;
  const alpha = Math.exp(-1 / ((tauMs / 1000) * rate));
  const setpoint = new Array(n);
  const gyro = new Array(n);
  let target = 0, y = 0;
  for (let i = 0; i < n; i++) {
    if (i % Math.floor(rate * 0.4) === 0) target = (rnd() * 2 - 1) * 400; // new stick position every 400ms
    setpoint[i] = target;
    y = alpha * y + (1 - alpha) * gain * target;
    gyro[i] = y + (rnd() * 2 - 1) * 2; // small sensor noise
  }
  return { setpoint, gyro, rate };
}

test('stepResponse recovers a first-order tracker: settles near 1.0, sane rise time, no big overshoot', () => {
  const { setpoint, gyro, rate } = simulateFirstOrder({ tauMs: 20 });
  const r = stepResponse(setpoint, gyro, rate);
  assert.ok(r, 'expected a result');
  assert.ok(r.windows > 5, `expected several usable windows, got ${r.windows}`);
  assert.ok(Math.abs(r.steadyState - 1) < 0.15, `steadyState ${r.steadyState} not near 1.0`);
  // first-order 10-90% rise = 2.2 * tau = 44ms; deconvolution smears somewhat
  assert.ok(r.riseMs > 10 && r.riseMs < 120, `riseMs ${r.riseMs} out of expected band`);
  assert.ok(r.overshootPct < 15, `overshoot ${r.overshootPct}% unexpectedly large`);
  assert.ok(r.points.length > 50, 'curve points missing');
});

test('stepResponse reflects tracking gain (gain 0.5 → settles near 0.5)', () => {
  const { setpoint, gyro, rate } = simulateFirstOrder({ tauMs: 15, gain: 0.5, seed: 9 });
  const r = stepResponse(setpoint, gyro, rate);
  assert.ok(r, 'expected a result');
  assert.ok(Math.abs(r.steadyState - 0.5) < 0.12, `steadyState ${r.steadyState} not near 0.5`);
});

test('stepResponse returns null when there is no stick input', () => {
  const n = 2000 * 20;
  const setpoint = new Array(n).fill(0);
  const gyro = Array.from({ length: n }, (_, i) => Math.sin(i / 7) * 3);
  assert.equal(stepResponse(setpoint, gyro, 2000), null);
});

test('throttleFreqHeatmap localizes throttle-dependent noise', () => {
  const rate = 2000, seconds = 40;
  const n = rate * seconds;
  const rnd = mulberry32(3);
  const gyro = new Array(n);
  const throttle = new Array(n);
  for (let i = 0; i < n; i++) {
    // throttle sweeps 0→100% repeatedly; 150Hz resonance appears only above 60% throttle
    const pct = (i % (rate * 8)) / (rate * 8) * 100;
    throttle[i] = pct;
    const resonance = pct > 60 ? Math.sin((2 * Math.PI * 150 * i) / rate) * 40 : 0;
    gyro[i] = resonance + (rnd() * 2 - 1) * 3;
  }

  const hm = throttleFreqHeatmap(gyro, throttle, rate);
  assert.ok(hm, 'expected a heatmap');
  assert.equal(hm.matrix.length, 20);
  assert.equal(hm.freqs.length, 64);

  const cellNear150 = (row) => {
    let best = 0;
    for (let f = 0; f < hm.freqs.length; f++) {
      if (Math.abs(hm.freqs[f] - 150) < 25 && row[f] > best) best = row[f];
    }
    return best;
  };
  const lowRow = hm.matrix[2];   // ~12% throttle
  const highRow = hm.matrix[17]; // ~87% throttle
  assert.ok(lowRow && highRow, 'both throttle rows populated');
  assert.ok(cellNear150(highRow) > cellNear150(lowRow) * 5 + 0.001,
    `150Hz energy should live in the high-throttle rows (low=${cellNear150(lowRow)}, high=${cellNear150(highRow)})`);
});

test('throttleFreqHeatmap leaves unvisited throttle bins null', () => {
  const rate = 2000;
  const n = rate * 20;
  const gyro = Array.from({ length: n }, (_, i) => Math.sin(i / 5));
  const throttle = new Array(n).fill(50); // only ever mid-throttle
  const hm = throttleFreqHeatmap(gyro, throttle, rate);
  assert.ok(hm.matrix[10], 'mid-throttle bin populated');
  assert.equal(hm.matrix[0], null);
  assert.equal(hm.matrix[19], null);
});
