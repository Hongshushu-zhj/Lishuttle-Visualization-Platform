const test=require('node:test');const assert=require('node:assert/strict');
test('body-parser includes the compressed request crash patch',()=>{
  const version=require('body-parser/package.json').version.split('.').map(Number);assert.ok(version[0]===1&&version[1]===20&&version[2]>=9,'GHSA-27r3-jxmh-p828 requires body-parser >=1.20.9');
});
test('qs comma serialization handles an object with a non-callable own toString',()=>{
  const qs=require('qs');assert.doesNotThrow(()=>qs.stringify({a:[{toString:'x'}]},{arrayFormat:'comma'}));
});
