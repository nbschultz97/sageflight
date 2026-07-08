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
  };
}

module.exports = { analyzeBuffer, metricsForLlm };
