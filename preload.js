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
  openNotesDir: () => ipcRenderer.invoke('open-notes-dir'),
  getState: () => ipcRenderer.invoke('get-state'),
  on: (channel, cb) => {
    const allowed = ['load-file', 'file-changed', 'status', 'edit-mode'];
    if (allowed.includes(channel)) ipcRenderer.on(channel, (_e, data) => cb(data));
  },
});
