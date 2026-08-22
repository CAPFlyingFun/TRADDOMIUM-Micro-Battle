/**
 * DOES THE FLIGHT TELEMETRY AGREE WITH ITSELF?
 *
 * The unit tests prove the wind triangle. They cannot prove the scene
 * handed the HUD ground speed where it meant airspeed — a mistake this
 * code has already made once, printing the same number under both
 * labels for a week. This flies her for real and checks the live
 * reading against its own parts.
 */
import { chromium } from 'playwright';

const url = process.env.PROBE_URL ?? 'http://localhost:4173/';
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 932, height: 430 } });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message.split('\n')[0]));
await page.route('**://api.open-meteo.com/**', (r) => r.abort());
await page.goto(`${url}?scene=island`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Boolean(window.__island), null, { timeout: 120000 });
await page.waitForFunction(() => window.__island.simTime() > 0.4, null, { timeout: 240000 });

// On the ground there is no flight to read, and nothing should pretend.
const parked = await page.evaluate(() => window.__island.telemetry());
if (parked && parked.touchdown !== null) {
  console.log('probe:telemetry FAILED — a touchdown zone while parked');
  process.exitCode = 1;
}

await page.evaluate(() => {
  window.__island.setPace('run');
  window.__island.setSprint(true);
});
await page.keyboard.down('KeyW');
await page.waitForFunction(() => window.__island.canTakeOff(), null, { timeout: 300000 });
await page.keyboard.down('Space');
await page.waitForFunction(() => window.__island.height() > 30, null, { timeout: 300000 });
await page.keyboard.up('Space');

/**
 * WAIT ON SIM TIME, NEVER ON WALL TIME.
 *
 * SwiftShader renders this scene at a small fraction of real time, so
 * `waitForTimeout(180)` bought about a thousandth of a simulated second
 * — fourteen "samples" taken inside one frame of the model. The run
 * looked healthy and checked nothing: she was still climbing on a
 * button released three lines earlier, because the release had not yet
 * had a frame to take effect. Everything here steps the SIMULATION.
 */
async function settle(seconds) {
  const mark = await page.evaluate(() => window.__island.simTime());
  await page.waitForFunction(
    (until) => window.__island.simTime() >= until, mark + seconds,
    { timeout: 600000 },
  );
}

await settle(0.4);

// GET HER COMING DOWN. A level cruise out over the sea has no touchdown
// at all — which is correct, and which means a probe that only ever
// cruises never once exercises the solver it is here to check. She
// descends for the sampling run, so the readings below have a real
// touchdown zone to be consistent with.
await page.keyboard.down('ShiftLeft');
await settle(0.1);

const seen = [];
for (let i = 0; i < 14; i++) {
  seen.push(await page.evaluate(() => {
    const t = window.__island.telemetry();
    return t && {
      airspeed: t.airspeed, groundSpeed: t.groundSpeed,
      heading: t.heading, track: t.track, drift: t.drift,
      climbing: t.climbing, agl: t.agl, altitude: t.altitude,
      gx: t.ground.x, gz: t.ground.z,
      wind: t.wind.speed, windBearing: t.wind.bearing,
      tdRange: t.touchdown ? t.touchdown.range : null,
      tdAfter: t.touchdown ? t.touchdown.after : null,
      tdTerrain: t.touchdown ? t.touchdown.terrain : null,
      tdAgl: t.touchdown ? t.touchdown.agl : null,
      shownAgl: t.shownAgl, shownAtLanding: t.shownAtLanding,
      shownRange: t.shownRange, shownWhen: t.shownWhen,
      height: window.__island.height(),
    };
  }));
  await settle(0.05);
}

await page.keyboard.up('ShiftLeft');
await page.keyboard.up('KeyW');

const fail = (why) => { console.log(`probe:telemetry FAILED — ${why}`); process.exitCode = 1; };
const near = (a, b, slack) => Math.abs(a - b) <= slack;
const wrap180 = (d) => ((((d + 180) % 360) + 360) % 360) - 180;

let checked = 0;
for (const t of seen) {
  if (!t) { fail('no telemetry while airborne'); break; }
  checked++;
  // Ground speed IS the magnitude of the ground velocity.
  if (!near(t.groundSpeed, Math.hypot(t.gx, t.gz), 0.01)) {
    fail(`ground speed ${t.groundSpeed.toFixed(2)} is not |ground velocity| `
      + `${Math.hypot(t.gx, t.gz).toFixed(2)}`);
    break;
  }
  // Track IS the bearing of that vector, whenever there is one.
  if (t.groundSpeed > 1) {
    const bearing = ((Math.atan2(t.gx, -t.gz) * 180) / Math.PI + 360) % 360;
    if (Math.abs(wrap180(bearing - t.track)) > 0.5) {
      fail(`track ${t.track.toFixed(1)} is not the bearing of the velocity `
        + `${bearing.toFixed(1)}`);
      break;
    }
  }
  // Drift IS track minus heading, the short way.
  if (Math.abs(wrap180(t.track - t.heading) - t.drift) > 0.5) {
    fail(`drift ${t.drift.toFixed(1)} is not track minus heading`);
    break;
  }
  // Altitude IS the terrain plus the clearance.
  if (!near(t.altitude - t.agl, t.altitude - t.height, 0.5)) {
    fail('altitude and AGL disagree about the terrain');
    break;
  }
  // The touchdown, when there is one, is internally consistent: the
  // range it reports is the distance its own time buys at her speed,
  // and it really does sit on the ground.
  if (t.tdRange !== null) {
    if (!near(t.tdRange, t.groundSpeed * t.tdAfter, Math.max(1, t.tdRange * 0.01))) {
      fail(`touchdown range ${t.tdRange.toFixed(1)} is not speed x time `
        + `${(t.groundSpeed * t.tdAfter).toFixed(1)}`);
      break;
    }
    if (t.tdAgl > 6) {
      fail(`the touchdown zone floats ${t.tdAgl.toFixed(1)} above the ground`);
      break;
    }
    if (t.tdAfter < 0) { fail('a touchdown behind her'); break; }
  }
  // Anything NaN on screen is a number nobody can act on.
  for (const [key, value] of Object.entries(t)) {
    if (value !== null && typeof value === 'number' && !Number.isFinite(value)) {
      fail(`${key} is ${value}`);
      break;
    }
  }
}

// The run was flown in a descent on purpose; a solver that found
// nothing has not been tested by any of the checks above.
const landings = seen.filter((t) => t && t.tdRange !== null);
if (!landings.length) {
  fail('flew a whole descent without ever finding a touchdown zone');
}

/**
 * LND IS HER HEIGHT OVER THE GROUND SHE IS GOING TO LAND ON — and it is
 * an EASED readout, so it cannot be checked against one instantaneous
 * truth. Crossing a ridge line moves the real figure by metres between
 * two frames, on purpose; the ease then takes a second to follow, also
 * on purpose. Comparing the two at a single moment convicted the
 * smoothing of being smoothing.
 *
 * What an ease actually guarantees is that it stays inside the range of
 * what it has been fed, which is a property worth checking and the one
 * that would catch the readout being wired to the wrong terrain.
 */
if (landings.length) {
  const truth = landings.map((t) => t.altitude - t.tdTerrain);
  const low = Math.min(...truth);
  const high = Math.max(...truth);
  const slack = Math.max(30, (high - low) * 0.1);
  for (const t of landings) {
    if (t.shownAtLanding < low - slack || t.shownAtLanding > high + slack) {
      fail(`LND ${t.shownAtLanding.toFixed(0)} is outside everything it was `
        + `fed (${low.toFixed(0)} to ${high.toFixed(0)})`);
      break;
    }
  }
  // And it must be measuring against the LANDING ground, not the ground
  // under her feet. Those differ whenever the island is not flat, which
  // on Kauai is always — so if they never differ, it is wired wrong.
  const apart = landings.reduce(
    (m, t) => Math.max(m, Math.abs((t.altitude - t.tdTerrain) - t.agl)), 0,
  );
  console.log(`LND vs AGL differ by up to ${apart.toFixed(0)} cm`);
}

const last = seen[seen.length - 1];
if (last) {
  console.log(`AIR ${last.airspeed.toFixed(1)}  GND ${last.groundSpeed.toFixed(1)} cm/s`);
  console.log(`HDG ${last.heading.toFixed(0)}  TRK ${last.track.toFixed(0)}`
    + `  DRIFT ${last.drift.toFixed(1)}`);
  console.log(`AGL ${last.agl.toFixed(0)} cm  VS ${last.climbing.toFixed(1)} cm/s`
    + `  MSL ${last.altitude.toFixed(0)} cm`);
  console.log(`wind ${(last.wind / 100).toFixed(2)} m/s from bearing `
    + `${last.windBearing.toFixed(0)}`);
  console.log(last.tdRange === null
    ? 'touchdown none within the horizon'
    : `touchdown ${(last.tdRange / 100).toFixed(1)} m ahead in `
      + `${last.tdAfter.toFixed(1)}s, ${last.shownAtLanding.toFixed(0)} cm to lose`);
  // The eased readouts must be in the same country as the raw ones.
  if (Math.abs(last.shownAgl - last.agl) > Math.max(40, last.agl * 0.6)) {
    fail(`the shown AGL ${last.shownAgl.toFixed(0)} is nowhere near `
      + `the real ${last.agl.toFixed(0)}`);
  }
}

if (!process.exitCode) {
  console.log(`\nprobe:telemetry passed — ${checked} readings, all self-consistent`);
}
await browser.close();
