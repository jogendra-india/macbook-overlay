'use strict';

const $ = (s) => document.querySelector(s);
const view = $('#view'), editor = $('#editor'), titleEl = $('#title'),
      titleEdit = $('#title-edit'), savedEl = $('#saved'), btnEdit = $('#btn-edit');
let currentText = '';
let isText = false;
let hasFile = false;
let saveTimer = null;

function setTitle(name) {
  titleEl.textContent = name || 'Markdown Overlay';
  hasFile = !!name;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function render(text) {
  currentText = text || '';
  if (!currentText.trim()) { view.innerHTML = '<div class="empty">Empty file.</div>'; return; }
  view.innerHTML = isText
    ? '<pre class="plain">' + escapeHtml(currentText) + '</pre>'   // .txt → plain text
    : window.overlay.renderMarkdown(currentText);                  // .md  → rendered
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 1400);
}

async function setEditing(on) {
  if (on && !hasFile) {
    // No file bound yet — create one so edits actually persist.
    const r = await window.overlay.ensureFile();
    if (r && r.name) setTitle(r.name);
  }
  document.body.classList.toggle('editing', on);
  btnEdit.classList.toggle('active', on);
  if (on) { editor.value = currentText; editor.focus(); }
  else { render(editor.value); }
}

// ─── Autosave ────────────────────────────────────────────────────────────────
editor.addEventListener('input', () => {
  savedEl.textContent = 'saving…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const r = await window.overlay.saveContent(editor.value);
    currentText = editor.value;
    if (r && r.name) setTitle(r.name);   // reflect the auto-created file name
    savedEl.textContent = r && r.ok ? 'saved ✓' : 'save failed';
    setTimeout(() => (savedEl.textContent = ''), 1200);
  }, 500);
});

// ─── Bar buttons ─────────────────────────────────────────────────────────────
const btnMin = $('#btn-min'), btnMax = $('#btn-max'), btnMore = $('#btn-more');
const opVal = $('#m-op-val'), themeVal = $('#m-theme-val');
let theme = 'dark';

btnEdit.addEventListener('click', () => setEditing(!document.body.classList.contains('editing')));
$('#btn-close').addEventListener('click', () => window.overlay.winClose());
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'w') { e.preventDefault(); window.overlay.winClose(); }
});
btnMin.addEventListener('click', () => {
  window.overlay.winMinimize().then((collapsed) =>
    document.body.classList.toggle('collapsed', !!collapsed));
});
btnMax.addEventListener('click', () => {
  window.overlay.winMaximize().then((maxed) => btnMax.classList.toggle('active', !!maxed));
});

// ─── Theme ───────────────────────────────────────────────────────────────────
function applyTheme(t) {
  theme = t === 'light' ? 'light' : 'dark';
  document.body.classList.toggle('light', theme === 'light');
  if (themeVal) themeVal.textContent = theme === 'light' ? 'Light' : 'Dark';
}

// ─── ⋯ overflow menu ─────────────────────────────────────────────────────────
function setMenu(open) { document.body.classList.toggle('menu-open', open); }
btnMore.addEventListener('click', (e) => { e.stopPropagation(); setMenu(!document.body.classList.contains('menu-open')); });
document.addEventListener('mousedown', (e) => {            // click outside closes
  if (!e.target.closest('#menu') && !e.target.closest('#btn-more')) setMenu(false);
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });

// Opacity & theme stay open (live tweaking); actions close the menu.
$('#m-op-down').addEventListener('click', () => window.overlay.bumpOpacity(-0.1).then(showOpacity));
$('#m-op-up').addEventListener('click', () => window.overlay.bumpOpacity(0.1).then(showOpacity));
$('#m-theme').addEventListener('click', () => {
  applyTheme(theme === 'light' ? 'dark' : 'light');
  window.overlay.setTheme(theme);
});
function runAndClose(fn) { setMenu(false); fn(); }
$('#m-new').addEventListener('click', () => runAndClose(() => window.overlay.newNote()));
$('#m-open').addEventListener('click', () => runAndClose(() => window.overlay.pickFile()));
$('#m-overlay').addEventListener('click', () => runAndClose(() => window.overlay.newOverlay()));
$('#m-dir').addEventListener('click', () => runAndClose(() => window.overlay.openNotesDir()));

function showOpacity(v) { if (typeof v === 'number' && opVal) opVal.textContent = Math.round(v * 100) + '%'; }

// ─── Rename: double-click the title ──────────────────────────────────────────
function startRename() {
  if (!hasFile) { toast('Start editing first to create the file'); return; }
  titleEdit.value = titleEl.textContent;
  document.body.classList.add('renaming');
  titleEdit.focus(); titleEdit.select();
}
function commitRename() {
  if (!document.body.classList.contains('renaming')) return;
  document.body.classList.remove('renaming');
  const name = titleEdit.value.trim();
  if (name && name !== titleEl.textContent) {
    window.overlay.renameFile(name).then((r) => {
      if (r && r.ok) { setTitle(r.name); toast('Renamed'); }
      else toast(r && r.error ? r.error : 'Rename failed');
    });
  }
}
titleEl.addEventListener('dblclick', startRename);
titleEdit.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') commitRename();
  else if (e.key === 'Escape') document.body.classList.remove('renaming');
});
titleEdit.addEventListener('blur', commitRename);

// ─── Click-through ────────────────────────────────────────────────────────────
// The TITLE BAR is always interactive — grab it to move the window, or use its
// buttons, at any time without unlocking. Only the CONTENT below is click-through
// (clicks pass to whatever is underneath) until you unlock it with the 🔒 button.
const btnLock = $('#btn-lock');
let locked = true;          // refers to the content area only
let interactiveNow = false;

function applyInteractive(on) {
  if (on === interactiveNow) return;
  interactiveNow = on;
  window.overlay.setIgnore(!on); // ignore mouse = NOT interactive
}
function refresh(e) {
  const overBar = e && e.target && e.target.closest && e.target.closest('.bar');
  // Bar is always hot (move/drag/buttons); content is hot only when unlocked.
  applyInteractive(!locked || !!overBar);
}
function updateLock() {
  btnLock.textContent = locked ? '🔒' : '🔓';
  btnLock.classList.toggle('active', !locked);
  btnLock.title = locked
    ? 'Content is click-through — click to interact with the note (title bar always moves the window)'
    : 'Content is interactive — click to make it click-through';
}

document.addEventListener('mousemove', refresh);
document.addEventListener('mouseleave', () => { if (locked) applyInteractive(false); });
btnLock.addEventListener('click', (e) => {
  e.stopPropagation();
  locked = !locked;
  applyInteractive(!locked);
  updateLock();
  toast(locked ? 'Content click-through' : 'Content interactive');
});
window.overlay.on('relock', () => { locked = true; applyInteractive(false); updateLock(); });
updateLock();

// ─── From main process ───────────────────────────────────────────────────────
window.overlay.on('load-file', (d) => {
  setTitle(d.name);
  isText = !!d.isText;
  if (d.theme) applyTheme(d.theme);
  document.body.classList.remove('editing');
  btnEdit.classList.remove('active');
  render(d.content);
});
window.overlay.on('file-changed', (d) => {
  if (typeof d.isText === 'boolean') isText = d.isText;
  if (!document.body.classList.contains('editing')) render(d.content);
});
window.overlay.on('edit-mode', (on) => setEditing(!!on));
window.overlay.on('status', (msg) => toast(msg));

// ─── Initial load (pull, avoids race) ────────────────────────────────────────
(async () => {
  try {
    const s = await window.overlay.getState();
    if (s) {
      if (s.theme) applyTheme(s.theme);
      if (typeof s.opacity === 'number') showOpacity(s.opacity);
      if (s.file) {
        setTitle(s.name);
        isText = !!s.isText;
        render(s.content);
      }
    }
  } catch (e) { console.error(e); }
})();
