const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const isDev = process.argv.includes('--dev');
const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|svg)$/i;

let mainWindow = null;

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

function setupIpcHandlers() {
  ipcMain.handle('get-images', async () => {
    return { images: listImages() };
  });
}

app.whenReady().then(() => {
  setupIpcHandlers();
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
