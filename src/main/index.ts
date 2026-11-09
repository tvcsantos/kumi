import { join } from 'node:path';
import { app, BrowserWindow, nativeTheme, session, shell } from 'electron';
import { Catalog } from './catalog/catalog';
import { HttpCache } from './catalog/http';
import { RegistryStore } from './catalog/sources';
import { createHostEnv, loadShellEnv } from './host';
import { InstallService } from './install/service';
import { registerIpc, type Services } from './ipc';
import { createSafeStorageBox } from './secrets/secrets';
import { SettingsStore } from './settings';
import { BackupService } from './state/backups';
import { StateStore } from './state/store';

const isDev = !!process.env.ELECTRON_RENDERER_URL;
// Packaged builds get their icon from the app bundle; in dev, use ours instead of Electron's.
const devIcon = isDev ? join(__dirname, '../../build', process.platform === 'darwin' ? 'icon-mac.png' : 'icon.png') : undefined;

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' https: data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'Kumi',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    // Matches the splash screen, so the window never flashes a different color while it loads.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#14161c' : '#f7f2e9',
    icon: devIcon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  win.once('ready-to-show', () => win.show());
  // Links open in the browser; the app window never navigates away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault();
  });

  if (isDev) void win.loadURL(process.env.ELECTRON_RENDERER_URL!);
  else void win.loadFile(join(__dirname, '../renderer/index.html'));
}

async function startServices(): Promise<Services> {
  await loadShellEnv();
  const env = createHostEnv();
  const dataDir = process.env.KUMI_DATA_DIR ?? join(env.home, '.kumi');
  const settings = new SettingsStore(dataDir);
  const state = new StateStore(dataDir);
  const backups = new BackupService(dataDir);
  const box = await createSafeStorageBox();
  const catalog = new Catalog(new RegistryStore(dataDir, box), new HttpCache(dataDir));
  const installer = new InstallService(env, state, backups, box);
  return { env, dataDir, catalog, installer, state, backups, settings };
}

app.whenReady().then(() => {
  if (!isDev) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [CSP] } });
    });
  }
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  if (devIcon && process.platform === 'darwin') app.dock?.setIcon(devIcon);

  // Show the window (and its splash screen) right away; reading the login shell's environment can take seconds.
  registerIpc(startServices());
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
