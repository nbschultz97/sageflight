// Fleet timeline: everything Sageflight knows about every board it has ever
// touched, grouped per board — config backups, blackbox logs, and the global
// bench-activity feed. Answers "what changed since this quad last flew well?"
//
// Pure aggregation over the store's lists — no I/O here.

function normBoard(name) {
  const s = String(name || '').trim().toUpperCase();
  return s && s !== 'UNKNOWN-BOARD' && s !== 'UNKNOWN' ? s : null;
}

// backups: store.listBackups()      [{ id, createdAt, boardName, auto, reason, bytes }]
// logs:    store.listBlackboxes()   [{ name, uploadedAt, board, craft, bytes, source }]
// history: store.readHistory(n)     [{ at, kind, ... }]
// forensicUnits: forensic.listAllUnits() [{ batch, label, status, mcuId, lastScanAt }]
function buildFleet({ backups = [], logs = [], history = [], forensicUnits = [] } = {}) {
  const boards = new Map();

  const boardEntry = (key) => {
    if (!boards.has(key)) {
      boards.set(key, { board: key, crafts: new Set(), backups: [], logs: [], events: [] });
    }
    return boards.get(key);
  };

  for (const b of backups) {
    const key = normBoard(b.boardName) || 'UNIDENTIFIED';
    const e = boardEntry(key);
    e.backups.push(b);
    e.events.push({
      at: b.createdAt || null,
      type: 'backup',
      label: b.auto ? `auto snapshot${b.reason ? ` (${b.reason})` : ''}` : 'config backup',
      id: b.id,
    });
  }

  for (const l of logs) {
    const key = normBoard(l.board) || 'UNIDENTIFIED';
    const e = boardEntry(key);
    if (l.craft) e.crafts.add(l.craft);
    e.logs.push(l);
    e.events.push({
      at: l.uploadedAt || null,
      type: 'log',
      label: `blackbox log${l.craft ? ` · ${l.craft}` : ''}${l.source === 'dataflash' ? ' (from FC flash)' : ''}`,
      name: l.name,
      bytes: l.bytes,
    });
  }

  const out = [...boards.values()].map(e => {
    e.events.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
    // Consecutive backups (newest first) — the "what changed" diff pairs.
    const sortedBackups = [...e.backups].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    const diffPairs = [];
    for (let i = 0; i + 1 < sortedBackups.length; i++) {
      diffPairs.push({ from: sortedBackups[i + 1].id, to: sortedBackups[i].id, at: sortedBackups[i].createdAt });
    }
    const stamps = e.events.map(ev => ev.at).filter(Boolean);
    return {
      board: e.board,
      crafts: [...e.crafts],
      backupCount: e.backups.length,
      logCount: e.logs.length,
      firstSeen: stamps.length ? stamps[stamps.length - 1] : null,
      lastSeen: stamps.length ? stamps[0] : null,
      events: e.events.slice(0, 100),
      diffPairs: diffPairs.slice(0, 25),
    };
  }).sort((a, b) => String(b.lastSeen || '').localeCompare(String(a.lastSeen || '')));

  return {
    boards: out,
    benchActivity: history.slice(0, 50),
    caseHistory: forensicUnits,
  };
}

module.exports = { buildFleet, normBoard };
