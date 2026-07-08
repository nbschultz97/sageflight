// Betaflight cloud build API client (build.betaflight.com).
//
// The same service Betaflight Configurator uses: pick a target + release,
// choose firmware options (radio/telemetry/motor/OSD protocols, feature
// defines), the service compiles a custom hex server-side. Protocol
// reverse-referenced from betaflight-configurator's BuildApi.js /
// useCloudBuild.js:
//
//   GET  /api/targets                    -> [{ target, manufacturer, mcu, group? }]
//   GET  /api/targets/{target}           -> { target, releases: [{ release, type, label, cloudBuild }] }
//   GET  /api/options/{release}          -> { radioProtocols, telemetryProtocols, motorProtocols, osdProtocols, generalOptions, ... }
//   POST /api/builds { target, release, options } -> { key, url, file }
//   GET  /api/builds/{key}/status        -> { status: queued|success|..., timeOut?, configuration? }
//   GET  /api/builds/{key}/log           -> plain-text build log
//
// options must start with "CORE_BUILD" (defaults only) or "CLOUD_BUILD"
// (custom) — the service rejects requests without a mode marker.

const BUILD_HOST = process.env.BF_BUILD_HOST || 'https://build.betaflight.com';

async function getJson(path, timeoutMs = 15000) {
  const r = await fetch(BUILD_HOST + path, {
    headers: { 'Accept': 'application/json', 'User-Agent': 'sageflight' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json();
}

function fetchTargets() {
  return getJson('/api/targets');
}

function fetchTargetReleases(target) {
  return getJson(`/api/targets/${encodeURIComponent(target)}`);
}

function fetchOptions(release) {
  return getJson(`/api/options/${encodeURIComponent(release)}`);
}

// Pure — assemble the POST /api/builds options array. Unit-testable.
// selections: { coreBuild?, radioProtocol?, telemetryProtocol?,
//               motorProtocol?, osdProtocol?, options?: [], customDefines?: [] }
function assembleBuildRequest(target, release, selections = {}) {
  if (!target || !release) throw new Error('target and release are required');
  const request = { target, release, options: [] };

  if (selections.coreBuild) {
    request.options.push('CORE_BUILD');
    return request;
  }

  request.options.push('CLOUD_BUILD');
  for (const key of ['radioProtocol', 'telemetryProtocol', 'motorProtocol', 'osdProtocol']) {
    const v = selections[key];
    if (v) request.options.push(String(v));
  }
  for (const opt of selections.options || []) {
    if (opt != null && String(opt).trim() !== '') request.options.push(String(opt).trim());
  }
  for (const tag of selections.customDefines || []) {
    const t = String(tag).trim();
    if (t) request.options.push(t);
  }
  // De-dup while preserving order — double options make the service reject.
  request.options = [...new Set(request.options)];
  return request;
}

async function submitBuild(request) {
  const r = await fetch(BUILD_HOST + '/api/builds', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'sageflight' },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(20000),
  });
  if (!(r.status === 200 || r.status === 201 || r.status === 202)) {
    const text = await r.text().catch(() => '');
    throw new Error(`build submit: HTTP ${r.status} ${text.slice(0, 200)}`);
  }
  return r.json(); // { key, url, file }
}

function buildStatus(key) {
  return getJson(`/api/builds/${encodeURIComponent(key)}/status`, 10000);
}

function buildLogUrl(key) {
  return `${BUILD_HOST}/api/builds/${encodeURIComponent(key)}/log`;
}

// Download the finished firmware hex text from the URL the submit response
// gave us. The service returns a host-relative path ("/api/builds/{key}/hex");
// absolute URLs are only accepted on the build host so this can't be steered
// to arbitrary servers.
function resolveFirmwareUrl(url) {
  const s = String(url || '');
  if (s.startsWith('/')) return BUILD_HOST + s;
  if (s.startsWith(BUILD_HOST + '/')) return s;
  throw new Error(`firmware URL is not on the build host — refusing (${s.slice(0, 80)})`);
}

async function downloadFirmware(url, timeoutMs = 60000) {
  const r = await fetch(resolveFirmwareUrl(url), { signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': 'sageflight' } });
  if (!r.ok) throw new Error(`firmware download: HTTP ${r.status}`);
  return r.text();
}

// Submit → poll (5s cadence, like the configurator) → download. onEvent gets
// progress callbacks: { phase, msg }. Returns { hexText, key, file, logUrl }.
async function runCloudBuild(request, onEvent = () => {}, { pollSeconds = 5, maxWaitSeconds = 300 } = {}) {
  onEvent({ phase: 'submit', msg: `Requesting ${request.target} @ ${request.release} (${request.options.length} options)` });
  const resp = await submitBuild(request);
  if (!resp || !resp.key) throw new Error('build service returned no build key');
  onEvent({ phase: 'queued', msg: `Build key ${resp.key}`, key: resp.key });

  const deadline = Date.now() + maxWaitSeconds * 1000;
  let status = await buildStatus(resp.key).catch(() => null);
  while ((status?.status === 'queued' || !status) && Date.now() < deadline) {
    onEvent({ phase: 'building', msg: `Status: ${status?.status || 'waiting'}…` });
    await new Promise(r => setTimeout(r, pollSeconds * 1000));
    status = await buildStatus(resp.key).catch(() => null);
  }

  if (status?.status !== 'success') {
    throw new Error(`cloud build did not succeed (status: ${status?.status || 'unknown'}) — log: ${buildLogUrl(resp.key)}`);
  }
  onEvent({ phase: 'download', msg: `Build succeeded — downloading ${resp.file || 'firmware'}` });
  const hexText = await downloadFirmware(resp.url);
  return { hexText, key: resp.key, file: resp.file || `${request.target}-${request.release}.hex`, logUrl: buildLogUrl(resp.key) };
}

module.exports = {
  BUILD_HOST,
  fetchTargets, fetchTargetReleases, fetchOptions,
  assembleBuildRequest, submitBuild, buildStatus, buildLogUrl,
  resolveFirmwareUrl, downloadFirmware, runCloudBuild,
};
