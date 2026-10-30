const { app, BrowserWindow, session, ipcMain, dialog, Menu, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { startBackend } = require('./backendHost.cjs');
const { registerDownloads } = require('./downloads.cjs');
const { installWebContentsSecurity, configureSessionSecurity } = require('./security.cjs');

const channel = require('../package.json').desktopChannel || 'dev';
const dev = channel === 'dev';
const resources = app.isPackaged ? process.resourcesPath : path.resolve(__dirname, '..');
const { resolveRuntimePaths } = require(path.join(resources, 'backend/src/runtimePaths'));
app.setName(dev ? 'AntennaDraw Dev' : 'AntennaDraw');
app.setAppUserModelId(dev ? 'com.antennadraw.desktop.dev' : 'com.antennadraw.desktop');
const paths = resolveRuntimePaths({ channel, ...(app.isPackaged ? { resourcesDir: resources } : { sourceRoot: resources }),
  dataDir: dev ? process.env.ANTENNA_DESKTOP_DATA_DIR : undefined });
const { dataDir } = paths;
for (const dir of [dataDir, path.join(dataDir, 'electron'), path.join(dataDir, 'session')]) fs.mkdirSync(dir, { recursive: true });
app.setPath('userData', path.join(dataDir, 'electron'));
app.setPath('sessionData', path.join(dataDir, 'session'));
const primary = app.requestSingleInstanceLock();
let window, backend, origin, diagnostics, allowQuit = false, shuttingDown = false, acceptanceActive = false;
if (!primary) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.on('before-quit', event => {
    if (allowQuit) return;
    event.preventDefault();
    if (acceptanceActive) return;
    if (shuttingDown) return;
    shuttingDown = true;
    (async () => {
      const activity = await backend?.getActivity();
      if (activity?.active) {
        const result = await dialog.showMessageBox(window, { type: 'question', title: '有任务正在运行', message: '检测或绘图任务尚未结束，是否取消并退出？',
          detail: '应用会取消排队任务并等待本次 MATLAB 所属进程全部停止。已经完成的图片会保留。', buttons: ['留在应用', '取消任务并退出'], defaultId: 0, cancelId: 0 });
        if (result.response !== 1) { shuttingDown = false; return; }
      }
      await backend?.stop(); allowQuit = true; app.quit();
    })().catch(async error => {
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
  w.on('close', event => { if (!allowQuit) { event.preventDefault(); app.quit(); } });
  installWebContentsSecurity(w.webContents, () => origin);
  return w;
}
async function start() {
  const secret = crypto.randomBytes(32).toString('hex');
  const cookieName = 'antenna_' + crypto.randomBytes(8).toString('hex');
  diagnostics = require(path.join(resources, 'backend/src/diagnostics')).createDiagnostics({ dataDir, secretValues:[secret] });
  diagnostics.log('APP_START', { version:app.getVersion(), channel });
  backend = await startBackend({ entry: path.join(resources, 'backend/desktop-entry.js'), channel, paths,
    sessionSecret: secret, sessionCookieName: cookieName,
    settings: { matlabExe: dev ? process.env.ANTENNA_DESKTOP_MATLAB || '' : '', maxConcurrentJobs: 1 },
    logger: diagnostics.log,
    failForTest: !app.isPackaged && process.env.ANTENNA_DESKTOP_TEST_FAIL === '1' });
  origin = backend.origin;
  const appSession = session.fromPartition(`persist:antenna-${channel}`);
  configureSessionSecurity(appSession);
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
  require('./ipc.cjs').registerDesktopIpc({ ipcMain, dialog, shell, getWindow: () => window, getOrigin: () => origin, paths,
    diagnostics, getDiagnosticInfo: async () => ({ version:app.getVersion(), channel, electron:process.versions.electron, node:process.versions.node, windows:require('node:os').release(), activity:await backend.getActivity() }),
    getAppInfo: () => ({ version: app.getVersion(), channel, electron: process.versions.electron, node: process.versions.node }) });
  backend.child.on('exit', () => { if (!shuttingDown && !allowQuit) showFailure(new Error('本地服务已断开，请退出后重试')); });
  await window.loadURL(origin);
}
async function showFailure(error) {
  diagnostics?.log('APP_FAILURE', { code:error.code, message:error.message });
  if (!window || window.isDestroyed()) window = makeWindow();
  const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<meta charset="utf-8"><title>启动失败</title><h2>本地服务启动失败</h2><p>请关闭后重试，或重新安装应用。</p><pre>BACKEND_START_FAILED: ${escape(error.message)}</pre>`));
}
