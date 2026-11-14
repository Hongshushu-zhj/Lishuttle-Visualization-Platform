import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';

let chromium;
if (process.env.PLAYWRIGHT_MODULE_PATH) ({ chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE_PATH));
test('real preview pixels, color changes and reused Vue card dimensions preserve padding', { skip: !chromium && 'Set PLAYWRIGHT_MODULE_PATH for browser verification' }, async () => {
  const { createServer } = await import('vite');
  const { default: vue } = await import('@vitejs/plugin-vue');
  const root = fileURLToPath(new URL('..', import.meta.url));
  const preview = { bounds: { left: 20, right: 100, bottom: -70, top: 0, res: 1 },
    extent: { left: 20, right: 100, bottom: -70, top: 0 }, width: 2, height: 2,
    original: { width: 2, height: 2 }, data: Buffer.from(new Int16Array([-10000,-9000,-8000,-32768]).buffer).toString('base64'),
    invalid: -32768, divisor: 100, unit: 'dBm', defaultRange: [-115,-45], min: -100, max: -80, validCount: 3,
    overlays: { walls: [], buildings: [], cells: [] } };
  const fixturePlugin = { name: 'padding-test-fixture', configureServer(server) {
    server.middlewares.use('/fixture.html', async (req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end(await server.transformIndexHtml('/fixture.html', `<html><body><div id="app"></div><script type="module">
      import {createApp,h,reactive} from 'vue';
      import Figure from '/src/components/InteractiveFigure.vue';
      window.fig=reactive({sourceName:'synthetic',taskName:'indoor',dataType:'RSRP',layerLabel:'1',xlim:[16,104],ylim:[-74,4],coordBounds:{left:20,right:100,bottom:-70,top:0},coordMode:'rel-ll'});
      createApp({render:()=>h(Figure,{fig:window.fig,compact:true})}).mount('#app');
      </script></body></html>`));
    });
  } };
  const server = await createServer({ configFile: false, root, plugins: [vue(), fixturePlugin], server: { host: '127.0.0.1', port: 0 } });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) });
    const page = await browser.newPage({ viewport: { width: 1300, height: 1100 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    page.on('console', msg => { if (msg.type() === 'error') console.error(msg.text()); });
    await page.route('**/api/preview', route => route.fulfill({ json: preview }));
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/fixture.html`);
    await page.waitForFunction(() => document.querySelector('canvas')?.height === 1000);
    if (process.env.INDOOR_PADDING_ARTIFACTS) {
      await mkdir(process.env.INDOOR_PADDING_ARTIFACTS,{recursive:true});
      await page.screenshot({path: process.env.INDOOR_PADDING_ARTIFACTS + '/preview-padding.png'});
    }
    const results = await page.evaluate(async preview => {
      const { createRasterPainter, drawPreview } = await import('/src/rasterRenderer.js');
      const results = [];
      for (const gpu of [false, true]) {
        const painter = createRasterPainter(preview, gpu), canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 1000;
        const ctx = canvas.getContext('2d');
        const scale = Math.min(950/88,810/78), x0 = 100+(950-88*scale)/2;
        const point = (x,y) => [Math.round(x0+(x-16)*scale),Math.round(90+(4-y)*scale)];
        const pixel = (x,y) => Array.from(ctx.getImageData(...point(x,y),1,1).data);
        const samples = [];
        for (const range of [[-115,-45],[-100,-70]]) {
          drawPreview(canvas,painter,preview,window.fig,range);
          samples.push({ margins: [[18,-35],[102,-35],[60,2],[60,-72]].map(p=>pixel(...p)), valid:pixel(40,-20), invalid:pixel(80,-50) });
        }
        results.push({ mode:painter.mode, samples }); painter.dispose();
      }
      return results;
    }, preview);
    for (const result of results) {
      for (const sample of result.samples) {
        for (const pixel of [...sample.margins, sample.invalid]) assert.deepEqual(pixel,[255,255,255,255],result.mode);
        assert.ok(Math.min(...sample.valid.slice(0,3)) < 200,result.mode);
      }
      assert.notDeepEqual(result.samples[0].valid,result.samples[1].valid,'changing range recolors only the data');
    }
    console.log('Verified preview painters:', results.map(result => result.mode).join(', '));
    // Reuse the mounted component with a wide display range: watcher must resize.
    await page.evaluate(() => { window.fig.xlim=[-100,200]; window.fig.ylim=[-74,4]; window.fig.coordBounds={left:0,right:100,bottom:-70,top:0}; });
    await page.waitForFunction(() => document.querySelector('canvas').height === 437);
    assert.deepEqual(errors,[]);
    if (process.env.INDOOR_PADDING_ARTIFACTS) {
      await mkdir(process.env.INDOOR_PADDING_ARTIFACTS,{recursive:true});
      await page.screenshot({path: process.env.INDOOR_PADDING_ARTIFACTS + '/preview-reused-card.png'});
    }
  } finally { if (browser) await browser.close(); await server.close(); }
});
