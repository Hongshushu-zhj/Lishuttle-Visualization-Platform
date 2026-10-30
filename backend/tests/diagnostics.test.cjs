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
  const oldFile=path.join(paths.exportDir,'old.zip'), active=path.join(paths.exportDir,'active.zip'), recent=path.join(paths.exportDir,'new.zip'), source=path.join(root,'source','input.dem');
  for(const file of [oldFile,active,recent,source]) fs.writeFileSync(file,'test'); for(const file of [oldFile,active,source]) fs.utimesSync(file,old,old); activeFiles.add(active);
  fs.symlinkSync(path.join(root,'source'),path.join(paths.cacheDir,'linked'),'junction');
  const result=cleanupManaged({paths,activeFiles}); assert.equal(result.removed,1); assert.equal(fs.existsSync(oldFile),false); for(const file of [active,recent,source]) assert.equal(fs.existsSync(file),true);
});
test('overlapping downloads retain export until every response completes',()=>{
  const exporter=require('../src/exporter').createExporter({EXPORT_DIR:'unused'}); const a=exporter.retain('same.zip'),b=exporter.retain('same.zip');
  a(); assert.equal(exporter.activeFiles.has('same.zip'),true); b(); assert.equal(exporter.activeFiles.has('same.zip'),false);
});
