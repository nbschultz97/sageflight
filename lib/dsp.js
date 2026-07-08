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

module.exports = { fftRadix2, welchSpectrum, downsampleSpectrum, findPeaks, rms, bandRms };
