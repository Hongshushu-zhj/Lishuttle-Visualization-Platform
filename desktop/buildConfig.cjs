function resolveBuildTarget({mode,channel,version}) {
  if (!['dev','pack','dist'].includes(mode)) throw new Error('请选择 dev / pack / dist');
  channel ||= mode === 'dev' ? 'dev' : 'stable';
  if (!['dev','stable'].includes(channel)) throw new Error('构建渠道无效');
  if (mode === 'dev' && channel !== 'dev') throw new Error('开发启动只能使用 dev 渠道');
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error('构建版本无效');
  return { channel,version,appId:channel==='dev'?'com.antennadraw.desktop.dev':'com.antennadraw.desktop', productName:channel==='dev'?'AntennaDraw Dev':'AntennaDraw',
    output:`release/${channel}`, artifactName:`AntennaDraw${channel==='dev'?'-Dev':''}-Setup-\${version}-\${arch}.\${ext}` };
}
module.exports={resolveBuildTarget};
