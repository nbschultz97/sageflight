// Spin each motor in turn, capture battery voltage under load, compare.
// Differential voltage sag under identical PWM reveals current draw differences —
// a motor with inter-turn shorts will pull measurably more current than healthy peers.
//
// Usage:  node spin-compare.js [pwm=1080] [seconds=2]

const readline = require('readline');
const { SerialPort } = require('serialport');
const { detectFC } = require('./lib/usb-detect');
const { printBanner } = require('./lib/banner');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const pwm = parseInt(process.argv[2] || '1080', 10);
const seconds = parseFloat(process.argv[3] || '2');
if (pwm < 1000 || pwm > 1300) { console.log('PWM must be 1000–1300'); process.exit(1); }
if (seconds > 5) { console.log('Max 5 seconds'); process.exit(1); }

async function ask(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => rl.question(q, a => { rl.close(); res(a.trim().toLowerCase()); }));
}

function parseStatusVoltage(buf) {
  // Kakute H7 / newer BF format: "Voltage: 2451 * 0.01V (6S battery - OK)"
  const mult = buf.match(/Voltage:\s*(\d+)\s*\*\s*([\d.]+)V/);
  if (mult) return parseFloat(mult[1]) * parseFloat(mult[2]);
  // Older BF format: "Voltage: 24.51V"
  const plain = buf.match(/Voltage:\s*([\d.]+)V/);
  return plain ? parseFloat(plain[1]) : null;
}

async function cliRoundTrip(port, cmd, waitMs) {
  return new Promise((resolve) => {
    let out = '';
    const h = (d) => { out += d.toString(); };
    port.on('data', h);
    port.write(cmd + '\r\n');
    setTimeout(() => { port.removeListener('data', h); resolve(out); }, waitMs);
  });
}

async function main() {
  printBanner();
  console.log('\n  === MOTOR SPIN COMPARISON ===');
  console.log(`  PWM per motor: ${pwm}`);
  console.log(`  Time per motor: ${seconds}s`);
  console.log('\n  SAFETY: Props removed from ALL motors. Quad restrained.\n');

  const a = await ask('  Props OFF and quad secured? Type "yes" to proceed: ');
  if (a !== 'yes' && a !== 'y') { console.log('  Aborted.'); return; }

  const det = detectFC();
  if (det.type !== 'ALIVE') { console.log('  No FC on USB.'); process.exit(1); }

  const port = new SerialPort({ path: det.comPort, baudRate: 115200 });
  await new Promise((r, e) => { port.on('open', r); port.on('error', e); });
  await sleep(500);

  port.write('#');
  await sleep(1500);

  const results = [];
  try {
    for (let m = 0; m < 4; m++) {
      const motorHuman = m + 1;
      // Idle voltage BEFORE spin
      const idleBuf = await cliRoundTrip(port, 'status', 2000);
      const vIdle = parseStatusVoltage(idleBuf);

      console.log(`\n  Motor ${motorHuman}: spinning at ${pwm}...`);
      await cliRoundTrip(port, `motor ${m} ${pwm}`, 200);

      // Wait for motor to stabilize, then measure under-load voltage
      await sleep(700);
      const loadBuf = await cliRoundTrip(port, 'status', 2000);
      const vLoad = parseStatusVoltage(loadBuf);

      // Hold remaining time (guard against negative if seconds small)
      const remaining = seconds * 1000 - 2900;
      if (remaining > 0) await sleep(remaining);

      // Stop motor
      await cliRoundTrip(port, `motor ${m} 1000`, 300);

      const sag = (vIdle != null && vLoad != null) ? +(vIdle - vLoad).toFixed(3) : null;
      results.push({ motor: motorHuman, vIdle, vLoad, sag });
      console.log(`    idle: ${vIdle}V   under-load: ${vLoad}V   sag: ${sag}V`);

      // Let caps recharge between motors
      await sleep(800);
    }
  } catch (e) {
    console.error('  Error:', e.message);
    for (let m = 0; m < 4; m++) { try { port.write(`motor ${m} 1000\r\n`); } catch {} }
  } finally {
    await sleep(300);
    for (let m = 0; m < 4; m++) await cliRoundTrip(port, `motor ${m} 1000`, 100);
    port.write('exit\r\n');
    await sleep(500);
    await new Promise(r => port.close(r));
  }

  console.log('\n  === COMPARISON ===');
  console.log('  Motor | Idle V | Load V | Sag V');
  console.log('  ------+--------+--------+-------');
  for (const r of results) {
    console.log(`    ${r.motor}   | ${String(r.vIdle ?? 'n/a').padEnd(6)} | ${String(r.vLoad ?? 'n/a').padEnd(6)} | ${r.sag ?? 'n/a'}`);
  }

  // Interpret
  const validSags = results.filter(r => r.sag != null).map(r => r.sag);
  if (validSags.length === 4) {
    const mean = validSags.reduce((a, b) => a + b, 0) / validSags.length;
    const outliers = results.filter(r => r.sag != null && Math.abs(r.sag - mean) > 0.15);
    console.log(`\n  Mean sag: ${mean.toFixed(3)}V`);
    if (outliers.length > 0) {
      console.log('  OUTLIERS (>150mV deviation from mean):');
      for (const o of outliers) {
        const dir = o.sag > mean ? 'drew MORE current' : 'drew LESS current';
        console.log(`    Motor ${o.motor}: ${o.sag}V sag (${dir} than average)`);
      }
      console.log('  Motor pulling more current than peers at same PWM is consistent with inter-turn short.');
    } else {
      console.log('  All motors within normal variance — no electrical asymmetry detected.');
      console.log('  If motor 3 still sounds off, the cause is likely mechanical (bearing subtlety, slight bell eccentricity, or break-in).');
    }
  } else if (validSags.some(s => s === 0)) {
    console.log('\n  Voltage readback was 0V — FC VBAT sense may not be active, or battery is below detection threshold.');
    console.log('  Can not compare current draw with this data. Fall back to multimeter phase-resistance test.');
  }
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
