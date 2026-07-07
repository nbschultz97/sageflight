// Betaflight arming-disable flag decoding — the "why won't it arm?" doctor.
//
// The single most common beginner problem is a quad that refuses to arm.
// Betaflight exposes the exact reasons as a bitmask (MSP_STATUS_EX / CLI
// `status`), but the configurator only prints flag names. We decode each
// flag AND say what to do about it, in plain English.
//
// Bit order follows armingDisableFlags_e in Betaflight's runtime_config.h
// (4.3–4.5 era). Order drifts slightly across majors — treat as best-effort.

const FLAGS = [
  { name: 'NOGYRO',          meaning: 'No gyro detected',                        fix: 'The gyro is not responding. Reflash firmware for the correct target; if it persists the gyro chip or its solder joints are damaged.' },
  { name: 'FAILSAFE',        meaning: 'Failsafe is active',                      fix: 'The FC believes the link is lost. Check that the receiver is bound, powered, and the correct SerialRX/ELRS protocol is set on the right UART.' },
  { name: 'RXLOSS',          meaning: 'No valid receiver signal',                fix: 'The FC is not seeing RC data. Turn on your radio, verify binding, check Receiver tab for moving channel bars, and confirm the receiver UART/protocol.' },
  { name: 'BADRX',           meaning: 'Recovering from RX failsafe',             fix: 'Signal just came back. Toggle your arm switch off and on again.' },
  { name: 'BOXFAILSAFE',     meaning: 'Failsafe switch is on',                   fix: 'A failsafe mode switch on your radio is active. Check the Modes tab and your switch positions.' },
  { name: 'RUNAWAY',         meaning: 'Runaway takeoff prevention triggered',    fix: 'The quad spun up without leaving the ground (often props on backwards, wrong motor order, or wrong board alignment). Disarm fully, fix the mechanical cause, then re-arm.' },
  { name: 'CRASH',           meaning: 'Crash detected',                          fix: 'Crash recovery latched. Disarm and re-arm to clear.' },
  { name: 'THROTTLE',        meaning: 'Throttle is not at minimum',              fix: 'Lower your throttle stick fully. If it still shows, check throttle endpoints in the Receiver tab (should read ~1000 at bottom).' },
  { name: 'ANGLE',           meaning: 'Quad is tilted too far',                  fix: 'Place the quad level (default limit 25°). If it reads tilted while flat, recalibrate the accelerometer or set small_angle = 180 to disable the check.' },
  { name: 'BOOTGRACE',       meaning: 'Still in boot grace time',                fix: 'Wait a few seconds after power-up before arming.' },
  { name: 'NOPREARM',        meaning: 'Prearm switch not active',                fix: 'You have a PREARM mode configured — activate the prearm switch first (or after a disarm, toggle it again).' },
  { name: 'LOAD',            meaning: 'CPU load too high',                       fix: 'The FC cannot keep up. Lower the PID loop frequency, disable unused features, or reduce filtering load.' },
  { name: 'CALIB',           meaning: 'Sensors still calibrating',               fix: 'Keep the quad still for a few seconds after plugging in. If it never clears, recalibrate the accelerometer.' },
  { name: 'CLI',             meaning: 'CLI is active',                           fix: 'A CLI session is open. Type exit in the CLI or disconnect the configurator.' },
  { name: 'CMS',             meaning: 'OSD menu is open',                        fix: 'Exit the OSD/CMS menu (throttle mid + yaw left typically exits).' },
  { name: 'BST',             meaning: 'Black Sheep Telemetry arming block',      fix: 'A TBS BST device is blocking arming.' },
  { name: 'MSP',             meaning: 'Connected over USB/MSP',                  fix: 'Betaflight blocks arming while the configurator is connected. Disconnect USB before arming — this is the classic bench-test gotcha.' },
  { name: 'PARALYZE',        meaning: 'Paralyze mode latched',                   fix: 'Paralyze mode was activated. Power-cycle the quad to clear it.' },
  { name: 'GPS',             meaning: 'Waiting for GPS fix',                     fix: 'GPS Rescue needs a fix before arming. Wait for satellites, or disable the GPS-fix arming requirement.' },
  { name: 'RESC',            meaning: 'GPS Rescue switch is on',                 fix: 'Your GPS Rescue switch is active — turn it off before arming.' },
  { name: 'RPMFILTER',       meaning: 'RPM filter misconfigured',                fix: 'RPM filtering is on but ESCs are not reporting RPM — enable bidirectional DShot AND make sure the ESC firmware supports it (Bluejay/BLHeli_32), or turn off the RPM filter.' },
  { name: 'REBOOT_REQUIRED', meaning: 'Reboot required',                         fix: 'A setting change needs a reboot. Reboot the FC (or unplug/replug the battery).' },
  { name: 'DSHOT_BITBANG',   meaning: 'DShot bitbang misconfigured',             fix: 'DShot bitbang conflicts with the current setup — set dshot_bitbang = AUTO or OFF and reboot.' },
  { name: 'ACC_CALIB',       meaning: 'Accelerometer needs calibration',         fix: 'Calibrate the accelerometer on a flat, level surface (Setup tab in BF Configurator or CLI: acc_calibration).' },
  { name: 'MOTOR_PROTOCOL',  meaning: 'Motor protocol not set',                  fix: 'No valid motor protocol configured — pick your ESC protocol (e.g. DSHOT600) in the configuration. New in 4.4: defaults to OFF and MUST be set.' },
  { name: 'ARM_SWITCH',      meaning: 'Arm switch is on',                        fix: 'Your arm switch was already on at boot/plug-in. Toggle it off and on again — Betaflight refuses to arm if it powers up with the switch active.' },
];

// bits: u32 arming disable bitmask → array of { name, meaning, fix }
function decodeArmingFlags(bits) {
  const active = [];
  for (let i = 0; i < FLAGS.length; i++) {
    if (bits & (1 << i)) active.push({ bit: i, ...FLAGS[i] });
  }
  // Bits beyond our table (future firmware) — surface them rather than hide.
  for (let i = FLAGS.length; i < 32; i++) {
    if (bits & (1 << i)) active.push({ bit: i, name: `UNKNOWN_${i}`, meaning: `Unrecognized arming-disable bit ${i}`, fix: 'Check `status` in the CLI on this firmware version for the flag name.' });
  }
  return active;
}

module.exports = { FLAGS, decodeArmingFlags };
