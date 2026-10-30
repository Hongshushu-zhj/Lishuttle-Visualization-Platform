const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../src/serverApp');
const { resolveRuntimePaths } = require('../src/runtimePaths');
test('unauthorized API rejects missing/wrong cookie, origin and host before file access or process effects', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'antenna-security-'));
  const paths = resolveRuntimePaths({ channel: 'dev', dataDir: root, sourceRoot: path.resolve(__dirname,'../..') });
  const secret = 'c'.repeat(64), name = 'test_session'; const service = createServer({ paths, sessionSecret: secret, sessionCookieName: name });
  t.after(async () => { await service.close(); fs.rmSync(root,{recursive:true,force:true}); });
  const { origin } = await service.listen(); const cookie = `${name}=${secret}`;
  for (const headers of [{}, { Cookie: `${name}=bad` }, { Cookie: cookie, Origin:'https://evil.invalid' }, { Cookie: cookie, Origin:'null' }, { Cookie:cookie, Host:'evil.invalid' }]) {
    const result = await new Promise((resolve,reject)=> { const req = require('node:http').get(origin + '/api/fs/list?path=C:/',{headers},res=>{ let body='';res.on('data',bytes=>body+=bytes);res.on('end',()=>resolve({status:res.statusCode,body})); });req.on('error',reject); });
    assert.equal(result.status,403, Object.keys(headers).join(','));
    const json = JSON.parse(result.body); assert.equal(typeof json.details.code,'string'); assert.equal(json.details.retryable,false);
  }
  for (const endpoint of ['/plot','/environment/check','/settings','/sources']) {
    const response = await fetch(origin+'/api'+endpoint,{method:endpoint==='/settings'?'PATCH':'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:'{}'}); assert.equal(response.status,403);
  }
  assert.equal(service.supervisor.isBusy(),false); assert.equal(service.sourcesStore.list().length,0); assert.equal(service.jobs.list().length,0);
  const response = await fetch(origin+'/api/settings',{method:'PATCH',headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},body:'{"jobTimeoutMinutes":0}'});
  assert.equal(response.status,400); assert.equal(typeof (await response.json()).details.code,'string');
  const page = await fetch(origin); assert.match(page.headers.get('content-security-policy'), /frame-src 'none'/); assert.equal(page.headers.get('referrer-policy'),'no-referrer');
});
