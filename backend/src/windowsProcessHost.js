const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { isDeepStrictEqual } = require('node:util');

const SOURCE_FILE = 'WindowsProcessHost.cs';
const BINARY_FILE = 'WindowsProcessHost.exe';
const MANIFEST_FILE = 'WindowsProcessHost.manifest.json';
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const integrityError = detail => Object.assign(new Error('Windows 进程监管器完整性检查失败：' + detail + '。请使用可信安装包修复安装，并检查杀毒软件隔离记录；不会在安装环境重新编译或绕过隔离。'), { code: 'PROCESS_HOST_INTEGRITY_FAILED' });

function readRegularFile(file, limit = Infinity) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit) throw new Error(path.basename(file) + ' 不是正常文件或大小无效');
  return fs.readFileSync(file);
}
function validatePe(bytes) {
  if (bytes.length < 64 || bytes.toString('ascii', 0, 2) !== 'MZ') throw new Error('不是有效 PE 可执行文件');
  const offset = bytes.readUInt32LE(60);
  if (offset > bytes.length - 4 || !bytes.subarray(offset, offset + 4).equals(Buffer.from([80, 69, 0, 0]))) throw new Error('不是有效 PE 可执行文件');
}
function validateManifest(manifest) {
  if (manifest?.schemaVersion !== 1 || manifest.sourceFile !== SOURCE_FILE || manifest.binaryFile !== BINARY_FILE ||
      !/^[a-f0-9]{64}$/.test(manifest.sourceSha256 || '') || !/^[a-f0-9]{64}$/.test(manifest.binarySha256 || '') ||
      manifest.outputType !== 'ConsoleApplication' || !manifest.compiler ||
      !['name', 'powershellVersion', 'clrVersion'].every(key => typeof manifest.compiler[key] === 'string' && manifest.compiler[key].length > 0)) throw new Error('manifest 元数据无效');
}
// Hashes detect damaged/mismatched artifacts and record build provenance. They are
// not a signature or protection against an attacker replacing code and metadata.
function verifyWindowsProcessHost({ binary, manifestFile, sourceSha256, expectedManifest }) {
  try {
    const manifest = JSON.parse(readRegularFile(manifestFile, 16384).toString('utf8'));
    validateManifest(manifest);
    if (sourceSha256 && manifest.sourceSha256 !== sourceSha256) throw new Error('源码 SHA-256 与 manifest 不符');
    if (expectedManifest) {
      validateManifest(expectedManifest);
      if (!isDeepStrictEqual(manifest, expectedManifest)) throw new Error('manifest 与 build-info 构建记录不符');
    }
    const bytes = readRegularFile(binary, 16 * 1024 * 1024); validatePe(bytes);
    if (sha256(bytes) !== manifest.binarySha256) throw new Error('二进制 SHA-256 与 manifest 不符');
    return manifest;
  } catch (error) { if (error.code === 'PROCESS_HOST_INTEGRITY_FAILED') throw error; throw integrityError(error.message); }
}
async function compileSource({ source, output }) {
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const code = "$ErrorActionPreference='Stop'; Add-Type -TypeDefinition (Get-Content -LiteralPath $env:ANTENNA_HOST_SOURCE -Raw -Encoding UTF8) -OutputAssembly $env:ANTENNA_HOST_OUTPUT -OutputType ConsoleApplication; @{name='Windows PowerShell Add-Type';powershellVersion=$PSVersionTable.PSVersion.ToString();clrVersion=[Environment]::Version.ToString()} | ConvertTo-Json -Compress";
  const env = { ...process.env, ANTENNA_HOST_SOURCE: source, ANTENNA_HOST_OUTPUT: output };
  return new Promise((resolve, reject) => {
    const compiler = spawn(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', code], { env, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timeout = setTimeout(() => { compiler.kill(); }, 30000);
    compiler.stdout.on('data', bytes => { stdout = (stdout + bytes.toString('utf8')).slice(-16384); });
    compiler.stderr.on('data', bytes => { stderr = (stderr + bytes.toString('utf8')).slice(-4000); });
    compiler.on('error', error => { clearTimeout(timeout); reject(error); });
    compiler.on('close', code => {
      clearTimeout(timeout);
      if (code !== 0) { reject(new Error('无法建立 Windows 进程监管器：' + stderr)); return; }
      try { resolve({ ...JSON.parse(stdout.trim()), executable: powershell }); } catch { reject(new Error('编译器没有返回有效的版本信息')); }
    });
  });
}
async function compileInto({ source, directory, compile }) {
  const sourceSha256 = sha256(readRegularFile(source, 2 * 1024 * 1024));
  const binary = path.join(directory, BINARY_FILE), manifestFile = path.join(directory, MANIFEST_FILE);
  const compiler = await compile({ source, output: binary });
  if (sha256(readRegularFile(source, 2 * 1024 * 1024)) !== sourceSha256) throw new Error('进程监管器源码在编译期间发生变化');
  const bytes = readRegularFile(binary, 16 * 1024 * 1024); validatePe(bytes);
  const manifest = { schemaVersion: 1, sourceFile: SOURCE_FILE, sourceSha256, binaryFile: BINARY_FILE, binarySha256: sha256(bytes), compiler, outputType: 'ConsoleApplication' };
  validateManifest(manifest); fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2), { flag: 'wx' });
  verifyWindowsProcessHost({ binary, manifestFile, sourceSha256 });
  return { binary, manifestFile, manifest };
}
// Release builds always compile the reviewed source in a fresh directory. They
// never consult bundled executables or the development runtime cache.
async function buildWindowsProcessHost({ sourceDir = path.join(__dirname, 'native'), outputDir, compile = compileSource }) {
  if (!outputDir) throw new Error('必须指定进程监管器构建输出目录');
  fs.mkdirSync(outputDir, { recursive: true });
  const temporary = fs.mkdtempSync(path.join(outputDir, '.compile-'));
  try {
    const result = await compileInto({ source: path.join(sourceDir, SOURCE_FILE), directory: temporary, compile });
    const binary = path.join(outputDir, BINARY_FILE), manifestFile = path.join(outputDir, MANIFEST_FILE);
    fs.renameSync(result.binary, binary); fs.renameSync(result.manifestFile, manifestFile);
    verifyWindowsProcessHost({ binary, manifestFile, sourceSha256: result.manifest.sourceSha256 });
    return { binary, manifestFile, manifest: result.manifest };
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}
async function ensureWindowsProcessHost(stateDir, { sourceDir = path.join(__dirname, 'native'), packaged, compile = compileSource } = {}) {
  const source = path.join(sourceDir, SOURCE_FILE), bundled = path.join(sourceDir, BINARY_FILE), bundledManifest = path.join(sourceDir, MANIFEST_FILE);
  // Installed packages omit C# source. build-info also prevents a subsequently
  // added source file from enabling runtime compilation in an installation.
  const buildInfoFile = path.resolve(sourceDir, '../../../build-info.json');
  const installed = packaged === true || fs.existsSync(buildInfoFile) || !fs.existsSync(source);
  if (installed || fs.existsSync(bundled) || fs.existsSync(bundledManifest)) {
    let expectedManifest;
    if (installed) {
      try { expectedManifest = JSON.parse(readRegularFile(buildInfoFile, 2 * 1024 * 1024).toString('utf8')).nativeProcessHost; validateManifest(expectedManifest); }
      catch (error) { throw integrityError('build-info 构建记录无效：' + error.message); }
    }
    verifyWindowsProcessHost({ binary: bundled, manifestFile: bundledManifest, sourceSha256: !installed && fs.existsSync(source) ? sha256(readRegularFile(source)) : undefined, expectedManifest });
    return bundled;
  }
  const sourceSha256 = sha256(readRegularFile(source, 2 * 1024 * 1024));
  fs.mkdirSync(stateDir, { recursive: true });
  const binary = path.join(stateDir, 'AntennaProcessHost-' + sourceSha256 + '.exe'), manifestFile = binary.replace(/\.exe$/, '.manifest.json');
  if (fs.existsSync(binary) || fs.existsSync(manifestFile)) { verifyWindowsProcessHost({ binary, manifestFile, sourceSha256 }); return binary; }
  const temporary = fs.mkdtempSync(path.join(stateDir, '.compile-'));
  try {
    const result = await compileInto({ source, directory: temporary, compile });
    if (result.manifest.sourceSha256 !== sourceSha256) throw new Error('进程监管器源码在编译准备期间发生变化');
    if (fs.existsSync(binary) || fs.existsSync(manifestFile)) { verifyWindowsProcessHost({ binary, manifestFile, sourceSha256 }); return binary; }
    fs.renameSync(result.binary, binary); fs.renameSync(result.manifestFile, manifestFile);
    verifyWindowsProcessHost({ binary, manifestFile, sourceSha256 }); return binary;
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}
module.exports = { ensureWindowsProcessHost, buildWindowsProcessHost, verifyWindowsProcessHost };
