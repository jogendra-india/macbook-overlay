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

// ─── Toolbar ─────────────────────────────────────────────────────────────────
btnEdit.addEventListener('click', () => setEditing(!document.body.classList.contains('editing')));
$('#btn-new').addEventListener('click', () => window.overlay.newNote());
$('#btn-open').addEventListener('click', () => window.overlay.pickFile());
$('#btn-dir').addEventListener('click', () => window.overlay.openNotesDir());
$('#btn-overlay').addEventListener('click', () => window.overlay.newOverlay());
$('#btn-op-up').addEventListener('click', () => window.overlay.bumpOpacity(0.1));
$('#btn-op-down').addEventListener('click', () => window.overlay.bumpOpacity(-0.1));

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
    if (s && s.file) {
      titleEl.textContent = s.name || 'Markdown Overlay';
      isText = !!s.isText;
      render(s.content);
    }
  } catch (e) { console.error(e); }
})();
