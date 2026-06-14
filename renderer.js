'use strict';

const $ = (s) => document.querySelector(s);
const view = $('#view'), editor = $('#editor'), titleEl = $('#title'),
      titleEdit = $('#title-edit'), savedEl = $('#saved'), btnEdit = $('#btn-edit');
let currentText = '';
let isText = false;
let saveTimer = null;

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

function setEditing(on) {
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
    savedEl.textContent = r.ok ? 'saved ✓' : 'save failed';
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
  if (titleEl.textContent === 'Markdown Overlay') return; // no file yet
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
      if (r && r.ok) { titleEl.textContent = r.name; toast('Renamed'); }
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

// ─── Click-through: window is transparent to the mouse unless interacting ─────
// Locked  = clicks pass through to whatever is underneath (only the title bar is
//           hot, so you can grab/drag/unlock it).
// Unlocked = whole panel interactive (scroll/edit/select). Clicking away re-locks.
const btnLock = $('#btn-lock');
let locked = true;
let interactiveNow = false;

function applyInteractive(on) {
  if (on === interactiveNow) return;
  interactiveNow = on;
  window.overlay.setIgnore(!on); // ignore mouse = NOT interactive
}
function refresh(e) {
  const overBar = e && e.target && e.target.closest && e.target.closest('.bar');
  applyInteractive(!locked || !!overBar);
}
function updateLock() {
  btnLock.textContent = locked ? '🔒' : '🔓';
  btnLock.classList.toggle('active', !locked);
  btnLock.title = locked
    ? 'Click-through ON — only the title bar is active (click bar to interact)'
    : 'Interactive — click to lock (make click-through)';
}

document.addEventListener('mousemove', refresh);
document.addEventListener('mouseleave', () => { if (locked) applyInteractive(false); });
// Grabbing the title bar unlocks the panel for scroll/edit/select.
$('.bar').addEventListener('mousedown', (e) => {
  if (e.target.closest('#btn-lock')) return; // the lock button handles itself
  if (locked) { locked = false; applyInteractive(true); updateLock(); }
});
btnLock.addEventListener('click', (e) => {
  e.stopPropagation();
  locked = !locked;
  applyInteractive(!locked);
  updateLock();
  toast(locked ? 'Click-through on' : 'Interactive');
});
window.overlay.on('relock', () => { locked = true; applyInteractive(false); updateLock(); });
updateLock();

// ─── From main process ───────────────────────────────────────────────────────
window.overlay.on('load-file', (d) => {
  titleEl.textContent = d.name || 'Markdown Overlay';
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
        titleEl.textContent = s.name || 'Markdown Overlay';
        isText = !!s.isText;
        render(s.content);
      }
    }
  } catch (e) { console.error(e); }
})();
