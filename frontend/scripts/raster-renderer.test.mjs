import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import * as renderer from '../src/rasterRenderer.js';

const preview = {
  data: Buffer.from(new Int16Array([-10000, -9000, -8000, -32768]).buffer).toString('base64'),
  width: 2, height: 2, original: { width: 2, height: 2 }, invalid: -32768, divisor: 100,
  bounds: { left: 0, right: 2, bottom: 0, top: 1, res: 1 },
  extent: { left: -.5, right: 1.5, bottom: 0, top: 0 },
  unit: 'dBm', overlays: { walls: [], buildings: [], cells: [] },
};

test('collapsed raster extent is rejected before drawing and valid extents stay unchanged', () => {
  assert.equal(typeof renderer.rasterExtent, 'function');
  assert.throws(() => renderer.rasterExtent(preview), /坐标范围无效/);
  const valid = { ...preview.extent, bottom: -.5, top: 1.5 };
  assert.deepEqual(renderer.rasterExtent({ ...preview, extent: valid }), valid);
});
let chromium;
if (process.env.PLAYWRIGHT_MODULE_PATH) ({ chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE_PATH));
test('real Canvas/WebGL previews and exported PNG contain colored valid pixels and transparent invalid cell', { skip: !chromium && 'Set PLAYWRIGHT_MODULE_PATH to run real browser pixel regression' }, async () => {
  const source = await readFile(new URL('../src/rasterRenderer.js', import.meta.url), 'utf8');
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/renderer.js' ? 'text/javascript' : 'text/html');
    response.end(request.url === '/renderer.js' ? source : '<!doctype html><html><body></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const results = await page.evaluate(async preview => {
      const { createRasterPainter, drawPreview } = await import('/renderer.js');
      const results = [];
      for (const useGpu of [false, true]) {
        const painter = createRasterPainter(preview, useGpu);
        const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 665;
        drawPreview(canvas, painter, preview, { sourceName: 'demo', taskName: 'indoor', dataType: 'RSRP', layerLabel: '1' }, [-115, -45]);
        const ctx = canvas.getContext('2d');
        const pixels = [[.25,.75],[1.25,.75],[.25,.25],[1.25,.25]].map(([x,y]) => Array.from(ctx.getImageData(Math.round(100+x*475),Math.round(90+(1-y)*475),1,1).data));
        const png = new Image(); png.src = canvas.toDataURL('image/png'); await png.decode();
        const restored = document.createElement('canvas'); restored.width = canvas.width; restored.height = canvas.height;
        const restoredCtx = restored.getContext('2d'); restoredCtx.drawImage(png,0,0);
        results.push({ mode:painter.mode, pixels, savedPixel:Array.from(restoredCtx.getImageData(219,209,1,1).data) });
        painter.dispose();
      }
      return results;
    }, { ...preview, extent: { ...preview.extent, bottom: -.5, top: 1.5 } });
    for (const result of results) {
      for (const [index, pixel] of result.pixels.entries()) {
        if (index === 3) assert.deepEqual(pixel, [255,255,255,255], `${result.mode}: invalid cell remains transparent over white`);
        else assert.ok(Math.min(...pixel.slice(0,3)) < 200 && pixel[3] === 255, `${result.mode}: valid cell ${index} must be colored, got ${pixel}`);
      }
      assert.ok(Math.min(...result.savedPixel.slice(0,3)) < 200, `${result.mode}: exported PNG must contain the raster`);
    }
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
});
