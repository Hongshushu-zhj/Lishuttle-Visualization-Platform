const {test,expect,_electron:electron}=require('@playwright/test');const fs=require('node:fs');const path=require('node:path');const os=require('node:os');
test('diagnostic preview and native save work in sandbox, external page and popup remain blocked',async()=>{
  const root=path.resolve(__dirname,'../..'),data=fs.mkdtempSync(path.join(os.tmpdir(),'antenna-diag-ui-'));let app;
  try{
    const env={...process.env,ANTENNA_DESKTOP_DATA_DIR:data};delete env.ELECTRON_RUN_AS_NODE;
    app=await electron.launch({args:[root],cwd:root,env});const page=await app.firstWindow();await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+/);
    await page.evaluate(()=>fetch('/api/onboarding/complete',{method:'POST'}));await page.reload();
    await page.getByRole('button',{name:'应用设置',exact:true}).click();await page.getByRole('tab',{name:'导入与诊断'}).click();await page.getByRole('button',{name:'预览并导出诊断'}).click();
    await expect(page.getByRole('dialog',{name:'诊断预览'})).toBeVisible();
    const target=path.join(data,'report.json');await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},target);
    await page.getByRole('button',{name:'保存诊断…'}).click();await expect.poll(()=>fs.existsSync(target)).toBe(true);const report=JSON.parse(fs.readFileSync(target,'utf8'));expect(report.info.channel).toBe('dev');expect(report.logs[0].text).toContain('APP_START');
    const origin=new URL(page.url()).origin;await page.evaluate(()=>{const a=document.createElement('a');a.href='https://evil.invalid';a.click();window.open('https://evil.invalid');});expect(new URL(page.url()).origin).toBe(origin);expect(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length)).toBe(1);
    await page.screenshot({path:path.join(root,'.desktop-test-data/screenshots/diagnostic-preview.png')});
  }finally{if(app)await app.close();fs.rmSync(data,{recursive:true,force:true});}
});
