// Cross-platform flight-controller USB detection.
//
// Primary path: SerialPort.list() — works on Windows, macOS, and Linux without
// shelling out. We match known FC USB vendor IDs (STM32 VCP, AT32, APM32) and
// common UART bridges. Fallback probes (PowerShell on Windows, lsusb on Linux)
// catch non-serial states: DFU bootloader and failed USB enumeration.

const { SerialPort } = require('serialport');
const { execFileSync } = require('child_process');

// USB vendor IDs that indicate a flight controller (or its UART bridge).
// Keys are lowercase hex, no 0x prefix — matching serialport's vendorId field.
const FC_VENDORS = {
  '0483': 'STMicroelectronics (STM32 VCP)',
  '2e3c': 'Artery (AT32 VCP)',
  '314b': 'Geehy (APM32 VCP)',
  '10c4': 'Silicon Labs CP210x (UART bridge)',
  '0403': 'FTDI (UART bridge)',
  '1a86': 'WCH CH340 (UART bridge)',
};

// vendorId:productId pairs for STM32/AT32 DFU bootloader mode.
const DFU_IDS = new Set(['0483:df11', '2e3c:df11']);

// Pure classification over a SerialPort.list() result — unit-testable.
function classifyPorts(ports) {
  const known = [];
  for (const p of ports || []) {
    const vid = (p.vendorId || '').toLowerCase();
    const isKnownVendor = Object.prototype.hasOwnProperty.call(FC_VENDORS, vid);
    const looksLikeFC = /betaflight|stm32|stm |virtual com/i.test(
      [p.manufacturer, p.friendlyName, p.pnpId].filter(Boolean).join(' ')
    );
    if (isKnownVendor || looksLikeFC) {
      known.push({ ...p, vendorName: FC_VENDORS[vid] || 'unknown vendor' });
    }
  }

  if (known.length > 0) {
    // Prefer a native FC VCP (STM32/AT32/APM32) over a generic UART bridge.
    const native = known.find(p => ['0483', '2e3c', '314b'].includes((p.vendorId || '').toLowerCase()));
    const pick = native || known[0];
    return {
      type: 'ALIVE',
      comPort: pick.path,
      description: [pick.friendlyName || pick.manufacturer, pick.vendorName].filter(Boolean).join(' · '),
      candidates: known.map(p => ({ path: p.path, vendorId: p.vendorId, productId: p.productId, manufacturer: p.manufacturer })),
    };
  }
  return { type: 'NOT_FOUND', comPort: null, description: 'No flight controller detected on USB', candidates: [] };
}

function runPS(command) {
  try {
    return execFileSync('powershell', ['-Command', command], { encoding: 'utf8', timeout: 10000 }).trim();
  } catch {
    return '';
  }
}

function runLsusb() {
  try {
    return execFileSync('lsusb', [], { encoding: 'utf8', timeout: 5000 });
  } catch {
    return '';
  }
}

// Probe for non-serial USB states (DFU bootloader, failed enumeration).
// These devices never appear in SerialPort.list().
function probeNonSerialStates() {
  if (process.platform === 'win32') {
    const failed = runPS(
      "Get-PnpDevice | Where-Object { $_.FriendlyName -match 'Unknown USB Device' -and $_.InstanceId -match 'VID_0000' } | Select-Object -ExpandProperty FriendlyName"
    );
    if (failed) return { type: 'FAILED_ENUM', comPort: null, description: failed, candidates: [] };

    const dfu = runPS(
      "Get-PnpDevice | Where-Object { $_.InstanceId -match 'VID_0483&PID_DF11' } | Select-Object -ExpandProperty FriendlyName"
    );
    if (dfu) return { type: 'DFU', comPort: null, description: dfu, candidates: [] };
    return null;
  }

  // Linux/macOS: lsusb (if present) can reveal a DFU-mode bootloader.
  const usb = runLsusb();
  for (const id of DFU_IDS) {
    if (usb.toLowerCase().includes(id)) {
      return { type: 'DFU', comPort: null, description: `DFU bootloader on USB (${id})`, candidates: [] };
    }
  }
  return null;
}

async function detectFC() {
  let ports = [];
  try {
    ports = await SerialPort.list();
  } catch {
    ports = [];
  }
  const result = classifyPorts(ports);
  if (result.type === 'ALIVE') return result;

  const nonSerial = probeNonSerialStates();
  if (nonSerial) return nonSerial;
  return result;
}

async function listPorts() {
  try {
    const ports = await SerialPort.list();
    return ports.map(p => ({
      path: p.path,
      vendorId: p.vendorId || null,
      productId: p.productId || null,
      manufacturer: p.manufacturer || null,
      serialNumber: p.serialNumber || null,
      vendorName: FC_VENDORS[(p.vendorId || '').toLowerCase()] || null,
    }));
  } catch {
    return [];
  }
}

function getUSBDetails() {
  if (process.platform === 'win32') {
    return runPS(
      "Get-PnpDevice | Where-Object { $_.InstanceId -match 'VID_0483|VID_0000&PID_0002' } | Get-PnpDeviceProperty | Where-Object { $_.Data -ne $null } | Format-Table KeyName, Data -AutoSize"
    );
  }
  return runLsusb();
}

module.exports = { detectFC, listPorts, classifyPorts, getUSBDetails, FC_VENDORS, DFU_IDS };
