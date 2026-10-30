const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

async function ensureWindowsProcessHost(stateDir) {
  const source = path.join(__dirname, 'native/WindowsProcessHost.cs');
  const bundled = path.join(__dirname, 'native/WindowsProcessHost.exe');
  if (fs.existsSync(bundled)) return bundled;
  const hash = crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex').slice(0, 20);
  fs.mkdirSync(stateDir, { recursive: true });
  const binary = path.join(stateDir, 'AntennaProcessHost-' + hash + '.exe');
  if (fs.existsSync(binary)) return binary;
  const temporary = binary + '.' + crypto.randomUUID() + '.tmp.exe';
  const code = "$ErrorActionPreference='Stop'; Add-Type -TypeDefinition (Get-Content -LiteralPath $env:ANTENNA_HOST_SOURCE -Raw -Encoding UTF8) -OutputAssembly $env:ANTENNA_HOST_OUTPUT -OutputType ConsoleApplication";
  const env = { ...process.env, ANTENNA_HOST_SOURCE: source, ANTENNA_HOST_OUTPUT: temporary };
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  try {
    await new Promise((resolve, reject) => {
      const compiler = spawn(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', code], { env, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      const timeout = setTimeout(() => { compiler.kill(); }, 30000);
      compiler.stdout.resume(); compiler.stderr.on('data', bytes => { stderr = (stderr + bytes.toString('utf8')).slice(-4000); });
      compiler.on('error', error => { clearTimeout(timeout); reject(error); });
      compiler.on('close', code => { clearTimeout(timeout); code === 0 ? resolve() : reject(new Error('无法建立 Windows 进程监管器：' + stderr)); });
    });
    fs.renameSync(temporary, binary); return binary;
  } finally { try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
}
module.exports = { ensureWindowsProcessHost };
