// 渲染自检:走完整 API 流程渲染一张图并报告结果(排查 MATLAB 绘图问题用)
// 用法: node scripts/render-check.js [数据类型] [高度层] [数据源名关键字]
//   默认 SCR / ground / 第一个含该类型的数据源;高度层用 all 可渲染全部层
const BASE = process.env.PLATFORM_URL || 'http://127.0.0.1:8000';

async function post(p, body) {
  const r = await fetch(BASE + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json();
}

async function main() {
  const dataType = process.argv[2] || 'SCR';
  const layer = process.argv[3] || 'ground';
  const nameFilter = process.argv[4] || '';

  const sources = await (await fetch(`${BASE}/api/sources`)).json();
  if (!sources.length) {
    console.log('没有已注册的数据源,请先在平台里添加结果文件夹');
    return;
  }
  const pool = nameFilter ? sources.filter((s) => s.name.includes(nameFilter)) : sources;
  if (!pool.length) {
    console.log(`没有匹配「${nameFilter}」的数据源。已注册: ${sources.map((s) => s.name).join(', ')}`);
    return;
  }
  const source = pool.find((s) => s.types[dataType]) || pool[0];
  const useType = source.types[dataType] ? dataType : Object.keys(source.types)[0];
  console.log(`数据源: ${source.name}${source.indoor ? '(室内)' : ''} | 类型: ${useType} | ${source.indoor ? '楼层' : '高度层'}: ${layer}`);
  if (source.indoor) {
    console.log(`墙线文件: ${source.wallsName || '(未找到,室内图将没有建筑叠加)'}`);
  }

  const r = await post('/api/plot', {
    requests: [{ sourceId: source.id, dataType: useType, layers: layer === 'all' ? ['all'] : [layer] }],
    options: { coordMode: 'abs' },
  });
  if (r.error) {
    console.log('请求失败:', r.error);
    return;
  }
  console.log(`待绘图 ${r.figures.filter((f) => f.status === 'pending').length} 张,已缓存 ${r.figures.filter((f) => f.status === 'cached').length} 张`);
  console.log('图片 URL:', r.figures[0].url);
  if (!r.jobId) {
    console.log('无需启动 MATLAB(全部命中缓存)');
    return;
  }

  const t0 = Date.now();
  for (let i = 0; i < 60; i++) {
    await new Promise((s) => setTimeout(s, 3000));
    const st = await (await fetch(`${BASE}/api/jobs/${r.jobId}`)).json();
    if (st.status === 'done' || st.status === 'failed') {
      console.log(`\n任务结束: ${st.status} | 成功 ${st.done} 失败 ${st.failed} | 用时 ${((Date.now() - t0) / 1000).toFixed(0)}s`);
      for (const f of st.figures) {
        if (f.status === 'failed') console.log(`  ✗ ${f.layerLabel}: ${f.error}`);
      }
      if (st.error) console.log('  任务级错误:', st.error.slice(0, 1500));
      return;
    }
  }
  console.log('任务超时未结束');
}

main().catch((e) => console.error('自检异常:', e.message));
