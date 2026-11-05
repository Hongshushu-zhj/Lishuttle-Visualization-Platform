const test=require('node:test');const assert=require('node:assert/strict');
test('loopback server rejects browser restricted ports and external bind addresses',async t=>{
  const {listenLoopback,isRestrictedPort}=require('../src/loopbackServer'); const app=require('express')();
  assert.equal(isRestrictedPort(6000),true); assert.equal(isRestrictedPort(6667),true);
  await assert.rejects(listenLoopback(app,{port:6667}),/受限/);await assert.rejects(listenLoopback(app,{host:'0.0.0.0'}),/本机/);
  const server=await listenLoopback(app);t.after(()=>new Promise(r=>server.close(r)));assert.equal(isRestrictedPort(server.address().port),false);
});
