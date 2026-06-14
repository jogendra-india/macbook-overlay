'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const MarkdownIt = require('markdown-it');

const md = new MarkdownIt({
  html: false,        // ignore raw HTML in notes (safe)
  linkify: true,
  breaks: true,
  typographer: true,
});

contextBridge.exposeInMainWorld('overlay', {
  renderMarkdown: (text) => md.render(text || ''),
  saveContent: (content) => ipcRenderer.invoke('save-content', content),
  pickFile: () => ipcRenderer.invoke('pick-file'),
  newNote: () => ipcRenderer.invoke('new-note'),
  newOverlay: () => ipcRenderer.invoke('new-overlay'),
  renameFile: (name) => ipcRenderer.invoke('rename-file', name),
  bumpOpacity: (delta) => ipcRenderer.invoke('bump-opacity', delta),
  openNotesDir: () => ipcRenderer.invoke('open-notes-dir'),
  setIgnore: (ignore) => ipcRenderer.send('set-ignore', ignore),
  getState: () => ipcRenderer.invoke('get-state'),
  on: (channel, cb) => {
    const allowed = ['load-file', 'file-changed', 'status', 'edit-mode', 'relock'];
    if (allowed.includes(channel)) ipcRenderer.on(channel, (_e, data) => cb(data));
  },
});
