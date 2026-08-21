/**
 * probe:lod — sky and water must never show through land.
 *
 * THE ACCEPTANCE TEST, in Joshua's words: at any playable camera angle,
 * approaching an LOD boundary must never reveal sky or water through
 * land, and a hole must not merely move farther away as the player
 * approaches.
 *
 * That second half is why this walks. The old artefact "closed up" as
 * she came at it and opened again further out, which is what makes it
 * an LOD transition rather than a bad patch of ground — so a test that
 * only looks from the spawn would be fooled by exactly the behaviour it
 * is meant to catch.
 *
 * IT TAKES BOTH PIXELS AND RAYS, and finding that out cost a run.
 *
 * PIXELS are the only thing that sees the artefact honestly, because
 * the artefact is thin — the slit on the Līhuʻe Plain was twelve screen
 * rows out of four hundred and thirty. A ray sweep stepping four
 * degrees at a time walks straight over a band about one degree tall,
 * and duly reported a clean sweep against a build with the bug still
 * in it. So every frame is rendered and read.
 *
 * The catch, which has misled this project three times, is that not all
 * blue is a hole: sky above the horizon is blue, the sea past a real
 * coast is blue, and so is the HUD's own SAFE · UNARMED chip. So the
 * HUD is hidden before the shot, and a pixel only counts when it has
 * land above it AND land below it.
 *
 * RAYS then say what the pixels cannot: which two tiers met there, at
 * what distance, and how far behind the discarded surface its
 * replacement turned up. That last number is the defect itself, and it
 * is far more sensitive than counting sky: on the old ladder the worst
 * seam was twenty thousand units.
 */
import { chromium } from 'playwright';
import { readPng } from './readPng.mjs';

const url = process.env.PROBE_URL ?? 'http://localhost:4173/';
const regions = (process.env.PROBE_REGIONS ?? 'lihue,hanalei,waimea-rim,kokee')
  .split(',');
/**
 * EVERY CANDIDATE, NOT A RANDOM ONE.
 *
 * The first version of this probe rolled the spawn like the game does
 * and reported a clean sweep against a build with the bug still in it —
 * the artefact lives at one of a region's four starts and it drew a
 * different one. A regression test that passes half the time on a
 * broken build is worse than no test, because it is believed.
 */
const rolls = (process.env.PROBE_ROLLS ?? '0,0.25,0.5,0.75')
  .split(',').map(Number);

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
});

const notes = [];
try {
  const runs = regions.flatMap((region) => rolls.map((roll) => ({ region, roll })));
  for (const { region, roll } of runs) {
    // Walking and flying are what make this slow, so they run once per
    // region. Every candidate still gets looked at from where it lands.
    const deep = roll === rolls[0];
    const page = await browser.newPage({ viewport: { width: 932, height: 430 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**://api.open-meteo.com/**', (route) => route.abort());
    await page.goto(`${url}?spawnRoll=${roll}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-ui="main-menu"]', { timeout: 60000 });
    await page.click('[data-ui="new-colony"]');
    await page.waitForSelector('[data-ui="island-canvas"]', { timeout: 60000 });

    const map = await page.evaluate(() => {
      const b = document.querySelector('[data-ui="island-canvas"]').getBoundingClientRect();
      return { left: b.left, top: b.top, size: b.width };
    });
    const target = await page.evaluate((want) =>
      window.__regions?.find((r) => r.id === want) ?? null, region);
    if (!target) throw new Error(`no region called ${region}`);
    await page.mouse.click(map.left + target.mapX * map.size, map.top + target.mapY * map.size);
    await page.waitForSelector('[data-ui="spawn-here"]', { timeout: 20000 });
    await page.click('[data-ui="spawn-here"]');
    await page.waitForFunction(() => Boolean(window.__island), null, { timeout: 120000 });
    await page.waitForFunction(() => window.__island.simTime() > 2, null, { timeout: 180000 });

    /** Render the frame with the HUD out of the way, and read it. */
    const shot = async (tag) => {
      await page.screenshot({ path: 'probe-lod.png' });
      const { width, height, data } = readPng('probe-lod.png');
      const blue = (x, y) => {
        const i = (y * width + x) * 4;
        return data[i + 2] > data[i] + 12 && data[i + 2] > data[i + 1] + 6;
      };
      const found = [];
      for (let x = 3; x < width - 3; x += 2) {
        let landAbove = false;
        for (let y = 2; y < height - 2; y += 1) {
          if (!blue(x, y)) { landAbove = true; continue; }
          if (!landAbove) continue;
          for (let k = y + 1; k < Math.min(height - 2, y + 110); k += 1) {
            if (!blue(x, k)) { found.push({ x, y }); break; }
          }
        }
      }
      return { tag, width, height, found };
    };

    const look = async (label) => page.evaluate((tag) => {
      const holes = [];
      const gaps = [];
      let cast = 0;
      // Every heading, and the whole frame at each — the criterion says
      // ANY playable camera angle.
      // Enough to cover the frame at every heading without asking a
      // software renderer's host page to intersect a billion triangles.
      for (let turn = 0; turn < 360; turn += 30) {
        for (let pitch = -10; pitch <= 30; pitch += 4) {
          for (let side = -20; side <= 20; side += 10) {
            const ray = window.__island.sightLine(pitch, turn + side);
            cast += 1;
            if (ray.hole) holes.push({ turn: turn + side, pitch, dropped: ray.dropped });
            else if (ray.gap) gaps.push({ turn: turn + side, pitch, behind: ray.behind });
          }
        }
      }
      return {
        tag, cast, holes, gaps,
        cost: window.__island.terrainCost(),
        at: window.__island.where(),
      };
    }, label);

    // The HUD would otherwise be counted as scenery.
    await page.addStyleTag({
      content: '[data-ui]:not([data-ui="island-canvas"]) { visibility: hidden !important }',
    });
    await page.waitForFunction(() => {
      const v = document.querySelector('[data-ui="vitals"]');
      return v === null || getComputedStyle(v).visibility === 'hidden';
    }, null, { timeout: 20000 });

    process.stdout.write(`${region} #${rolls.indexOf(roll)}: sweeping... `);
    const first = await look('on arrival');
    first.pixels = await shot('on arrival');
    const passes = [first];
    if (!deep) process.stdout.write('\n');

    // ── WALK AT IT ────────────────────────────────────────────────────
    // The old artefact retreated. If it still does, this second look
    // finds it in the same place it was pushed to.
    if (deep) {
    process.stdout.write('walking... ');
    await page.keyboard.down('KeyW');
    const from = await page.evaluate(() => window.__island.simTime());
    await page.waitForFunction((mark) => window.__island.simTime() >= mark,
      from + 6, { timeout: 300000 });
    await page.keyboard.up('KeyW');
    const walked = await look('after walking');
    walked.pixels = await shot('after walking');
    passes.push(walked);
    process.stdout.write('flying...\n');

    // ── AND FROM THE AIR ──────────────────────────────────────────────
    // Flight shows several tiers at once and is far crueller to a seam
    // than standing on one is.
    await page.evaluate(() => {
      window.__island.setPace('run');
      window.__island.setSprint(true);
    });
    await page.keyboard.down('KeyW');
    // Wait until she can actually take off before asking her to —
    // takeoff needs airspeed, and holding Space at a standstill just
    // spends the request.
    await page.waitForFunction(() => window.__island.canTakeOff(),
      null, { timeout: 300000 });
    await page.keyboard.down('Space');
    await page.waitForFunction(() => window.__island.airborne(),
      null, { timeout: 300000 }).catch(() => {});
    const lifted = await page.evaluate(() => window.__island.simTime());
    await page.waitForFunction((mark) => window.__island.simTime() >= mark,
      lifted + 8, { timeout: 400000 });
    const airborne = await page.evaluate(() => window.__island.airborne());
    const flying = await look(airborne ? 'flying' : 'running (never left the ground)');
    flying.pixels = await shot('flying');
    passes.push(flying);
    await page.keyboard.up('Space');
    await page.keyboard.up('KeyW');
    }

    for (const pass of passes) {
      const worstGap = pass.gaps.length
        ? Math.round(Math.max(...pass.gaps.map((g) => g.behind))) : 0;
      const seen = pass.pixels?.found.length ?? 0;
      const line = `  ${region} #${rolls.indexOf(roll)} ${pass.tag}: `
        + `${seen} px see through the ground, worst seam ${worstGap} units `
        + `(${pass.holes.length} hole rays of ${pass.cast})`;
      console.log(line);

      // THE ACCEPTANCE CRITERION, in Joshua's words: at any playable
      // camera angle, approaching an LOD boundary must never reveal sky
      // or water through land.
      if (seen > 0) {
        const rows = pass.pixels.found.map((p) => p.y);
        throw new Error(
          `${region} candidate ${rolls.indexOf(roll)}, ${pass.tag}: `
          + `${seen} pixels show sky or water through land `
          + `(screen rows ${Math.min(...rows)}-${Math.max(...rows)})`,
        );
      }
      // A seam this wide is the artefact even where no sky got through:
      // the ground that replaced the discarded surface turned up
      // hundreds of metres further away. On the old ladder this reached
      // 20,366 units in flight.
      if (worstGap > 8_000) {
        throw new Error(
          `${region} candidate ${rolls.indexOf(roll)}, ${pass.tag}: `
          + `a tier hands off ${worstGap} units late`,
        );
      }
      if (pass.holes.length) {
        const worst = pass.holes.slice(0, 3);
        for (const h of worst) {
          console.log(
            `    heading ${h.turn}° pitch ${h.pitch}° — `
            + `${h.dropped.tier} discarded at ${Math.round(h.dropped.square)} units`,
          );
        }
        throw new Error(
          `${region} candidate ${rolls.indexOf(roll)}, ${pass.tag}: `
          + `${pass.holes.length} sight lines see sky or water through land`,
        );
      }
      notes.push(line);
    }

    if (deep) {
      console.log(
        `  terrain: ${first.cost.triangles.toLocaleString()} triangles, `
        + `${first.cost.vertices.toLocaleString()} vertices, `
        + `${first.cost.meshes} meshes`,
      );
    }
    if (errors.length) throw new Error(`${region}: ${errors[0]}`);
    await page.close();
  }

  console.log(
    `\nprobe:lod OK — ${regions.length} regions x ${rolls.length} starts, `
    + 'standing, walking and flying',
  );
} catch (why) {
  console.error(`\nprobe:lod FAILED — ${why.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
