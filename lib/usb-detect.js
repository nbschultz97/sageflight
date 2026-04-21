const { execFileSync } = require('child_process');

function runPS(command) {
  try {
    return execFileSync('powershell', ['-Command', command], { encoding: 'utf8', timeout: 10000 }).trim();
  } catch (e) {
    return '';
  }
}

function detectFC() {
  // Check for working FC (STM32 VCP)
  const alive = runPS(
    "Get-PnpDevice -Class Ports -Status OK | Where-Object { $_.FriendlyName -match 'STM|Betaflight' } | Select-Object -ExpandProperty FriendlyName"
  );

  if (alive) {
    const comMatch = alive.match(/\(COM(\d+)\)/);
    return { type: 'ALIVE', comPort: comMatch ? `COM${comMatch[1]}` : null, description: alive };
  }

  // Check for failed USB device
  const failed = runPS(
    "Get-PnpDevice | Where-Object { $_.FriendlyName -match 'Unknown USB Device' -and $_.InstanceId -match 'VID_0000' } | Select-Object -ExpandProperty FriendlyName"
  );

  if (failed) {
    return { type: 'FAILED_ENUM', comPort: null, description: failed };
  }

  // Check for DFU device
  const dfu = runPS(
    "Get-PnpDevice | Where-Object { $_.InstanceId -match 'VID_0483&PID_DF11' } | Select-Object -ExpandProperty FriendlyName"
  );

  if (dfu) {
    return { type: 'DFU', comPort: null, description: dfu };
  }

  return { type: 'NOT_FOUND', comPort: null, description: 'No flight controller detected on USB' };
}

function getUSBDetails() {
  return runPS(
    "Get-PnpDevice | Where-Object { $_.InstanceId -match 'VID_0483|VID_0000&PID_0002' } | Get-PnpDeviceProperty | Where-Object { $_.Data -ne $null } | Format-Table KeyName, Data -AutoSize"
  );
}

module.exports = { detectFC, getUSBDetails };
