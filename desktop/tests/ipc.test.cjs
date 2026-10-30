const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
test('固定 IPC 拒绝外部窗口及子框架；原生选择取消返回 null；仅打开受管日志目录', async t => {
  const { registerDesktopIpc } = require('../ipc.cjs');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antenna-ipc-')); t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const frame = { url: 'http://127.0.0.1:1234/' }, contents = { mainFrame: frame }, handlers = new Map(); let opened, selections = 0;
  registerDesktopIpc({ ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, getWindow: () => ({ webContents: contents }),
    getOrigin: () => 'http://127.0.0.1:1234', paths: { dataDir }, getAppInfo: () => ({ channel: 'dev' }),
    dialog: { showOpenDialog: async () => { selections++; return { canceled: true, filePaths: [] }; } }, shell: { openPath: async value => { opened = value; return ''; } } });
  const authorized = { sender: contents, senderFrame: frame };
  await assert.rejects(async () => handlers.get('desktop:select-matlab')({ sender: {}, senderFrame: frame }), /未授权/);
  await assert.rejects(async () => handlers.get('desktop:select-directory')({ sender: contents, senderFrame: { url: frame.url } }), /未授权/);
  assert.equal(selections, 0);
  assert.equal(await handlers.get('desktop:select-matlab')(authorized), null);
  await handlers.get('desktop:open-logs')(authorized, 'C:\\Windows'); assert.equal(opened, path.join(dataDir, 'logs'));
});
