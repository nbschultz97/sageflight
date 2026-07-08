// Tool belt for the LLM agent loop.
//
// Deliberate safety boundary: the LLM can OBSERVE the aircraft (detect, scan,
// read config, read test history) but can never ACTUATE it directly. Motor
// spins and config writes stay behind the human-confirmed safety-token
// endpoints. The one bridge is propose_config_changes: the LLM drafts CLI
// commands, they are validated against the forbidden list, and the UI renders
// them as a card the human must explicitly approve before anything runs.

const { classifyCliCommand } = require('./fc-cli');

const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'detect_fc',
      description: 'Check whether a flight controller is currently connected over USB. Returns detection state (ALIVE / DFU / FAILED_ENUM / NOT_FOUND) and the serial port path.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'scan_fc',
      description: 'Read full identity and health from the connected flight controller via Betaflight CLI: board name, MCU, firmware version, sensors, voltage, CPU load, I2C errors. Takes ~15 seconds. Requires an ALIVE FC.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_config_diff',
      description: 'Read the current Betaflight configuration (CLI `diff all`) from the connected flight controller. Shows every setting that differs from firmware defaults. Requires an ALIVE FC.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_motor_history',
      description: 'Read recent motor test results (spin tests, 4-motor voltage-sag comparisons) recorded by this tool, newest first.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max number of records to return (default 10)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_config_backups',
      description: 'List saved Betaflight config backups (id, board, timestamp, size).',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_forensic_record',
      description: 'Look up the stack-forensic (fc-forensic) database record for a flight controller by MCU id — prior scans, unit status/label, and linked ESC records. Get the MCU id from scan_fc first. Returns null if the forensic DB is not installed or has no record.',
      parameters: {
        type: 'object',
        properties: {
          mcuId: { type: 'string', description: 'MCU id of the board (from scan_fc)' },
        },
        required: ['mcuId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_forensic_units',
      description: 'List every flight controller recorded in the stack-forensic database (batch, unit number, label, status, MCU id).',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_config_changes',
      description: 'Propose Betaflight CLI configuration changes to the user. The commands are validated and shown to the user as a reviewable card with an Apply button — they do NOT run until the user explicitly approves. Use exact CLI syntax (e.g. "set motor_pwm_protocol = DSHOT600"). Include "save" as the last command if the changes should persist. Never propose destructive commands (defaults, flash_erase, motor, ...) — they will be rejected.',
      parameters: {
        type: 'object',
        properties: {
          commands: {
            type: 'array',
            items: { type: 'string' },
            description: 'Ordered list of Betaflight CLI commands to run',
          },
          reason: { type: 'string', description: 'One-sentence explanation of what this change does and why' },
        },
        required: ['commands', 'reason'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_last_esc_scan',
      description: 'Read the most recent ESC interrogation result (BLHeli 4-way scan run from the ESC tab): per-slot responsiveness, chip signature, firmware family/version. Tells you which ESCs answer and what firmware they run.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_loadout',
      description: 'Read the planned build (loadout) imported from COTS-Architect, if any: intended components (FC, ESC, motors, receiver, VTX), target firmware, and airframe class. Use it to compare what SHOULD be on the bench against what actually is. Returns null if no loadout was imported — that is normal, Sageflight works standalone.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_live_telemetry',
      description: 'Read the live telemetry snapshot from the connected flight controller: attitude (roll/pitch/yaw), battery voltage/current, RSSI, RC channel values, motor outputs, cycle time, and — critically — the decoded arming-disable flags explaining exactly why the quad will not arm. Requires the user to have clicked Connect. THE tool for "why won\'t it arm" questions.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
];

// deps: { detectFC, scanFC, withCli, runExclusive, store, forensic, connection }
function createToolExecutor(deps) {
  const { detectFC, scanFC, withCli, runExclusive, store, forensic, connection } = deps;

  async function requireAlive() {
    const det = await detectFC();
    if (det.type !== 'ALIVE') {
      throw new Error(`No flight controller connected (state: ${det.type}). Ask the user to plug the FC in over USB.`);
    }
    return det;
  }

  const handlers = {
    async detect_fc() {
      return await detectFC();
    },
    async scan_fc() {
      const det = await requireAlive();
      const fc = await runExclusive(() => scanFC(det.comPort));
      // Drop raw CLI dumps — they blow up small-model context. get_config_diff
      // exists for when the agent actually wants the config text.
      const { rawStatus, rawDiff, ...summary } = fc;
      return summary;
    },
    async get_config_diff() {
      const det = await requireAlive();
      const diff = await runExclusive(() =>
        withCli(det.comPort, async ({ send }) => send('diff all', 8000))
      );
      return { diff: diff.trim() };
    },
    async get_motor_history({ limit = 10 } = {}) {
      return { history: store.readHistory(Math.min(Number(limit) || 10, 50)) };
    },
    async list_config_backups() {
      return { backups: store.listBackups() };
    },
    async get_forensic_record({ mcuId } = {}) {
      if (!forensic) return { error: 'forensic integration not available' };
      if (!mcuId) return { error: 'mcuId is required — run scan_fc first to get it' };
      const status = forensic.getStatus();
      if (!status.available) {
        return { record: null, forensicDb: 'not found', hint: status.hint };
      }
      const record = forensic.findUnitByMcuId(mcuId);
      return record
        ? { record }
        : { record: null, note: 'No forensic record for this MCU id — board was never scanned by fc-forensic.' };
    },
    async list_forensic_units() {
      if (!forensic) return { error: 'forensic integration not available' };
      const status = forensic.getStatus();
      if (!status.available) return { units: [], forensicDb: 'not found', hint: status.hint };
      return { units: forensic.listAllUnits() };
    },
    async propose_config_changes({ commands, reason } = {}) {
      const list = Array.isArray(commands) ? commands.map(c => String(c).trim()).filter(Boolean) : [];
      if (list.length === 0) return { error: 'commands must be a non-empty array of CLI lines' };
      if (list.length > 50) return { error: 'too many commands in one proposal (max 50)' };

      const rejected = [];
      for (const line of list) {
        const cls = classifyCliCommand(line);
        if (cls.kind === 'forbidden' || cls.kind === 'unknown' || cls.kind === 'invalid') {
          rejected.push({ line, kind: cls.kind });
        }
      }
      if (rejected.length > 0) {
        return { error: 'proposal rejected — these commands are not allowed', rejected };
      }
      return {
        proposal: { commands: list, reason: String(reason || '') },
        note: 'Proposal validated and shown to the user as an Apply card. It has NOT been executed — the user must approve it. Tell the user what you proposed and to review the card.',
      };
    },
    async get_loadout() {
      const loadout = store.readLoadout ? store.readLoadout() : null;
      if (!loadout) return { loadout: null, note: 'No loadout imported. Sageflight is running standalone — that is fine.' };
      return { loadout };
    },
    async get_live_telemetry() {
      if (!connection) return { error: 'live connection not available' };
      const state = connection.getState();
      if (!state.connected || !state.telemetry) {
        return {
          connected: false,
          note: 'No live connection. Ask the user to click Connect in the header (FC must be plugged in over USB).',
        };
      }
      return { connected: true, ...state.telemetry };
    },
    async get_last_esc_scan() {
      const scan = store.readHistory(200).find(h => h.kind === 'esc.interrogate');
      if (!scan) return { scan: null, note: 'No ESC interrogation recorded yet — run one from the ESC tab (battery on, props off).' };
      // Strip raw EEPROM hex — it is noise for the model.
      const results = (scan.results || []).map(({ fingerprintHex, ...r }) => r);
      return { scan: { ...scan, results } };
    },
  };

  return async function execTool(name, args = {}) {
    const handler = handlers[name];
    if (!handler) return { error: `Unknown tool: ${name}` };
    try {
      return await handler(args);
    } catch (e) {
      return { error: e.message };
    }
  };
}

module.exports = { TOOL_DEFINITIONS, createToolExecutor };
