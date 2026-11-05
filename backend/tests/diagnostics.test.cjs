const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
test('diagnostic logs rotate to five bounded files and export only redacted bounded log tails', t => {
  const { createDiagnostics } = require('../src/diagnostics'); const root = fs.mkdtempSync(path.join(os.tmpdir(),'antenna-diagnostics-')); t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const diagnostics = createDiagnostics({ dataDir:root, secretValues:['private-session-secret'], maxFileBytes:1024 });
  for(let i=0;i<20;i++) diagnostics.log('event '+i+' '+ 'x'.repeat(700));
  diagnostics.log('MATLAB failed at D:\\数据\\test\nCookie: private-session-secret\nAuthorization: Bearer hidden-token');
  const files = fs.readdirSync(path.join(root,'logs')); assert.equal(files.length,5); for(const name of files) assert.ok(fs.statSync(path.join(root,'logs',name)).size<=1024);
  fs.writeFileSync(path.join(root,'logs','unrelated.lic'),'LICENCE_DO_NOT_EXPORT'); fs.writeFileSync(path.join(root,'sources.json'),'SOURCE_DO_NOT_EXPORT');
  const report = diagnostics.preview({version:'test',channel:'dev'}); const text = JSON.stringify(report);
  assert.ok(text.includes('本地路径')); assert.ok(text.includes('D:')); assert.ok(!text.includes('private-session-secret')); assert.ok(!text.includes('hidden-token')); assert.ok(!text.includes('DO_NOT_EXPORT')); assert.ok(text.length<400000);
});
test('cleanup touches only managed cache/exports, retains recent and active files, and never follows junctions', t => {
  const { cleanupManaged } = require('../src/diagnostics'); const root = fs.mkdtempSync(path.join(os.tmpdir(),'antenna-cleanup-')); t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const old = new Date(Date.now()-9*86400000); const paths = { cacheDir:path.join(root,'cache'),exportDir:path.join(root,'exports') }; const activeFiles = new Set();
  for(const directory of [paths.cacheDir,paths.exportDir,path.join(root,'source')]) fs.mkdirSync(directory);
  const oldFile=path.join(paths.exportDir,'00000000-0000-4000-8000-000000000001.zip'), active=path.join(paths.exportDir,'00000000-0000-4000-8000-000000000002.zip'), recent=path.join(paths.exportDir,'00000000-0000-4000-8000-000000000003.zip'), source=path.join(root,'source','input.dem');
  for(const file of [oldFile,active,recent,source]) fs.writeFileSync(file,'test'); for(const file of [oldFile,active,source]) fs.utimesSync(file,old,old); activeFiles.add(active);
  fs.symlinkSync(path.join(root,'source'),path.join(paths.cacheDir,'linked'),'junction');
  const result=cleanupManaged({paths,activeFiles}); assert.equal(result.removed,1); assert.equal(fs.existsSync(oldFile),false); for(const file of [active,recent,source]) assert.equal(fs.existsSync(file),true);
});

test('cleanup preserves legacy cache, formal results, unknown files and protected output roots', t => {
  const { cleanupManaged } = require('../src/diagnostics');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'antenna-safe-cleanup-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const paths = { cacheDir: path.join(root, 'cache'), exportDir: path.join(root, 'exports') };
  const protectedRoot = path.join(paths.exportDir, 'formal-results');
  const files = [path.join(paths.cacheDir, 'source/RSRP/F1.png'), path.join(paths.cacheDir, 'source/RSRP/F1.png.meta.json'),
    path.join(paths.cacheDir, 'unknown.bin'), path.join(paths.exportDir, 'notes.zip'),
    path.join(protectedRoot, '00000000-0000-4000-8000-000000000001.zip')];
  for (const file of files) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'preserve'); fs.utimesSync(file, new Date(0), new Date(0)); }
  cleanupManaged({ paths, protectedRoots: [protectedRoot] });
  for (const file of files) assert.ok(fs.existsSync(file), file);
  const exportFile = path.join(paths.exportDir, '00000000-0000-4000-8000-000000000002.zip');
  fs.writeFileSync(exportFile, 'formal'); fs.utimesSync(exportFile, new Date(0), new Date(0));
  cleanupManaged({ paths, protectedRoots: [paths.exportDir] });
  assert.ok(fs.existsSync(exportFile), 'configured output root may equal the exports directory');
});
test('overlapping downloads retain export until every response completes',()=>{
  const exporter=require('../src/exporter').createExporter({EXPORT_DIR:'unused'}); const a=exporter.retain('same.zip'),b=exporter.retain('same.zip');
  a(); assert.equal(exporter.activeFiles.has('same.zip'),true); b(); assert.equal(exporter.activeFiles.has('same.zip'),false);
});

test('structured diagnostics redact nested secrets, quoted JSON keys and session credentials', t => {
  const { createDiagnostics } = require('../src/diagnostics');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'antenna-diagnostic-secret-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const diagnostics = createDiagnostics({ dataDir: root });
  diagnostics.log('structured', { password: 'private-secret', nested: { sessionToken: 'session-secret', cookie: 'session=private-cookie', authorization: 'Bearer private-auth' }, normal: 'visible-value' });
  diagnostics.log('serialized {"password":"quoted-secret","access_token":"access-secret"}');
  const preview = JSON.stringify(diagnostics.preview({ token: 'report-secret', state: 'visible-state' }));
  for (const secret of ['private-secret', 'session-secret', 'private-cookie', 'private-auth', 'quoted-secret', 'access-secret', 'report-secret']) assert.ok(!preview.includes(secret), secret);
  assert.ok(preview.includes('visible-value'));
  assert.ok(preview.includes('visible-state'));
});
