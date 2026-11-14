import test from 'node:test';
import assert from 'node:assert/strict';
import { drawPreview } from '../src/rasterRenderer.js';

test('padded preview keeps white background, equal scales, original extent and independent relative origin', () => {
  const bounds = { left: 20, right: 100, bottom: -70, top: 0, res: .1 };
  const preview = { bounds, extent: { left: 20, right: 100, bottom: -70, top: 0 }, unit: 'dBm', overlays: { walls: [], buildings: [], cells: [] } };
  const original = JSON.stringify(preview);
  for (const mode of ['abs', 'rel-ll', 'rel-center']) {
    const calls = [], ctx = new Proxy({}, { get: (o, key) => key in o ? o[key] : (...args) => calls.push([key, ...args]), set: (o, key, value) => { o[key] = value; calls.push([key, value]); return true; } });
    const canvas = { width: 1200, height: 1000, getContext: () => ctx };
    const figure = { xlim: [16, 104], ylim: [-74, 4], coordBounds: bounds, coordMode: mode };
    const paint = { paint: () => 'raster' };
    drawPreview(canvas, paint, preview, figure, [-115, -45]);
    assert.deepEqual(calls.slice(0, 2), [['fillStyle', '#fff'], ['fillRect', 0, 0, 1200, 1000]]);
    const frame = calls.find(c => c[0] === 'strokeRect');
    const image = calls.find(c => c[0] === 'drawImage');
    assert.ok(image[2] > frame[1] && image[3] > frame[2]);
    assert.ok(image[2] + image[4] < frame[1] + frame[3]);
    assert.ok(image[3] + image[5] < frame[2] + frame[4]);
    assert.ok(Math.abs(image[4] / 80 - image[5] / 70) < 1e-10);
    const texts = calls.filter(c => c[0] === 'fillText').map(c => c[1]);
    if (mode === 'rel-ll') { assert.ok(texts.includes('相对坐标原点 (20, -70) m')); assert.ok(texts.includes('-4')); }
    if (mode === 'rel-center') assert.ok(texts.includes('相对坐标原点 (60, -35) m'));
    if (mode === 'abs') assert.ok(texts.includes('16'));
    drawPreview(canvas, paint, preview, { ...figure, coordBounds: undefined, coordMode: 'rel-ll' }, [-110, -40]);
    assert.ok(calls.some(c => c[1] === '相对坐标原点 (16, -74) m'), 'legacy fallback');
  }
  assert.equal(JSON.stringify(preview), original);
});
