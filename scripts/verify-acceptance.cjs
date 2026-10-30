// 开发者验证另一台设备可用的原生验收入口。只替代人工选择对话框；检查使用真实包和 MATLAB。
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { _electron: electron } = require('playwright');
const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
async function main() {
  const root = path.resolve(__dirname, '..');
  const artifact = option('--artifact') && path.resolve(option('--artifact'));
  const matlab = option('--matlab');
  assert.ok(matlab && fs.statSync(matlab).isFile(), '请显式指定真实 MATLAB');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'antenna-native-acceptance-'));
  let app;
  try {
    const reportRoot = path.join(scratch, 'reports'); fs.mkdirSync(reportRoot);
    const env = { ...process.env, ANTENNA_DESKTOP_DATA_DIR: path.join(scratch, 'data') }; delete env.ELECTRON_RUN_AS_NODE;
    for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key];
    env.Path = path.join(process.env.SystemRoot, 'System32') + ';' + process.env.SystemRoot;
    app = await electron.launch({ executablePath: artifact ? path.join(artifact, 'AntennaDraw Dev.exe') : undefined,
      args: artifact ? [] : [root], env, cwd: artifact || root });
    const page = await app.firstWindow(); await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+/);
    await app.evaluate(({ Menu, dialog }, { matlab, reportRoot }) => {
      const choices = [matlab, reportRoot];
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [choices.shift()] });
      dialog.showMessageBox = async (window, options) => {
        if (options.message === '验收未完成') globalThis.__acceptanceError = options.detail;
        return { response: 1 };
      };
      const item = Menu.getApplicationMenu().getMenuItemById('desktop-acceptance');
      if (!item) throw Error('缺少安装验收入口');
      item.click();
    }, { matlab, reportRoot });
    const deadline = Date.now() + 300000;
    let reportDir;
    while (Date.now() < deadline) {
      const error = await app.evaluate(() => globalThis.__acceptanceError || null);
      assert.equal(error, null, error || '');
      const directory = fs.readdirSync(reportRoot).find(name => name.startsWith('AntennaDraw-StageA-'));
      if (directory && fs.existsSync(path.join(reportRoot, directory, '验收结果.html'))) { reportDir = path.join(reportRoot, directory); break; }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert.ok(reportDir, '原生验收未在 5 分钟内生成报告');
    const report = JSON.parse(fs.readFileSync(path.join(reportDir, 'acceptance-report.json'), 'utf8'));
    console.log('NATIVE_REPORT status=' + report.status);
    const closeDeadline = Date.now() + 30000;
    while (!(await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('desktop-acceptance').enabled))) {
      assert.ok(Date.now() < closeDeadline, '验收窗口未完成退出准备');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(report.status, 'PASS', JSON.stringify(report));
    assert.equal(report.cleanEnvironmentConfirmed, false, '本机测试不能冒充独立环境');
    assert.match(report.checks.find(c => c.id === 'matlab').details.matlabVersion, /R2022a/);
    assert.deepEqual(await page.evaluate(() => fetch('/api/sources').then(r => r.json())), [], '验收不得修改常规数据源');
    const evidence = path.join(root, '.desktop-test-data'); fs.mkdirSync(evidence, { recursive: true });
    fs.cpSync(reportDir, path.join(evidence, artifact ? 'native-acceptance-packaged' : 'native-acceptance-source'), { recursive: true, force: true });
    const resultWindow = app.windows().find(window => window !== page);
    if (resultWindow) await resultWindow.screenshot({ path: path.join(evidence, 'screenshots/native-acceptance.png'), fullPage: true });
    await app.close(); app = null;
    console.log('NATIVE_ACCEPTANCE_OK: 真实 worker/MATLAB/PNG/ZIP、报告、系统 PATH、常规源隔离');
    console.log(JSON.stringify(report, null, 2));
  } finally { if (app) await app.close(); fs.rmSync(scratch, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
