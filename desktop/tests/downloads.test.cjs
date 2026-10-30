const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
test('download completion reports saved only on completed, cancellation is silent and failure is explicit', async () => {
  const { registerDownloads } = require('../downloads.cjs');
  const session = new EventEmitter(), messages = [];
  const contents = { getURL: () => 'http://127.0.0.1:1234/', send: (...args) => messages.push(args), isDestroyed: () => false };
  const window = { webContents: contents, isDestroyed: () => false };
  registerDownloads(session, () => window, () => 'http://127.0.0.1:1234');
  for (const state of ['completed', 'cancelled', 'interrupted']) {
    const item = new EventEmitter(); Object.assign(item, { getURL: () => 'blob:http://127.0.0.1:1234/id', getFilename: () => 'test.csv', setSaveDialogOptions() {} });
    session.emit('will-download', { preventDefault() { assert.fail('trusted download blocked'); } }, item, contents);
    item.emit('done', {}, state);
  }
  assert.deepEqual(messages, [ ['desktop:download-result', { state: 'completed', filename: 'test.csv' }], ['desktop:download-result', { state: 'interrupted', filename: 'test.csv' }] ]);
});
