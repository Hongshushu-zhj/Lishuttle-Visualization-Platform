// 仅 dev 原型的阶段 A 验收工具，不修改正式设置、数据源或已有结果。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { app, BrowserWindow, dialog, session, nativeImage, shell } = require('electron');
const { startBackend } = require('./backendHost.cjs');
const { runAcceptanceChecks } = require('./acceptanceChecks.cjs');

const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function writeSummary(reportDir, report) {
  const checks = report.checks.map(check => `<li>${escape(check.status)} — ${escape(check.name)}${check.message ? '：' + escape(check.message) : ''}</li>`).join('');
  const html = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'self'"><title>阶段 A 安装验收报告</title>
  <style>body{font:16px/1.7 'Microsoft YaHei',sans-serif;max-width:1000px;margin:32px auto;padding:0 24px;color:#172b4d}img{max-width:100%;border:1px solid #ddd}h1{font-size:26px}code{background:#f2f4f7;padding:3px}</style>
  <h1>阶段 A 自动检查：${escape(report.status)}</h1><p>版本 ${escape(report.build.version)} · ${escape(report.environment.release)} · Electron ${escape(report.environment.electron)}</p>
  <ul>${checks}</ul><p>干净环境由测试者确认：${report.cleanEnvironmentConfirmed ? '是' : '否'}。自动通过后仍需人工查看三张图、断网使用并重启应用，不代表完整 V1 已通过。</p>
  <p>请将本目录的 <code>acceptance-report.json</code> 和三张 sample PNG 带回。报告仅包含版本和合成样本结果，不包含 MATLAB 许可、业务 DEM 或会话凭证。</p>
  ${[1, 2, 3].filter(i => fs.existsSync(path.join(reportDir, `sample-${i}.png`))).map(i => `<h2>样图 ${i}</h2><img src="sample-${i}.png">`).join('')}`;
  fs.writeFileSync(path.join(reportDir, '验收结果.html'), html);
}

async function runDesktopAcceptance({ parent, resources }) {
  const chosen = await dialog.showOpenDialog(parent, { title: '安装验收：选择本机 MATLAB 的 matlab.exe',
    filters: [{ name: 'MATLAB 可执行程序', extensions: ['exe'] }], properties: ['openFile'] });
  if (chosen.canceled || !chosen.filePaths[0]) return;
  const executable = chosen.filePaths[0];
  if (path.basename(executable).toLowerCase() !== 'matlab.exe' || !fs.statSync(executable).isFile()) throw new Error('请选择 MATLAB 安装目录中的 bin/matlab.exe');
  const destination = await dialog.showOpenDialog(parent, { title: '选择验收报告保存位置（将创建独立子目录）', properties: ['openDirectory', 'createDirectory'] });
  if (destination.canceled || !destination.filePaths[0]) return;
  const confirmed = await dialog.showMessageBox(parent, { type: 'question', title: '确认验收环境',
    message: '这台设备是否未安装 Node.js，且没有复制本项目源码？',
    detail: `开始后将运行所选 MATLAB，并用包内合成数据检查统计、三张图片和文件保存。不会读取业务 DEM。\nMATLAB：${executable}\n请等待验收结束后再关闭窗口。`,
    buttons: ['是，开始干净环境验收', '否，开始本机复测', '取消'], defaultId: 0, cancelId: 2 });
  if (confirmed.response === 2) return;
  const reportDir = fs.mkdtempSync(path.join(destination.filePaths[0], 'AntennaDraw-StageA-'));
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'antenna-acceptance-runtime-'));
  const dataDir = path.join(scratch, 'data');
  const prefs = path.join(scratch, 'matlab-prefs'); fs.mkdirSync(prefs);
  const sourceDir = path.join(reportDir, 'synthetic-demo');
  const demoResource = app.isPackaged ? path.join(resources, 'demo/demo') : path.join(resources, '.desktop-build/demo/demo');
  let backend, testWindow, running = true, pendingDownload;
  let report;
  const testSession = session.fromPartition('acceptance-' + crypto.randomUUID());
  const environment = { platform: process.platform, release: os.release(), arch: process.arch,
    electron: process.versions.electron, node: process.versions.node };
  const buildInfo = app.isPackaged ? JSON.parse(fs.readFileSync(path.join(resources, 'build-info.json'), 'utf8'))
    : { version: app.getVersion(), revision: 'development', workingTreeDirty: true };
  try {
    testWindow = new BrowserWindow({ title: '阶段 A 安装验收', width: 1050, height: 800,
      webPreferences: { session: testSession, nodeIntegration: false, contextIsolation: true, sandbox: true } });
    testWindow.removeMenu(); testWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    testWindow.webContents.on('will-navigate', event => event.preventDefault());
    testSession.setPermissionRequestHandler((contents, permission, callback) => callback(false));
    testSession.setPermissionCheckHandler(() => false);
    testWindow.on('close', event => { if (running) { event.preventDefault(); testWindow.focus(); } });
    await testWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><style>body{font:18px/1.8 sans-serif;padding:40px}</style><h1>阶段 A 安装验收</h1><p id="status">正在准备包内合成样本…</p><p>MATLAB 启动和绘图可能需要数分钟。结束后会显示结果和三张样图。</p>'));
    fs.cpSync(demoResource, sourceDir, { recursive: true, errorOnExist: true, force: false });
    const paths = { channel: 'dev', dataDir, matlabDir: path.join(resources, 'matlab'),
      frontendDir: path.join(resources, app.isPackaged ? 'frontend' : 'frontend/dist'),
      jobsDir: path.join(dataDir, 'jobs'), exportDir: path.join(dataDir, 'exports'), cacheDir: path.join(dataDir, 'cache') };
    const secret = crypto.randomBytes(32).toString('hex'), cookieName = 'acceptance_' + crypto.randomBytes(8).toString('hex');
    backend = await startBackend({ entry: path.join(resources, 'backend/desktop-entry.js'), channel: 'dev', paths,
      sessionSecret: secret, sessionCookieName: cookieName, settings: { matlabExe: executable, maxConcurrentJobs: 1 }, matlabPrefDir: prefs });
    const origin = backend.origin;
    await testSession.cookies.set({ url: origin, name: cookieName, value: secret, path: '/', httpOnly: true, sameSite: 'strict' });
    const headers = { Cookie: `${cookieName}=${secret}`, Origin: origin, 'Content-Type': 'application/json' };
    testSession.on('will-download', (event, item, contents) => {
      const pending = pendingDownload;
      if (!pending || contents !== testWindow.webContents || item.getURL() !== pending.url) { event.preventDefault(); return; }
      pendingDownload = null;
      try {
        item.setSavePath(pending.file);
        item.once('done', (event, state) => state === 'completed' ? pending.resolve() : pending.reject(new Error(`下载未完成：${state}，收到 ${item.getReceivedBytes()} 字节`)));
      } catch (error) { item.cancel(); pending.reject(error); }
    });
    report = await runAcceptanceChecks({ reportDir, sourceDir, buildInfo, environment,
      cleanEnvironmentConfirmed: confirmed.response === 0,
      request: async (url, body) => {
        const response = await fetch(origin + '/api' + url, { method: body === undefined ? 'GET' : 'POST', headers,
          body: body === undefined ? undefined : JSON.stringify(body) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || `服务请求失败 ${response.status}`);
        return result;
      },
      readBytes: async url => {
        const response = await fetch(origin + url, { headers });
        if (!response.ok) throw new Error('图片读取失败');
        return Buffer.from(await response.arrayBuffer());
      },
      decodePng: bytes => nativeImage.createFromBuffer(bytes).getSize(),
      download: (url, file) => new Promise((resolve, reject) => {
        pendingDownload = { url: origin + url, file, resolve, reject };
        testWindow.webContents.downloadURL(origin + url, { headers: { Cookie: `${cookieName}=${secret}` } });
      }),
      onProgress: text => {
        testWindow.setTitle('安装验收：' + text); parent?.setProgressBar(2);
        testWindow.webContents.executeJavaScript('document.getElementById("status").textContent=' + JSON.stringify(text)).catch(() => {});
      },
    });
  } catch (error) {
    report = { schemaVersion: 1, scope: 'stage-a-prototype', status: 'FAIL', build: buildInfo, environment,
      cleanEnvironmentConfirmed: confirmed.response === 0,
      checks: [{ id: 'bootstrap', name: '验收工具启动', status: 'FAIL', message: String(error.message).replace(/[A-Z]:[\\/][^\r\n]*/gi, '[本机路径]').slice(0, 1000) }] };
    fs.writeFileSync(path.join(reportDir, 'acceptance-report.json'), JSON.stringify(report, null, 2));
  } finally {
    if (backend) await backend.stop();
    running = false; parent?.setProgressBar(-1);
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  writeSummary(reportDir, report);
  if (testWindow && !testWindow.isDestroyed()) {
    testWindow.setTitle('阶段 A 验收结果：' + report.status);
    await testWindow.loadFile(path.join(reportDir, '验收结果.html'));
  }
  const result = await dialog.showMessageBox(testWindow || parent, { type: report.status === 'PASS' ? 'info' : 'error', title: '阶段 A 验收结果',
    message: report.status === 'PASS' ? '自动检查通过，请查看三张样图并带回报告。' : '验收未通过，报告已保存，请带回查看。',
    detail: `报告目录：${reportDir}\n只需带回 acceptance-report.json 和 sample-1/2/3.png。\n此结果不代表完整 Desktop V1 已通过。`,
    buttons: ['打开报告文件夹', '关闭提示'], defaultId: 0, cancelId: 1 });
  if (result.response === 0) await shell.openPath(reportDir);
  return { reportDir, report };
}
module.exports = { runDesktopAcceptance };
