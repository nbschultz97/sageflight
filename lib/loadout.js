// Ceradon Loadout v1 — the shared contract between COTS-Architect (planning /
// inventory) and Sageflight (bench). COTS-Architect exports a planned build
// as loadout JSON; Sageflight imports it to drive build checklists and an
// as-designed vs. as-built verification against what's actually on the bench.
//
// The two tools stay separate products — this file IS the integration.
// Schema doc: docs/loadout-schema.md (kept in lockstep with this validator).

const ROLES = [
  'airframe', 'flight_controller', 'esc', 'motor', 'propeller',
  'receiver', 'vtx', 'camera', 'battery', 'gps', 'other',
];

function validateLoadout(obj) {
  const errors = [];
  const warnings = [];
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { ok: false, errors: ['loadout must be a JSON object'], warnings: [] };
  }
  if (obj.loadoutVersion !== 1) errors.push('loadoutVersion must be 1');
  if (!obj.name || typeof obj.name !== 'string') errors.push('name (string) is required');
  if (!Array.isArray(obj.components) || obj.components.length === 0) {
    errors.push('components must be a non-empty array');
  } else {
    obj.components.forEach((c, i) => {
      if (!c || typeof c !== 'object') { errors.push(`components[${i}] must be an object`); return; }
      if (!c.role || !ROLES.includes(c.role)) errors.push(`components[${i}].role must be one of: ${ROLES.join(', ')}`);
      if (!c.name || typeof c.name !== 'string') errors.push(`components[${i}].name (string) is required`);
      if (c.quantity != null && (!Number.isInteger(c.quantity) || c.quantity < 1 || c.quantity > 16)) {
        errors.push(`components[${i}].quantity must be an integer 1-16`);
      }
    });
  }
  if (obj.firmware != null && typeof obj.firmware !== 'object') errors.push('firmware must be an object');

  // Optional blocks (additive, consumers ignore what they don't understand).
  // A malformed tune/payload never rejects the loadout — the bench workflow
  // doesn't depend on them — but we surface warnings so producers can fix up.
  if (obj.payload_g != null && (typeof obj.payload_g !== 'number' || obj.payload_g < 0)) {
    warnings.push('payload_g should be a non-negative number (grams); ignoring');
  }
  if (obj.tune != null) {
    if (typeof obj.tune !== 'object' || Array.isArray(obj.tune)) {
      warnings.push('tune should be an object; ignoring');
    } else {
      if (obj.tune.tuneVersion !== 1) warnings.push('tune.tuneVersion should be 1');
      if (obj.tune.rates != null) {
        if (typeof obj.tune.rates !== 'object' || Array.isArray(obj.tune.rates)) {
          warnings.push('tune.rates should be an object of Betaflight CLI values');
        } else {
          for (const [k, v] of Object.entries(obj.tune.rates)) {
            if (k !== 'rates_type' && typeof v !== 'number') {
              warnings.push(`tune.rates.${k} should be a number (Betaflight CLI units)`);
            }
          }
        }
      }
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}

function findComponent(loadout, role) {
  return (loadout?.components || []).find(c => c.role === role) || null;
}

function expectedMotorCount(loadout) {
  const motor = findComponent(loadout, 'motor');
  return motor?.quantity || 4;
}

function summarizeLoadout(loadout) {
  if (!loadout) return null;
  return {
    name: loadout.name,
    source: loadout.source || null,
    exportedAt: loadout.exportedAt || null,
    airframeClass: loadout.airframeClass || null,
    firmware: loadout.firmware || null,
    componentCount: (loadout.components || []).length,
    motorCount: expectedMotorCount(loadout),
    flightController: findComponent(loadout, 'flight_controller')?.name || null,
    esc: findComponent(loadout, 'esc')?.name || null,
  };
}

const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// As-designed vs. as-built. scan = last FC scan (from /api/scan), escScan =
// last esc.interrogate history record. Every check degrades to 'unknown'
// rather than guessing when the bench side hasn't produced the data yet.
function verifyAgainstBench(loadout, { scan, escScan } = {}) {
  const checks = [];
  const add = (check, expected, actual, status) => checks.push({ check, expected: expected ?? null, actual: actual ?? null, status });

  const fw = loadout?.firmware || {};

  // Board target
  if (fw.target && scan?.boardName) {
    add('FC board target', fw.target, scan.boardName,
      norm(fw.target) === norm(scan.boardName) ? 'pass' : 'fail');
  } else {
    add('FC board target', fw.target, scan?.boardName, 'unknown');
  }

  // Firmware family
  if (fw.family && (scan?.fwVariant || scan?.firmware)) {
    add('Firmware family', fw.family, scan.fwVariant || 'Betaflight',
      norm(fw.family) === norm(scan.fwVariant || 'Betaflight') ? 'pass' : 'fail');
  } else {
    add('Firmware family', fw.family, scan?.fwVariant, 'unknown');
  }

  // Firmware version (prefix match: planned 4.5 accepts 4.5.1)
  if (fw.targetVersion && scan?.firmware) {
    add('Firmware version', fw.targetVersion, scan.firmware,
      String(scan.firmware).startsWith(String(fw.targetVersion)) ? 'pass' : 'fail');
  } else {
    add('Firmware version', fw.targetVersion, scan?.firmware, 'unknown');
  }

  // Motor/ESC count vs responsive ESC slots
  const wantMotors = expectedMotorCount(loadout);
  const responsive = escScan?.results?.filter(r => r.responsive).length;
  if (responsive != null) {
    add('Responsive ESC slots', wantMotors, responsive, responsive === wantMotors ? 'pass' : 'fail');
  } else {
    add('Responsive ESC slots', wantMotors, null, 'unknown');
  }

  // ESC firmware family, if the plan specifies one
  const escComp = findComponent(loadout, 'esc');
  const plannedEscFw = escComp?.specs?.firmware_family;
  if (plannedEscFw && escScan?.results?.length) {
    const families = [...new Set(escScan.results.filter(r => r.responsive).map(r => r.family))];
    const match = families.length === 1 && norm(families[0]).includes(norm(plannedEscFw));
    add('ESC firmware family', plannedEscFw, families.join(', ') || null, families.length ? (match ? 'pass' : 'fail') : 'unknown');
  } else {
    add('ESC firmware family', plannedEscFw, null, 'unknown');
  }

  const failed = checks.filter(c => c.status === 'fail').length;
  const passed = checks.filter(c => c.status === 'pass').length;
  return {
    verdict: failed > 0 ? 'MISMATCH' : passed > 0 ? 'MATCHES_PLAN' : 'INSUFFICIENT_DATA',
    passed, failed,
    checks,
  };
}

// Map loadout airframe classes onto Sageflight's checklist sets.
function checklistAirframe(loadout) {
  const c = String(loadout?.airframeClass || '').toLowerCase();
  if (/cine/.test(c)) return 'cinewhoop';
  if (/whoop|65|75mm/.test(c)) return 'whoop';
  if (/7|long/.test(c)) return 'longrange7';
  if (/5|freestyle|race/.test(c)) return 'freestyle5';
  return null;
}

module.exports = { ROLES, validateLoadout, summarizeLoadout, verifyAgainstBench, findComponent, expectedMotorCount, checklistAirframe };
