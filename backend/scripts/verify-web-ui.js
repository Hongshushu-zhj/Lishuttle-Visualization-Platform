// 可选：PLAYWRIGHT_MODULE_PATH 指定现有 playwright；所有业务数据放在临时目录。
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const { createServer } = require('../src/serverApp');
const { resolveWebPaths } = require('../src/runtimePaths');

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'antenna-web-ui-'));
  const project = path.resolve(__dirname, '../..');
  const artifacts = path.join(project, '.web-test-data/ui'); fs.mkdirSync(artifacts, { recursive: true });
  const service = createServer({ paths: resolveWebPaths({ sourceRoot: project, dataDir: root }), initialSettings: { matlabExe: '', outputMode: 'source' } });
  let browser, page;
  try {
    const { origin } = await service.listen();
    browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) });
    page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem('antenna-color-ranges-v1', JSON.stringify({ RSRP: { range: [-115, -45], enabled: true } }));
      localStorage.setItem('antenna-analysis-config-v1', JSON.stringify({ RSRP: { boundaries: [-110, -90], threshold: -90 } }));
    });
    await page.goto(origin);
    const wizard = page.getByRole('dialog', { name: '欢迎使用本机 Web 版', exact: true });
    await wizard.waitFor();
    await wizard.getByRole('button', { name: '使用演示数据', exact: true }).click();
    await wizard.getByText(/已登记 1 个数据源/).waitFor();
    await wizard.getByRole('button', { name: '先跳过 MATLAB 并进入', exact: true }).click();
    await wizard.waitFor({ state: 'hidden' });
    await page.getByText('结果分析', { exact: true }).click();
    await page.getByRole('button', { name: '开始分析', exact: true }).click();
    await page.getByText('各层统计明细', { exact: true }).waitFor();
    assert.equal(await page.locator('.analysis-view canvas').count() || await page.locator('canvas').count(), 4);
    const csvEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出统计汇总 CSV', exact: true }).click();
    const csv = await csvEvent; const csvText = fs.readFileSync(await csv.path(), 'utf8');
    assert.equal(csvText.charCodeAt(0), 0xfeff); assert.match(csvText, /RSRP/); assert.match(csvText, /1层/);
    const chartEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: '下载图表 PNG', exact: true }).first().click();
    assert.ok(fs.statSync(await (await chartEvent).path()).size > 1000);
    await page.screenshot({ path: path.join(artifacts, 'analysis.png'), fullPage: true });
    await page.getByRole('button', { name: '应用设置', exact: true }).click();
    const settings = page.getByRole('dialog', { name: /应用设置/ });
    await settings.getByRole('spinbutton', { name: '绘图超时分钟', exact: true }).fill('45');
    await settings.getByRole('button', { name: '保存设置', exact: true }).click();
    await page.getByText('设置已保存', { exact: true }).waitFor();
    await settings.getByRole('tab', { name: '导入与诊断', exact: true }).click();
    await settings.getByRole('button', { name: '预览本浏览器旧偏好', exact: true }).click();
    await settings.getByText(/可迁入 2 项/).waitFor();
    await settings.getByRole('button', { name: '确认迁入预览中的偏好', exact: true }).click();
    await page.getByText('偏好已迁入本机服务', { exact: true }).waitFor();
    assert.deepEqual(service.settingsStore.getPreferences().colorRanges.RSRP.range, [-115, -45]);
    await settings.getByRole('button', { name: '预览并下载诊断', exact: true }).click();
    const diagnosis = page.getByRole('dialog', { name: '诊断预览', exact: true });
    await diagnosis.waitFor();
    const diagnosticsEvent = page.waitForEvent('download');
    await diagnosis.getByRole('button', { name: '发起诊断下载', exact: true }).click();
    const diagnostics = JSON.parse(fs.readFileSync(await (await diagnosticsEvent).path(), 'utf8'));
    assert.equal(diagnostics.info.app, 'antenna-draw-web');
    await diagnosis.getByRole('button', { name: '关闭', exact: true }).click();
    await settings.getByRole('button', { name: '关闭', exact: true }).click();
    await page.getByText('画图展示', { exact: true }).click();
    await page.locator('.src-item').filter({ hasText: 'demo-v1' }).first().click();
    await page.getByRole('button', { name: '实时调色', exact: true }).first().click();
    const preview = page.getByRole('dialog', { name: /实时调色/ });
    await preview.getByRole('button', { name: '保存当前预览到结果文件夹', exact: true }).waitFor();
    await preview.locator('.el-loading-mask').waitFor({ state: 'hidden' });
    const coloredSamples = await preview.locator('.canvas-wrap canvas').evaluate(canvas => {
      const context = canvas.getContext('2d');
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      let colored = 0;
      // 合成 DEM 有三块有效栅格；只采样图内区域，排除标题、轴和右侧色条。
      for (let y = 130; y < canvas.height - 150; y += 8) {
        for (let x = 140; x < canvas.width - 260; x += 8) {
          const offset = (y * canvas.width + x) * 4;
          const rgb = [data[offset], data[offset + 1], data[offset + 2]];
          if (Math.max(...rgb) - Math.min(...rgb) > 40) colored++;
        }
      }
      return colored;
    });
    assert.ok(coloredSamples > 100, `交互预览必须画出 DEM 颜色，实际仅 ${coloredSamples} 个彩色采样点`);
    const savedEvent = page.waitForResponse(response => response.url().endsWith('/api/preview/save') && response.status() === 200);
    await preview.getByRole('button', { name: '保存当前预览到结果文件夹', exact: true }).click();
    const saved = await (await savedEvent).json(); assert.ok(fs.existsSync(saved.path));
    const previewDownloadEvent = page.waitForEvent('download');
    await preview.getByRole('button', { name: '下载当前预览', exact: true }).click();
    const previewImage = await previewDownloadEvent;
    require('../src/outputPaths').validatePng(fs.readFileSync(await previewImage.path()));
    await page.screenshot({ path: path.join(artifacts, 'preview.png'), fullPage: true });
    await preview.getByRole('button', { name: '关闭此对话框', exact: true }).click();
    await page.getByRole('button', { name: '任务记录', exact: true }).click();
    await page.getByText('暂无绘图任务', { exact: true }).waitFor();
    await page.getByRole('button', { name: '关闭此对话框', exact: true }).last().click();
    await page.reload();
    assert.equal(await page.getByRole('dialog', { name: '欢迎使用本机 Web 版', exact: true }).count(), 0);
    assert.equal(service.settingsStore.get().jobTimeoutMinutes, 45);
    assert.deepEqual(errors, []);
    console.log('WEB_UI_OK: 引导、演示、分析、CSV/PNG、设置、旧浏览器偏好迁移、诊断、交互预览保存/下载、任务记录、刷新恢复');
    console.log('截图：' + artifacts);
  } catch (error) {
    if (page) { await page.screenshot({ path: path.join(artifacts, 'failure.png'), fullPage: true }).catch(() => {}); console.error((await page.locator('body').innerText()).slice(-6000)); }
    throw error;
  } finally { if (browser) await browser.close(); await service.close(); fs.rmSync(root, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
