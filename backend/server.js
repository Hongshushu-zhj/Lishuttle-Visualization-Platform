const path = require('node:path');
const { createServer } = require('./src/serverApp');
const { resolveRuntimePaths } = require('./src/runtimePaths');
async function main() {
  const root = path.resolve(__dirname, '..');
  const paths = resolveRuntimePaths({ channel: 'dev', sourceRoot: root, dataDir: process.env.ANTENNA_DESKTOP_DATA_DIR });
  const service = createServer({ paths, devOrigin: 'http://localhost:5173' });
  const { origin } = await service.listen({ host: '127.0.0.1', port: 8000 });
  console.log(`天线覆盖绘图平台开发服务 ${origin}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => service.close().then(() => { process.exitCode = 0; }));
  return service;
}
module.exports = { main };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
