'use strict';

const $ = (s) => document.querySelector(s);
const view = $('#view'), editor = $('#editor'), titleEl = $('#title'),
      savedEl = $('#saved'), btnEdit = $('#btn-edit');
let currentText = '';
let saveTimer = null;

function render(text) {
  currentText = text || '';
  view.innerHTML = currentText.trim()
    ? window.overlay.renderMarkdown(currentText)
    : '<div class="empty">Empty note.</div>';
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

// Autosave (debounced) while typing in the editor.
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

btnEdit.addEventListener('click', () => setEditing(!document.body.classList.contains('editing')));
$('#btn-new').addEventListener('click', () => window.overlay.newNote());
$('#btn-open').addEventListener('click', () => window.overlay.pickFile());
$('#btn-dir').addEventListener('click', () => window.overlay.openNotesDir());

// From main process
window.overlay.on('load-file', ({ name, content }) => {
  titleEl.textContent = name || 'Markdown Overlay';
  document.body.classList.remove('editing');
  btnEdit.classList.remove('active');
  render(content);
});
window.overlay.on('file-changed', ({ content }) => {
  // live reload only when not actively editing
  if (!document.body.classList.contains('editing')) render(content);
});
window.overlay.on('edit-mode', (on) => setEditing(!!on));
window.overlay.on('status', (msg) => toast(msg));

// Pull the current file on load (avoids a race with the main process push).
(async () => {
  try {
    const s = await window.overlay.getState();
    if (s && s.file) {
      titleEl.textContent = s.name || 'Markdown Overlay';
      render(s.content);
    }
  } catch (e) { console.error(e); }
})();
