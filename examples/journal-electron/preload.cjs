// Preload: the only bridge between the window and the main process.
// Sandboxed, so CommonJS and only "electron" can be required here.
const { contextBridge, ipcRenderer } = require("electron")

const call = (channel, ...args) => ipcRenderer.invoke(channel, ...args)
const on = channel => cb => {
  const listener = (_event, value) => cb(value)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

contextBridge.exposeInMainWorld("journal", {
  // account, for the sign-in form
  signUp: (email, password) => call("auth:signUp", email, password),
  signIn: (email, password) => call("auth:signIn", email, password),
  recover: (email, code, newPassword) => call("auth:recover", email, code, newPassword),
  signOut: () => call("auth:signOut"),
  // journal
  signedIn: () => call("journal:signedIn"),
  open: () => call("journal:open"),
  list: () => call("journal:list"),
  read: name => call("journal:read", name),
  write: (name, text) => call("journal:write", name, text),
  remove: name => call("journal:remove", name),
  sync: () => call("journal:sync"),
  status: () => call("journal:status"),
  onChange: on("journal:change"),
  onStatus: on("journal:status"),
})
