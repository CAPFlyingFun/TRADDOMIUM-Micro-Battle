/** Spawn in each named region and save a clean screenshot. No probing. */
import { chromium } from 'playwright';
const url = process.env.PROBE_URL ?? 'http://localhost:4173/';
const spots = (process.env.SHOTS ?? 'mana,lihue,poipu,kokee,hanalei-bay').split(',');
const tag = process.env.TAG ?? 'shot';
// The design canvas by default, but the HUD's crowding problems live at
// the NARROW end — Joshua's phone in landscape is a good deal tighter
// than 932, and a strip that fits here can still sit on the queen's
// card there. VIEW=844x390 to shoot one.
const [vw, vh] = (process.env.VIEW ?? '932x430').split('x').map(Number);
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
});
try {
  for (const spot of spots) {
    const page = await browser.newPage({ viewport: { width: vw, height: vh } });
    // A SHADER THAT WILL NOT COMPILE FAILS QUIETLY — the terrain just
    // is not there, and a screenshot of an empty blue world looks like
    // a spawn in the sea rather than like a broken build. The error is
    // on the console, so the console is watched.
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error' && !/ERR_FAILED|Failed to load resource/.test(m.text())) {
        errors.push(m.text());
      }
    });
    await page.route('**://api.open-meteo.com/**', (r) => r.abort());
    if (process.env.CLOSE_UP === '1') {
      // Pull the camera in through the SAVED SETTINGS rather than a
      // debug hook: the game already reads these on boot and clamps
      // them, so this is the player's own zoom rather than a back door
      // that has to be maintained.
      await page.addInitScript(() => {
        localStorage.setItem('traddomium.settings', JSON.stringify({
          cameraDistance: 3.5, fov: 40,
        }));
      });
    }
    await page.goto(`${url}?spawnRoll=${process.env.SPAWN_ROLL ?? '0.25'}${process.env.EXTRA ?? ''}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-ui="main-menu"]', { timeout: 60000 });
    await page.click('[data-ui="new-colony"]');
    await page.waitForSelector('[data-ui="island-canvas"]', { timeout: 60000 });
    const map = await page.evaluate(() => {
      const b = document.querySelector('[data-ui="island-canvas"]').getBoundingClientRect();
      return { left: b.left, top: b.top, size: b.width };
    });
    const r = await page.evaluate((w) => window.__regions.find((x) => x.id === w), spot);
    if (!r) { console.log(`no region ${spot}`); await page.close(); continue; }
    await page.mouse.click(map.left + r.mapX * map.size, map.top + r.mapY * map.size);
    await page.waitForSelector('[data-ui="spawn-here"]', { timeout: 20000 });
    await page.click('[data-ui="spawn-here"]');
    await page.waitForFunction(() => Boolean(window.__island), null, { timeout: 120000 });
    // A skinned queen of a hundred thousand triangles is very slow
    // under a software renderer; a fraction of a simulated second is
    // plenty for a still.
    await page.waitForFunction(() => window.__island.simTime() > 0.4,
      null, { timeout: 240000 });
    if (process.env.FLYING === '1') {
      // Get her airborne and hold her there, so the wings are working
      // rather than folded.
      await page.evaluate(() => {
        window.__island.setPace('run');
        window.__island.setSprint(true);
      });
      await page.keyboard.down('KeyW');
      await page.waitForFunction(() => window.__island.canTakeOff(),
        null, { timeout: 300000 });
      await page.keyboard.down('Space');
      await page.waitForTimeout(2200);
    }
    if (process.env.WINGS !== undefined) {
      // Look at HER, close up, from the side. The default chase camera
      // is behind and above, which is the worst angle for judging a
      // wing.
      await page.evaluate(async (on) => {
        window.__island.setWings(on === '1');
        window.__island.setPace('crawl');
      }, process.env.WINGS);
      await page.waitForTimeout(3000);
    }
    if (process.env.KEEP_HUD === '1') {
      // The HUD is the subject rather than the obstacle: open the
      // weather panel and let her work, so the endurance readout has a
      // workload to report on rather than sitting at FULL.
      await page.click('[data-ui="weather-chip"]').catch(() => {});
      await page.evaluate(() => {
        window.__island.setPace('run');
        window.__island.setSprint(true);
      });
      // Real time, not simulated: the readout reports the rate she is
      // working at RIGHT NOW, so it only needs her to be sprinting at
      // the moment of the shot, not to have sprinted for a while. Under
      // a software renderer a few simulated seconds is several minutes.
      await page.keyboard.down('KeyW');
      await page.waitForTimeout(12000);
    } else {
      await page.addStyleTag({
        content: '[data-ui]:not([data-ui="island-canvas"]){visibility:hidden!important}',
      });
      await page.waitForFunction(() => {
        const v = document.querySelector('[data-ui="vitals"]');
        return v === null || getComputedStyle(v).visibility === 'hidden';
      }, null, { timeout: 20000 });
    }
    await page.screenshot({ path: `${tag}-${spot}.png`, timeout: 240000 });
    await page.keyboard.up('KeyW').catch(() => {});
    if (errors.length) {
      console.log(`${spot}: FAILED — ${errors[0].split('\n')[0]}`);
      process.exitCode = 1;
    } else {
      console.log(`${tag}-${spot}.png  (${vw}x${vh})`);
    }
    await page.close();
  }
} finally { await browser.close(); }
