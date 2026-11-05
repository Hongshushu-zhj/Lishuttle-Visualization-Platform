const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawnSync } = require('node:child_process');
const launcher = require('../../scripts/web-launcher.cjs');

function fixture(t) {
  const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'antenna-web-launcher-'));
  const dataDir = path.join(sourceRoot, 'data'); fs.mkdirSync(dataDir);
  t.after(() => fs.rmSync(sourceRoot, {recursive:true, force:true}));
  return {sourceRoot, paths:{sourceRoot,dataDir,DATA_DIR:dataDir},port:0};
}
async function listener(t, handler) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return {server,port:server.address().port};
}
function json(res, body) {res.setHeader('Content-Type', 'application/json');res.end(JSON.stringify(body));}

test('batch launcher fixture cannot terminate an unknown port listener', {skip: process.platform !== 'win32'}, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'antenna-legacy-launcher-'));
  const log = path.join(root, 'terminated.txt');
  try {
    fs.writeFileSync(path.join(root, 'stop.bat'), fs.readFileSync(path.join(__dirname, '../../停止平台.bat')));
    fs.writeFileSync(path.join(root, 'netstat.cmd'), '@echo off\r\necho TCP 127.0.0.1:8000 0.0.0.0:0 LISTENING 456789\r\n');
    fs.writeFileSync(path.join(root, 'taskkill.cmd'), '@echo off\r\necho %* >> "' + log + '"\r\n');
    spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'stop.bat'], {cwd:root,env:{...process.env,PATH:root+';'+process.env.PATH},windowsHide:true});
    assert.equal(fs.existsSync(log), false, 'unknown listener was passed to taskkill');
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('start refuses unknown occupied port before installation or launching', async t => {
  const configuration = fixture(t);
  Object.assign(configuration, await listener(t, (_req,res) => json(res,{app:'other-service'})));
  let touched = false;
  await assert.rejects(launcher.start({configuration,prepare(){touched=true;},launch(){touched=true;},open(){touched=true;}}), /占用/);
  assert.equal(touched,false);
});

test('start reuses same project service and configured port', async t => {
  const configuration = fixture(t);
  Object.assign(configuration,await listener(t, (_req,res) => json(res,{app:'antenna-draw-web',sourceRoot:configuration.sourceRoot,pid:123})));
  let opened;
  const result = await launcher.start({configuration,prepare(){assert.fail('must reuse');},launch(){assert.fail('must reuse');},open(origin){opened=origin;}});
  assert.equal(result.reused,true);
  assert.equal(opened,`http://127.0.0.1:${configuration.port}`);
});

test('stop refuses a marker belonging to another project', async t => {
  const configuration = fixture(t);
  fs.writeFileSync(path.join(configuration.paths.dataDir,'web-instance.json'),JSON.stringify({app:'antenna-draw-web',sourceRoot:path.join(configuration.sourceRoot,'other'),shutdownToken:'secret',pid:123,port:8000}));
  await assert.rejects(launcher.stop({configuration}), /身份/);
});

test('stop checks live identity then sends instance token and waits for listener close', async t => {
  const configuration=fixture(t); let token; let shutdown=false;
  const {server,port}=await listener(t,(req,res) => {
    if(req.url === '/api/runtime/shutdown') {
      token=req.headers['x-antenna-shutdown-token'];shutdown=true;json(res,{ok:true});server.close();
    } else json(res,{app:'antenna-draw-web',sourceRoot:configuration.sourceRoot,pid:123});
  });
  configuration.port=port;
  fs.writeFileSync(path.join(configuration.paths.dataDir,'web-instance.json'),JSON.stringify({app:'antenna-draw-web',sourceRoot:configuration.sourceRoot,pid:123,port,origin:`http://127.0.0.1:${port}`,shutdownToken:'private-token'}));
  const result=await launcher.stop({configuration,timeoutMs:2000});
  assert.equal(result.stopped,true); assert.equal(shutdown,true);assert.equal(token,'private-token');
});

test('stop never sends shutdown when health pid differs from marker', async t => {
  const configuration=fixture(t); let shutdown=false;
  const {port}=await listener(t,(req,res) => {if(req.method==='POST')shutdown=true;json(res,{app:'antenna-draw-web',sourceRoot:configuration.sourceRoot,pid:999});});configuration.port=port;
  fs.writeFileSync(path.join(configuration.paths.dataDir,'web-instance.json'),JSON.stringify({app:'antenna-draw-web',sourceRoot:configuration.sourceRoot,pid:123,port,shutdownToken:'private-token'}));
  await assert.rejects(launcher.stop({configuration}),/身份/);assert.equal(shutdown,false);
});

test('failed dependency install prevents service launch', async t => {
  const configuration=fixture(t);
  const portServer=await listener(t,(_req,res)=>res.end());configuration.port=portServer.port;
  await new Promise(resolve=>portServer.server.close(resolve));
  await assert.rejects(launcher.start({configuration,prepare(){throw Error('npm failed');},launch(){assert.fail('must not launch');},open(){}}), /npm failed/);
});

test('production demo generator preserves fixture shape, valid binary values and refuses overwrite', t => {
  const configuration=fixture(t);
  const {createDemo}=require('../../scripts/create-demo.cjs');
  const result=createDemo(configuration.sourceRoot);
  assert.equal(result.sourceDir,path.join(configuration.sourceRoot,'demo'));
  assert.deepEqual(result.expected.rsrp,{total:4,valid:3,min:-100,max:-80,mean:-90,median:-90,p10:-100,p90:-80});
  const buffer=fs.readFileSync(path.join(result.sourceDir,'pred','室内 A','RSRP_2.dem'));
  assert.deepEqual([0,2,4,6].map(i=>buffer.readInt16LE(i)),[-10000,-9000,-8000,-32768]);
  assert.ok(fs.existsSync(path.join(result.sourceDir,'pred','室外','10m','SCR.dem')));
  assert.throws(()=>createDemo(configuration.sourceRoot), /已存在/);
});

test('server entry records private instance identity and removes only its own marker', async t => {
  const configuration=fixture(t);configuration.port=8123;let injected;let bound;let closed=0;
  const {startWebServer}=require('../server');
  const running=await startWebServer({configuration,createService(options){injected=options;return {async listen(address){bound=address;return {origin:'http://127.0.0.1:8123'};},async close(){closed++;}};}});
  const markerFile=path.join(configuration.paths.dataDir,'web-instance.json');
  const marker=JSON.parse(fs.readFileSync(markerFile,'utf8'));
  assert.deepEqual(bound,{host:'127.0.0.1',port:8123});
  assert.equal(marker.pid,process.pid);assert.equal(marker.app,'antenna-draw-web');
  assert.equal(marker.sourceRoot,configuration.sourceRoot);assert.equal(marker.shutdownToken,injected.shutdownToken);
  assert.ok(marker.shutdownToken.length>=32);
  await running.close();assert.equal(closed,1);assert.equal(fs.existsSync(markerFile),false);
});

test('server cleanup does not delete replacement instance marker', async t => {
  const configuration=fixture(t);configuration.port=8123;
  const {startWebServer}=require('../server');
  const running=await startWebServer({configuration,createService(){return {async listen(){return {origin:'http://127.0.0.1:8123'};},async close(){}};}});
  const markerFile=path.join(configuration.paths.dataDir,'web-instance.json');
  fs.writeFileSync(markerFile,JSON.stringify({shutdownToken:'replacement'}));
  await running.close();assert.equal(JSON.parse(fs.readFileSync(markerFile,'utf8')).shutdownToken,'replacement');
});

test('release helper build records reviewed source binary manifest and revision', async t => {
  const configuration=fixture(t);const outputDir=path.join(configuration.sourceRoot,'release');
  const {buildProcessHost}=require('../../scripts/build-process-host.cjs');
  const manifest={schemaVersion:1,binarySha256:'a'.repeat(64),sourceSha256:'b'.repeat(64)};let verified=false;
  const result=await buildProcessHost({sourceRoot:configuration.sourceRoot,outputDir,revision:'fixture-revision',build:async({outputDir:nativeDir})=>{fs.mkdirSync(nativeDir,{recursive:true});fs.writeFileSync(path.join(nativeDir,'WindowsProcessHost.exe'),'fixture');fs.writeFileSync(path.join(nativeDir,'WindowsProcessHost.manifest.json'),JSON.stringify(manifest));return {manifest,binary:path.join(nativeDir,'WindowsProcessHost.exe'),manifestFile:path.join(nativeDir,'WindowsProcessHost.manifest.json')};},verify(options){verified=options.expectedManifest===manifest;}});
  const info=JSON.parse(fs.readFileSync(path.join(outputDir,'build-info.json'),'utf8'));
  assert.equal(info.revision,'fixture-revision');assert.equal(info.nativeProcessHost.sourceSha256,manifest.sourceSha256);assert.equal(verified,true);assert.equal(result.outputDir,outputDir);
});

test('real Web entry health and launcher token shutdown work with isolated data', async t => {
  const temporary=fixture(t);
  const sourceRoot=path.resolve(__dirname,'../..');
  const configuration=require('../src/config').loadWebConfiguration({sourceRoot,dataDir:temporary.paths.dataDir});
  const available=await listener(t,(_req,res)=>res.end());configuration.port=available.port;
  await new Promise(resolve=>available.server.close(resolve));
  configuration.initialSettings={...configuration.initialSettings,matlabExe:''};
  const {startWebServer}=require('../server');
  const running=await startWebServer({configuration});t.after(()=>running.close());
  const current=await launcher.requestJson(running.origin,'/api/health');
  assert.equal(current.app,'antenna-draw-web');assert.equal(current.pid,process.pid);
  assert.equal(current.sourceRoot,sourceRoot);
  await assert.rejects(launcher.requestJson(running.origin,'/api/runtime/shutdown',{method:'POST',headers:{'X-Antenna-Shutdown-Token':'wrong-token'}}), /403|令牌|拒绝|可信来源/);
  const stopped=await launcher.stop({configuration,timeoutMs:5000});
  assert.equal(stopped.stopped,true);
  assert.equal(fs.existsSync(path.join(configuration.paths.dataDir,'web-instance.json')),false);
});


test('detached launcher starts and gracefully stops its own child service', async t => {
  const configuration=fixture(t);
  const available=await listener(t,(_req,res)=>res.end());configuration.port=available.port;
  await new Promise(resolve=>available.server.close(resolve));
  fs.mkdirSync(path.join(configuration.sourceRoot,'backend'));
  fs.writeFileSync(path.join(configuration.sourceRoot,'backend/config.json'),JSON.stringify({port:configuration.port}));
  const serverEntry=path.resolve(__dirname,'../server.js');const configEntry=path.resolve(__dirname,'../src/config.js');
  fs.writeFileSync(path.join(configuration.sourceRoot,'backend/server.js'),`require(${JSON.stringify(serverEntry)}).startWebServer({configuration:require(${JSON.stringify(configEntry)}).loadWebConfiguration({sourceRoot:${JSON.stringify(configuration.sourceRoot)},dataDir:${JSON.stringify(configuration.paths.dataDir)}})}).catch(error=>{console.error(error);process.exitCode=1;});`);
  const result=await launcher.start({configuration,prepare(){},open(){},timeoutMs:10000});
  assert.equal(result.reused,false);assert.ok(Number.isInteger(result.pid));
  t.after(async()=>{try{await launcher.stop({configuration,timeoutMs:5000});}catch{}});
  await launcher.stop({configuration,timeoutMs:5000});
  let alive=true;
  for(let attempt=0;attempt<25 && alive;attempt++){
    try{process.kill(result.pid,0);await new Promise(resolve=>setTimeout(resolve,40));}catch(error){if(error.code==='ESRCH')alive=false;else throw error;}
  }
  assert.equal(alive,false,'gracefully stopped service process must exit');
});
