'use strict';

const {
  app, BrowserWindow, Tray, Menu, globalShortcut,
  ipcMain, screen, dialog, nativeImage, shell,
} = require('electron');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

// ─── Paths ───────────────────────────────────────────────────────────────────
const USER_DATA = app.getPath('userData');
const SETTINGS_FILE = path.join(USER_DATA, 'settings.json');
const NOTES_DIR = path.join(app.getPath('documents'), 'Overlay Notes');
const LAUNCH_AGENT = path.join(
  app.getPath('home'), 'Library', 'LaunchAgents', 'com.jogendra.macbookoverlay.plist');

const TEXT_EXTS = ['.txt', '.log', '.text'];

// ─── Settings model ──────────────────────────────────────────────────────────
// settings = { overlays: [ { id, file, opacity, displayIndex, bounds } ] }
function newRecord() {
  return {
    id: 'ov-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    file: null,
    opacity: 0.95,
    displayIndex: 0,
    theme: 'dark',
    bounds: null,
  };
}

function loadSettings() {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch {}
  if (!Array.isArray(s.overlays) || s.overlays.length === 0) {
    const r = newRecord();
    if (s.lastFile) r.file = s.lastFile;          // migrate old single-file format
    if (s.opacity) r.opacity = s.opacity;
    s = { overlays: [r] };
  }
  return s;
}

let settings = loadSettings();

// Live windows: webContents.id -> { rec, win, watcher, suppressUntil }
const overlays = new Map();
let lastActiveId = null;
let tray = null;
let saveTimer = null;

function persist() {
  const arr = [];
  for (const e of overlays.values()) {
    if (!e.win || e.win.isDestroyed()) continue;
    // Persist the "natural" bounds, not the collapsed/maximized ones.
    let bounds = e.win.getBounds();
    if (e.collapsed && e.collapsedFrom) bounds = { ...bounds, height: e.collapsedFrom };
    else if (e.maxed && e.maxFrom) bounds = e.maxFrom;
    arr.push({
      id: e.rec.id, file: e.rec.file, opacity: e.rec.opacity,
      displayIndex: e.rec.displayIndex, theme: e.rec.theme || 'dark', bounds,
    });
  }
  if (arr.length) settings.overlays = arr;
  try {
    fs.mkdirSync(USER_DATA, { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
  } catch (e) { console.error('persist failed', e); }
}
function persistSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(persist, 400); }

// ─── Window creation ─────────────────────────────────────────────────────────
const TRAY_ICON =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACwAAAAsCAYAAAAehFoBAAAAjUlEQVR42u2XwQ2AIAxF2YETC3RBR2AWl2IZ7QES4klQ0Op7yT+2/WnaUJwDAACAj+FV4aT8k0YXVVJtjUo5diprh9Gj1pmdLUWjShpGQnJMiZ/S6VSZ7SVW4zF8wUp35EIeqfIMXcRQFQovyINhDGMYwxjG8M+fZnPHj8nz0twBb/KLZPITCgAAALezAw+ljjkY/QyBAAAAAElFTkSuQmCC';

function defaultBounds(displayIndex, stagger) {
  const displays = screen.getAllDisplays();
  const d = displays[Math.min(displayIndex, displays.length - 1)] || screen.getPrimaryDisplay();
  const { x, y, width } = d.workArea;
  const w = 460, h = 620, off = (stagger % 5) * 34;
  return { x: Math.round(x + width - w - 24 - off), y: Math.round(y + 24 + off), width: w, height: h };
}

function createOverlay(rec, stagger = 0) {
  const win = new BrowserWindow({
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: true,
    skipTaskbar: true,
    show: false,
    vibrancy: 'under-window',
    visualEffectState: 'active',
    fullscreenable: false,
    minWidth: 260,
    minHeight: 180,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // allow preload to require('markdown-it')
    },
  });

  win.setContentProtection(true);               // invisible to screen capture/sharing
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setOpacity(rec.opacity);
  win.setBounds(rec.bounds || defaultBounds(rec.displayIndex, stagger));
  // Start interactive so the title bar reliably catches the mouse. The renderer
  // switches the CONTENT to click-through (ignore mouse, forward keeps mousemove
  // flowing) only while the pointer is over the content and the panel is locked.

  const wcId = win.webContents.id;   // capture now; webContents is gone after 'closed'
  const entry = { rec, win, watcher: null, suppressUntil: 0 };
  overlays.set(wcId, entry);

  win.webContents.on('preload-error', (_e, p, err) =>
    console.error('[preload-error]', p, err && err.message));
  win.webContents.on('console-message', (_e, level, message, line, source) => {
    if (level >= 2) console.error(`[renderer:${level}] ${message} (${source}:${line})`);
  });
  win.webContents.on('render-process-gone', (_e, d) =>
    console.error('[render-gone]', JSON.stringify(d)));

  win.loadFile('renderer.html');
  win.once('ready-to-show', () => win.showInactive());
  win.on('focus', () => { lastActiveId = wcId; });
  win.on('blur', () => send(entry, 'relock'));   // clicking away re-locks (click-through)
  win.on('resize', persistSoon);
  win.on('move', persistSoon);
  win.on('closed', () => {
    if (entry.watcher) entry.watcher.close();
    overlays.delete(wcId);
    if (lastActiveId === wcId) lastActiveId = null;
    persist();
    buildTrayMenu();
  });

  if (rec.file) watchFile(entry, rec.file);
  buildTrayMenu();
  return entry;
}

// ─── Helpers to resolve which overlay an action targets ─────────────────────────
function entryOf(eventOrWin) {
  if (eventOrWin && eventOrWin.sender) return overlays.get(eventOrWin.sender.id);
  return null;
}
function activeEntry() {
  const f = BrowserWindow.getFocusedWindow();
  if (f && overlays.has(f.webContents.id)) return overlays.get(f.webContents.id);
  if (lastActiveId && overlays.has(lastActiveId)) return overlays.get(lastActiveId);
  return overlays.values().next().value || null;
}
function send(entry, channel, payload) {
  if (entry && entry.win && !entry.win.isDestroyed()) entry.win.webContents.send(channel, payload);
}
function isTextFile(file) {
  return !!file && TEXT_EXTS.includes(path.extname(file).toLowerCase());
}
function payloadFor(entry) {
  let content = '';
  if (entry.rec.file) { try { content = fs.readFileSync(entry.rec.file, 'utf8'); } catch {} }
  return {
    file: entry.rec.file,
    name: entry.rec.file ? path.basename(entry.rec.file) : null,
    opacity: entry.rec.opacity,
    theme: entry.rec.theme || 'dark',
    isText: isTextFile(entry.rec.file),
    content,
  };
}

// ─── Files ───────────────────────────────────────────────────────────────────
function watchFile(entry, file) {
  if (entry.watcher) { entry.watcher.close(); entry.watcher = null; }
  if (!file) return;
  try {
    entry.watcher = fs.watch(file, () => {
      if (Date.now() < entry.suppressUntil) return;
      try {
        const content = fs.readFileSync(file, 'utf8');
        send(entry, 'file-changed', { content, isText: isTextFile(file) });
      } catch {}
    });
  } catch (e) { console.error('watch failed', e); }
}

function setFile(entry, file, enterEdit = false) {
  try {
    entry.rec.file = file;
    watchFile(entry, file);
    persist();
    send(entry, 'load-file', payloadFor(entry));
    if (enterEdit) send(entry, 'edit-mode', true);
    if (!entry.win.isVisible()) entry.win.showInactive();
    buildTrayMenu();
  } catch (e) {
    dialog.showErrorBox('Could not open file', String(e));
  }
}

async function pickFile(entry) {
  if (!entry) return;
  const r = await dialog.showOpenDialog(entry.win, {
    title: 'Open file',
    defaultPath: fs.existsSync(NOTES_DIR) ? NOTES_DIR : app.getPath('documents'),
    filters: [
      { name: 'Text & Markdown', extensions: ['md', 'markdown', 'txt', 'text', 'log'] },
      { name: 'All files', extensions: ['*'] },
    ],
    properties: ['openFile'],
  });
  if (!r.canceled && r.filePaths[0]) setFile(entry, r.filePaths[0]);
}

function freshNotePath() {
  fs.mkdirSync(NOTES_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return path.join(NOTES_DIR, `note-${stamp}.md`);
}

function newNote(entry) {
  if (!entry) return;
  const file = freshNotePath();
  fs.writeFileSync(file, '# New note\n\n');
  setFile(entry, file, true);
}

// Create + bind an empty backing file for an overlay that has none, so edits persist.
function ensureFile(entry) {
  if (!entry) return null;
  if (!entry.rec.file) {
    const file = freshNotePath();
    fs.writeFileSync(file, '');
    entry.rec.file = file;
    watchFile(entry, file);
    persist();
    buildTrayMenu();
  }
  return { name: path.basename(entry.rec.file), file: entry.rec.file };
}

function renameFile(entry, rawName) {
  if (!entry || !entry.rec.file) return { ok: false, error: 'no file' };
  let name = String(rawName || '').trim().replace(/[\/\\]/g, '');
  if (!name) return { ok: false, error: 'empty name' };
  const dir = path.dirname(entry.rec.file);
  if (!path.extname(name)) name += path.extname(entry.rec.file) || '.md';
  const dest = path.join(dir, name);
  if (dest === entry.rec.file) return { ok: true, name };
  if (fs.existsSync(dest)) return { ok: false, error: 'name already exists' };
  try {
    entry.suppressUntil = Date.now() + 600;
    fs.renameSync(entry.rec.file, dest);
    entry.rec.file = dest;
    watchFile(entry, dest);
    persist();
    buildTrayMenu();
    return { ok: true, name: path.basename(dest) };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// ─── Opacity & displays ──────────────────────────────────────────────────────
function bumpOpacity(entry, delta) {
  if (!entry) return 0;
  entry.rec.opacity = Math.min(1, Math.max(0.2, +(entry.rec.opacity + delta).toFixed(2)));
  entry.win.setOpacity(entry.rec.opacity);
  persistSoon();
  send(entry, 'status', `Opacity ${Math.round(entry.rec.opacity * 100)}%`);
  return entry.rec.opacity;
}

function moveToDisplay(entry, index) {
  const n = screen.getAllDisplays().length;
  entry.rec.displayIndex = ((index % n) + n) % n;
  entry.win.setBounds(defaultBounds(entry.rec.displayIndex, 0));
  persist();
  send(entry, 'status', `Display ${entry.rec.displayIndex + 1}/${n}`);
  buildTrayMenu();
}

function toggleAll() {
  const anyVisible = [...overlays.values()].some((e) => e.win.isVisible());
  for (const e of overlays.values()) {
    if (anyVisible) e.win.hide(); else e.win.showInactive();
  }
}

// ─── IPC ─────────────────────────────────────────────────────────────────────
ipcMain.handle('get-state', (e) => { const en = entryOf(e); return en ? payloadFor(en) : {}; });
ipcMain.handle('save-content', (e, content) => {
  const en = entryOf(e);
  if (!en) return { ok: false };
  if (!en.rec.file) ensureFile(en);   // backstop: bind a file if none yet
  try {
    en.suppressUntil = Date.now() + 500;
    fs.writeFileSync(en.rec.file, content);
    return { ok: true, name: path.basename(en.rec.file) };
  } catch (err) { return { ok: false, error: String(err) }; }
});
ipcMain.handle('ensure-file', (e) => ensureFile(entryOf(e)));
ipcMain.handle('pick-file', (e) => pickFile(entryOf(e)));
ipcMain.handle('new-note', (e) => newNote(entryOf(e)));
ipcMain.handle('new-overlay', () => { const en = createOverlay(newRecord(), overlays.size); persist(); return true; });
ipcMain.handle('rename-file', (e, name) => renameFile(entryOf(e), name));
ipcMain.handle('bump-opacity', (e, delta) => bumpOpacity(entryOf(e), delta));
ipcMain.handle('open-notes-dir', () => { fs.mkdirSync(NOTES_DIR, { recursive: true }); shell.openPath(NOTES_DIR); });
ipcMain.on('set-ignore', (e, ignore) => {
  const en = entryOf(e);
  if (en) en.win.setIgnoreMouseEvents(!!ignore, { forward: true });
});
ipcMain.on('win-close', (e) => { const en = entryOf(e); if (en) en.win.close(); });

// Manual window drag from the title bar (reliable even in click-through mode).
let dragState = null;
ipcMain.on('drag-begin', (e, p) => {
  const en = entryOf(e); if (!en) return;
  dragState = { win: en.win, winStart: en.win.getPosition(), screenStart: [p.x, p.y] };
});
ipcMain.on('drag-to', (_e, p) => {
  if (!dragState || dragState.win.isDestroyed()) return;
  dragState.win.setPosition(
    Math.round(dragState.winStart[0] + (p.x - dragState.screenStart[0])),
    Math.round(dragState.winStart[1] + (p.y - dragState.screenStart[1])));
});
ipcMain.on('drag-end', () => { dragState = null; persistSoon(); });
ipcMain.handle('win-minimize', (e) => {
  const en = entryOf(e); if (!en) return false;
  const b = en.win.getBounds();
  if (en.collapsed) {
    en.win.setBounds({ ...b, height: en.collapsedFrom || 560 });
    en.collapsed = false;
  } else {
    en.collapsedFrom = b.height;
    en.win.setBounds({ ...b, height: 40 });   // roll up to the title bar
    en.collapsed = true;
  }
  persistSoon();
  return en.collapsed;
});
ipcMain.handle('win-maximize', (e) => {
  const en = entryOf(e); if (!en) return false;
  if (en.maxed) {
    if (en.maxFrom) en.win.setBounds(en.maxFrom);
    en.maxed = false;
  } else {
    en.maxFrom = en.win.getBounds();
    const wa = screen.getDisplayMatching(en.win.getBounds()).workArea;
    en.win.setBounds({ x: wa.x + 12, y: wa.y + 12, width: wa.width - 24, height: wa.height - 24 });
    en.maxed = true;
  }
  persistSoon();
  return en.maxed;
});
ipcMain.handle('set-theme', (e, theme) => {
  const en = entryOf(e); if (!en) return 'dark';
  en.rec.theme = theme === 'light' ? 'light' : 'dark';
  persistSoon();
  return en.rec.theme;
});

// ─── Auto-start (LaunchAgent — reliable for the unpackaged dev app too) ────────
function loginEnabled() { return fs.existsSync(LAUNCH_AGENT); }
function setLogin(on) {
  if (on) {
    // Packaged: launch the app binary directly. Dev: launch electron with the project path.
    const args = app.isPackaged
      ? [process.execPath]
      : [process.execPath, app.getAppPath()];
    const progArgs = args.map((a) => `    <string>${a}</string>`).join('\n');
    const plist =
`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.jogendra.macbookoverlay</string>
  <key>ProgramArguments</key>
  <array>
${progArgs}
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><false/>
  <key>ProcessType</key><string>Interactive</string>
</dict>
</plist>
`;
    try {
      fs.mkdirSync(path.dirname(LAUNCH_AGENT), { recursive: true });
      fs.writeFileSync(LAUNCH_AGENT, plist);
      execFile('/bin/launchctl', ['load', '-w', LAUNCH_AGENT], () => {});
    } catch (e) { console.error('setLogin on failed', e); }
  } else {
    execFile('/bin/launchctl', ['unload', '-w', LAUNCH_AGENT], () => {
      try { fs.unlinkSync(LAUNCH_AGENT); } catch {}
    });
  }
  setTimeout(buildTrayMenu, 200);
}

// ─── Tray ────────────────────────────────────────────────────────────────────
function buildTrayMenu() {
  if (!tray) return;
  const displays = screen.getAllDisplays();
  const menu = Menu.buildFromTemplate([
    { label: 'Show / hide all', accelerator: 'Alt+Cmd+O', click: toggleAll },
    { label: 'New overlay', accelerator: 'Alt+Cmd+T', click: () => { createOverlay(newRecord(), overlays.size); persist(); } },
    { type: 'separator' },
    { label: 'Open file…', accelerator: 'Alt+Cmd+F', click: () => pickFile(activeEntry()) },
    { label: 'New note', accelerator: 'Alt+Cmd+N', click: () => newNote(activeEntry()) },
    { label: 'Open notes folder', click: () => { fs.mkdirSync(NOTES_DIR, { recursive: true }); shell.openPath(NOTES_DIR); } },
    { type: 'separator' },
    {
      label: 'Move active to display',
      submenu: displays.map((d, i) => ({
        label: `Display ${i + 1}  (${d.size.width}×${d.size.height})`,
        click: () => { const en = activeEntry(); if (en) moveToDisplay(en, i); },
      })),
    },
    {
      label: 'Opacity (active)',
      submenu: [
        { label: 'Increase', accelerator: 'Alt+Cmd+=', click: () => bumpOpacity(activeEntry(), 0.1) },
        { label: 'Decrease', accelerator: 'Alt+Cmd+-', click: () => bumpOpacity(activeEntry(), -0.1) },
      ],
    },
    { type: 'separator' },
    { label: `Overlays open: ${overlays.size}`, enabled: false },
    { label: 'Open at login', type: 'checkbox', checked: loginEnabled(), click: (i) => setLogin(i.checked) },
    { label: 'Quit', accelerator: 'Cmd+Q', role: 'quit' },
  ]);
  tray.setContextMenu(menu);
}

function createTray() {
  const img = nativeImage.createFromDataURL(TRAY_ICON);
  img.setTemplateImage(true);
  tray = new Tray(img);
  tray.setToolTip('Markdown Overlay');
  // Click opens the menu only (via setContextMenu); use the menu item to show/hide.
  buildTrayMenu();
}

// ─── App lifecycle ───────────────────────────────────────────────────────────
app.whenReady().then(() => {
  if (app.dock) app.dock.hide();
  settings.overlays.forEach((rec, i) => createOverlay({ ...newRecord(), ...rec }, i));
  createTray();

  globalShortcut.register('Alt+Cmd+O', toggleAll);
  globalShortcut.register('Alt+Cmd+T', () => { createOverlay(newRecord(), overlays.size); persist(); });
  globalShortcut.register('Alt+Cmd+=', () => bumpOpacity(activeEntry(), 0.1));
  globalShortcut.register('Alt+Cmd+-', () => bumpOpacity(activeEntry(), -0.1));
  globalShortcut.register('Alt+Cmd+0', () => { const e = activeEntry(); if (e) { e.rec.opacity = 0.95; e.win.setOpacity(0.95); persistSoon(); } });
  globalShortcut.register('Alt+Cmd+Right', () => { const e = activeEntry(); if (e) moveToDisplay(e, e.rec.displayIndex + 1); });
  globalShortcut.register('Alt+Cmd+F', () => pickFile(activeEntry()));
  globalShortcut.register('Alt+Cmd+N', () => newNote(activeEntry()));
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => { /* keep running as a menu-bar app */ });
