// Sageflight desktop shell.
//
// Spawns the production Express server (app/server.js) as a child Node
// process, waits for /api/health, then opens the UI in a BrowserWindow.
// Prereq: the frontend must be built once (`cd app && npm run build`).

const { app, BrowserWindow, shell, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const APP_DIR = path.join(__dirname, '..', 'app');
const SERVER = path.join(APP_DIR, 'server.js');
const DIST = path.join(APP_DIR, 'dist', 'index.html');
const PORT = process.env.PORT || 3001;
const URL = `http://localhost:${PORT}`;

let serverProc = null;

function startServer() {
  serverProc = spawn(process.execPath, [SERVER], {
    cwd: APP_DIR,
    env: { ...process.env, NODE_ENV: 'production', ELECTRON_RUN_AS_NODE: '1', PORT: String(PORT) },
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

async function waitForServer(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${URL}/api/health`);
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
    backgroundColor: '#262b25',
    title: 'Sageflight',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  // External links open in the system browser, not inside the shell.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  const up = await waitForServer();
  if (!up) {
    dialog.showErrorBox('Sageflight', `Backend did not come up on ${URL}. Is the frontend built? Run: cd app && npm run build`);
    app.quit();
    return;
  }
  win.loadURL(URL);
}

app.whenReady().then(() => {
  if (!fs.existsSync(DIST)) {
    dialog.showErrorBox('Sageflight', 'Frontend build not found.\n\nRun once:  cd app && npm install && npm run build');
    app.quit();
    return;
  }
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
