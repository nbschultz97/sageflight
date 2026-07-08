const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assembleBuildRequest, buildLogUrl, resolveFirmwareUrl, BUILD_HOST } = require('../lib/cloud-build');

test('core build carries only the CORE_BUILD marker', () => {
  const r = assembleBuildRequest('ACROSKYF405', '4.5.2', { coreBuild: true, radioProtocol: 'USE_SERIALRX_CRSF' });
  assert.deepEqual(r, { target: 'ACROSKYF405', release: '4.5.2', options: ['CORE_BUILD'] });
});

test('custom build starts with CLOUD_BUILD and collects protocol + option defines', () => {
  const r = assembleBuildRequest('ACROSKYF405', '4.5.2', {
    radioProtocol: 'USE_SERIALRX_CRSF',
    telemetryProtocol: 'USE_TELEMETRY_CRSF',
    motorProtocol: 'USE_DSHOT',
    osdProtocol: 'USE_OSD_HD',
    options: ['USE_GPS', 'USE_LED_STRIP', '', null],
    customDefines: [' USE_ACRO_TRAINER ', ''],
  });
  assert.equal(r.options[0], 'CLOUD_BUILD');
  assert.deepEqual(r.options, [
    'CLOUD_BUILD', 'USE_SERIALRX_CRSF', 'USE_TELEMETRY_CRSF', 'USE_DSHOT',
    'USE_OSD_HD', 'USE_GPS', 'USE_LED_STRIP', 'USE_ACRO_TRAINER',
  ]);
});

test('duplicate options are removed, order preserved', () => {
  const r = assembleBuildRequest('T', '4.5.2', {
    radioProtocol: 'USE_SERIALRX_CRSF',
    options: ['USE_SERIALRX_CRSF', 'USE_GPS', 'USE_GPS'],
  });
  assert.deepEqual(r.options, ['CLOUD_BUILD', 'USE_SERIALRX_CRSF', 'USE_GPS']);
});

test('missing target or release throws', () => {
  assert.throws(() => assembleBuildRequest('', '4.5.2'), /required/);
  assert.throws(() => assembleBuildRequest('T', ''), /required/);
});

test('buildLogUrl points at the build host', () => {
  assert.equal(buildLogUrl('abc123'), `${BUILD_HOST}/api/builds/abc123/log`);
});

test('resolveFirmwareUrl accepts host-relative and on-host URLs, rejects foreign hosts', () => {
  assert.equal(resolveFirmwareUrl('/api/builds/k/hex'), `${BUILD_HOST}/api/builds/k/hex`);
  assert.equal(resolveFirmwareUrl(`${BUILD_HOST}/api/builds/k/hex`), `${BUILD_HOST}/api/builds/k/hex`);
  assert.throws(() => resolveFirmwareUrl('https://evil.example.com/x.hex'), /refusing/);
  assert.throws(() => resolveFirmwareUrl(''), /refusing/);
});
