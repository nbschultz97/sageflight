// Safety-gated motor spin test via Betaflight CLI.
// Sends `motor <index> <pwm>` commands for a brief interval, then stops.
// Props MUST be off. Quad MUST be restrained.
//
// Usage:  node spin-test.js <motor 1-4> [pwm=1070] [seconds=2]
// Example: node spin-test.js 3 1070 2   -> spin motor 3 at idle-low for 2 seconds
//
// PWM scale (DShot):
//   1000 = stopped / idle min
//   1050 = just spinning (quiet)
//   1100 = light spin (what you want for a listening test)
//   1200 = noticeably loud, don't go higher without a reason
//   2000 = full throttle — DO NOT use this manually

const readline = require('readline');
const { SerialPort } = require('serialport');
const { detectFC } = require('./lib/usb-detect');
const { printBanner } = require('./lib/banner');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const motorHuman = parseInt(process.argv[2], 10);
const pwm = parseInt(process.argv[3] || '1070', 10);
const seconds = parseFloat(process.argv[4] || '2');

if (!motorHuman || motorHuman < 1 || motorHuman > 4) {
  console.log('Usage: node spin-test.js <motor 1-4> [pwm=1070] [seconds=2]');
  process.exit(1);
}
if (pwm < 1000 || pwm > 1300) {
  console.log('Refusing — PWM must be between 1000 and 1300. Listening tests never need more.');
  process.exit(1);
}
if (seconds > 5) {
  console.log('Refusing — max 5 seconds for safety.');
  process.exit(1);
}

const motorIdx = motorHuman - 1; // BF uses 0-indexed internally

async function ask(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => rl.question(q, a => { rl.close(); res(a.trim().toLowerCase()); }));
}

async function main() {
  printBanner();
  console.log('\n  === MOTOR SPIN TEST ===');
  console.log(`  Motor: ${motorHuman} (CLI index ${motorIdx})`);
  console.log(`  PWM:   ${pwm}`);
  console.log(`  Time:  ${seconds}s`);
  console.log('\n  SAFETY CHECKLIST:');
  console.log('    1. PROPS REMOVED from ALL motors');
  console.log('    2. Quad secured/restrained so it cannot move');
  console.log('    3. Battery connected');
  console.log('    4. Nothing loose near the motors (wires, fingers, debris)');

  const a = await ask('\n  Props OFF and quad restrained? Type "yes" to proceed: ');
  if (a !== 'yes' && a !== 'y') { console.log('  Aborted.'); return; }

  const det = detectFC();
  if (det.type !== 'ALIVE') { console.log('  No FC on USB.'); process.exit(1); }

  const port = new SerialPort({ path: det.comPort, baudRate: 115200 });
  await new Promise((r, e) => { port.on('open', r); port.on('error', e); });
  let buf = '';
  port.on('data', d => buf += d.toString());
  await sleep(500);

  async function sendCli(cmd, waitMs = 300) {
    buf = '';
    port.write(cmd + '\r\n');
    await sleep(waitMs);
    return buf;
  }

  // Enter CLI
  port.write('#');
  await sleep(1500);

  try {
    console.log(`\n  Spinning motor ${motorHuman} at ${pwm}...`);
    await sendCli(`motor ${motorIdx} ${pwm}`, 200);
    await sleep(seconds * 1000);
    console.log('  Stopping motor...');
    await sendCli(`motor ${motorIdx} 1000`, 200);
    await sleep(200);
    // Belt-and-suspenders: set ALL motors to 1000 in case of mis-routing
    for (let i = 0; i < 4; i++) await sendCli(`motor ${i} 1000`, 100);
    console.log('  All motors commanded to stop.');
  } catch (e) {
    console.error('  Error:', e.message);
    // Emergency: try to kill all motors
    for (let i = 0; i < 4; i++) {
      try { port.write(`motor ${i} 1000\r\n`); } catch {}
    }
  } finally {
    await sleep(300);
    port.write('exit\r\n');
    await sleep(500);
    await new Promise(r => port.close(r));
  }

  console.log('\n  Spin test complete. Listen for:');
  console.log('    - Steady hum = healthy');
  console.log('    - Grinding / scraping = bearing or bell rub');
  console.log('    - Irregular pulses = inter-turn short');
  console.log('    - Silent = no signal / dead ESC slot / broken wire');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
