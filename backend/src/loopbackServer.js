const RESTRICTED = new Set([1,7,9,11,13,15,17,19,20,21,22,23,25,37,42,43,53,69,77,79,87,95,101,102,103,104,109,110,111,113,115,117,119,123,135,137,139,143,161,179,389,427,465,512,513,514,515,526,530,531,532,540,548,554,556,563,587,601,636,989,990,993,995,1719,1720,1723,2049,3659,4045,5060,5061,6000,6566,6665,6666,6667,6668,6669,6697,10080]);
const isRestrictedPort = port => RESTRICTED.has(port);
async function listenLoopback(app, { host = '127.0.0.1', port = 0 } = {}) {
  if (host !== '127.0.0.1') throw new Error('仅允许绑定本机回环地址');
  if (isRestrictedPort(port)) throw new Error('浏览器受限端口不可用于桌面服务');
  for (let attempts = 0; attempts < 20; attempts++) {
    const server = await new Promise((resolve,reject)=>{ const s=app.listen(port,host,()=>resolve(s));s.once('error',reject); });
    if (!isRestrictedPort(server.address().port)) return server;
    await new Promise(resolve=>server.close(resolve));
  }
  throw new Error('无法取得浏览器可访问的本机端口');
}
module.exports={listenLoopback,isRestrictedPort};
