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
if (parked && parked.impact !== null) {
  console.log('probe:telemetry FAILED — a terrain intercept while parked');
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
await page.waitForTimeout(1500);

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
      soonRange: t.soon.range, soonAfter: t.soon.after, soonAgl: t.soon.agl,
      shownAgl: t.shownAgl, shownTarget: t.shownTarget,
      impact: t.impact ? t.impact.after : null,
      height: window.__island.height(),
    };
  }));
  await page.waitForTimeout(180);
}

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
  // The look-ahead goes as far as the speed says it should.
  if (!near(t.soonRange, t.groundSpeed * t.soonAfter, 0.01)) {
    fail(`look-ahead range ${t.soonRange.toFixed(1)} is not speed x time`);
    break;
  }
  // Anything NaN on screen is a number nobody can act on.
  for (const [key, value] of Object.entries(t)) {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      fail(`${key} is ${value}`);
      break;
    }
  }
}

const last = seen[seen.length - 1];
if (last) {
  console.log(`AIR ${last.airspeed.toFixed(1)}  GND ${last.groundSpeed.toFixed(1)} cm/s`);
  console.log(`HDG ${last.heading.toFixed(0)}  TRK ${last.track.toFixed(0)}`
    + `  DRIFT ${last.drift.toFixed(1)}`);
  console.log(`AGL ${last.agl.toFixed(0)} cm  VS ${last.climbing.toFixed(1)} cm/s`
    + `  TGT ${last.soonAgl.toFixed(0)} cm`);
  console.log(`wind ${(last.wind / 100).toFixed(2)} m/s from bearing `
    + `${last.windBearing.toFixed(0)}`);
  console.log(`impact ${last.impact === null ? 'none' : `${last.impact.toFixed(1)}s`}`);
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
