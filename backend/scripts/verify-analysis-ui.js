// npm 环境中需提供 playwright；也可通过 PLAYWRIGHT_MODULE_PATH 指定其模块路径。
// 使用独立临时数据源/HTTP 端口，不改本机注册表、不启动 MATLAB。
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('node:assert/strict');
const express = require('express');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const store = require('../src/sourcesStore');
const { scanSource } = require('../src/scanner');

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'analysis-ui-'));
  const oldSources = store.sources, oldSave = store.save;
  let server, browser;
  store.sources = []; store.save = () => {};
  try {
    for (const name of ['任务A', '任务B']) {
      const pred = path.join(root, 'pred', name); fs.mkdirSync(pred, { recursive: true });
      fs.writeFileSync(path.join(pred, 'index.txt'), 'RSRP_1.dem 0 4 0 3 1\nRSRP_2.dem 0 4 0 3 1\nBESTSERVER_1.dem 0 4 0 3 1\nBESTSERVER_2.dem 0 4 0 3 1\n');
      for (const [file, values] of [
        ['RSRP_1.dem', [-12000, -11000, -10000, -10000, -9000, -8000, -7000, -6000, -5000, -4000, -3000, -32768]],
        ['RSRP_2.dem', Array(12).fill(-10000)],
        ['BESTSERVER_1.dem', Array.from({ length: 12 }, (_, i) => i)],
        ['BESTSERVER_2.dem', Array(12).fill(-32768)],
      ]) { const raw = Buffer.alloc(24); values.forEach((v, i) => raw.writeInt16LE(v, 2 * i)); fs.writeFileSync(path.join(pred, file), raw); }
    }
    store.add(root, scanSource(root));
    const app = express(); app.use(express.json()); app.use('/api', require('../src/routes'));
    app.use(express.static(path.join(__dirname, '../../frontend/dist')));
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) });
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByText('结果分析', { exact: true }).click();
    await page.getByRole('button', { name: '开始分析', exact: true }).waitFor();
    await page.getByRole('button', { name: '开始分析', exact: true }).click();
    await page.getByText('各层统计明细', { exact: true }).waitFor();
    await page.locator('canvas').first().waitFor();
    assert.equal(await page.locator('canvas').count(), 4);
    const overview = await page.getByText('当前层统计概览', { exact: true }).boundingBox();
    const detail = await page.getByText('1层 · 数值分布详情', { exact: true }).boundingBox();
    const allLayers = await page.getByText('各层统计明细', { exact: true }).boundingBox();
    const crossChart = await page.getByRole('img', { name: '各层数值区间占比', exact: true }).boundingBox();
    assert.ok(overview.y < detail.y && detail.y < allLayers.y && detail.y < crossChart.y, '当前层概览与详情必须连续位于层间分析之前');
    const summary = page.locator('.el-card').filter({ has: page.getByText('各层统计明细', { exact: true }) });
    await summary.getByRole('row').filter({ hasText: /^2层/ }).click();
    await page.getByText('2层 · 数值分布详情', { exact: true }).waitFor();
    await page.waitForFunction(() => Math.abs(document.querySelector('.current-layer-overview').getBoundingClientRect().top) < 20);
    await page.locator('.layer-select').click(); await page.getByRole('option', { name: '1层', exact: true }).click();
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出统计汇总 CSV', exact: true }).click();
    const csv = await downloadEvent; const csvFile = await csv.path();
    const text = fs.readFileSync(csvFile, 'utf8');
    assert.equal(text.charCodeAt(0), 0xfeff); assert.match(text, /任务A/); assert.match(text, /≥ -100/); assert.match(text, /1层/); assert.match(text, /2层/);
    await page.getByRole('spinbutton', { name: '达标门限', exact: true }).fill('-80');
    await page.getByRole('button', { name: '应用并保存配置', exact: true }).click();
    await page.getByText(/当前分档：.*达标门限 ≥ -80/).waitFor();
    const pngEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: '下载图表 PNG', exact: true }).first().click();
    const png = await pngEvent; assert.ok(fs.statSync(await png.path()).size > 1000);
    const artifacts = path.join(__dirname, '../../docs/analysis-qa'); fs.mkdirSync(artifacts, { recursive: true });
    await page.screenshot({ path: path.join(artifacts, 'continuous.png'), fullPage: true });
    await page.locator('.conditions label').nth(2).locator('.el-select').click();
    assert.equal(await page.getByRole('option', { name: /BESTSERVER/ }).count(), 0, 'BESTSERVER 不应出现在结果分析指标选项中');
    await page.keyboard.press('Escape');
    await page.getByText('BESTSERVER 为小区编号数据，暂不纳入结果分析。', { exact: true }).waitFor();
    const sourcesResponse = await page.request.get(`http://127.0.0.1:${server.address().port}/api/sources`);
    const exposedSources = await sourcesResponse.json();
    assert.ok(exposedSources[0].tasks[0].types.BESTSERVER, '原始数据源及绘图类型必须保留 BESTSERVER');
    await page.locator('.conditions label').nth(1).locator('.el-select').click();
    await page.getByRole('option', { name: /任务B/ }).click();
    await page.getByText('分析条件或数据源已变化，请重新分析。', { exact: true }).waitFor();
    await page.getByRole('button', { name: '开始分析', exact: true }).click();
    await page.getByText('各层统计明细', { exact: true }).waitFor();
    await page.getByText(/任务 任务B · RSRP/).first().waitFor();
    // 延迟旧任务响应，选择新任务后旧响应不能恢复结果区。
    let releaseOld, startedOld;
    const oldStarted = new Promise(resolve => { startedOld = resolve; });
    const oldReleased = new Promise(resolve => { releaseOld = resolve; });
    await page.route('**/api/analysis', async route => {
      const response = await route.fetch();
      startedOld(); await oldReleased;
      await route.fulfill({ response });
    });
    await page.getByRole('button', { name: '开始分析', exact: true }).click();
    await oldStarted;
    await page.locator('.conditions label').nth(1).locator('.el-select').click();
    await page.getByRole('option', { name: /任务A/ }).click();
    releaseOld();
    await page.waitForResponse('**/api/analysis');
    assert.equal(await page.getByText('各层统计明细', { exact: true }).count(), 0);
    await page.unroute('**/api/analysis');
    await page.getByRole('button', { name: '开始分析', exact: true }).click();
    await page.getByText(/任务 任务A · RSRP/).first().waitFor();
    await page.getByText('各层统计明细', { exact: true }).waitFor();
    // 重新加载后独立分析配置仍保留。
    await page.reload();
    await page.getByText('结果分析', { exact: true }).click();
    await page.getByRole('spinbutton', { name: '达标门限', exact: true }).waitFor();
    assert.equal(await page.getByRole('spinbutton', { name: '达标门限', exact: true }).inputValue(), '-80.00');
    assert.deepEqual(errors, []);
    console.log('ANALYSIS_UI_OK: 默认选择、多层统计、配置应用/刷新恢复、CSV/PNG、BESTSERVER 分析入口隐藏且绘图类型保留、任务切换、旧响应隔离、无浏览器异常');
  } finally {
    await browser?.close();
    if (server) await new Promise(resolve => server.close(resolve));
    store.sources = oldSources; store.save = oldSave;
    fs.rmSync(root, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
