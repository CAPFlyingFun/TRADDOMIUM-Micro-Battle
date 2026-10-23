/**
 * THE BUILT-IN OUTFITS' CARD PICTURES (Joshua, 2026-10-23, on the Character Studio preview: "we could have little
 * screenshots for the outfit").
 *
 *     npm run bake:outfits
 *
 * Builds, serves dist/, opens the character room with `?bake=outfits` and asks the room itself to put each outfit it
 * offers on Sarah and picture her (`bakeOutfitPictures` in SarahLabScene.ts: the same camera and size a saved outfit's
 * picture is taken with), then writes them to public/sarahlab/outfits/<outfit>.jpg, where the OUTFIT cards read them.
 * Run it again when an outfit is added or its look changes, then build. A fresh browser, so the LIGHT theme.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { build, preview } from 'vite';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(ROOT, 'public');
const log = (m) => console.log(`[bake:outfits] ${m}`);

function chromiumPath() {
  const override = process.env.PLAYWRIGHT_CHROMIUM;
  if (override && existsSync(override)) return override;
  if (existsSync(chromium.executablePath())) return undefined;
  const browsers = process.env.PLAYWRIGHT_BROWSERS_PATH;
  const linked = browsers ? path.join(browsers, 'chromium') : null;
  if (linked && existsSync(linked)) return linked;
  throw new Error('no Chromium found; this script never runs `playwright install`');
}

log('building');
await build({ root: ROOT, logLevel: 'error' });
const server = await preview({ root: ROOT, preview: { host: '127.0.0.1', port: 4199, strictPort: false, open: false }, logLevel: 'error' });
const browser = await chromium.launch({ executablePath: chromiumPath(), args: ['--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'] });
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: 932, height: 430 }, deviceScaleFactor: 2 });
  page.on('pageerror', (e) => { failed = true; log(`page error: ${e.message}`); });
  await page.goto(`${server.resolvedUrls.local[0]}?open=CharacterRoom&bake=outfits`);
  await page.waitForFunction(() => typeof globalThis.__sarahLabBakeOutfits === 'function' && (document.querySelector('[data-field="sarahlab-status"]')?.textContent ?? '').startsWith('model v2-body'), null, { timeout: 300_000 });
  log('the room is up: picturing each outfit (a minute or more each on a software renderer)');
  const pictures = await page.evaluate(() => globalThis.__sarahLabBakeOutfits(), null, { timeout: 0 });
  for (const { name, path: file, picture } of pictures) {
    const m = /^data:image\/jpeg;base64,(.+)$/.exec(picture ?? '');
    if (!m) { failed = true; log(`FAIL ${name}: no picture`); continue; }
    const target = path.join(OUT, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, Buffer.from(m[1], 'base64'));
    log(`${name} -> public/${file} (${Math.round(m[1].length * 0.75 / 1024)} KB)`);
  }
} finally {
  await browser.close();
  await server.httpServer.close();
}
if (failed) process.exit(1);
