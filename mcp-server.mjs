// Sageflight MCP server — exposes the bench's READ-ONLY tools over the Model
// Context Protocol so external agents (Claude Code, Reg, anything MCP-aware)
// can inspect the aircraft: detection, scans, live telemetry + arming flags,
// config, test history, forensic records, the planned loadout.
//
// Deliberately no actuation tools: motor spins, config writes, and flashing
// stay behind Sageflight's human-confirmed safety tokens. An external agent
// can look; only the human at the bench can make it move.
//
// Talks HTTP to the running Sageflight app (npm run dev / npm start in app/),
// so there is never serial-port contention. Override with SAGEFLIGHT_URL.
//
// Register in Claude Code (.mcp.json):
//   { "mcpServers": { "sageflight": { "command": "node", "args": ["<repo>/mcp-server.mjs"] } } }

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const BASE = process.env.SAGEFLIGHT_URL || 'http://localhost:3001';

async function api(path, opts = {}) {
  let r;
  try {
    r = await fetch(BASE + path, {
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(60000),
      ...opts,
    });
  } catch (e) {
    throw new Error(`Sageflight app not reachable at ${BASE} (${e.message}). Start it: cd app && npm start`);
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

const text = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj, null, 1) }] });
const fail = (e) => ({ content: [{ type: 'text', text: `ERROR: ${e.message}` }], isError: true });

const server = new McpServer({ name: 'sageflight', version: '0.4.0' });

server.tool('detect_fc',
  'Check whether a flight controller is connected over USB and in what state (ALIVE / DFU / FAILED_ENUM / NOT_FOUND).',
  {},
  async () => { try { return text(await api('/api/detect')); } catch (e) { return fail(e); } });

server.tool('scan_fc',
  'Full identity/health scan of the connected FC via Betaflight CLI: board, firmware variant+version, sensors, voltage, CPU load. Takes ~15s.',
  {},
  async () => {
    try {
      const j = await api('/api/scan', { method: 'POST', body: '{}' });
      const { rawStatus, rawDiff, ...fc } = j.fc || {};
      return text({ detection: j.detection, fc });
    } catch (e) { return fail(e); }
  });

server.tool('get_config_diff',
  'Read the current configuration (CLI `diff all`) from the connected FC — every setting that differs from defaults.',
  {},
  async () => {
    try {
      const j = await api('/api/cli', { method: 'POST', body: JSON.stringify({ command: 'diff all' }) });
      return text({ diff: j.output });
    } catch (e) { return fail(e); }
  });

server.tool('get_live_telemetry',
  'Live telemetry snapshot if a persistent connection is open: attitude, battery, RSSI, RC channels, motor outputs, and decoded arming-disable flags (why it will not arm).',
  {},
  async () => { try { return text(await api('/api/connection')); } catch (e) { return fail(e); } });

server.tool('get_test_history',
  'Recent bench test records: motor spins, 4-motor sag comparisons, ESC interrogations, flashes, calibrations. Newest first.',
  { limit: z.number().int().min(1).max(200).optional() },
  async ({ limit = 30 }) => {
    try { return text(await api(`/api/history?limit=${limit}`)); } catch (e) { return fail(e); }
  });

server.tool('get_last_esc_scan',
  'Most recent BLHeli 4-way ESC interrogation: per-slot responsiveness, chip signature, firmware family/version.',
  {},
  async () => {
    try {
      const j = await api('/api/history?limit=200');
      const scan = (j.history || []).find(h => h.kind === 'esc.interrogate') || null;
      return text({ scan });
    } catch (e) { return fail(e); }
  });

server.tool('list_config_backups',
  'List saved Betaflight config backups (id, board, timestamp, size).',
  {},
  async () => { try { return text(await api('/api/config/backups')); } catch (e) { return fail(e); } });

server.tool('get_forensic_record',
  'Look up the fc-forensic case history for a board by MCU id (from scan_fc): unit status, prior scans, linked ESC records.',
  { mcuId: z.string() },
  async ({ mcuId }) => {
    try { return text(await api(`/api/forensic/unit/${encodeURIComponent(mcuId)}`)); } catch (e) { return fail(e); }
  });

server.tool('list_forensic_units',
  'List every flight controller recorded in the fc-forensic database.',
  {},
  async () => { try { return text(await api('/api/forensic/units')); } catch (e) { return fail(e); } });

server.tool('get_loadout',
  'Read the planned build (Ceradon Loadout) imported from COTS-Architect, if any — intended components and target firmware.',
  {},
  async () => { try { return text(await api('/api/loadout')); } catch (e) { return fail(e); } });

const transport = new StdioServerTransport();
await server.connect(transport);
