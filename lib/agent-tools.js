// Read-only tool belt for the LLM agent loop.
//
// Deliberate safety boundary: the LLM can OBSERVE the aircraft (detect, scan,
// read config, read test history) but can never ACTUATE it. Motor spins and
// config writes stay behind the human-confirmed safety-token endpoints. The
// agent's job is to decide what to look at and interpret what it sees.

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
];

// deps: { detectFC, scanFC, withCli, runExclusive, store }
function createToolExecutor(deps) {
  const { detectFC, scanFC, withCli, runExclusive, store } = deps;

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
