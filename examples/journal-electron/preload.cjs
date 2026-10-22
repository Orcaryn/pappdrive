// Electron sandboxed preloads must be CommonJS and can only require "electron".
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pappdrive', { send: text => ipcRenderer.send('pappdrive', text), onMessage: cb => ipcRenderer.on('pappdrive', (_event, text) => cb(text)) });
