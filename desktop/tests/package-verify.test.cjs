const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const os=require('node:os');
test('package scanner rejects private configuration, keys, simulation files and development URLs',t=>{
  const {auditResourceFiles}=require('../../scripts/package-verify.cjs');const root=fs.mkdtempSync(path.join(os.tmpdir(),'antenna-package-audit-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  for(const name of ['backend/config.json','backend/src/test.pem','matlab/user-case.dem']){const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'private');assert.throws(()=>auditResourceFiles(root),/个人|密钥|仿真|禁止/);fs.unlinkSync(file);}
  fs.mkdirSync(path.join(root,'frontend'),{recursive:true});const file=path.join(root,'frontend','index.html');fs.writeFileSync(file,'<script src="http://localhost:5173/src.js"></script>');assert.throws(()=>auditResourceFiles(root),/开发/);
});
