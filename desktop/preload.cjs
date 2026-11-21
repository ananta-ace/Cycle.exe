const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('cycleDesktop', {
  isDesktopApp: true,
  appName: 'Cycle.exe',
  platform: process.platform,
});
