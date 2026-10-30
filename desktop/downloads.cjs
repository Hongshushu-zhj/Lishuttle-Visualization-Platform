const { dialog } = require('electron');
function registerDownloads(appSession, getWindow, getOrigin) {
  appSession.on('will-download', async (event, item, contents) => {
    const window = getWindow();
    const page = contents?.getURL() || '';
    const url = item.getURL();
    if (!window || contents !== window.webContents || !page.startsWith(getOrigin() + '/') ||
      !(url.startsWith(getOrigin() + '/') || url.startsWith('blob:' + getOrigin() + '/') || url.startsWith('data:image/png'))) {
      event.preventDefault(); return;
    }
    // Electron 内置保存对话框能保持下载句柄；异步自行弹窗会错过 will-download 时机。
    item.setSaveDialogOptions({ title: '保存文件', defaultPath: item.getFilename(), properties: ['showOverwriteConfirmation'] });
    item.once('done', async (event, state) => {
      if (state === 'interrupted') await dialog.showMessageBox(window, { type: 'error', message: '文件保存失败，请检查目标目录后重试。', buttons: ['确定'] });
    });
  });
}
module.exports = { registerDownloads };
