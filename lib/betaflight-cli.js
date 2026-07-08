const { SerialPort } = require('serialport');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function scanFC(comPort) {
  const port = new SerialPort({ path: comPort, baudRate: 115200 });
  let buffer = '';
  port.on('data', (data) => { buffer += data.toString(); });

  async function send(cmd, wait = 2000) {
    buffer = '';
    port.write(cmd + '\r\n');
    await sleep(wait);
    return buffer;
  }

  function parseLine(text, key) {
    // Betaflight echoes the command, then prints the response on a separate line.
    // Find the LAST line that starts with the key (skip the echo).
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.startsWith(key));
    if (lines.length >= 2) return lines[lines.length - 1].substring(key.length).trim();
    if (lines.length === 1) return lines[0].substring(key.length).trim();
    return null;
  }

  // Wait for port to open
  await new Promise((resolve, reject) => {
    port.on('open', resolve);
    port.on('error', reject);
  });

  await sleep(500);
  buffer = '';
  port.write('#');
  await sleep(2000);

  const mcuIdRaw = await send('mcu_id');
  const mcuId = parseLine(mcuIdRaw, 'mcu_id') || 'UNKNOWN';

  const boardRaw = await send('board_name');
  const boardName = parseLine(boardRaw, 'board_name') || 'UNKNOWN';

  // Firmware variant: Betaflight / INAV / EmuFlight share the CLI heritage,
  // and `version` names the family on all of them.
  const versionRaw = await send('version', 1500);
  const fwVariant = versionRaw.match(/\b(INAV|Betaflight|EmuFlight|Cleanflight)\b/i)?.[1] || 'Betaflight';

  const statusRaw = await send('status', 3000);
  const diffRaw = await send('diff all', 8000);

  // Parse status
  const vref = statusRaw.match(/Vref=([0-9.]+)V/)?.[1] || null;
  const coreTemp = statusRaw.match(/Core temp=(\d+)degC/)?.[1] || null;
  const cpuLoad = statusRaw.match(/CPU:(\d+)%/)?.[1] || null;
  const gyro = statusRaw.match(/GYRO=(\w+)/)?.[1] || null;
  const acc = statusRaw.match(/ACC=(\w+)/)?.[1] || null;
  const baro = statusRaw.match(/BARO=(\w+)/)?.[1] || null;
  const osd = statusRaw.match(/OSD: (\S+)/)?.[1] || null;
  const buildKey = statusRaw.match(/BUILD KEY: (\S+)/)?.[1] || null;
  const fwVersion = statusRaw.match(/\(([0-9.]+)\)/)?.[1] || null;
  const sdCard = statusRaw.match(/SD card: (.+)/)?.[1]?.trim() || null;
  const i2cErrors = statusRaw.match(/I2C Errors: (\d+)/)?.[1] || null;
  const voltage = statusRaw.match(/Voltage: (.+)/)?.[1]?.split('\r')[0]?.trim() || null;
  const uptime = statusRaw.match(/System Uptime: (\d+)/)?.[1] || null;
  const mcuType = statusRaw.match(/MCU (\S+)/)?.[1] || null;
  const clock = statusRaw.match(/Clock=(\d+MHz)/)?.[1] || null;
  const configSize = statusRaw.match(/size: (\d+), max/)?.[1] || null;
  const cycleTime = statusRaw.match(/cycle time: (\d+)/)?.[1] || null;
  const gyroRate = statusRaw.match(/GYRO rate: (\d+)/)?.[1] || null;

  // Extract firmware line from diff
  const fwLine = diffRaw.match(/# Betaflight .+ \/ .+ \(.+\) .+/)?.[0] || null;
  const signature = diffRaw.match(/signature (.+)/)?.[1]?.trim() || null;
  const manufacturerId = diffRaw.match(/manufacturer_id (\w+)/)?.[1] || null;

  port.write('exit\r\n');
  await sleep(500);
  await new Promise((resolve) => {
    if (!port.isOpen) return resolve();
    port.close((err) => resolve());
  });

  return {
    mcuId,
    boardName,
    manufacturerId,
    fwVariant,
    firmware: fwVersion,
    firmwareLine: fwLine,
    buildKey,
    signature,
    mcuType,
    clock,
    sensors: { gyro, acc, baro, osd },
    health: {
      vref, coreTemp, cpuLoad, i2cErrors,
      voltage, sdCard, uptime, configSize,
      cycleTime, gyroRate
    },
    rawStatus: statusRaw.trim(),
    rawDiff: diffRaw.trim()
  };
}

module.exports = { scanFC };
