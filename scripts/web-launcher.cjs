const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const {spawn,spawnSync}=require('node:child_process');
const SOURCE_ROOT=path.resolve(__dirname,'..');
const APP='antenna-draw-web';
function dataDirectory(configuration){return configuration.paths.dataDir || configuration.paths.DATA_DIR;}
function samePath(a,b){if(typeof a!=='string'||typeof b!=='string')return false;const normalize=value=>process.platform==='win32'?path.resolve(value).toLowerCase():path.resolve(value);return normalize(a)===normalize(b);}
function assertNodeVersion(version=process.versions.node){const [major,minor]=version.split('.').map(Number);if(major<20 || (major===20 && minor<19))throw Error('需要 Node.js 20.19+；建议 Node 22 LTS。');}
function loadConfiguration(){return require('../backend/src/config').loadWebConfiguration({sourceRoot:SOURCE_ROOT});}
function requestJson(origin,pathname,{method='GET',headers={},timeoutMs=1500}={}){
  return new Promise((resolve,reject)=>{
    const req=http.request(new URL(pathname,origin),{method,headers,timeout:timeoutMs},res=>{
      let text='';res.setEncoding('utf8');res.on('data',chunk=>{text+=chunk;if(text.length>1024*1024)req.destroy(Error('响应过大'));});
      res.on('end',()=>{try{const body=JSON.parse(text);if(res.statusCode<200||res.statusCode>=300)throw Error(body.error||`HTTP ${res.statusCode}`);resolve(body);}catch(error){reject(error);}});
    });req.on('timeout',()=>req.destroy(Error('服务响应超时')));req.on('error',reject);req.end();
  });
}
async function health(origin){try{return await requestJson(origin,'/api/health');}catch{return null;}}
function ownHealth(value,configuration,pid){return value?.app===APP && samePath(value.sourceRoot,configuration.paths.sourceRoot) && Number.isInteger(value.pid) && (pid===undefined || value.pid===pid);}
function portAvailable(port){return new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',error=>error.code==='EADDRINUSE'?resolve(false):reject(error));probe.listen(port,'127.0.0.1',()=>probe.close(()=>resolve(true)));});}
const pause=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));
function npm(args,cwd){const result=spawnSync(process.platform==='win32'?'npm.cmd':'npm',args,{cwd,stdio:'inherit',windowsHide:true,shell:process.platform==='win32'});if(result.error)throw result.error;if(result.status!==0)throw Error(`npm ${args.join(' ')} 失败（退出码 ${result.status}），已停止启动。`);}
function prepareInstallation(configuration){
  const sourceRoot=configuration.paths.sourceRoot;
  const backend=path.join(sourceRoot,'backend');const frontend=path.join(sourceRoot,'frontend');
  if(!fs.existsSync(path.join(backend,'node_modules','express','package.json')))npm([fs.existsSync(path.join(backend,'package-lock.json'))?'ci':'install','--no-audit','--no-fund'],backend);
  if(!fs.existsSync(path.join(frontend,'dist','index.html'))){
    if(!fs.existsSync(path.join(frontend,'node_modules','vite','package.json')))npm([fs.existsSync(path.join(frontend,'package-lock.json'))?'ci':'install','--no-audit','--no-fund'],frontend);
    npm(['run','build'],frontend);
  }
}
function launchDetached(configuration){
  const dataDir=dataDirectory(configuration);fs.mkdirSync(dataDir,{recursive:true});
  const descriptor=fs.openSync(path.join(dataDir,'backend.log'),'a');
  try{const child=spawn(process.execPath,[path.join(configuration.paths.sourceRoot,'backend','server.js')],{cwd:configuration.paths.sourceRoot,env:{...process.env,ANTENNA_WEB_DATA_DIR:dataDir},detached:true,windowsHide:true,stdio:['ignore',descriptor,descriptor]});child.on('error',error=>console.error(error.message));child.unref();return child.pid;}finally{fs.closeSync(descriptor);}
}
function openBrowser(origin){
  // Pass the URL as an argument, never as shell code. All process windows stay hidden.
  const child=process.platform==='win32'?spawn('rundll32.exe',['url.dll,FileProtocolHandler',origin],{windowsHide:true,detached:true,stdio:'ignore'}):spawn(process.platform==='darwin'?'open':'xdg-open',[origin],{detached:true,stdio:'ignore'});
  child.on('error',error=>console.error(`浏览器未打开，请手工访问 ${origin}（${error.message}）`));child.unref();
}
async function start({configuration=loadConfiguration(),prepare=prepareInstallation,launch=launchDetached,open=openBrowser,timeoutMs=30000}={}){
  assertNodeVersion();const origin=`http://127.0.0.1:${configuration.port}`;
  const existing=await health(origin);
  if(ownHealth(existing,configuration)){open(origin);return {origin,reused:true};}
  if(existing || !await portAvailable(configuration.port))throw Error(`端口 ${configuration.port} 已被其他服务占用；未停止任何进程。请修改 backend/config.json 的 port 后重试。`);
  await prepare(configuration);const pid=await launch(configuration);const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline){const current=await health(origin);if(ownHealth(current,configuration,pid)){open(origin);return {origin,reused:false,pid};}if(current)throw Error('启动期间端口被其他服务占用；未停止任何进程。');await pause(200);}
  throw Error(`服务未在期限内就绪，请检查 ${path.join(dataDirectory(configuration),'backend.log')}。`);
}
async function stop({configuration=loadConfiguration(),timeoutMs=60000}={}){
  assertNodeVersion();const markerFile=path.join(dataDirectory(configuration),'web-instance.json');let marker;
  try{marker=JSON.parse(fs.readFileSync(markerFile,'utf8'));}catch(error){if(error.code==='ENOENT')throw Error('未找到本项目服务实例记录；未停止任何进程。');throw Error('实例身份记录损坏；未停止任何进程。');}
  if(marker.app!==APP || !samePath(marker.sourceRoot,configuration.paths.sourceRoot) || !Number.isInteger(marker.pid) || !Number.isInteger(marker.port) || marker.port<1 || marker.port>65535 || typeof marker.shutdownToken!=='string' || !marker.shutdownToken)throw Error('实例身份不匹配；未停止任何进程。');
  const origin=`http://127.0.0.1:${marker.port}`;const current=await health(origin);
  if(!current){if(await portAvailable(marker.port))return {stopped:true,alreadyStopped:true};throw Error('无法核实端口监听进程身份；未停止任何进程。');}
  if(!ownHealth(current,configuration,marker.pid))throw Error('当前监听进程身份与实例记录不匹配；未停止任何进程。');
  await requestJson(origin,'/api/runtime/shutdown',{method:'POST',headers:{'X-Antenna-Shutdown-Token':marker.shutdownToken},timeoutMs});
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline){if(await portAvailable(marker.port))return {stopped:true};await pause(200);}
  throw Error('服务尚未完全退出；未强制结束进程。请查看任务恢复/诊断信息后重试。');
}
module.exports={start,stop,assertNodeVersion,requestJson,prepareInstallation,ownHealth,portAvailable};
if(require.main===module){const action=process.argv[2];if(!['start','stop'].includes(action)){console.error('用法: node scripts/web-launcher.cjs start|stop');process.exitCode=1;}else module.exports[action]().then(result=>console.log(action==='start'?`服务已就绪：${result.origin}；关闭浏览器不会停止服务。`:'本项目服务已停止。')).catch(error=>{console.error(error.message);process.exitCode=1;});}
