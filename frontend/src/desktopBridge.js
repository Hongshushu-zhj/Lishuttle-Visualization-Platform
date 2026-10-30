const native = window.desktopBridge;
export const isDesktop = !!native;
export const desktopBridge = Object.freeze({
  getAppInfo: () => native?.getAppInfo() || Promise.resolve({ channel: 'dev', version: '浏览器开发模式' }),
  selectMatlab: () => native?.selectMatlab() || Promise.resolve(null),
  selectDirectory: () => native?.selectDirectory() || Promise.resolve(null),
  selectPreferences: () => native?.selectPreferences() || Promise.resolve(null),
  openLogs: () => native?.openLogs() || Promise.reject(new Error('请在桌面应用中打开日志目录')),
});
