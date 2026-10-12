/**
 * THE SARAH LAB, OPENED THE WAY JOSHUA OPENS IT.
 *
 *     npm run probe:sarahlab
 *
 * Builds, serves dist/, opens the BARE URL, presses EDITORS and the Sarah
 * Lab's OPEN, waits for the base model, then works every control at 932 x 430:
 *
 *   shots/sarahlab-1-full.png      as loaded: full bump, shirt and leggings
 *   shots/sarahlab-2-flat.png      BUMP slider at 0
 *   shots/sarahlab-2b-twins.png    BUMP slider at 200, past full term
 *   shots/sarahlab-3-walk.png      WALK, bump back at 100
 *   shots/sarahlab-4-sit.png       SIT
 *   shots/sarahlab-5-fist.png      STAND, FINGERS at 100, close on the hands
 *   shots/sarahlab-6-bikini.png    OUTFIT once: the bikini
 *   shots/sarahlab-7-swimsuit.png  OUTFIT twice: the swimsuit
 *   shots/sarahlab-8-bare.png      OUTFIT three times: none
 *
 * and fails on a console error, a model that did not load, a file without the
 * belly slider or the clothes, or a blank frame.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { build, preview } from 'vite';
import { readPng } from './probePng.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SHOTS = path.join(ROOT, 'shots');
const CHROMIUM_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'];
/** Joshua's phone in landscape. */
const VIEWPORT = (process.env.SARAH_TEXTURE_ONLY || process.env.SARAH_CLOSE_ONLY || process.env.SARAH_TEE_ONLY || process.env.SARAH_SWEEP || process.env.SARAH_HEM_ONLY || process.env.SARAH_NAVEL_ONLY) ? { width: 1400, height: 800 } : { width: 932, height: 430 };
const APP_PORT = 4197;
const TOOL = 'lab.sarah';
const HUD = 'sarah-lab-hud';

const log = (m) => console.log(`[probe:sarahlab] ${m}`);
let failures = 0;
function check(ok, what) {
  log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures += 1;
  return ok;
}

function chromiumPath() {
  const override = process.env.PLAYWRIGHT_CHROMIUM;
  if (override && existsSync(override)) return override;
  const pinned = chromium.executablePath();
  if (existsSync(pinned)) return undefined;
  const browsers = process.env.PLAYWRIGHT_BROWSERS_PATH;
  const linked = browsers ? path.join(browsers, 'chromium') : null;
  if (linked && existsSync(linked)) return linked;
  throw new Error('no Chromium found; this probe never runs `playwright install`');
}

function brightness(file) {
  const img = readPng(readFileSync(file));
  let sum = 0, min = 255, max = 0;
  const px = img.width * img.height;
  for (let i = 0; i < px; i += 1) {
    const o = i * 4;
    const l = 0.3 * img.data[o] + 0.59 * img.data[o + 1] + 0.11 * img.data[o + 2];
    sum += l; if (l < min) min = l; if (l > max) max = l;
  }
  return { mean: sum / px, spread: max - min };
}

async function shot(page, name, what) {
  const file = path.join(SHOTS, name);
  await page.screenshot({ path: file });
  const b = brightness(file);
  check(b.mean > 8 && b.spread > 40, `${what}: a picture, not a blank (mean ${b.mean.toFixed(1)}, spread ${b.spread.toFixed(0)}) -> shots/${name}`);
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  log('building, because preview serves dist/ and a stale dist/ is a lie');
  await build({ root: ROOT, logLevel: 'error' });
  const server = await preview({ root: ROOT, preview: { host: '127.0.0.1', port: APP_PORT, strictPort: false, open: false }, logLevel: 'error' });
  const url = server.resolvedUrls.local[0];
  const browser = await chromium.launch({ executablePath: chromiumPath(), args: CHROMIUM_ARGS });
  try {
    const page = await browser.newPage({ viewport: VIEWPORT });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

    await page.goto(url, { waitUntil: 'load' });
    await page.waitForSelector('[data-action="new-game"]', { timeout: 120_000 });
    await page.click('[data-action="editors"]', { timeout: 60_000 });
    await page.waitForSelector(`[data-action="tool:${TOOL}"]`, { state: 'attached', timeout: 60_000 });
    await page.click(`[data-action="tool:${TOOL}"]`, { timeout: 60_000 });
    await page.waitForSelector(`[data-role="${HUD}"]`, { timeout: 180_000 });
    log('bare URL -> EDITORS -> OPEN -> the Sarah lab is up');

    const status = '[data-field="sarahlab-status"]';
    await page.waitForFunction((sel) => (document.querySelector(sel)?.textContent ?? '').startsWith('base model'), status, { timeout: 180_000 })
      .then(() => check(true, 'the base model loaded'))
      .catch(async () => check(false, `the base model loaded: ${await page.textContent(status)}`));
    const line = await page.textContent(status);
    check(/belly slider/.test(line) && /4 garments/.test(line), `the file has the belly slider and all four garments: "${line}"`);
    if (process.env.SARAH_TEXTURE_ONLY) {
      await page.click('[data-action="sarahlab:tpose"]');
      await page.click('[data-role="sarahlab-textures"] summary');
      await page.setInputFiles('[data-field="texture-upload"]',process.env.SARAH_TEXTURE_IMAGE);
      await page.waitForFunction(()=>document.querySelector('[data-field="texture-status"]')?.textContent?.includes('texture-test.png'));
      await shot(page,'sarahlab-upload-auto.png','TEXTURE UPLOADED');
      await page.click('[data-action="sarahlab:texture-mirror-x"]');
      check(await page.getAttribute('[data-action="sarahlab:texture-mirror-x"]','aria-pressed')==='true','mirror X toggled');
      await page.click('[data-action="sarahlab:texture-mirror-y"]');
      check(await page.getAttribute('[data-action="sarahlab:texture-mirror-y"]','aria-pressed')==='true','mirror Y toggled');
      await shot(page,'sarahlab-upload-mirrored.png','TEXTURE MIRRORED');
      check(!readFileSync(path.join(SHOTS,'sarahlab-upload-auto.png')).equals(readFileSync(path.join(SHOTS,'sarahlab-upload-mirrored.png'))),'mirrored image renders differently');
      await page.click('[data-action="sarahlab:texture-rotate"]');
      await page.selectOption('[data-field="texture-mode"]','tile');
      await shot(page,'sarahlab-upload-tiled.png','TEXTURE TILED');
      await page.click('[data-action="sarahlab:texture-reset"]');
      check((await page.textContent('[data-field="texture-status"]')).includes('Original shirt'),'reset restores original');
      await shot(page,'sarahlab-upload-reset.png','TEXTURE RESET');
      await page.selectOption('[data-field="texture-garment"]','leggings');
      await page.setInputFiles('[data-field="texture-upload"]',process.env.SARAH_TEXTURE_IMAGE);
      await page.waitForFunction(()=>document.querySelector('[data-field="texture-status"]')?.textContent?.includes('texture-test.png'));
      await shot(page,'sarahlab-upload-leggings.png','LEGGINGS UPLOAD');
      await page.click('[data-action="sarahlab:texture-reset"]');
      await page.setViewportSize({width:932,height:430});
      await page.locator('[data-action="sarahlab:texture-reset"]').scrollIntoViewIfNeeded();
      await shot(page,'sarahlab-upload-landscape.png','TEXTURE MOBILE LANDSCAPE');
      await page.setViewportSize({width:390,height:844});
      await page.locator('[data-action="sarahlab:texture-reset"]').scrollIntoViewIfNeeded();
      await shot(page,'sarahlab-upload-portrait.png','TEXTURE MOBILE PORTRAIT');
      check(errors.length===0,'no console errors');
      if(failures)throw new Error(`${failures} checks failed`);
      log('PASS');return;
    }
    if (process.env.SARAH_TEE_ONLY || process.env.SARAH_SWEEP || process.env.SARAH_HEM_ONLY || process.env.SARAH_NAVEL_ONLY) {
      const bump = async (value) => {
        await page.locator('[data-field="sarahlab-bump"] + input').evaluate((input, v) => {
          input.value = String(v); input.dispatchEvent(new Event('input', { bubbles: true }));
        }, value);
        await page.waitForTimeout(600);
      };
      const drag = async (dx, dy = 0) => {
        await page.mouse.move(430, 180); await page.mouse.down();
        await page.mouse.move(430 + dx, 180 + dy, { steps: 3 }); await page.mouse.up();
      };
      await page.mouse.move(430, 180); await page.mouse.wheel(0, -650); await drag(62.5);
      if (process.env.SARAH_NAVEL_ONLY) {
        for(let i=0;i<3;i++) await page.click('[data-action="sarahlab:outfit"]');
        await page.mouse.wheel(0,-800);
        for(const value of (process.env.SARAH_NAVEL_VALUES||'100,200').split(',').map(Number)) {
          await bump(value);
          await shot(page,`sarahlab-navel-${value}-front.png`,`NAVEL ${value} FRONT`);
          await drag(-85);
          await shot(page,`sarahlab-navel-${value}-quarter.png`,`NAVEL ${value} QUARTER`);
          await drag(85);
        }
        check(errors.length===0,'no console errors');
        if(failures) throw new Error(`${failures} check(s) failed`);
        log('PASS'); return;
      }
      if (process.env.SARAH_HEM_ONLY) {
        if (process.env.SARAH_TPOSE) await page.click('[data-action="sarahlab:tpose"]');
        for (const value of (process.env.SARAH_HEM_VALUES||'50,100,200').split(',').map(Number)) {
          await bump(value);
          await shot(page,`sarahlab-hem-${value}-front.png`,`HEM ${value} FRONT`);
          if(process.env.SARAH_FRONT_ONLY) continue;
          await drag(-196.35);
          await shot(page,`sarahlab-hem-${value}-side.png`,`HEM ${value} SIDE`);
          await drag(-196.35);
          await shot(page,`sarahlab-hem-${value}-back.png`,`HEM ${value} BACK`);
          await drag(392.7);
        }
        if (process.env.SARAH_FABRIC_CLOSE) {
          await bump(100); await page.mouse.move(430,180); await page.mouse.wheel(0,-1000);
          await shot(page,'sarahlab-fabric-close-front.png','FABRIC CLOSE FRONT');
          await drag(-85); await shot(page,'sarahlab-fabric-close-quarter.png','FABRIC CLOSE QUARTER');
          await drag(85); await page.mouse.wheel(0,1000);
        }
        for (const [pose,value] of [['walk',50],['sit',200]]) {
          await page.click(`[data-action="sarahlab:${pose}"]`); await bump(value);
          await shot(page,`sarahlab-hem-${pose}.png`,`HEM ${pose}`);
        }
        check(errors.length===0,'no console errors');
        if(failures) throw new Error(`${failures} check(s) failed`);
        log('PASS'); return;
      }
      if (process.env.SARAH_SWEEP) {
        for (let i = 0; i < 3; i++) await page.click('[data-action="sarahlab:outfit"]');
        for (const value of (process.env.SARAH_SWEEP_VALUES || '20,30,40,50,60,70').split(',').map(Number)) {
          await bump(value);
          await shot(page, `sarahlab-bare-${value}-front.png`, `BARE ${value} FRONT`);
        }
        await page.click('[data-action="sarahlab:outfit"]');
      }
      for (const value of [50, 100, 200]) {
        await bump(value);
        await shot(page, `sarahlab-tee-${value}-front.png`, `TEE ${value} FRONT`);
      }
      await drag(-150);
      await shot(page, 'sarahlab-tee-200-side.png', 'TEE 200 SIDE');
      await drag(150, -60);
      await shot(page, 'sarahlab-tee-200-under.png', 'TEE 200 UNDERSIDE');
      await drag(0, 60);
      for (const [pose, value] of [['walk', 50], ['sit', 200]]) {
        await page.click(`[data-action="sarahlab:${pose}"]`); await bump(value);
        await shot(page, `sarahlab-tee-${pose}-${value}.png`, `TEE ${pose} ${value}`);
      }
      check(errors.length === 0, 'no console errors');
      if (failures) throw new Error(`${failures} check(s) failed`);
      log('PASS'); return;
    }
    await page.waitForTimeout(1500);
    await shot(page, 'sarahlab-1-full.png', 'FULL BUMP, dressed');
    check(/bust volume target 1.30×/.test(await page.textContent('[data-field="sarahlab-bump"]')), '100% belly has 1.30× nominal bust volume');

    const setSlider = (field, value) => page.evaluate(([f, v]) => {
      const label = document.querySelector(`[data-field="${f}"]`);
      const input = label?.nextElementSibling;
      if (!(input instanceof HTMLInputElement)) return false;
      input.value = String(v);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }, [field, value]);
    check(await setSlider('sarahlab-bump', 0), 'the BUMP slider moved to 0');
    await page.waitForTimeout(800);
    check(/nearly flat/.test(await page.textContent('[data-field="sarahlab-bump"]')), 'the BUMP line reads nearly flat');
    check(/bust volume target 1.00×/.test(await page.textContent('[data-field="sarahlab-bump"]')), '0% belly has normal breast scale');
    await shot(page, 'sarahlab-2-flat.png', 'BUMP 0');

    check(await setSlider('sarahlab-bump', 200), 'the BUMP slider moved to 200');
    await page.waitForTimeout(800);
    check(/200% · past full term/.test(await page.textContent('[data-field="sarahlab-bump"]')), 'the BUMP line reads 200% past full term');
    check(/bust volume target 1.55×/.test(await page.textContent('[data-field="sarahlab-bump"]')), '200% belly has 1.55× nominal bust volume');
    await shot(page, 'sarahlab-2b-twins.png', 'BUMP 200');

    if (!process.env.SARAH_CLOSE_ONLY) {
    await setSlider('sarahlab-bump', 100);
    await page.click('[data-action="sarahlab:walk"]');
    await page.waitForTimeout(1500);
    await shot(page, 'sarahlab-3-walk.png', 'WALK');

    await page.click('[data-action="sarahlab:sit"]');
    await page.waitForTimeout(1500);
    await shot(page, 'sarahlab-4-sit.png', 'SIT');

    // Intermediate shapes and bent knees: the garment must stay closed as both
    // growth targets and bone motion are combined, not just at the endpoints.
    for (const pose of ['stand', 'walk', 'sit']) {
      await page.click(`[data-action="sarahlab:${pose}"]`);
      for (const bump of [50, 150, 200]) {
        await setSlider('sarahlab-bump', bump);
        await page.waitForTimeout(800);
        await shot(page, `sarahlab-fit-${pose}-${bump}.png`, `${pose.toUpperCase()} BUMP ${bump}`);
      }
    }
    await setSlider('sarahlab-bump', 100);

    await page.click('[data-action="sarahlab:stand"]');
    check(await setSlider('sarahlab-fingers', 100), 'the FINGERS slider moved to 100');
    // come closer: a wheel toward her
    await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2);
    for (let i = 0; i < 6; i += 1) await page.mouse.wheel(0, -300);
    await page.waitForTimeout(1500);
    await shot(page, 'sarahlab-5-fist.png', 'FINGERS 100, closer');

    for (let i = 0; i < 6; i += 1) await page.mouse.wheel(0, 300);
    await setSlider('sarahlab-fingers', 0);
    await page.click('[data-action="sarahlab:outfit"]');
    await page.waitForTimeout(800);
    check(/bikini/.test(await page.textContent('[data-action="sarahlab:outfit"]')), 'OUTFIT reads bikini');
    await shot(page, 'sarahlab-6-bikini.png', 'OUTFIT bikini');
    await page.click('[data-action="sarahlab:outfit"]');
    await page.waitForTimeout(800);
    await shot(page, 'sarahlab-7-swimsuit.png', 'OUTFIT swimsuit');
    await page.click('[data-action="sarahlab:outfit"]');
    await page.waitForTimeout(1200);
    await shot(page, 'sarahlab-8-bare.png', 'OUTFIT none');
    } else {
      for (const [pose, bump] of [['walk', 50], ['sit', 200]]) {
        await page.click(`[data-action="sarahlab:${pose}"]`);
        await setSlider('sarahlab-bump', bump);
        await page.waitForTimeout(800);
        await shot(page, `sarahlab-fit-${pose}-${bump}.png`, `${pose} ${bump}`);
      }
      await page.click('[data-action="sarahlab:stand"]');
      for (let i = 0; i < 3; i += 1) await page.click('[data-action="sarahlab:outfit"]');
    }
    // Close-up geometry checks: inspect the bare transition separately from cloth.
    await page.mouse.move(430, 180);
    await page.mouse.wheel(0, -650);
    const drag = async (dx, dy = 0) => {
      await page.mouse.move(430, 180); await page.mouse.down();
      await page.mouse.move(430 + dx, 180 + dy, { steps: 3 });
      await page.mouse.up();
    };
    await drag(62.5); // initial yaw .5 -> front
    for (const outfit of ['bare', 'tee']) {
      if (outfit === 'tee') await page.click('[data-action="sarahlab:outfit"]');
      for (const bump of [20, 50, 80, 200]) {
        await setSlider('sarahlab-bump', bump);
        await page.waitForTimeout(500);
        await shot(page, `sarahlab-close-${outfit}-${bump}-front.png`, `CLOSE ${outfit} ${bump} FRONT`);
      }
      await drag(-150);
      await shot(page, `sarahlab-close-${outfit}-200-side.png`, `CLOSE ${outfit} 200 SIDE`);
      await drag(150, -60);
      await shot(page, `sarahlab-close-${outfit}-200-under.png`, `CLOSE ${outfit} 200 UNDERSIDE`);
      await drag(0, 60);
    }
    check(errors.length === 0, errors.length ? `no console errors:\n${errors.join('\n')}` : 'no console errors');
  } finally {
    await browser.close();
    server.httpServer.close();
  }
  if (failures) { log(`FAIL: ${failures} check(s)`); process.exit(1); }
  log('PASS');
}

main().catch((e) => { console.error(e); process.exit(1); });
