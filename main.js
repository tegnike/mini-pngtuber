const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');

const isDev = process.argv.includes('--dev');
const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|svg)$/i;

// ポート指定: --port=3000 または -p 3000
const portArg = process.argv.find(arg => arg.startsWith('--port=') || arg.startsWith('-p='));
const portIndex = process.argv.findIndex(arg => arg === '-p' || arg === '--port');
const PORT = portArg
  ? parseInt(portArg.split('=')[1], 10)
  : portIndex !== -1 && process.argv[portIndex + 1]
    ? parseInt(process.argv[portIndex + 1], 10)
    : 3000;

let mainWindow = null;
let server = null;

function getPublicPath() {
  // パッケージ化後はresourcesPath、それ以外は__dirnameを使用
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'public');
  }
  return path.join(__dirname, 'public');
}

function listImages() {
  const publicDir = getPublicPath();
  try {
    const items = fs.readdirSync(publicDir, { withFileTypes: true });
    return items
      .filter((d) => d.isFile())
      .map((d) => d.name)
      .filter((name) => IMAGE_EXTENSIONS.test(name))
      .sort((a, b) => a.localeCompare(b));
  } catch (e) {
    console.error('画像一覧取得エラー:', e);
    return [];
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 600,
    minHeight: 400,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#0b0f14'
  });

  mainWindow.loadFile(path.join(getPublicPath(), 'index.html'));

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

function startServer() {
  const publicDir = getPublicPath();

  server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === '/images') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
      res.end(JSON.stringify({ images: listImages() }));
      return;
    }

    let filePath = decodeURIComponent(url.pathname);
    if (filePath === '/' || filePath === '') filePath = '/index.html';

    const resolved = path.join(publicDir, filePath);
    if (!resolved.startsWith(publicDir)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    fs.stat(resolved, (err, stat) => {
      if (err || !stat.isFile()) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const ext = path.extname(resolved).toLowerCase();
      const type = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type });
      fs.createReadStream(resolved).pipe(res);
    });
  });

  server.listen(PORT, () => {
    console.log(`OBS用サーバー起動: http://localhost:${PORT}`);
  });
}

function setupIpcHandlers() {
  ipcMain.handle('get-images', async () => {
    return { images: listImages() };
  });
}

app.whenReady().then(() => {
  setupIpcHandlers();
  startServer();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
