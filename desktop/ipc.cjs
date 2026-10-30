const fs = require('node:fs');
const path = require('node:path');
function registerDesktopIpc({ ipcMain, dialog, shell, getWindow, getOrigin, paths, getAppInfo }) {
  const handle = (name, fn) => ipcMain.handle('desktop:' + name, async event => {
    const window = getWindow();
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('未授权桌面调用');
    try { if (new URL(event.senderFrame.url).origin !== getOrigin()) throw new Error(); } catch { throw new Error('未授权桌面调用'); }
    return fn(window);
  });
  const select = async (window, options) => {
    const result = await dialog.showOpenDialog(window, options);
    return result.canceled || !result.filePaths[0] ? null : result.filePaths[0];
  };
  handle('app-info', getAppInfo);
  handle('select-matlab', async window => {
    const selected = await select(window, { title: '选择 MATLAB 安装目录中的 bin/matlab.exe', properties: ['openFile'], filters: [{ name: 'MATLAB 程序', extensions: ['exe'] }] });
    if (selected && (path.basename(selected).toLowerCase() !== 'matlab.exe' || !fs.statSync(selected).isFile())) throw new Error('请选择实际存在的 matlab.exe');
    return selected;
  });
  handle('select-directory', window => select(window, { title: '选择文件夹', properties: ['openDirectory', 'createDirectory'] }));
  handle('select-preferences', window => select(window, { title: '选择主动导出的偏好文件', properties: ['openFile'], filters: [{ name: 'JSON 偏好', extensions: ['json'] }] }));
  handle('open-logs', async () => {
    const directory = path.join(paths.dataDir, 'logs'); fs.mkdirSync(directory, { recursive: true });
    const error = await shell.openPath(directory); if (error) throw new Error('日志目录打开失败：' + error); return { ok: true };
  });
}
module.exports = { registerDesktopIpc };
