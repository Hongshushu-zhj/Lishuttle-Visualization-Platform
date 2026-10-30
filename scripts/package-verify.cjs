const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
function walk(root,callback,directory=root){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);if(entry.isSymbolicLink())throw Error('禁止打包文件链接');if(entry.isDirectory())walk(root,callback,file);else callback(file,path.relative(root,file).replace(/\\/g,'/'));}}
function auditResourceFiles(resources,buildInfo={}){
  let count=0;walk(resources,(file,name)=>{
    if(/(?:^|\/)(?:\.env(?:\..*)?|sources\.json|settings\.json|preferences\.json)$/.test(name)||name==='backend/config.json'||/\.(?:pem|key|pfx|p12|lic)$/i.test(name)||/(?:^|\/)\.git(?:\/|$)/.test(name))throw Error('禁止打包个人配置或密钥：'+name);
    if(/\.dem$/i.test(name)){
      const expected=name.startsWith('demo/')&&buildInfo.demoManifest?.[name.slice(5)];
      if(!expected||crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==expected)throw Error('禁止打包非合成仿真数据：'+name);
    }
    if((name.startsWith('frontend/')||name.startsWith('backend/src/'))&&/\.(?:js|html|cjs|json)$/i.test(name)&&/https?:\/\/(?:localhost|127\.0\.0\.1):(?:5173|3000|8000)\b/i.test(fs.readFileSync(file,'utf8')))throw Error('包含开发服务器 URL：'+name);
    count++;
  });return count;
}
function verifyPackage(artifact){
  const root=path.resolve(artifact),resources=path.join(root,'resources');
  for(const file of ['app.asar','backend/desktop-entry.js','backend/src/analysisWorker.js','backend/src/serverApp.js','backend/src/outputPaths.js','backend/src/diagnostics.js','backend/src/native/WindowsProcessHost.exe','backend/node_modules/express/index.js','frontend/index.html','matlab/plot_dispatch.m','matlab/showrsrp_indoor.m','matlab/showrsrp_outdoor.m','matlab/prepare_export_figure.m','build-info.json','demo/demo/pred/室内 A/index.txt','third-party/THIRD_PARTY_NOTICES.txt','third-party/inventory.json']){
    if(!fs.statSync(path.join(resources,file)).isFile())throw Error('缺少安装资源：'+file);
  }
  for(const file of ['LICENSE.electron.txt','LICENSES.chromium.html'])if(!fs.statSync(path.join(root,file)).isFile())throw Error('缺少第三方许可：'+file);
  const buildInfo=JSON.parse(fs.readFileSync(path.join(resources,'build-info.json'),'utf8'));const count=auditResourceFiles(resources,buildInfo);
  const asar=require('@electron/asar'),archive=path.join(resources,'app.asar');
  const pkg=JSON.parse(asar.extractFile(archive,'package.json').toString('utf8'));
  const target=require('../desktop/buildConfig.cjs').resolveBuildTarget({mode:'dist',channel:pkg.desktopChannel,version:pkg.version});
  if(pkg.version!==buildInfo.version||pkg.desktopChannel!==buildInfo.channel||buildInfo.appId!==target.appId||pkg.productName!==target.productName)throw Error('安装包渠道、版本或标识不一致');
  if(!fs.existsSync(path.join(root,target.productName+'.exe')))throw Error('缺少对应渠道的程序');
  for(const name of asar.listPackage(archive)){if(!/^\/(?:desktop(?:\/[^/]+\.cjs)?|package\.json)$/.test(name.replace(/\\/g,'/')))throw Error('app.asar 出现非预期文件：'+name);}
  const binary=fs.readFileSync(path.join(resources,'backend/src/native/WindowsProcessHost.exe'));if(binary.toString('ascii',0,2)!=='MZ'||binary.toString('ascii',binary.readUInt32LE(60),binary.readUInt32LE(60)+2)!=='PE')throw Error('进程监管器不是有效 PE 可执行文件');
  const manifest=[];walk(resources,(file,name)=>manifest.push({name,size:fs.statSync(file).size,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}));
  const evidence=path.resolve(__dirname,'../.desktop-test-data');fs.mkdirSync(evidence,{recursive:true});fs.writeFileSync(path.join(evidence,`package-manifest-${pkg.desktopChannel}-${pkg.version}.json`),JSON.stringify({build:buildInfo,files:manifest},null,2));
  console.log(`PACKAGE_RESOURCES_OK: ${pkg.desktopChannel} ${pkg.version}; ${count} files; native supervisor, worker, MATLAB, frontend, synthetic demo, licence and privacy checks`);
  return {root,resources,buildInfo,pkg};
}
module.exports={verifyPackage,auditResourceFiles};
if(require.main===module){try{verifyPackage(process.argv[2]||path.resolve(__dirname,'../release/stable/win-unpacked'));}catch(error){console.error(error.message);process.exitCode=1;}}
