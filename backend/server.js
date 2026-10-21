const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const { config, configSource, FRONTEND_DIST } = require('./src/config');
const routes = require('./src/routes');

const app = express();
app.use(cors());
app.use('/api/preview/save', express.json({ limit: '21mb' }));
app.use(express.json({ limit: '2mb' }));
app.use('/api', routes);

const hasFrontend = fs.existsSync(path.join(FRONTEND_DIST, 'index.html'));
if (hasFrontend) {
  app.use(express.static(FRONTEND_DIST));
}

app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: '接口不存在' });
  if (hasFrontend) return res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
  res
    .status(200)
    .send(
      '<h3>前端未构建</h3><p>请先在 platform/frontend 目录执行 npm install && npm run build,或开发模式运行 npm run dev(端口 5173)。</p>'
    );
});

app.listen(config.port, () => {
  console.log('==============================================');
  console.log('  天线覆盖绘图平台后端已启动');
  console.log(`  地址:   http://127.0.0.1:${config.port}`);
  console.log(`  配置:   ${configSource}`);
  console.log(`  MATLAB: ${fs.existsSync(config.matlabExe) ? config.matlabExe : '(未找到!请检查 config.json)'}`);
  console.log('==============================================');
});
