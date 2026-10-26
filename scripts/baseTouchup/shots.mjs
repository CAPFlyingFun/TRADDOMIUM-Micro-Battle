// node scripts/baseTouchup/shots.mjs <glb> <outdir> <region:mode[:pitch],...> [swap slot=url,...]
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
const [glb, outDir, list, swaps = ''] = process.argv.slice(2);
const root = process.cwd(); mkdirSync(outDir, { recursive: true });
const server = await createServer({ root, server: { port: 4300 + Math.floor(Math.random() * 90), host: '127.0.0.1', hmr: false }, logLevel: 'error' });
await server.listen(); const port = server.config.server.port;
const exe = (() => { const p = chromium.executablePath(); if (existsSync(p)) return undefined; const b = process.env.PLAYWRIGHT_BROWSERS_PATH; return b ? path.join(b, 'chromium') : undefined; })();
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
try {
  const p = await browser.newPage({ viewport: { width: 1200, height: 1200 } });
  p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await p.goto(`http://127.0.0.1:${port}/scripts/baseTouchup/view.html?f=/${glb}` + (process.env.LPOS ? `&lpos=/${process.env.LPOS}&lnor=/${process.env.LNOR}` : '') + (process.env.ALL ? '&all=1' : ''));
  await p.waitForFunction(() => window.ready, null, { timeout: 600000 });
  console.log(JSON.stringify(await p.evaluate(() => window.info)));
  for (const sw of swaps.split(',').filter(Boolean)) { const [slot, url] = sw.split('='); await p.evaluate(([s, u]) => window.swap(s, u), [slot, url]); }
  if (process.env.MORPHS) for (const mw of process.env.MORPHS.split(',')) { const [n, w] = mw.split('='); await p.evaluate(([n, w]) => window.morph(n, +w), [n, w]); }
  for (const item of list.split(',')) {
    const [region, mode = 'full', pitch = '0'] = item.split(':');
    await p.evaluate(([r, m, pi]) => window.shot(r, m, +pi), [region, mode, pitch]);
    await p.locator('canvas').screenshot({ path: path.join(outDir, `${region}-${mode}${pitch !== '0' ? '-p' + pitch : ''}.png`) });
  }
  console.log('done');
} finally { await browser.close(); await server.close(); }
