const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');

const DEFAULT_LIVE_URL = 'https://ais-pre-cfxsxcqute6bujnob7bkzh-468648258110.asia-east1.run.app';
const LOCAL_WEB_DIR = path.join(__dirname, 'web-dist');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

let mainWindow = null;
let localServer = null;
let localServerUrl = null;

// Enforce single desktop instance
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

function proxyApiRequest(req, res) {
  const target = new URL(req.url || '/api', DEFAULT_LIVE_URL);
  const headers = { ...req.headers, host: target.host };
  delete headers['content-length'];

  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    if (body.length > 0) {
      headers['content-length'] = String(body.length);
    }

    const upstream = https.request(
      target,
      {
        method: req.method || 'GET',
        headers,
        timeout: 15000,
      },
      (upRes) => {
        res.writeHead(upRes.statusCode || 502, upRes.headers);
        upRes.pipe(res);
      }
    );

    upstream.on('error', () => {
      if (!res.headersSent) {
        res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
      }
      res.end(JSON.stringify({ error: 'Offline or backend unavailable' }));
    });

    upstream.on('timeout', () => {
      upstream.destroy();
    });

    if (body.length > 0) {
      upstream.write(body);
    }
    upstream.end();
  });
}

function tryListenPorts(server, ports, index) {
  return new Promise((resolve) => {
    if (index >= ports.length) {
      resolve(null);
      return;
    }
    const port = ports[index];
    const onError = () => {
      server.removeListener('listening', onListening);
      resolve(tryListenPorts(server, ports, index + 1));
    };
    const onListening = () => {
      server.removeListener('error', onError);
      const addr = server.address();
      resolve(addr && typeof addr === 'object' ? addr.port : null);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

function startLocalWebServer() {
  return new Promise((resolve) => {
    const indexPath = path.join(LOCAL_WEB_DIR, 'index.html');
    if (!fs.existsSync(indexPath)) {
      resolve(null);
      return;
    }

    const server = http.createServer((req, res) => {
      try {
        const rawUrl = req.url || '/';
        if (rawUrl.startsWith('/api/')) {
          proxyApiRequest(req, res);
          return;
        }

        const cleanUrl = decodeURIComponent(rawUrl.split('?')[0].split('#')[0]);
        const relPath = cleanUrl === '/' ? 'index.html' : cleanUrl.replace(/^\/+/, '');
        let targetPath = path.normalize(path.join(LOCAL_WEB_DIR, relPath));

        if (!targetPath.startsWith(LOCAL_WEB_DIR)) {
          res.writeHead(403);
          res.end('Forbidden');
          return;
        }

        if (!fs.existsSync(targetPath) || fs.statSync(targetPath).isDirectory()) {
          targetPath = indexPath;
        }

        const ext = path.extname(targetPath).toLowerCase();
        res.writeHead(200, {
          'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
          'Cache-Control': 'no-cache',
        });
        fs.createReadStream(targetPath).pipe(res);
      } catch {
        res.writeHead(500);
        res.end('Internal Error');
      }
    });

    // Prefer a deterministic localhost port so Firebase Auth sessions & preferences persist across launches
    const candidatePorts = [17845, 17846, 17847, 17848, 17849, 17850, 0];
    tryListenPorts(server, candidatePorts, 0).then((boundPort) => {
      if (boundPort) {
        localServer = server;
        localServerUrl = `http://localhost:${boundPort}/`;
        resolve(localServerUrl);
      } else {
        resolve(null);
      }
    });
  });
}

function isAuthOrSameOriginPopup(targetUrl, appUrl) {
  try {
    const parsed = new URL(targetUrl);
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'accounts.google.com' ||
      host.endsWith('.google.com') ||
      host.endsWith('.firebaseapp.com') ||
      host.endsWith('.web.app') ||
      host === 'localhost' ||
      host === '127.0.0.1'
    ) {
      return true;
    }
    if (appUrl) {
      const base = new URL(appUrl);
      if (parsed.origin === base.origin) return true;
    }
  } catch {
    return false;
  }
  return false;
}

function buildAppMenu(startUrl) {
  const template = [
    {
      label: 'Cycle.exe',
      submenu: [
        {
          label: 'Reload App',
          accelerator: 'CmdOrCtrl+R',
          click: () => mainWindow && mainWindow.reload(),
        },
        {
          label: 'Force Reload (Clear Cache)',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => mainWindow && mainWindow.webContents.reloadIgnoringCache(),
        },
        { type: 'separator' },
        ...(localServerUrl
          ? [
              {
                label: 'Use Bundled Local App (Offline-Ready)',
                click: () => mainWindow && mainWindow.loadURL(localServerUrl),
              },
            ]
          : []),
        {
          label: 'Connect to Live Web App',
          click: () => mainWindow && mainWindow.loadURL(DEFAULT_LIVE_URL),
        },
        { type: 'separator' },
        {
          label: 'About Cycle.exe',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'Cycle.exe Desktop Software',
              message: 'Cycle.exe 2.0',
              detail: `Standalone Cycle.exe Desktop Application.\n\nActive Source: ${mainWindow ? mainWindow.webContents.getURL() : startUrl}`,
            });
          },
        },
        { type: 'separator' },
        { role: 'quit', label: 'Exit Cycle.exe' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow() {
  const customUrlArg = process.argv.find((a) => a.startsWith('--url='));
  const customUrl = customUrlArg ? customUrlArg.slice('--url='.length) : null;

  const bundledUrl = await startLocalWebServer();
  const startUrl = customUrl || bundledUrl || DEFAULT_LIVE_URL;

  const iconPath = path.join(
    __dirname,
    'assets',
    process.platform === 'win32' ? 'icon.ico' : 'icon.png'
  );

  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 900,
    minHeight: 620,
    title: 'Cycle.exe',
    backgroundColor: '#fbf9f4',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  buildAppMenu(startUrl);

  // Allow Firebase Google OAuth popups in standalone desktop sub-windows; open external links cleanly
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAuthOrSameOriginPopup(url, startUrl)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 520,
          height: 680,
          autoHideMenuBar: true,
          parent: mainWindow,
          icon: fs.existsSync(iconPath) ? iconPath : undefined,
        },
      };
    }
    shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });

  mainWindow.webContents.on('did-fail-load', (_e, errorCode, errorDescription) => {
    if (errorCode === -3) return;
    const html = `
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"><title>Cycle.exe — Offline</title></head>
      <body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#fbf9f4;font-family:system-ui,sans-serif;color:#1e1e1e;padding:24px;">
        <div style="max-width:440px;background:#fff;border:3px solid #1e1e1e;border-radius:24px;padding:32px;box-shadow:0 8px 0 #1e1e1e;text-align:center;">
          <h1 style="margin:0 0 8px;font-size:24px;">Cycle.exe Connection Issue</h1>
          <p style="margin:0 0 20px;font-size:14px;color:#555;">Could not reach Cycle.exe (${errorDescription}). Retry loading the application.</p>
          <button onclick="location.href='${startUrl}'" style="background:#f9c74f;color:#1e1e1e;font-weight:800;border:2px solid #1e1e1e;border-radius:12px;padding:10px 20px;cursor:pointer;">Retry Launch</button>
        </div>
      </body>
      </html>
    `;
    mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  });

  mainWindow.loadURL(startUrl);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (localServer) {
    try {
      localServer.close();
    } catch {
      // Ignore
    }
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
