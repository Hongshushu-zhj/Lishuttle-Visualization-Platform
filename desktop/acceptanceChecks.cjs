const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const CHECKS = [['source', '包内合成数据扫描'], ['worker', '真实统计线程'], ['matlab', 'MATLAB 室内/室外/BESTSERVER 出图'],
  ['png', 'PNG 签名和原生解码'], ['downloads', 'PNG 和 ZIP 下载保存']];

function verifyPng(bytes, decodePng) {
  assert.ok(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'PNG 文件签名无效');
  const size = decodePng(bytes);
  assert.ok(size.width > 100 && size.height > 100, 'PNG 无法解码或尺寸异常');
  return size;
}

async function runAcceptanceChecks({ reportDir, sourceDir, buildInfo, environment, cleanEnvironmentConfirmed,
  request, readBytes, decodePng, download, onProgress = () => {} }) {
  const report = {
    schemaVersion: 1, scope: 'stage-a-prototype', startedAt: new Date().toISOString(), status: 'FAIL',
    build: { version: buildInfo.version, revision: buildInfo.revision, workingTreeDirty: buildInfo.workingTreeDirty },
    environment, cleanEnvironmentConfirmed: !!cleanEnvironmentConfirmed,
    checks: CHECKS.map(([id, name]) => ({ id, name, status: 'NOT_RUN' })),
    manualChecks: { imageAppearance: 'NOT_RUN', offlineOperation: 'NOT_RUN', relaunch: 'NOT_RUN' },
  };
  let current;
  async function check(id, task) {
    current = report.checks.find(item => item.id === id);
    onProgress(current.name);
    current.details = await task(); current.status = 'PASS';
  }
  try {
    let source, job;
    const requests = [];
    await check('source', async () => {
      source = await request('/sources', { path: sourceDir });
      assert.ok(source.id, '合成数据注册失败');
      requests.push({ sourceId: source.id, taskId: '室内 A', dataType: 'RSRP', layers: ['F1'] },
        { sourceId: source.id, taskId: '室外', dataType: 'SCR', layers: ['10m'] },
        { sourceId: source.id, taskId: '室内 A', dataType: 'BESTSERVER', layers: ['F1'] });
      return { taskCount: 3 };
    });
    await check('worker', async () => {
      const stats = await request('/analysis', { sourceId: source.id, taskId: '室内 A', dataType: 'RSRP', layers: ['F1', 'F2'] });
      assert.equal(stats.layers.length, 2, '统计层数异常');
      for (const layer of stats.layers) {
        assert.equal(layer.mean, -90, '统计均值应为 -90');
        assert.equal(layer.validCount, 3, '有效样本数应为 3');
      }
      return { mean: -90, validCount: 3, layerCount: 2 };
    });
    await check('matlab', async () => {
      const plot = await request('/plot', { requests });
      assert.ok(plot.jobId, '未创建真实绘图任务');
      // 原型尚无进程监管；等待真实队列结束，避免误把停止轮询当成 MATLAB 已退出。
      let slowNotified = false;
      const started = Date.now();
      do {
        job = await request('/jobs/' + plot.jobId);
        if (['done', 'partial', 'failed', 'cancelled', 'timed_out', 'interrupted'].includes(job.status)) break;
        if (!slowNotified && Date.now() - started > 180000) {
          slowNotified = true; onProgress('MATLAB 启动或绘图较慢，仍在等待任务结束，请勿关闭应用');
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      } while (true);
      assert.equal(job.status, 'done', job.error || 'MATLAB 批次失败');
      assert.equal(job.done, 3, '必须有 3 张成功图片');
      assert.equal(job.failed, 0, '存在失败图片');
      assert.equal(job.figures.length, 3, '图片清单不完整');
      return { total: job.total, done: job.done, failed: job.failed, matlabVersion: job.matlabVersion || null };
    });
    await check('png', async () => {
      const sizes = [];
      for (let index = 0; index < job.figures.length; index++) {
        const bytes = await readBytes(job.figures[index].url);
        sizes.push(verifyPng(bytes, decodePng));
        fs.writeFileSync(path.join(reportDir, `sample-${index + 1}.png`), bytes);
      }
      return { sizes };
    });
    await check('downloads', async () => {
      const zip = await request('/export', { requests });
      assert.equal(zip.count, 3, 'ZIP 必须包含 3 张图');
      const downloadsDir = path.join(reportDir, 'downloads'); fs.mkdirSync(downloadsDir, { recursive: true });
      const pngFile = path.join(downloadsDir, 'sample-download.png');
      const zipFile = path.join(downloadsDir, 'figures.zip');
      const imageUrl = job.figures[0].url;
      await download(imageUrl + (imageUrl.includes('?') ? '&' : '?') + 'download=1', pngFile);
      verifyPng(fs.readFileSync(pngFile), decodePng);
      await download(zip.url, zipFile);
      const zipBytes = fs.readFileSync(zipFile);
      assert.ok(zipBytes.length > 4 && zipBytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 3, 4])), 'ZIP 下载文件无效');
      return { count: 2 };
    });
    report.status = 'PASS';
  } catch (error) {
    if (current) {
      current.status = 'FAIL';
      // 报告不导出完整栈、会话或机器路径；本工具仅触及合成数据。
      current.message = String(error.message).replace(/[A-Z]:[\\/][^\r\n]*/gi, '[本机路径]').slice(0, 1000);
    }
  }
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(reportDir, 'acceptance-report.json'), JSON.stringify(report, null, 2));
  return report;
}
module.exports = { runAcceptanceChecks, verifyPng };
