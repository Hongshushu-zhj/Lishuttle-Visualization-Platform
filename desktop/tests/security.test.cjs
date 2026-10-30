const test=require('node:test'); const assert=require('node:assert/strict'); const {EventEmitter}=require('node:events');
test('web contents block outside navigation, subframes, webview and popups',()=>{
  const {installWebContentsSecurity,isTrustedFrame}=require('../security.cjs'); const wc=new EventEmitter(); wc.setWindowOpenHandler=fn=>{wc.open=fn;}; wc.mainFrame={url:'http://127.0.0.1:1234/'};
  installWebContentsSecurity(wc,()=> 'http://127.0.0.1:1234'); let prevented=0; const event={preventDefault(){prevented++;}};
  wc.emit('will-navigate',event,'https://evil.invalid'); wc.emit('will-frame-navigate',{...event,url:'http://127.0.0.1:1234/',isMainFrame:false}); wc.emit('will-attach-webview',event); assert.equal(prevented,3);
  assert.deepEqual(wc.open({url:'https://example.com'}),{action:'deny'});
  assert.equal(isTrustedFrame({sender:wc,senderFrame:wc.mainFrame},{webContents:wc},'http://127.0.0.1:1234'),true);
  assert.equal(isTrustedFrame({sender:wc,senderFrame:{url:wc.mainFrame.url}},{webContents:wc},'http://127.0.0.1:1234'),false);
});
