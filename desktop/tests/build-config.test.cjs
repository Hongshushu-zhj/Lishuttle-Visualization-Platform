const test=require('node:test');const assert=require('node:assert/strict');
test('dist defaults to stable; dev builds have separate metadata and cannot pretend to be stable',()=>{
  const {resolveBuildTarget}=require('../buildConfig.cjs');
  const stable=resolveBuildTarget({mode:'dist',version:'1.0.0-rc.2'}),dev=resolveBuildTarget({mode:'dist',channel:'dev',version:'1.0.0-rc.2'});
  assert.equal(stable.channel,'stable');assert.equal(stable.appId,'com.antennadraw.desktop');assert.equal(dev.appId,'com.antennadraw.desktop.dev');assert.notEqual(stable.productName,dev.productName);assert.notEqual(stable.output,dev.output);
  assert.throws(()=>resolveBuildTarget({mode:'dev',channel:'stable',version:'1.0.0'}),/开发/);assert.throws(()=>resolveBuildTarget({mode:'dist',version:'bad'}),/版本/);
});
