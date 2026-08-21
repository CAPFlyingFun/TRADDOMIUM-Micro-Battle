/**
 * probe:spawn — the front door, end to end.
 *
 * Boots the game as a player gets it, walks menu → map → a spawn on the
 * far side of the island, and checks she actually arrives there rather
 * than somewhere the floating origin left behind. Fails on console
 * errors, on a spawn that lands off its region, and on a menu that does
 * not fit a landscape phone.
 */
import { chromium } from 'playwright';

const url = process.env.PROBE_URL ?? 'http://localhost:4173/';
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
});

const notes = [];
try {
  const page = await browser.newPage({ viewport: { width: 932, height: 430 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

  await page.goto(url, { waitUntil: 'domcontentloaded' });

  // ── Menu ─────────────────────────────────────────────────────────
  await page.waitForSelector('[data-ui="main-menu"]', { timeout: 60000 });
  const menu = await page.evaluate(() => ({
    hasNew: Boolean(document.querySelector('[data-ui="new-colony"]')),
    continueDisabled: document.querySelector('[data-ui="continue"]')?.disabled,
    build: document.querySelector('[data-ui="menu-build"]')?.textContent ?? '',
    fits: [...document.querySelectorAll('[data-ui="main-menu"] button')].every((b) => {
      const box = b.getBoundingClientRect();
      return box.top >= -1 && box.bottom <= innerHeight + 1 && box.height >= 34;
    }),
  }));
  if (!menu.hasNew) throw new Error('the menu has no NEW COLONY');
  if (menu.continueDisabled !== true) {
    throw new Error('CONTINUE COLONY must be disabled until there is a colony');
  }
  if (!menu.fits) throw new Error('a menu button is off screen or too small to tap');
  if (!/^v\d+\.\d+\.\d+ · /.test(menu.build)) {
    throw new Error(`the menu build stamp reads "${menu.build}"`);
  }
  notes.push(`menu ok (${menu.build})`);

  // The world must NOT be running yet.
  if (await page.$('canvas[data-ui="island-canvas"]') === null
    && await page.evaluate(() => Boolean(window.__island))) {
    throw new Error('the world booted behind the menu');
  }

  // ── Map ──────────────────────────────────────────────────────────
  await page.click('[data-ui="new-colony"]');
  await page.waitForSelector('[data-ui="island-canvas"]', { timeout: 60000 });
  const map = await page.evaluate(() => {
    const c = document.querySelector('[data-ui="island-canvas"]');
    const box = c.getBoundingClientRect();
    const panel = document.querySelector('[data-ui="region-panel"]').getBoundingClientRect();
    return {
      square: Math.abs(box.width - box.height) < 3,
      inside: box.bottom <= innerHeight + 1 && box.top >= -1,
      panelInside: panel.right <= innerWidth + 1,
      map: [box.left, box.top, box.width],
    };
  });
  if (!map.square) throw new Error('the island map is not square');
  if (!map.inside) throw new Error('the island map does not fit the window');
  if (!map.panelInside) throw new Error('the region panel runs off the screen');

  // Nothing chosen yet, so no spawn button.
  if (await page.$('[data-ui="spawn-here"]') !== null) {
    throw new Error('SPAWN HERE offered before a region was chosen');
  }

  // ── Choose a region, deliberately a far one ──────────────────────
  const target = await page.evaluate(() => {
    const picked = window.__regions?.find((r) => r.id === 'polihale') ?? window.__regions?.[0];
    return picked ?? null;
  });
  if (!target) throw new Error('the map exposed no regions to the probe');

  const [left, top, size] = map.map;
  await page.mouse.click(left + target.mapX * size, top + target.mapY * size);
  await page.waitForSelector('[data-ui="spawn-here"]', { timeout: 20000 });
  const panel = await page.evaluate(() =>
    document.querySelector('[data-ui="region-panel"]').textContent ?? '');
  if (!panel.includes(target.name)) {
    throw new Error(`the panel shows "${panel.slice(0, 60)}" for ${target.name}`);
  }
  notes.push(`picked ${target.name}`);

  // ── Spawn ────────────────────────────────────────────────────────
  await page.click('[data-ui="spawn-here"]');
  await page.waitForFunction(() => Boolean(window.__island), null, { timeout: 120000 });
  await page.waitForFunction(() => window.__island.simTime() > 1, null, { timeout: 120000 });

  const landed = await page.evaluate(() => {
    const at = window.__island.where();
    return {
      wx: at[0], wz: at[2], y: at[1],
      ground: window.__island.groundUnderfoot(),
      origin: window.__island.origin(),
      cells: window.__island.cells(),
    };
  });

  const apart = Math.hypot(landed.wx - target.wx, landed.wz - target.wz);
  // Candidates search up to 2.6 km from the region centre.
  if (apart > 400_000) {
    throw new Error(
      `she spawned ${(apart / 100000).toFixed(1)} km from ${target.name}`,
    );
  }
  // The floating origin must have followed her, not stayed at the last spot.
  const strayed = Math.hypot(landed.wx - landed.origin.x, landed.wz - landed.origin.z);
  if (strayed > 8192) {
    throw new Error(`the origin stayed ${Math.round(strayed)} units behind her`);
  }
  // And she must be ON the ground the renderer drew, not near it.
  if (Math.abs(landed.y - landed.ground) > 0.01) {
    throw new Error(
      `she stands at ${landed.y.toFixed(2)} on ground of ${landed.ground.toFixed(2)}`,
    );
  }
  if (landed.cells < 9) throw new Error(`only ${landed.cells} terrain cells around her`);

  notes.push(
    `spawned at ${Math.round(landed.wx)}, ${Math.round(landed.wz)} — `
    + `${(apart / 100000).toFixed(2)} km from the marker, on the drawn ground, `
    + `${landed.cells} cells`,
  );

  // ── She still works ──────────────────────────────────────────────
  const before = await page.evaluate(() => window.__island.where());
  await page.keyboard.down('KeyW');
  await page.evaluate(() => new Promise((go) => {
    const t0 = window.__island.simTime();
    const f = () => (window.__island.simTime() - t0 > 3 ? go() : requestAnimationFrame(f));
    f();
  }));
  await page.keyboard.up('KeyW');
  const after = await page.evaluate(() => window.__island.where());
  const walked = Math.hypot(after[0] - before[0], after[2] - before[2]);
  if (walked < 5) throw new Error(`she would not walk after spawning: ${walked.toFixed(1)}`);
  notes.push(`walked ${walked.toFixed(0)} units after arriving`);

  // ── Grace ────────────────────────────────────────────────────────
  const grace = await page.evaluate(() => ({
    seconds: window.__island.grace(),
    shielded: window.__island.shielded(),
    disarmed: window.__island.disarmed(),
    chip: document.querySelector('[data-ui="grace"]')?.textContent ?? '',
  }));
  if (grace.seconds < 280) throw new Error(`she arrived with ${grace.seconds}s of grace`);
  // The rule the whole thing exists for: never one without the other.
  if (grace.shielded !== grace.disarmed) {
    throw new Error('grace protected her without disarming her');
  }
  if (!/SAFE/.test(grace.chip) || !/UNARMED/.test(grace.chip)) {
    throw new Error(`the grace chip reads "${grace.chip}" — it must say both halves`);
  }
  notes.push(`grace ${Math.round(grace.seconds)}s, shield and disarm together`);

  // ── The loop, three times over ───────────────────────────────────
  // Once proves it can happen. Three proves nothing is leaking between
  // runs — a scene left listening, a HUD left on screen, an origin left
  // where the last queen died.
  for (let round = 1; round <= 3; round++) {
    await page.click('[data-ui="debug-die"]');
    await page.waitForSelector('[data-ui="death"]', { timeout: 20000 });
    await page.click('[data-ui="choose-new-start"]');
    await page.waitForSelector('[data-ui="island-canvas"]', { timeout: 30000 });
    if (await page.$('[data-ui="death"]') !== null) {
      throw new Error(`the death screen survived restart ${round}`);
    }

    const next = await page.evaluate(() =>
      window.__regions.find((r) => r.id === 'kealia') ?? window.__regions[0]);
    const at = await page.evaluate(() => {
      const r = document.querySelector('[data-ui="island-canvas"]').getBoundingClientRect();
      return [r.left, r.top, r.width];
    });
    await page.mouse.click(at[0] + next.mapX * at[2], at[1] + next.mapY * at[2]);
    await page.waitForSelector('[data-ui="spawn-here"]', { timeout: 20000 });
    await page.click('[data-ui="spawn-here"]');
    await page.waitForFunction(() => Boolean(window.__island), null, { timeout: 120000 });
    await page.waitForFunction(() => window.__island.simTime() > 1, null, { timeout: 120000 });

    const fresh = await page.evaluate(() => ({
      grace: window.__island.grace(),
      canvases: document.querySelectorAll('canvas').length,
      deaths: document.querySelectorAll('[data-ui="death"]').length,
      dieButtons: document.querySelectorAll('[data-ui="debug-die"]').length,
      vitals: document.querySelectorAll('[data-ui="vitals"]').length,
    }));
    if (fresh.grace < 280) throw new Error(`round ${round} began with ${fresh.grace}s of grace`);
    // One of everything. Two means the last life is still on screen.
    for (const [what, many] of Object.entries(fresh)) {
      if (what === 'grace') continue;
      const want = what === 'deaths' ? 0 : 1;
      if (many !== want) {
        throw new Error(`round ${round} left ${many} ${what} on screen, wanted ${want}`);
      }
    }
  }
  notes.push('died and respawned three times over with nothing left behind');

  await page.screenshot({ path: 'probe-spawn.png' });
  if (errors.length) throw new Error(`page errors:\n${errors.join('\n')}`);
} finally {
  await browser.close();
}

console.log(`probe:spawn OK — ${notes.join('; ')}`);
