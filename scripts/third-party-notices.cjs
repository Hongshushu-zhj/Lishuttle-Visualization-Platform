const fs=require('node:fs');const path=require('node:path');
function createNotices(root,destination) {
  const sections=['AntennaDraw third-party notices','Electron: see LICENSE.electron.txt and LICENSES.chromium.html beside the application.','MATLAB is not distributed with this application; its licence is supplied by the user.'];
  const inventory=[];
  for(const project of ['backend','frontend']) {
    const lock=JSON.parse(fs.readFileSync(path.join(root,project,'package-lock.json'),'utf8'));
    for(const [relative,entry] of Object.entries(lock.packages)) {
      if(!relative || entry.dev)continue;
      const directory=path.join(root,project,relative);if(!fs.existsSync(path.join(directory,'package.json')))continue;
      const pkg=JSON.parse(fs.readFileSync(path.join(directory,'package.json'),'utf8'));
      const files=fs.readdirSync(directory).filter(name=>/^(licen[sc]e|copying|notice)(?:[.-]|$)/i.test(name)&&fs.statSync(path.join(directory,name)).isFile());
      inventory.push({project,name:pkg.name,version:pkg.version,license:pkg.license||entry.license||'SEE LICENSE'});
      sections.push(`\n===== ${pkg.name}@${pkg.version} (${project}; ${pkg.license||entry.license||'SEE LICENSE'}) =====`);
      for(const name of files)sections.push(name+'\n'+fs.readFileSync(path.join(directory,name),'utf8'));
    }
  }
  fs.mkdirSync(destination,{recursive:true});
  fs.writeFileSync(path.join(destination,'THIRD_PARTY_NOTICES.txt'),sections.join('\n'));
  fs.writeFileSync(path.join(destination,'inventory.json'),JSON.stringify(inventory,null,2));
  return inventory;
}
module.exports={createNotices};
