// Sageflight desktop shell.
//
// Spawns the production Express server (app/server.js) as a child process
// using this same binary in node mode (ELECTRON_RUN_AS_NODE), waits for
// /api/health, then opens the UI in a BrowserWindow.
//
// Two layouts:
//   dev      — repo checkout: server at ../app/server.js, dist built once
//   packaged — electron-builder output: server tree copied into ./bundle by
//              build-bundle.cjs (bundle/app/server.js, bundle/lib, bundle/llm,
//              bundle/app/dist), node_modules resolved from the app root
//
// Packaged installs keep user data (backups, test history, staged firmware,
// RAG index) in the OS per-user data dir, never in the install directory.

const { app, BrowserWindow, shell, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const net = require('net');

const ROOT = app.isPackaged ? path.join(__dirname, 'bundle') : path.join(__dirname, '..');
const SERVER = path.join(ROOT, 'app', 'server.js');
const DIST = path.join(ROOT, 'app', 'dist', 'index.html');

let serverProc = null;
let port = null;

function portFree(p) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(p, '127.0.0.1');
  });
}

// Prefer 3001 (MCP server default), walk up if something else owns it.
async function pickPort() {
  const preferred = parseInt(process.env.SAGEFLIGHT_PORT, 10);
  if (preferred) return preferred;
  for (let p = 3001; p < 3020; p++) {
    if (await portFree(p)) return p;
  }
  return 3001;
}

function startServer() {
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    ELECTRON_RUN_AS_NODE: '1',
    PORT: String(port),
  };
  if (app.isPackaged) {
    env.STACK_DATA_DIR = path.join(app.getPath('userData'), 'data');
  }
  serverProc = spawn(process.execPath, [SERVER], {
    cwd: path.dirname(SERVER),
    env,
    stdio: 'inherit',
  });
  serverProc.on('exit', (code) => {
    serverProc = null;
    if (code !== 0 && !app.isQuitting) {
      dialog.showErrorBox('Sageflight', `Backend server exited unexpectedly (code ${code}).`);
      app.quit();
    }
  });
}

async function waitForServer(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://localhost:${port}/api/health`);
      if (r.ok) return true;
    } catch {}
    await new Promise(r => setTimeout(r, 300));
  }
  return false;
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    backgroundColor: '#161a19',
    title: 'Sageflight',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'icon.ico'),
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  // External links open in the system browser, not inside the shell.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  const up = await waitForServer();
  if (!up) {
    dialog.showErrorBox('Sageflight', `Backend did not come up on port ${port}.` +
      (app.isPackaged ? '' : ' Is the frontend built? Run: cd app && npm run build'));
    app.quit();
    return;
  }
  win.loadURL(`http://localhost:${port}`);
}

app.whenReady().then(async () => {
  if (!fs.existsSync(DIST)) {
    dialog.showErrorBox('Sageflight', app.isPackaged
      ? 'Bundled frontend missing — broken install, please reinstall.'
      : 'Frontend build not found.\n\nRun once:  cd app && npm install && npm run build');
    app.quit();
    return;
  }
  port = await pickPort();
  startServer();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => { app.isQuitting = true; });
app.on('window-all-closed', () => app.quit());
app.on('quit', () => {
  if (serverProc) { try { serverProc.kill(); } catch {} }
});
