// Motor break-in cycle — gradual PWM ramp for new-motor bearing seating.
// 6 stages × 5 seconds = 30 seconds total. Voltage captured at each stage for current-draw monitoring.
//
// Usage: node spin-breakin.js <motor 1-4>

const readline = require('readline');
const { SerialPort } = require('serialport');
const { detectFC } = require('./lib/usb-detect');
const { printBanner } = require('./lib/banner');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const motorHuman = parseInt(process.argv[2], 10);
if (!motorHuman || motorHuman < 1 || motorHuman > 4) {
  console.log('Usage: node spin-breakin.js <motor 1-4>');
  process.exit(1);
}
const motorIdx = motorHuman - 1;
const stages = [1050, 1070, 1090, 1110, 1130, 1150];
const stageSeconds = 5;

async function ask(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => rl.question(q, a => { rl.close(); res(a.trim().toLowerCase()); }));
}

function parseVoltage(buf) {
  const mult = buf.match(/Voltage:\s*(\d+)\s*\*\s*([\d.]+)V/);
  if (mult) return +(parseFloat(mult[1]) * parseFloat(mult[2])).toFixed(2);
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
  console.log(`\n  === MOTOR ${motorHuman} BREAK-IN CYCLE ===`);
  console.log(`  6 stages × ${stageSeconds}s = ${stages.length * stageSeconds}s total`);
  console.log(`  PWM schedule: ${stages.join(' -> ')}`);
  console.log('\n  SAFETY: Props off ALL motors. Quad restrained. Battery connected.\n');

  const a = await ask('  Props OFF and quad secured? Type "yes" to proceed: ');
  if (a !== 'yes' && a !== 'y') { console.log('  Aborted.'); return; }

  const det = detectFC();
  if (det.type !== 'ALIVE') { console.log('  No FC.'); process.exit(1); }

  const port = new SerialPort({ path: det.comPort, baudRate: 115200 });
  await new Promise((r, e) => { port.on('open', r); port.on('error', e); });
  await sleep(500);
  port.write('#');
  await sleep(1500);

  const results = [];
  try {
    // Baseline voltage
    const baseBuf = await cliRoundTrip(port, 'status', 2000);
    const vBase = parseVoltage(baseBuf);
    console.log(`\n  Baseline battery: ${vBase}V`);

    for (let i = 0; i < stages.length; i++) {
      const pwm = stages[i];
      console.log(`\n  Stage ${i+1}/${stages.length}: motor ${motorHuman} at ${pwm} PWM for ${stageSeconds}s...`);
      await cliRoundTrip(port, `motor ${motorIdx} ${pwm}`, 200);
      // Stabilize, then measure voltage under load
      await sleep(1500);
      const loadBuf = await cliRoundTrip(port, 'status', 1800);
      const vLoad = parseVoltage(loadBuf);
      const sag = (vBase != null && vLoad != null) ? +(vBase - vLoad).toFixed(3) : null;
      results.push({ stage: i+1, pwm, vLoad, sag });
      console.log(`    under-load voltage: ${vLoad}V   sag from baseline: ${sag}V`);
      // Remaining time at this PWM
      await sleep(stageSeconds * 1000 - 3500);
    }

    // Cooldown stop
    console.log('\n  Stopping motor...');
    for (let m = 0; m < 4; m++) await cliRoundTrip(port, `motor ${m} 1000`, 100);
  } catch (e) {
    console.error('  Error:', e.message);
    for (let m = 0; m < 4; m++) { try { port.write(`motor ${m} 1000\r\n`); } catch {} }
  } finally {
    for (let m = 0; m < 4; m++) await cliRoundTrip(port, `motor ${m} 1000`, 50);
    port.write('exit\r\n');
    await sleep(500);
    await new Promise(r => port.close(r));
  }

  console.log('\n  === BREAK-IN SUMMARY ===');
  console.log('  Stage | PWM  | V-load | Sag');
  console.log('  ------+------+--------+-------');
  for (const r of results) {
    console.log(`    ${r.stage}   | ${r.pwm} | ${String(r.vLoad ?? 'n/a').padEnd(6)} | ${r.sag ?? 'n/a'}`);
  }
  const sags = results.filter(r => r.sag != null).map(r => r.sag);
  if (sags.length === results.length) {
    const trend = sags[sags.length - 1] - sags[0];
    console.log(`\n  Sag trend (last - first): ${trend.toFixed(3)}V`);
    console.log('  As PWM climbs, sag should climb proportionally (more current = more drop).');
    console.log('  Unexpectedly HIGH sag at any one stage = possible intermittent short.');
  }

  console.log('\n  LISTEN: Did the grinding reduce over the 30 seconds, stay the same, or get worse?');
  console.log('    Reduced  -> break-in noise, motor is fine to fly');
  console.log('    Same     -> slight mechanical issue, flyable but will likely be replaced early');
  console.log('    Worse    -> bearing failing under heat, swap the motor');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
