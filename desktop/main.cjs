const { app, BrowserWindow, session, ipcMain, dialog, Menu } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { startBackend } = require('./backendHost.cjs');
const { registerDownloads } = require('./downloads.cjs');

const channel = require('../package.json').desktopChannel || 'dev';
const dev = channel === 'dev';
app.setName(dev ? 'AntennaDraw Dev' : 'AntennaDraw');
app.setAppUserModelId(dev ? 'com.antennadraw.desktop.dev' : 'com.antennadraw.desktop');
const dataDir = dev && process.env.ANTENNA_DESKTOP_DATA_DIR
  ? path.resolve(process.env.ANTENNA_DESKTOP_DATA_DIR)
  : path.join(process.env.LOCALAPPDATA || app.getPath('appData'), dev ? 'AntennaDraw-Dev' : 'AntennaDraw');
fs.mkdirSync(dataDir, { recursive: true });
app.setPath('userData', path.join(dataDir, 'electron'));
app.setPath('sessionData', path.join(dataDir, 'session'));
const primary = app.requestSingleInstanceLock();
let window, backend, origin, allowQuit = false, shuttingDown = false, acceptanceActive = false;
if (!primary) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.on('before-quit', event => {
    if (allowQuit) return;
    event.preventDefault();
    if (acceptanceActive) return;
    if (shuttingDown) return;
    shuttingDown = true;
    Promise.resolve(backend?.stop()).then(() => { allowQuit = true; app.quit(); }).catch(async error => {
      shuttingDown = false;
      await dialog.showMessageBox(window, { type: 'error', title: '退出未完成', message: error.message, buttons: ['留在应用'] });
    });
  });
  app.on('window-all-closed', () => app.quit());
  app.whenReady().then(start).catch(showFailure);
}
function makeWindow(appSession) {
  const w = new BrowserWindow({ width: 1440, height: 950, minWidth: 1000, minHeight: 700, title: app.getName(),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), session: appSession,
      nodeIntegration: false, contextIsolation: true, sandbox: true } });
  w.removeMenu();
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w.webContents.on('will-navigate', (event, url) => {
    try { if (new URL(url).origin !== origin) event.preventDefault(); } catch { event.preventDefault(); }
  });
  return w;
}
async function start() {
  const resources = app.isPackaged ? process.resourcesPath : path.resolve(__dirname, '..');
  const paths = { channel, dataDir, matlabDir: path.join(resources, 'matlab'),
    frontendDir: path.join(resources, app.isPackaged ? 'frontend' : 'frontend/dist'),
    jobsDir: path.join(dataDir, 'jobs'), exportDir: path.join(dataDir, 'exports'), cacheDir: path.join(dataDir, 'cache') };
  const secret = crypto.randomBytes(32).toString('hex');
  const cookieName = 'antenna_' + crypto.randomBytes(8).toString('hex');
  backend = await startBackend({ entry: path.join(resources, 'backend/desktop-entry.js'), channel, paths,
    sessionSecret: secret, sessionCookieName: cookieName,
    settings: { matlabExe: dev ? process.env.ANTENNA_DESKTOP_MATLAB || '' : '', maxConcurrentJobs: 1 },
    failForTest: !app.isPackaged && process.env.ANTENNA_DESKTOP_TEST_FAIL === '1' });
  origin = backend.origin;
  const appSession = session.fromPartition(`persist:antenna-${channel}`);
  appSession.setPermissionRequestHandler((webContents, permission, callback) => callback(false));
  appSession.setPermissionCheckHandler(() => false);
  await appSession.cookies.set({ url: origin, name: cookieName, value: secret, httpOnly: true, sameSite: 'strict', path: '/' });
  window = makeWindow(appSession);
  if (dev) {
    const menu = Menu.buildFromTemplate([{ label: '安装验收', submenu: [{ id: 'desktop-acceptance', label: '运行阶段 A 安装验收…',
      click: async item => {
        if (acceptanceActive) return;
        acceptanceActive = true; item.enabled = false;
        try { await require('./acceptance.cjs').runDesktopAcceptance({ parent: window, resources }); }
        catch (error) { await dialog.showMessageBox(window, { type: 'error', message: '验收未完成', detail: error.message, buttons: ['确定'] }); }
        finally { acceptanceActive = false; item.enabled = true; }
      },
    }] }]);
    Menu.setApplicationMenu(menu); window.setMenu(menu);
    window.on('close', event => { if (acceptanceActive) event.preventDefault(); });
  }
  registerDownloads(appSession, () => window, () => origin);
  ipcMain.handle('desktop:app-info', event => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || new URL(event.senderFrame.url).origin !== origin) throw new Error('未授权桌面调用');
    return { version: app.getVersion(), channel, electron: process.versions.electron, node: process.versions.node };
  });
  backend.child.on('exit', () => { if (!shuttingDown && !allowQuit) showFailure(new Error('本地服务已断开，请退出后重试')); });
  await window.loadURL(origin);
}
async function showFailure(error) {
  if (!window || window.isDestroyed()) window = makeWindow();
  const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<meta charset="utf-8"><title>启动失败</title><h2>本地服务启动失败</h2><p>请关闭后重试，或重新安装应用。</p><pre>BACKEND_START_FAILED: ${escape(error.message)}</pre>`));
}
