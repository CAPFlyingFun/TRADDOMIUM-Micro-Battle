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

  // THE FRONT DOOR MUST NOT NEED THE WEATHER SERVICE. Refusing the
  // request here is both a test — every check below runs with weather
  // unavailable — and a way to keep this probe about the front door
  // rather than about somebody else's uptime. The browser logs its own
  // line for a refused request, which is expected and filtered at the
  // end; a thrown error or an unhandled rejection is not.
  await page.route('**://api.open-meteo.com/**', (route) => route.abort());

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
  // The world is behind a loading screen now: everything below
  // this measures a half-built island unless it waits for the
  // veil to lift.
  await page.waitForFunction(
    () => !document.querySelector('[data-ui="loading"]'), null, { timeout: 240000 });
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
    record: window.__island.graceRecord(),
    seconds: window.__island.grace(),
    shielded: window.__island.shielded(),
    disarmed: window.__island.disarmed(),
    ignored: window.__island.ignoredByHostiles(),
    chip: document.querySelector('[data-ui="grace"]')?.textContent ?? '',
    now: Date.now(),
  }));

  // IT IS A DEADLINE, NOT A COUNTDOWN, and this probe is the clearest
  // demonstration of why that matters: under SwiftShader the game gets
  // through roughly a thirtieth of real time, so a subtracted timer
  // would still read close to a full five minutes here no matter how
  // long the probe had actually taken. What is checked is the ISSUED
  // SPAN — exactly five minutes — and that what remains agrees with the
  // wall clock rather than with how many frames the game managed.
  if (!grace.record) throw new Error('she arrived with no grace record');
  const span = (grace.record.endsAt - grace.record.spawnedAt) / 1000;
  if (Math.abs(span - 300) > 0.001) {
    throw new Error(`grace was issued for ${span}s rather than five minutes`);
  }
  const wallLeft = (grace.record.endsAt - grace.now) / 1000;
  if (Math.abs(grace.seconds - wallLeft) > 1) {
    throw new Error(
      `grace says ${grace.seconds.toFixed(1)}s left but the clock says `
      + `${wallLeft.toFixed(1)}s — it is being ticked, not read`,
    );
  }
  if (!grace.shielded) throw new Error('she is not protected after arriving');
  // The rule the whole thing exists for: never one without the other.
  if (grace.shielded !== grace.disarmed) {
    throw new Error('grace protected her without disarming her');
  }
  // And nothing may even choose her as a target while it runs.
  if (grace.ignored !== grace.shielded) {
    throw new Error('grace protected her while leaving her huntable');
  }
  if (!/SAFE/.test(grace.chip) || !/UNARMED/.test(grace.chip)) {
    throw new Error(`the grace chip reads "${grace.chip}" — it must say both halves`);
  }
  notes.push(
    `grace issued for ${span}s, ${Math.round(grace.seconds)}s left by the wall clock, `
    + 'shield and disarm and hostile-blindness together',
  );

  // ── The loop, three times over ───────────────────────────────────
  // Once proves it can happen. Three proves nothing is leaking between
  // runs — a scene left listening, a HUD left on screen, an origin left
  // where the last queen died.
  let lastSpawnedAt = grace.record.spawnedAt;
  for (let round = 1; round <= 3; round++) {
    // BEHIND THE GEAR NOW. Ending the run moved into the settings panel
    // in v0.0.141 — it is scaffolding, and the playing surface is not
    // where a control that cannot be undone belongs.
    await page.click('[data-ui="settings"]');
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
      record: window.__island.graceRecord(),
      shielded: window.__island.shielded(),
      canvases: document.querySelectorAll('canvas').length,
      deaths: document.querySelectorAll('[data-ui="death"]').length,
      dieButtons: document.querySelectorAll('[data-ui="debug-die"]').length,
      vitals: document.querySelectorAll('[data-ui="vitals"]').length,
    }));

    // A NEW queen gets a NEW five minutes — not a top-up of the last
    // one, and not the remains of it. The span is checked rather than
    // the seconds remaining, because the seconds remaining are correct
    // only for the instant they were read and this probe is slow.
    if (!fresh.record) throw new Error(`round ${round} began with no grace`);
    const span = (fresh.record.endsAt - fresh.record.spawnedAt) / 1000;
    if (Math.abs(span - 300) > 0.001) {
      throw new Error(`round ${round} was issued ${span}s of grace`);
    }
    if (fresh.record.spawnedAt <= lastSpawnedAt) {
      throw new Error(`round ${round} inherited the previous queen's grace`);
    }
    lastSpawnedAt = fresh.record.spawnedAt;
    if (!fresh.shielded) throw new Error(`round ${round} spawned unprotected`);

    // One of everything. Two means the last life is still on screen.
    for (const [what, many] of Object.entries(fresh)) {
      if (what === 'record' || what === 'shielded') continue;
      const want = what === 'deaths' ? 0 : 1;
      if (many !== want) {
        throw new Error(`round ${round} left ${many} ${what} on screen, wanted ${want}`);
      }
    }
  }
  notes.push('died and respawned three times over with nothing left behind');

  // ── The flight pair reads the way the screen points ──────────────
  const readPad = () => page.evaluate(() => {
    const seen = [...document.querySelectorAll('[data-ui="actions"] [data-action]')]
      .map((el) => {
        const b = el.getBoundingClientRect();
        return {
          action: el.dataset.action,
          top: Math.round(b.top),
          left: Math.round(b.left),
          w: Math.round(b.width),
          h: Math.round(b.height),
          // Greyed out is presented as opacity and greyscale rather
          // than the disabled attribute, so that is what gets read.
          dim: Number(getComputedStyle(el).opacity) < 0.95,
          glyph: el.textContent,
        };
      })
      .sort((a, b) => a.top - b.top);
    return seen;
  });

  const pad = await readPad();
  if (pad.length !== 2) throw new Error(`the action pad holds ${pad.length} buttons`);
  const [upper, lower] = pad;
  if (upper.action !== 'climb') {
    throw new Error(`the upper action button is "${upper.action}", not climb`);
  }
  if (lower.action !== 'descend') {
    throw new Error(`the lower action button is "${lower.action}", not descend`);
  }
  // Same slots as before the swap: one column, matching sizes, and the
  // gap between them unchanged. A reorder must not become a relayout.
  if (upper.left !== lower.left) throw new Error('the pair is no longer one column');
  if (upper.w !== lower.w || upper.h !== lower.h) {
    throw new Error('the two action buttons are different sizes');
  }
  const gap = lower.top - (upper.top + upper.h);
  if (gap < 4 || gap > 18) throw new Error(`the pad gap is now ${gap}px`);
  if (upper.w < 44 || upper.h < 44) {
    throw new Error(`an action button is ${upper.w}x${upper.h} — too small for a thumb`);
  }
  // On the ground there is nothing to descend from, so the lower button
  // must still be the one that greys out.
  // On the ground the upper button is a TAKEOFF, and says so.
  if (upper.glyph !== '🪽') {
    throw new Error(`the upper button shows "${upper.glyph}" on the ground`);
  }
  // Nothing to descend from down here, so the lower one is greyed.
  if (!lower.dim) throw new Error('DESCEND is not greyed out on the ground');
  // And she is standing still, so she cannot take off either.
  if (!upper.dim) {
    throw new Error('TAKEOFF is offered to a queen who is standing still');
  }

  // THE WIRING, not merely the order. Run, and the button that lights
  // up must be the UPPER one — takeoff needs airspeed, descending never
  // becomes available on the ground. Had the swap crossed the actions
  // with the slots, this is the check that would catch it.
  await page.keyboard.down('KeyW');
  // Wait for the BUTTON, not for the flight model. `canTakeOff` turns
  // true a frame before the HUD is repainted, and under SwiftShader a
  // frame is most of a second — reading the pad on the model's word
  // catches the button in its old state.
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-action="climb"]');
      return el !== null && Number(getComputedStyle(el).opacity) >= 0.95;
    },
    null,
    { timeout: 90000 },
  );
  const running = await readPad();
  await page.keyboard.up('KeyW');
  const [runUpper, runLower] = running;
  if (runUpper.dim) throw new Error('TAKEOFF stayed greyed out at a run');
  if (!runLower.dim) throw new Error('DESCEND lit up while she was on the ground');
  if (runUpper.top !== upper.top || runLower.top !== lower.top) {
    throw new Error('the buttons moved when their state changed');
  }
  notes.push(
    `action pad: climb above descend, ${upper.w}x${upper.h}, ${gap}px apart, `
    + 'takeoff lights the upper slot at a run',
  );

  await page.screenshot({ path: 'probe-spawn.png' });
  const real = errors.filter((e) =>
    !/ERR_FAILED|ERR_TUNNEL_CONNECTION_FAILED|ERR_INTERNET_DISCONNECTED|Failed to load resource/
      .test(e));
  if (real.length) throw new Error(`page errors:\n${real.join('\n')}`);
} finally {
  await browser.close();
}

console.log(`probe:spawn OK — ${notes.join('; ')}`);
