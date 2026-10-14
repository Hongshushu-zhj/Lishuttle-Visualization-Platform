// 开发自检脚本:注册数据源并打印自动识别结果
// 用法: node scripts/dev-check.js [文件夹路径 ...]
const BASE = process.env.PLATFORM_URL || 'http://127.0.0.1:8000';

async function main() {
  const paths = process.argv.slice(2);
  if (paths.length === 0) {
    const list = await (await fetch(`${BASE}/api/sources`)).json();
    console.log(`已注册数据源 ${list.length} 个:`);
    for (const s of list) printSource(s);
    return;
  }
  for (const p of paths) {
    const res = await fetch(`${BASE}/api/sources`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: p }),
    });
    const j = await res.json();
    if (j.error) {
      console.log(`[失败] ${p}\n   ${j.error}`);
      continue;
    }
    printSource(j);
  }
}

function printSource(s) {
  console.log(`\n=== ${s.name}  (id=${s.id})${s.indoor ? '  [室内]' : ''}`);
  console.log(`    路径: ${s.path}    ${s.offline ? '[离线]' : ''}`);
  console.log(`    坐标系: ${s.utm || (s.indoor ? '局部米制(室内)' : '-')}`);
  if (s.indoor) {
    console.log(`    墙线/建筑: ${s.wallsName ? s.wallsName + ' (' + s.wallsFile + ')' : '未找到(支持 walls.txt / *floor*.txt / out.txt)'}`);
  }
  for (const [k, v] of Object.entries(s.types || {})) {
    const layers = v.layers.map((l) => l.label).join(', ');
    console.log(`    - ${k.padEnd(11)} ${v.known ? '可绘图' : '无脚本'}  ${v.desc}`);
    console.log(`      ${s.indoor ? '楼层' : '高度层'}(${v.layers.length}): ${layers}`);
    console.log(`      范围: ${v.bounds.left}~${v.bounds.right} x ${v.bounds.bottom}~${v.bounds.top}, res=${v.bounds.res}`);
  }
}

main().catch((e) => {
  console.error('自检失败:', e.message);
  process.exit(1);
});
