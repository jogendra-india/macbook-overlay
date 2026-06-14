'use strict';

const {
  app, BrowserWindow, Tray, Menu, globalShortcut,
  ipcMain, screen, dialog, nativeImage, shell,
} = require('electron');
const fs = require('fs');
const path = require('path');

// ─── Paths & settings ────────────────────────────────────────────────────────
const USER_DATA = app.getPath('userData');
const SETTINGS_FILE = path.join(USER_DATA, 'settings.json');
const NOTES_DIR = path.join(app.getPath('documents'), 'Overlay Notes');

const DEFAULTS = {
  opacity: 0.95,
  displayIndex: 0,
  bounds: { width: 460, height: 620 },
  lastFile: null,
};

function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveSettings() {
  try {
    fs.mkdirSync(USER_DATA, { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
  } catch (e) {
    console.error('saveSettings failed', e);
  }
}

let settings = loadSettings();
let win = null;
let tray = null;
let currentFile = settings.lastFile;
let fileWatcher = null;
let suppressWatchUntil = 0; // ignore our own writes to avoid reload loops

// ─── Window ──────────────────────────────────────────────────────────────────
function placeOnDisplay(index) {
  const displays = screen.getAllDisplays();
  const d = displays[Math.min(index, displays.length - 1)] || screen.getPrimaryDisplay();
  const { x, y, width, height } = d.workArea;
  const w = settings.bounds.width;
  const h = settings.bounds.height;
  win.setBounds({
    x: Math.round(x + width - w - 24),
    y: Math.round(y + 24),
    width: w,
    height: h,
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: settings.bounds.width,
    height: settings.bounds.height,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: true,
    skipTaskbar: true,
    show: false,
    vibrancy: 'under-window',
    visualEffectState: 'active',
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // The single flag that makes the window invisible to screen capture / sharing.
  win.setContentProtection(true);

  // Float above everything, on every Space, even over fullscreen apps.
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  win.setOpacity(settings.opacity);
  placeOnDisplay(settings.displayIndex);

  win.loadFile('renderer.html');

  win.once('ready-to-show', () => {
    win.showInactive();
    if (currentFile) openFile(currentFile, false);
  });

  win.on('resize', () => {
    const [width, height] = win.getSize();
    settings.bounds = { width, height };
    saveSettings();
  });
}

function toggleWindow() {
  if (!win) return;
  if (win.isVisible()) win.hide();
  else win.showInactive();
}

// ─── Opacity & displays ──────────────────────────────────────────────────────
function bumpOpacity(delta) {
  settings.opacity = Math.min(1, Math.max(0.15, +(settings.opacity + delta).toFixed(2)));
  win.setOpacity(settings.opacity);
  saveSettings();
  send('status', `Opacity ${Math.round(settings.opacity * 100)}%`);
}

function cycleDisplay() {
  const n = screen.getAllDisplays().length;
  settings.displayIndex = (settings.displayIndex + 1) % n;
  placeOnDisplay(settings.displayIndex);
  saveSettings();
  send('status', `Display ${settings.displayIndex + 1}/${n}`);
  buildTrayMenu();
}

// ─── Files ───────────────────────────────────────────────────────────────────
function watchFile(file) {
  if (fileWatcher) { fileWatcher.close(); fileWatcher = null; }
  if (!file) return;
  try {
    fileWatcher = fs.watch(file, () => {
      if (Date.now() < suppressWatchUntil) return; // ignore our own save
      try {
        const content = fs.readFileSync(file, 'utf8');
        send('file-changed', { file, content });
      } catch {}
    });
  } catch (e) { console.error('watch failed', e); }
}

function openFile(file, focus = true) {
  try {
    const content = fs.readFileSync(file, 'utf8');
    currentFile = file;
    settings.lastFile = file;
    saveSettings();
    watchFile(file);
    send('load-file', { file, name: path.basename(file), content });
    if (focus && !win.isVisible()) win.showInactive();
    buildTrayMenu();
  } catch (e) {
    dialog.showErrorBox('Could not open file', String(e));
  }
}

async function pickFile() {
  const r = await dialog.showOpenDialog(win, {
    title: 'Open markdown file',
    defaultPath: fs.existsSync(NOTES_DIR) ? NOTES_DIR : app.getPath('documents'),
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }],
    properties: ['openFile'],
  });
  if (!r.canceled && r.filePaths[0]) openFile(r.filePaths[0]);
}

function newNote() {
  fs.mkdirSync(NOTES_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(NOTES_DIR, `note-${stamp}.md`);
  fs.writeFileSync(file, `# New note\n\n`);
  openFile(file);
  send('edit-mode', true);
}

// Autosave from the editor. Debounced on the renderer side.
ipcMain.handle('save-content', (_e, content) => {
  if (!currentFile) return { ok: false };
  try {
    suppressWatchUntil = Date.now() + 400;
    fs.writeFileSync(currentFile, content);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

ipcMain.handle('pick-file', () => pickFile());
ipcMain.handle('new-note', () => newNote());
ipcMain.handle('open-notes-dir', () => {
  fs.mkdirSync(NOTES_DIR, { recursive: true });
  shell.openPath(NOTES_DIR);
});
ipcMain.handle('get-state', () => {
  let content = '';
  if (currentFile) { try { content = fs.readFileSync(currentFile, 'utf8'); } catch {} }
  return {
    file: currentFile,
    name: currentFile ? path.basename(currentFile) : null,
    opacity: settings.opacity,
    content,
  };
});

// ─── Tray (menu-bar control) ─────────────────────────────────────────────────
function buildTrayMenu() {
  if (!tray) return;
  const displays = screen.getAllDisplays();
  const menu = Menu.buildFromTemplate([
    { label: win && win.isVisible() ? 'Hide overlay' : 'Show overlay', accelerator: 'Alt+Cmd+O', click: toggleWindow },
    { type: 'separator' },
    { label: 'Open file…', accelerator: 'Alt+Cmd+F', click: pickFile },
    { label: 'New note', accelerator: 'Alt+Cmd+N', click: newNote },
    { label: 'Open notes folder', click: () => { fs.mkdirSync(NOTES_DIR, { recursive: true }); shell.openPath(NOTES_DIR); } },
    { type: 'separator' },
    {
      label: 'Show on display',
      submenu: displays.map((d, i) => ({
        label: `Display ${i + 1}  (${d.size.width}×${d.size.height})${i === settings.displayIndex ? '  ✓' : ''}`,
        click: () => { settings.displayIndex = i; placeOnDisplay(i); saveSettings(); buildTrayMenu(); },
      })),
    },
    {
      label: 'Opacity',
      submenu: [
        { label: 'Increase', accelerator: 'Alt+Cmd+=', click: () => bumpOpacity(0.1) },
        { label: 'Decrease', accelerator: 'Alt+Cmd+-', click: () => bumpOpacity(-0.1) },
        { label: 'Reset', accelerator: 'Alt+Cmd+0', click: () => { settings.opacity = 0.95; win.setOpacity(0.95); saveSettings(); } },
      ],
    },
    { type: 'separator' },
    {
      label: 'Open at login',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
    },
    { label: 'Quit', accelerator: 'Cmd+Q', role: 'quit' },
  ]);
  tray.setContextMenu(menu);
}

// 36×36 template PNG (a "▣" glyph) embedded so there is no binary asset to sync.
const TRAY_ICON =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACQAAAAkCAYAAADhAJiYAAAAQElEQVR42u3XQQoAIAhFQe9/6TqD+DGCeeB+FmJUJeU7ywMUBW2sBRAQ0OQ0AAEBAQG9AnnLgIBSIP+yL0BSpwvegI6ANZLmBQAAAABJRU5ErkJggg==';

function createTray() {
  const img = nativeImage.createFromDataURL(TRAY_ICON);
  img.setTemplateImage(true); // adapts to light/dark menu bar
  tray = new Tray(img);
  tray.setToolTip('Markdown Overlay');
  tray.on('click', toggleWindow); // left-click toggles
  buildTrayMenu();
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// ─── App lifecycle ───────────────────────────────────────────────────────────
app.whenReady().then(() => {
  if (app.dock) app.dock.hide(); // menu-bar app, no dock icon
  createWindow();
  createTray();

  globalShortcut.register('Alt+Cmd+O', toggleWindow);
  globalShortcut.register('Alt+Cmd+=', () => bumpOpacity(0.1));
  globalShortcut.register('Alt+Cmd+-', () => bumpOpacity(-0.1));
  globalShortcut.register('Alt+Cmd+0', () => { settings.opacity = 0.95; win.setOpacity(0.95); saveSettings(); });
  globalShortcut.register('Alt+Cmd+Right', cycleDisplay);
  globalShortcut.register('Alt+Cmd+F', pickFile);
  globalShortcut.register('Alt+Cmd+N', newNote);
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (fileWatcher) fileWatcher.close();
});

app.on('window-all-closed', (e) => { /* keep running as a menu-bar app */ });
