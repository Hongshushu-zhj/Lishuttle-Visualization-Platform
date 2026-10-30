function trustedUrl(value, origin) {
  try { const url = new URL(value); return url.origin === origin && url.protocol === 'http:' && !url.username && !url.password; } catch { return false; }
}
function isTrustedFrame(event, window, origin) {
  return !!window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && trustedUrl(event.senderFrame.url, origin);
}
function installWebContentsSecurity(contents, getOrigin) {
  contents.setWindowOpenHandler(() => ({ action:'deny' }));
  contents.on('will-navigate',(event,url) => { if (!trustedUrl(url,getOrigin())) event.preventDefault(); });
  contents.on('will-frame-navigate',event => { if (!event.isMainFrame || !trustedUrl(event.url,getOrigin())) event.preventDefault(); });
  contents.on('will-attach-webview',event => event.preventDefault());
}
function configureSessionSecurity(session) {
  session.setPermissionRequestHandler((_contents,_permission,callback) => callback(false));
  session.setPermissionCheckHandler(() => false);
}
module.exports = { trustedUrl, isTrustedFrame, installWebContentsSecurity, configureSessionSecurity };
