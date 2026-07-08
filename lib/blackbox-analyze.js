// Blackbox flight analysis: decode → series → metrics the UI charts and the
// AI reasons over. This is the measured-data layer PIDtoolbox used to fill.

const { decodeLog, extractSeries } = require('./blackbox-decode');
const dsp = require('./dsp');

const AXES = ['roll', 'pitch', 'yaw'];

function analyzeBuffer(buf) {
  const decoded = decodeLog(buf);
  const s = extractSeries(decoded);
  if (!s.sampleRateHz || decoded.frames.length < 2048) {
    throw new Error(`decoded only ${decoded.frames.length} frames — log too short or decoder could not follow this format`);
  }

  const gyroAnalysis = AXES.map((axis, i) => {
    const g = s.gyro[i];
    if (!g) return { axis, available: false };
    const spec = dsp.welchSpectrum(g, s.sampleRateHz);
    return {
      axis,
      available: true,
      rmsDegS: +(dsp.rms(g) || 0).toFixed(1),
      peaks: dsp.findPeaks(spec),
      bands: {
        'low <80Hz': dsp.bandRms(spec, 1, 80),
        'mid 80-200Hz': dsp.bandRms(spec, 80, 200),
        'high >200Hz': dsp.bandRms(spec, 200, s.sampleRateHz / 2),
      },
      spectrum: dsp.downsampleSpectrum(spec, 128),
    };
  });

  const motorAnalysis = s.motors.map((m, i) => {
    if (!m) return { motor: i + 1, available: false };
    let min = Infinity, max = -Infinity, sum = 0, satHi = 0;
    for (const v of m) {
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
      if (v >= 1990) satHi++;
    }
    return {
      motor: i + 1,
      available: true,
      avg: Math.round(sum / m.length),
      min, max,
      saturationPct: +((satHi / m.length) * 100).toFixed(1),
    };
  });

  const avgs = motorAnalysis.filter(m => m.available).map(m => m.avg);
  const motorImbalance = avgs.length === 4 ? Math.max(...avgs) - Math.min(...avgs) : null;

  // v2b: step response per axis (setpoint → gyro Wiener deconvolution).
  // Yaw usually has little stick input in cruising logs — null is normal.
  const stepAnalysis = AXES.map((axis, i) => {
    const sp = s.setpoint[i], g = s.gyro[i];
    if (!sp || !g) return { axis, available: false };
    const r = dsp.stepResponse(sp, g, s.sampleRateHz);
    return r ? { axis, available: true, ...r } : { axis, available: false };
  });

  // v2b: throttle-vs-frequency heatmap per axis. Throttle is normalized to
  // percent via robust percentiles — rcCommand[3] scaling varies by RX/log.
  let throttleHeatmaps = null;
  const thr = s.rcCommandThrottle;
  if (thr && thr.length > 1024) {
    const sorted = [...thr].sort((a, b) => a - b);
    const lo = sorted[Math.floor(sorted.length * 0.01)];
    const hi = sorted[Math.floor(sorted.length * 0.99)];
    if (hi > lo) {
      const pct = thr.map(v => Math.min(100, Math.max(0, ((v - lo) / (hi - lo)) * 100)));
      throttleHeatmaps = AXES.map((axis, i) => {
        const g = s.gyro[i];
        const hm = g ? dsp.throttleFreqHeatmap(g, pct, s.sampleRateHz) : null;
        return { axis, available: !!hm, ...(hm || {}) };
      });
    }
  }

  return {
    experimental: true,
    frames: decoded.stats.frames,
    coverage: decoded.stats.coverage,
    logsInFile: decoded.stats.logsInFile,
    sampleRateHz: s.sampleRateHz,
    durationSec: s.durationSec,
    gyro: gyroAnalysis,
    motors: motorAnalysis,
    motorImbalance,
    stepResponse: stepAnalysis,
    throttleHeatmaps,
  };
}

// Compact version for the LLM (drop the chart arrays, keep the numbers).
function metricsForLlm(analysis) {
  if (!analysis) return null;
  return {
    durationSec: analysis.durationSec,
    sampleRateHz: analysis.sampleRateHz,
    decodeCoverage: analysis.coverage,
    gyro: analysis.gyro.map(({ spectrum, ...g }) => g),
    motors: analysis.motors,
    motorImbalance: analysis.motorImbalance,
    // Step-response numbers without the plot curve. riseMs = 10→90% of the
    // settled value; overshootPct relative to settled; steadyState ≈ 1.0
    // means the quad tracks setpoint 1:1 over the analysis window.
    stepResponse: (analysis.stepResponse || [])
      .filter(sr => sr.available)
      .map(({ points, ...sr }) => sr),
    // Noise-vs-throttle: dominant frequency cell in the low/mid/high
    // throttle thirds of the roll-axis heatmap (roll shows frame noise best).
    noiseVsThrottle: summarizeHeatmapForLlm(analysis.throttleHeatmaps),
  };
}

function summarizeHeatmapForLlm(heatmaps) {
  const roll = heatmaps?.find(h => h.axis === 'roll' && h.available);
  if (!roll || !roll.matrix) return null;
  const thirds = [
    { label: 'low throttle (0-33%)', from: 0, to: Math.floor(roll.matrix.length / 3) },
    { label: 'mid throttle (33-66%)', from: Math.floor(roll.matrix.length / 3), to: Math.floor((2 * roll.matrix.length) / 3) },
    { label: 'high throttle (66-100%)', from: Math.floor((2 * roll.matrix.length) / 3), to: roll.matrix.length },
  ];
  return thirds.map(({ label, from, to }) => {
    let best = null;
    for (let t = from; t < to; t++) {
      const row = roll.matrix[t];
      if (!row) continue;
      for (let f = 0; f < row.length; f++) {
        if (!best || row[f] > best.mag) best = { mag: row[f], hz: roll.freqs[f] };
      }
    }
    return best
      ? { range: label, dominantHz: best.hz, magnitude: +best.mag.toFixed(4) }
      : { range: label, dominantHz: null, magnitude: null };
  });
}

module.exports = { analyzeBuffer, metricsForLlm };
