const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
async function buildProcessHost({sourceRoot=path.resolve(__dirname,'..'),outputDir=sourceRoot,revision,build,verify}={}){
  const host=require('../backend/src/windowsProcessHost');
  build ||= host.buildWindowsProcessHost;verify ||= host.verifyWindowsProcessHost;
  if(revision===undefined){const result=spawnSync('git',['rev-parse','HEAD'],{cwd:sourceRoot,encoding:'utf8',windowsHide:true});revision=result.status===0?result.stdout.trim():'unknown';}
  const nativeDir=path.join(outputDir,'backend/src/native');
  const compiled=await build({sourceDir:path.join(sourceRoot,'backend/src/native'),outputDir:nativeDir});
  verify({binary:compiled.binary,manifestFile:compiled.manifestFile,expectedManifest:compiled.manifest});
  const infoFile=path.join(outputDir,'build-info.json');
  let previous={};try{previous=JSON.parse(fs.readFileSync(infoFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  const buildInfo={...previous,app:'antenna-draw-web',revision,builtAt:new Date().toISOString(),nativeProcessHost:compiled.manifest};
  const temporary=`${infoFile}.${process.pid}.tmp`;
  try{fs.writeFileSync(temporary,JSON.stringify(buildInfo,null,2),{flag:'wx'});fs.renameSync(temporary,infoFile);}finally{fs.rmSync(temporary,{force:true});}
  return {outputDir,nativeDir,buildInfo};
}
module.exports={buildProcessHost};
if(require.main===module){buildProcessHost({outputDir:process.argv[2]?path.resolve(process.argv[2]):undefined}).then(result=>console.log(`进程监管器已构建并校验：${result.nativeDir}`)).catch(error=>{console.error(error.message);process.exitCode=1;});}
