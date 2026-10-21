// 渲染口径综合自检:
//   1) 统一范围:两个范围不同的源一起出图时,实际坐标范围必须一致(= 并集)
//   2) 相对坐标:室内图在 rel-center 模式下的坐标范围与绝对模式一致(只改刻度标签)
//   3) 室外回归:现有室外数据仍能正常出图
// 用法: node scripts/verify-render-options.js
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const BASE = process.env.PLATFORM_URL || 'http://127.0.0.1:8000';
const SRC = 'D:/workspace/antenna-draw/kokin_tg';
const FIXTURE = path.join(process.env.TEMP || 'C:/Windows/Temp', 'antenna-unify-fixture');
const INDOOR = 'D:/workspace/LAB/Lab20261008/outputs/zhengzhou-indoor/zhengzhou_indoor_TEST2';

const post = async (p, body) =>
  (await fetch(BASE + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })).json();

async function waitJob(id) {
  for (let i = 0; i < 60; i++) {
    await new Promise((s) => setTimeout(s, 3000));
    const st = await (await fetch(`${BASE}/api/jobs/${id}`)).json();
    if (st.status === 'done' || st.status === 'failed') return st;
  }
  throw new Error('任务超时');
}

function makeShiftedFixture() {
  // 复制一个源的地面层数据,并把 index.txt 的范围整体平移 500m(栅格规模不变)
  const outPred = path.join(FIXTURE, 'pred', '0');
  fs.mkdirSync(outPred, { recursive: true });
  fs.copyFileSync(path.join(SRC, 'pred', '0', 'SCR.dem'), path.join(outPred, 'SCR.dem'));
  const lines = fs.readFileSync(path.join(SRC, 'pred', '0', 'index.txt'), 'utf8').trim().split(/\r?\n/);
  const shifted = lines.map((l) => {
    if (/^UTM/i.test(l)) return l;
    const p = l.trim().split(/\s+/);
    const [lf, rt, bt, tp, rs] = p.slice(1).map(Number);
    return `${p[0]} ${lf + 500} ${rt + 500} ${bt + 500} ${tp + 500} ${rs}`;
  });
  fs.writeFileSync(path.join(outPred, 'index.txt'), shifted.join('\n') + '\n');
  return FIXTURE;
}

// 清掉指定源的缓存,强制重新出图(这样才能读到本次实际使用的坐标范围)
function clearCache(sourceId, dataType) {
  const cache = require('../src/cache');
  const store = require('../src/sourcesStore');
  const source = store.get(sourceId);
  const dirs = [
    path.join(cache.resultsDir(sourceId), dataType),
    ...Object.keys(source.scan.tasks).map((taskId) => path.join(cache.resultsDir(sourceId, taskId), dataType)),
    path.join(__dirname, '..', 'data', 'cache', sourceId, dataType),
  ];
  for (const dir of dirs) {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(`(已清理结果图与旧缓存 ${sourceId}/${dataType},强制重画)`);
}

async function main() {
  const results = [];

  // ---------- 1) 统一范围 ----------
  const fixture = makeShiftedFixture();
  const fx = await post('/api/sources', { path: fixture });
  if (fx.error) throw new Error('夹具注册失败: ' + fx.error);
  const sources = await (await fetch(`${BASE}/api/sources`)).json();
  const real = sources.find((s) => s.name === 'kokin_tg');
  console.log(`源 A: ${real.name} 范围 ${JSON.stringify(real.types.SCR.bounds)}`);
  console.log(`源 B(夹具,整体平移 500m): ${fx.name} 范围 ${JSON.stringify(fx.types.SCR.bounds)}`);
  clearCache(real.id, 'SCR');
  clearCache(fx.id, 'SCR');

  const r = await post('/api/plot', {
    requests: [
      { sourceId: real.id, dataType: 'SCR', layers: ['ground'] },
      { sourceId: fx.id, dataType: 'SCR', layers: ['ground'] },
    ],
    options: { coordMode: 'abs' },
  });
  let axesPerFig = r.figures.map((f) => f.axes || null);
  if (r.jobId) {
    const st = await waitJob(r.jobId);
    console.log(`出图: ${st.status} 成功 ${st.done} 失败 ${st.failed}`);
    for (const f of st.figures) {
      if (f.status === 'failed') console.log('  失败:', f.sourceName, f.error);
    }
    axesPerFig = st.figures.map((f) => f.axes || null);
  }
  const expected = [
    Math.min(742331, 742831), Math.max(743866, 744366),
    Math.min(2560620, 2561120), Math.max(2562085, 2562585),
  ];
  console.log('两图实际坐标范围:', JSON.stringify(axesPerFig));
  const same = axesPerFig.every((a) => a && String(a) === String(axesPerFig[0]));
  const matchesUnion = axesPerFig[0] && expected.every((v, i) => Math.abs(v - axesPerFig[0][i]) < 0.01);
  console.log(`  两图范围一致: ${same ? '✓' : '✗'} | 等于并集 [${expected.join(', ')}]: ${matchesUnion ? '✓' : '✗'}`);
  results.push({ name: '统一范围(跨源并集)', pass: same && matchesUnion });

  // ---------- 2) 室内相对坐标 ----------
  const indoor = sources.find((s) => s.indoor);
  if (indoor && indoor.types.RSRP) {
    const layer = indoor.types.RSRP.layers[0].key;
    clearCache(indoor.id, 'RSRP');
    const r2 = await post('/api/plot', {
      requests: [{ sourceId: indoor.id, dataType: 'RSRP', layers: [layer] }],
      options: { coordMode: 'rel-center' },
    });
    let axes = r2.figures[0].axes || null;
    if (r2.jobId) {
      const st = await waitJob(r2.jobId);
      axes = st.figures[0].axes || null;
      if (st.figures[0].status === 'failed') console.log('  室内失败:', st.figures[0].error);
    }
    const b = indoor.types.RSRP.bounds;
    const ok =
      axes &&
      Math.abs(axes[0] - b.left) < 0.01 &&
      Math.abs(axes[1] - b.right) < 0.01 &&
      Math.abs(axes[2] - b.bottom) < 0.01 &&
      Math.abs(axes[3] - b.top) < 0.01;
    console.log(`\n室内(${indoor.name})相对坐标: 轴范围 ${JSON.stringify(axes)} 应等于数据范围 [${b.left},${b.right},${b.bottom},${b.top}] → ${ok ? '✓' : '✗'}`);
    results.push({ name: '室内相对坐标(范围不变、仅刻度相对)', pass: !!ok });
  } else {
    console.log('\n(未注册室内数据源,跳过室内项)');
  }

  // ---------- 清理夹具注册 ----------
  await fetch(`${BASE}/api/sources/${fx.id}`, { method: 'DELETE' });
  fs.rmSync(FIXTURE, { recursive: true, force: true });
  console.log('\n(测试夹具已清理)');

  console.log('\n===== 汇总 =====');
  for (const r2 of results) console.log(`  ${r2.pass ? '✓ 通过' : '✗ 未通过'}  ${r2.name}`);
}

main().catch((e) => {
  console.error('自检异常:', e.message);
  process.exit(1);
});
