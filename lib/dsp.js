// Minimal DSP for blackbox analysis: radix-2 FFT, Welch-averaged noise
// spectra, band RMS, and peak detection. Pure JS, no dependencies.

function fftRadix2(re, im) {
  const n = re.length;
  if ((n & (n - 1)) !== 0) throw new Error('FFT size must be a power of 2');
  // bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cwr = 1, cwi = 0;
      for (let j = 0; j < len / 2; j++) {
        const ur = re[i + j], ui = im[i + j];
        const vr = re[i + j + len / 2] * cwr - im[i + j + len / 2] * cwi;
        const vi = re[i + j + len / 2] * cwi + im[i + j + len / 2] * cwr;
        re[i + j] = ur + vr; im[i + j] = ui + vi;
        re[i + j + len / 2] = ur - vr; im[i + j + len / 2] = ui - vi;
        const nwr = cwr * wr - cwi * wi;
        cwi = cwr * wi + cwi * wr;
        cwr = nwr;
      }
    }
  }
}

// Welch-averaged amplitude spectrum. Returns { freqs, mags } up to Nyquist.
function welchSpectrum(samples, sampleRateHz, { segment = 1024 } = {}) {
  if (!samples || samples.length < segment || !sampleRateHz) return null;
  const hann = new Array(segment);
  for (let i = 0; i < segment; i++) hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (segment - 1)));

  const half = segment / 2;
  const acc = new Float64Array(half);
  let windows = 0;
  const hop = segment / 2;

  // Remove DC per segment; average magnitudes across segments.
  for (let start = 0; start + segment <= samples.length; start += hop) {
    const re = new Array(segment);
    const im = new Array(segment).fill(0);
    let mean = 0;
    for (let i = 0; i < segment; i++) mean += samples[start + i];
    mean /= segment;
    for (let i = 0; i < segment; i++) re[i] = (samples[start + i] - mean) * hann[i];
    fftRadix2(re, im);
    for (let i = 0; i < half; i++) acc[i] += Math.hypot(re[i], im[i]) / segment;
    windows++;
    if (windows >= 200) break; // enough averaging for a long log
  }
  if (windows === 0) return null;

  const freqs = new Array(half);
  const mags = new Array(half);
  for (let i = 0; i < half; i++) {
    freqs[i] = (i * sampleRateHz) / segment;
    mags[i] = acc[i] / windows;
  }
  return { freqs, mags, windows };
}

// Downsample a spectrum to n points for the UI (max-pool preserves peaks).
function downsampleSpectrum(spec, n = 128) {
  if (!spec) return null;
  const { freqs, mags } = spec;
  const step = Math.max(1, Math.floor(mags.length / n));
  const out = [];
  for (let i = 1; i < mags.length; i += step) { // skip DC bin
    let maxV = -Infinity, at = i;
    for (let j = i; j < Math.min(i + step, mags.length); j++) {
      if (mags[j] > maxV) { maxV = mags[j]; at = j; }
    }
    out.push({ f: +freqs[at].toFixed(1), m: +maxV.toFixed(4) });
  }
  return out;
}

// Top spectral peaks above a prominence floor, ignoring < minHz.
function findPeaks(spec, { count = 3, minHz = 20 } = {}) {
  if (!spec) return [];
  const { freqs, mags } = spec;
  const floor = mags.reduce((a, b) => a + b, 0) / mags.length;
  const peaks = [];
  for (let i = 2; i < mags.length - 2; i++) {
    if (freqs[i] < minHz) continue;
    if (mags[i] > mags[i - 1] && mags[i] > mags[i + 1] && mags[i] > floor * 3) {
      peaks.push({ hz: +freqs[i].toFixed(1), mag: +mags[i].toFixed(4), ratioToFloor: +(mags[i] / floor).toFixed(1) });
    }
  }
  return peaks.sort((a, b) => b.mag - a.mag).slice(0, count);
}

function rms(samples) {
  if (!samples?.length) return null;
  let acc = 0;
  for (const v of samples) acc += v * v;
  return Math.sqrt(acc / samples.length);
}

// RMS within a frequency band, computed from a spectrum (Parseval-ish).
function bandRms(spec, loHz, hiHz) {
  if (!spec) return null;
  let acc = 0;
  for (let i = 0; i < spec.freqs.length; i++) {
    if (spec.freqs[i] >= loHz && spec.freqs[i] < hiHz) acc += spec.mags[i] * spec.mags[i];
  }
  return +Math.sqrt(acc).toFixed(3);
}

// Inverse FFT via the conjugate trick: ifft(x) = conj(fft(conj(x))) / n
function ifftRadix2(re, im) {
  const n = re.length;
  for (let i = 0; i < n; i++) im[i] = -im[i];
  fftRadix2(re, im);
  for (let i = 0; i < n; i++) { re[i] /= n; im[i] = -im[i] / n; }
}

// ---------- Step response (PID-Analyzer / PIDtoolbox method) ----------
//
// Estimate the system's step response from flight data by Wiener
// deconvolution: split the log into overlapping windows, keep windows with
// real stick input, compute H(f) = conj(X)·Y / (|X|² + λ) with setpoint as
// input X and gyro as output Y, invert to an impulse response, integrate to
// a step response, and average across windows. A perfectly tracking quad
// settles at 1.0; overshoot and slow rise read directly off the curve.
function stepResponse(setpoint, gyro, sampleRateHz, {
  windowSec = 2, responseMs = 500, minInputDegS = 25, maxWindows = 120,
} = {}) {
  if (!setpoint || !gyro || !sampleRateHz) return null;
  const n = Math.min(setpoint.length, gyro.length);

  let seg = 1;
  while (seg < windowSec * sampleRateHz) seg <<= 1;
  while (seg > n && seg > 256) seg >>= 1;
  if (seg > n) return null;

  const respLen = Math.min(seg >> 1, Math.max(16, Math.round((responseMs / 1000) * sampleRateHz)));
  const hop = seg >> 1;
  const hann = new Array(seg);
  for (let i = 0; i < seg; i++) hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (seg - 1)));

  const acc = new Float64Array(respLen);
  let used = 0;

  for (let start = 0; start + seg <= n && used < maxWindows; start += hop) {
    // Only windows with meaningful stick input carry information about the
    // response — quiet hover windows would just average in noise.
    let maxIn = 0;
    for (let i = 0; i < seg; i++) {
      const a = Math.abs(setpoint[start + i]);
      if (a > maxIn) maxIn = a;
    }
    if (maxIn < minInputDegS) continue;

    const xr = new Array(seg), xi = new Array(seg).fill(0);
    const yr = new Array(seg), yi = new Array(seg).fill(0);
    for (let i = 0; i < seg; i++) {
      xr[i] = setpoint[start + i] * hann[i];
      yr[i] = gyro[start + i] * hann[i];
    }
    fftRadix2(xr, xi);
    fftRadix2(yr, yi);

    // λ regularizes bins where the input has no energy.
    let maxPow = 0;
    for (let i = 0; i < seg; i++) {
      const p = xr[i] * xr[i] + xi[i] * xi[i];
      if (p > maxPow) maxPow = p;
    }
    const lambda = maxPow * 1e-4 + 1e-12;

    const hr = new Array(seg), hi = new Array(seg);
    for (let i = 0; i < seg; i++) {
      const denom = xr[i] * xr[i] + xi[i] * xi[i] + lambda;
      hr[i] = (xr[i] * yr[i] + xi[i] * yi[i]) / denom;
      hi[i] = (xr[i] * yi[i] - xi[i] * yr[i]) / denom;
    }
    ifftRadix2(hr, hi);

    // impulse → step (cumulative sum over the causal part)
    let cum = 0;
    for (let i = 0; i < respLen; i++) {
      cum += hr[i];
      acc[i] += cum;
    }
    used++;
  }

  if (used === 0) return null;

  const curve = new Array(respLen);
  for (let i = 0; i < respLen; i++) curve[i] = acc[i] / used;

  // Metrics against the settled value (mean of the last quarter).
  const tailStart = Math.floor(respLen * 0.75);
  let steady = 0;
  for (let i = tailStart; i < respLen; i++) steady += curve[i];
  steady /= respLen - tailStart;

  let peak = -Infinity, peakIdx = 0;
  for (let i = 0; i < respLen; i++) if (curve[i] > peak) { peak = curve[i]; peakIdx = i; }

  const msPerSample = 1000 / sampleRateHz;
  let riseMs = null;
  if (steady > 0.05) {
    let t10 = null, t90 = null;
    for (let i = 0; i < respLen; i++) {
      if (t10 == null && curve[i] >= steady * 0.1) t10 = i;
      if (t90 == null && curve[i] >= steady * 0.9) { t90 = i; break; }
    }
    if (t10 != null && t90 != null && t90 >= t10) riseMs = +((t90 - t10) * msPerSample).toFixed(1);
  }
  const overshootPct = steady > 0.05 ? +(((peak - steady) / Math.abs(steady)) * 100).toFixed(1) : null;

  // Downsample the curve for transport/plotting (~125 points).
  const step = Math.max(1, Math.floor(respLen / 125));
  const points = [];
  for (let i = 0; i < respLen; i += step) {
    points.push({ t: +(i * msPerSample).toFixed(2), v: +curve[i].toFixed(4) });
  }

  return {
    windows: used,
    steadyState: +steady.toFixed(3),
    peak: +peak.toFixed(3),
    peakMs: +(peakIdx * msPerSample).toFixed(1),
    riseMs,
    overshootPct,
    points,
  };
}

// ---------- Throttle-vs-frequency heatmap ----------
//
// Short-window spectra binned by the window's mean throttle. Reveals
// throttle-tracking noise (frame resonance, motor/prop issues) that a whole-
// log spectrum smears out. Returns averaged magnitudes per (throttle, freq)
// cell; empty throttle bins are null.
function throttleFreqHeatmap(samples, throttlePct, sampleRateHz, {
  segment = 256, freqBins = 64, throttleBins = 20,
} = {}) {
  if (!samples || !throttlePct || !sampleRateHz) return null;
  const n = Math.min(samples.length, throttlePct.length);
  if (n < segment * 4) return null;

  const hop = segment >> 1;
  const half = segment >> 1;
  const hann = new Array(segment);
  for (let i = 0; i < segment; i++) hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (segment - 1)));

  const sums = Array.from({ length: throttleBins }, () => new Float64Array(freqBins));
  const counts = new Array(throttleBins).fill(0);
  const pool = Math.max(1, Math.floor(half / freqBins));

  for (let start = 0; start + segment <= n; start += hop) {
    let thr = 0;
    for (let i = 0; i < segment; i++) thr += throttlePct[start + i];
    thr /= segment;
    const tb = Math.min(throttleBins - 1, Math.max(0, Math.floor((thr / 100) * throttleBins)));

    const re = new Array(segment), im = new Array(segment).fill(0);
    let mean = 0;
    for (let i = 0; i < segment; i++) mean += samples[start + i];
    mean /= segment;
    for (let i = 0; i < segment; i++) re[i] = (samples[start + i] - mean) * hann[i];
    fftRadix2(re, im);

    const row = sums[tb];
    for (let b = 0; b < freqBins; b++) {
      let acc = 0;
      const from = 1 + b * pool; // skip DC
      for (let j = from; j < Math.min(from + pool, half); j++) acc += Math.hypot(re[j], im[j]) / segment;
      row[b] += acc / pool;
    }
    counts[tb]++;
  }

  const nyquist = sampleRateHz / 2;
  return {
    freqs: Array.from({ length: freqBins }, (_, b) => +(((1 + b * pool + pool / 2) * sampleRateHz) / segment).toFixed(1)),
    throttle: Array.from({ length: throttleBins }, (_, t) => Math.round(((t + 0.5) / throttleBins) * 100)),
    maxFreq: +nyquist.toFixed(0),
    matrix: sums.map((row, t) => counts[t] === 0 ? null : Array.from(row, v => +(v / counts[t]).toFixed(5))),
    counts,
  };
}

module.exports = {
  fftRadix2, ifftRadix2, welchSpectrum, downsampleSpectrum, findPeaks, rms, bandRms,
  stepResponse, throttleFreqHeatmap,
};
