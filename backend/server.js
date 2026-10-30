const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createServer } = require('./src/serverApp');
async function main() {
  const root = path.resolve(__dirname, '..');
  const dataDir = process.env.ANTENNA_DESKTOP_DATA_DIR || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.local/share'), 'AntennaDraw-Dev');
  let settings = { port: 8000, matlabExe: '', maxConcurrentJobs: 1 };
  try { settings = { ...settings, ...JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8')) }; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const paths = { channel: 'dev', dataDir, cacheDir: path.join(dataDir, 'cache'), jobsDir: path.join(dataDir, 'jobs'),
    exportDir: path.join(dataDir, 'exports'), matlabDir: path.join(root, 'matlab'), frontendDir: path.join(root, 'frontend/dist') };
  const service = createServer({ paths, settingsStore: { get: () => settings }, devOrigin: 'http://localhost:5173' });
  const { origin } = await service.listen({ host: '127.0.0.1', port: settings.port });
  console.log(`天线覆盖绘图平台开发服务 ${origin}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => service.close().then(() => { process.exitCode = 0; }));
  return service;
}
module.exports = { main };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
