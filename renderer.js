'use strict';

const $ = (s) => document.querySelector(s);
const view = $('#view'), editor = $('#editor'), contentEl = $('.content'),
      titleEl = $('#title'),
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
  if (on) {
    if (!hasFile) {
      // No file bound yet — create one so edits actually persist.
      const r = await window.overlay.ensureFile();
      if (r && r.name) setTitle(r.name);
    }
    unlock();                       // editing needs an interactive content area
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
const btnMax = $('#btn-max'), btnMore = $('#btn-more');
const opVal = $('#m-op-val'), themeVal = $('#m-theme-val');
let theme = 'dark';

btnEdit.addEventListener('click', () => setEditing(!document.body.classList.contains('editing')));
$('#btn-close').addEventListener('click', () => window.overlay.winClose());
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'w') { e.preventDefault(); window.overlay.winClose(); }
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
function setMenu(open) {
  document.body.classList.toggle('menu-open', open);
  applyInteractive(contentInteractive());   // menu is usable regardless of lock
}
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

// ─── Auto-scroll (runs in renderer — keeps going when unfocused / click-through) ─
const btnScroll = $('#btn-scroll');
const scrollVal = $('#m-scroll-val');
const scrollSpeedEl = $('#m-scroll-speed');
const scrollPauseLabel = $('#m-scroll-pause-label');
const SCROLL_MIN = 3;
const SCROLL_MAX = 80;
const SCROLL_STEP = 2;
let autoScroll = { enabled: false, paused: false, speed: 12 };
let scrollPos = null;

function scrollEl() {
  return document.body.classList.contains('editing') ? editor : contentEl;
}

function scrollLabel() {
  if (!autoScroll.enabled) return 'Off';
  return autoScroll.paused ? 'Paused' : `${autoScroll.speed} px/s`;
}

function refreshScrollUI() {
  const on = autoScroll.enabled && !autoScroll.paused;
  btnScroll.classList.toggle('active', on);
  btnScroll.classList.toggle('scroll-on', autoScroll.enabled);
  if (scrollVal) scrollVal.textContent = scrollLabel();
  if (scrollSpeedEl) scrollSpeedEl.textContent = String(autoScroll.speed);
  if (scrollPauseLabel) {
    scrollPauseLabel.textContent = autoScroll.paused ? 'Resume scroll' : 'Pause scroll';
  }
}

function resetScrollPos() {
  scrollPos = null;
}

function applyScrollTick(delta) {
  if (!autoScroll.enabled || autoScroll.paused) return;
  const el = scrollEl();
  if (!el) return;
  const max = el.scrollHeight - el.clientHeight;
  if (max <= 1) return;
  if (scrollPos === null || Math.abs(scrollPos - el.scrollTop) > 2) {
    scrollPos = el.scrollTop;
  }
  scrollPos += delta;
  if (scrollPos >= max) scrollPos = 0;
  if (scrollPos < 0) scrollPos = 0;
  el.scrollTop = scrollPos;
}

async function persistAutoScroll(patch) {
  autoScroll = { ...autoScroll, ...patch };
  if (typeof autoScroll.speed === 'number') {
    autoScroll.speed = Math.min(SCROLL_MAX, Math.max(SCROLL_MIN, Math.round(autoScroll.speed)));
  }
  if (!autoScroll.enabled || autoScroll.paused) resetScrollPos();
  refreshScrollUI();
  try { await window.overlay.setAutoScroll(autoScroll); } catch (e) { console.error(e); }
}

async function setAutoScrollEnabled(on) {
  await persistAutoScroll({ enabled: on, paused: false });
  toast(on ? 'Auto-scroll on' : 'Auto-scroll off');
}

async function toggleAutoScrollPause() {
  if (!autoScroll.enabled) {
    await setAutoScrollEnabled(true);
    return;
  }
  await persistAutoScroll({ paused: !autoScroll.paused });
  toast(autoScroll.paused ? 'Scroll paused' : 'Scroll resumed');
}

async function bumpScrollSpeed(delta) {
  if (!autoScroll.enabled) await persistAutoScroll({ enabled: true, paused: false });
  const speed = Math.min(SCROLL_MAX, Math.max(SCROLL_MIN, autoScroll.speed + delta));
  await persistAutoScroll({ speed });
  toast(`Scroll speed ${speed} px/s`);
}

function handleAutoScrollCmd({ action } = {}) {
  if (action === 'toggle') setAutoScrollEnabled(!autoScroll.enabled);
  else if (action === 'pause') toggleAutoScrollPause();
  else if (action === 'slower') bumpScrollSpeed(-SCROLL_STEP);
  else if (action === 'faster') bumpScrollSpeed(SCROLL_STEP);
}

btnScroll.addEventListener('click', (e) => {
  e.stopPropagation();
  setAutoScrollEnabled(!autoScroll.enabled);
});
$('#m-scroll-toggle').addEventListener('click', () => runAndClose(() => setAutoScrollEnabled(!autoScroll.enabled)));
$('#m-scroll-pause').addEventListener('click', () => runAndClose(() => toggleAutoScrollPause()));
$('#m-scroll-slower').addEventListener('click', () => bumpScrollSpeed(-SCROLL_STEP));
$('#m-scroll-faster').addEventListener('click', () => bumpScrollSpeed(SCROLL_STEP));
window.overlay.on('auto-scroll-cmd', handleAutoScrollCmd);
window.overlay.on('auto-scroll-tick', ({ delta }) => applyScrollTick(delta));

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
let locked = true;            // refers to the content area only
let interactiveNow = true;    // window starts interactive (bar reliably catches the mouse)
let dragging = false;

function applyInteractive(on) {
  if (on === interactiveNow) return;
  interactiveNow = on;
  window.overlay.setIgnore(!on); // ignore mouse = NOT interactive
}
// The content area must accept the mouse when unlocked, when the ⋯ menu is open,
// or while editing — even if the panel is otherwise locked/click-through.
function contentInteractive() {
  return !locked
    || document.body.classList.contains('menu-open')
    || document.body.classList.contains('editing');
}
function refresh(e) {
  if (dragging) return;        // stay interactive throughout a drag
  const overBar = e && e.target && e.target.closest && e.target.closest('.bar');
  applyInteractive(contentInteractive() || !!overBar);
}
const LOCK_CLOSED = '<svg viewBox="0 0 16 16"><rect x="3.8" y="7.3" width="8.4" height="5.4" rx="1.4"/><path d="M5.7 7.3V5.7a2.3 2.3 0 0 1 4.6 0v1.6"/></svg>';
const LOCK_OPEN = '<svg viewBox="0 0 16 16"><rect x="3.8" y="7.3" width="8.4" height="5.4" rx="1.4"/><path d="M5.7 7.3V5.7a2.3 2.3 0 0 1 4.4-.7"/></svg>';
function updateLock() {
  btnLock.innerHTML = locked ? LOCK_CLOSED : LOCK_OPEN;
  btnLock.classList.toggle('active', !locked);
  btnLock.title = locked
    ? 'Content is click-through — click to interact with the note (title bar always moves the window)'
    : 'Content is interactive — click to make it click-through';
}
function unlock() { if (locked) { locked = false; updateLock(); } applyInteractive(true); }

document.addEventListener('mousemove', refresh);
document.addEventListener('mouseleave', () => { if (!contentInteractive() && !dragging) applyInteractive(false); });
btnLock.addEventListener('click', (e) => {
  e.stopPropagation();
  locked = !locked;
  applyInteractive(contentInteractive());
  updateLock();
  toast(locked ? 'Content click-through' : 'Content interactive');
});
window.overlay.on('relock', () => { if (!dragging) { locked = true; applyInteractive(contentInteractive()); updateLock(); } });
updateLock();

// ─── Manual window drag from the title bar ───────────────────────────────────
const barEl = document.querySelector('.bar');
barEl.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  if (e.target.closest('button') || e.target.closest('#title-edit')) return; // controls/rename
  dragging = true;
  applyInteractive(true);
  document.body.classList.add('dragging');
  window.overlay.dragBegin(e.screenX, e.screenY);
  e.preventDefault();
});
window.addEventListener('mousemove', (e) => { if (dragging) window.overlay.dragTo(e.screenX, e.screenY); });
window.addEventListener('mouseup', () => {
  if (!dragging) return;
  dragging = false;
  document.body.classList.remove('dragging');
  window.overlay.dragEnd();
});

// ─── From main process ───────────────────────────────────────────────────────
window.overlay.on('load-file', (d) => {
  setTitle(d.name);
  isText = !!d.isText;
  if (d.theme) applyTheme(d.theme);
  if (d.autoScroll) {
    autoScroll = { ...autoScroll, ...d.autoScroll };
    refreshScrollUI();
  }
  document.body.classList.remove('editing');
  btnEdit.classList.remove('active');
  render(d.content);
  resetScrollPos();
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
      if (s.autoScroll) {
        autoScroll = { ...autoScroll, ...s.autoScroll };
        refreshScrollUI();
      }
    }
  } catch (e) { console.error(e); }
})();
