const fs=require('node:fs');
const path=require('node:path');
const {randomBytes}=require('node:crypto');
const {assertNodeVersion}=require('../scripts/web-launcher.cjs');

async function startWebServer({configuration,createService,onShutdown}={}){
  assertNodeVersion();
  configuration ||= require('./src/config').loadWebConfiguration({sourceRoot:path.resolve(__dirname,'..')});
  createService ||= require('./src/serverApp').createServer;
  const {paths,initialSettings}=configuration;
  const dataDir=paths.dataDir || paths.DATA_DIR;
  const markerFile=path.join(dataDir,'web-instance.json');
  const shutdownToken=randomBytes(32).toString('hex');
  let closing;
  const close=()=>{
    if(closing)return closing;
    closing=(async()=>{
      await service.close();
      try{const current=JSON.parse(fs.readFileSync(markerFile,'utf8'));if(current.shutdownToken===shutdownToken)fs.unlinkSync(markerFile);}catch(error){if(error.code!=='ENOENT')console.error('无法清理实例记录：',error.message);}
    })().catch(error=>{closing=null;throw error;});
    return closing;
  };
  const service=createService({paths,initialSettings,legacyConfigFile:configuration.legacyConfigFile,shutdownToken,devOrigin:process.env.ANTENNA_WEB_DEV_ORIGIN,onShutdown:async()=>{await close();await onShutdown?.();}});
  let address;
  try{
    address=await service.listen({host:'127.0.0.1',port:configuration.port});
    fs.mkdirSync(dataDir,{recursive:true});
    const marker={app:'antenna-draw-web',sourceRoot:paths.sourceRoot,pid:process.pid,port:Number(new URL(address.origin).port),origin:address.origin,shutdownToken};
    const temporary=`${markerFile}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
    try{fs.writeFileSync(temporary,JSON.stringify(marker,null,2),{mode:0o600,flag:'wx'});fs.renameSync(temporary,markerFile);}finally{fs.rmSync(temporary,{force:true});}
  }catch(error){await service.close().catch(()=>{});throw error;}
  return {service,origin:address.origin,close};
}
module.exports={startWebServer};
if(require.main===module){
  startWebServer({onShutdown:()=>{process.exitCode=0;}}).then(running=>{
    console.log(`天线覆盖绘图平台已启动：${running.origin}`);
    console.log('关闭浏览器不会停止服务；请运行停止平台.bat。');
    const shutdown=()=>running.close().then(()=>{process.exitCode=0;}).catch(error=>{console.error('停止失败，服务继续保留恢复信息：',error);process.exitCode=1;});
    process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
  }).catch(error=>{console.error('服务启动失败：',error.message);process.exitCode=1;});
}
