/**
 * probe:weather — the sky, end to end, without touching the internet.
 *
 * Open-Meteo is intercepted rather than called. That is not a
 * convenience: a probe that depends on a third-party service tests the
 * service, passes or fails for reasons that have nothing to do with
 * this repository, and cannot be made to rain on demand. Serving a
 * canned reply exercises the whole live path — request shape, parsing,
 * the field, the blend, the fog, the lights, the drops — and does it
 * the same way every run.
 *
 * Three runs:
 *
 *   1. a canned STORM, to see the sky close in and the rain fall
 *   2. a canned CLEAR day, to see it open up again
 *   3. the network REFUSED, to prove the game does not need it
 */
import { chromium } from 'playwright';

const url = process.env.PROBE_URL ?? 'http://localhost:4173/';
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
});

/** One Open-Meteo location object. */
const place = (over) => ({
  current: {
    time: '2026-08-21T12:00',
    temperature_2m: 25,
    relative_humidity_2m: 80,
    rain: 0,
    cloud_cover: 20,
    wind_speed_10m: 22,
    wind_direction_10m: 65,
    wind_gusts_10m: 33,
    weather_code: 1,
    ...over,
  },
  hourly: {
    time: ['2026-08-21T11:00', '2026-08-21T12:00', '2026-08-21T13:00'],
    visibility: [24000, over.__visibility ?? 24000, 24000],
  },
});

const STORM = (n) => Array.from({ length: n }, () => place({
  rain: 7.5, cloud_cover: 100, weather_code: 95, wind_speed_10m: 44,
  wind_gusts_10m: 70, relative_humidity_2m: 96, temperature_2m: 21,
  __visibility: 800,
}));

const CLEAR = (n) => Array.from({ length: n }, () => place({
  rain: 0, cloud_cover: 4, weather_code: 0, wind_speed_10m: 14,
  __visibility: 24000,
}));

/** Boot the game to a spawn, with `serve` deciding the weather reply. */
async function play(serve) {
  const page = await browser.newPage({ viewport: { width: 932, height: 430 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

  let asked = 0;
  await page.route('**://api.open-meteo.com/**', async (route) => {
    asked += 1;
    const count = new URL(route.request().url())
      .searchParams.get('latitude').split(',').length;
    await serve(route, count);
  });

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-ui="main-menu"]', { timeout: 60000 });
  await page.click('[data-ui="new-colony"]');
  await page.waitForSelector('[data-ui="island-canvas"]', { timeout: 60000 });

  const map = await page.evaluate(() => {
    const box = document.querySelector('[data-ui="island-canvas"]').getBoundingClientRect();
    return { left: box.left, top: box.top, size: box.width };
  });
  const target = await page.evaluate(() =>
    window.__regions?.find((r) => r.id === 'hanalei') ?? window.__regions?.[0]);
  const tapRegion = async () => {
    await page.mouse.click(
      map.left + target.mapX * map.size, map.top + target.mapY * map.size,
    );
    await page.waitForSelector('[data-ui="spawn-here"]', { timeout: 20000 });
  };
  await tapRegion();

  return { page, errors, target, tapRegion, asked: () => asked };
}

/**
 * Wait for `seconds` of SIMULATED time.
 *
 * SwiftShader renders this scene at roughly a tenth of real time, so
 * simulated seconds are expensive and the waits here are deliberately
 * short. They can be, because the blend is SETTLED at spawn rather than
 * eased into — the same call the game makes when she arrives — so the
 * only thing actually waiting is the rain fading in, which has a two
 * and a half second time constant.
 */
async function simulate(page, seconds, what) {
  const from = await page.evaluate(() => window.__island.simTime());
  try {
    await page.waitForFunction(
      (mark) => window.__island.simTime() >= mark,
      from + seconds,
      { timeout: 300000 },
    );
  } catch {
    const got = await page.evaluate(() => window.__island.simTime());
    throw new Error(
      `waiting ${seconds}s of sim time for ${what} reached only `
      + `${(got - from).toFixed(1)}s`,
    );
  }
}

const notes = [];
try {
  // ── 1. A canned storm ──────────────────────────────────────────────
  {
    const { page, errors, asked, tapRegion } = await play(async (route, count) => {
      await route.fulfill({ json: STORM(count) });
    });

    // Wait for the live readings to actually land BEFORE spawning. She
    // arrives settled into whatever the field holds at that instant, so
    // spawning mid-request would mean easing out of the simulated sky
    // over the following few minutes — correct behaviour, but not what
    // this run is measuring.
    await page.waitForFunction(() => window.__weather?.() === 'live',
      null, { timeout: 60000 });
    await tapRegion();

    // The map should already be asking, so a spawn arrives into weather.
    const panel = await page.evaluate(() =>
      document.querySelector('[data-ui="region-panel"]').textContent ?? '');
    if (!/Humidity/.test(panel) || !/Wind/.test(panel)) {
      throw new Error('the spawn map shows no weather for the chosen region');
    }
    if (!/Live Kauaʻi|Last known|Simulated/.test(panel)) {
      throw new Error('the spawn map does not say where its weather came from');
    }

    await page.click('[data-ui="spawn-here"]');
    await page.waitForFunction(() => Boolean(window.__island), null, { timeout: 120000 });
    await simulate(page, 1, 'the first frames');

    if (asked() === 0) throw new Error('the game never asked for live weather');

    // Only the rain has to catch up. The sky itself arrived settled.
    await simulate(page, 5, 'the rain to fall');

    const wet = await page.evaluate(() => ({
      source: window.__island.weatherSource(),
      fog: window.__island.fogDensity(),
      sun: window.__island.sunlight(),
      drops: window.__island.raindrops(),
      game: window.__island.weather(),
      reading: window.__island.reading(),
      chip: document.querySelector('[data-ui="weather-chip"]')?.textContent ?? '',
      chipBox: (() => {
        const c = document.querySelector('[data-ui="weather-chip"]');
        if (!c) return null;
        const b = c.getBoundingClientRect();
        return { r: b.right, t: b.top, w: b.width, h: b.height };
      })(),
    }));

    if (wet.source !== 'live') {
      throw new Error(`the canned reply did not go live — source is ${wet.source}`);
    }
    if (!wet.chipBox) throw new Error('there is no weather chip on the HUD');
    if (wet.chipBox.r > 932 || wet.chipBox.t < 0) {
      throw new Error('the weather chip is off the screen');
    }
    if (wet.chipBox.w > 160 || wet.chipBox.h > 70) {
      throw new Error(`the weather chip is a weather station: ${wet.chipBox.w}x${wet.chipBox.h}`);
    }
    if (!/\d+°/.test(wet.chip)) {
      throw new Error(`the chip shows no temperature: "${wet.chip}"`);
    }
    if (wet.drops < 700) {
      throw new Error(`only ${wet.drops} drops are falling in a thunderstorm`);
    }
    if (wet.game.rainfall < 0.8) {
      throw new Error(`rainfall eased to only ${wet.game.rainfall.toFixed(2)}`);
    }
    // 800 m of visibility: 1.7308 / (800 * 100) = 2.16e-5.
    const wantFog = Math.sqrt(-Math.log(0.05)) / (800 * 100);
    if (Math.abs(wet.fog - wantFog) / wantFog > 0.06) {
      throw new Error(
        `fog is ${wet.fog.toExponential(2)}, not the ${wantFog.toExponential(2)} that 800 m means`,
      );
    }
    if (wet.sun > 0.8) throw new Error(`the sun is still at ${wet.sun} under a storm`);

    // The panel behind the chip.
    await page.click('[data-ui="weather-chip"]');
    // The panel is filled by the next frame rather than by the click:
    // it is written from the eased reading, not from a stored copy.
    await page.waitForFunction(
      () => (document.querySelector('[data-ui="weather-panel"]')
        ?.textContent ?? '').includes('Source'),
      null, { timeout: 60000 },
    );
    const detail = await page.evaluate(() =>
      document.querySelector('[data-ui="weather-panel"]')?.textContent ?? '');
    for (const want of ['Humidity', 'Wind', 'Visibility', 'Source', 'Live Kauaʻi']) {
      if (!detail.includes(want)) {
        throw new Error(`the weather panel never mentions ${want}`);
      }
    }

    await page.screenshot({ path: 'probe-weather-storm.png' });
    if (errors.length) throw new Error(`storm run: ${errors[0]}`);
    notes.push(
      `storm: live, ${wet.drops} drops, fog ${wet.fog.toExponential(1)}, sun ${wet.sun.toFixed(2)}`,
    );
    await page.close();
  }

  // ── 2. A canned clear day ─────────────────────────────────────────
  {
    const { page, errors } = await play(async (route, count) => {
      await route.fulfill({ json: CLEAR(count) });
    });
    await page.waitForFunction(() => window.__weather?.() === 'live',
      null, { timeout: 60000 });
    await page.click('[data-ui="spawn-here"]');
    await page.waitForFunction(() => Boolean(window.__island), null, { timeout: 120000 });
    await simulate(page, 3, 'the clear sky');

    const dry = await page.evaluate(() => ({
      fog: window.__island.fogDensity(),
      sun: window.__island.sunlight(),
      drops: window.__island.raindrops(),
      source: window.__island.weatherSource(),
    }));

    if (dry.source !== 'live') throw new Error('the clear run did not go live');
    if (dry.drops !== 0) throw new Error(`${dry.drops} drops are falling on a clear day`);
    // THE REGRESSION THIS EXISTS FOR: fog used to be a fixed 7.5e-6 in
    // all weather, which is 2.3 km of sight — permanent haze standing in
    // for a streaming hider. Clear weather must now beat that.
    if (dry.fog >= 0.0000075) {
      throw new Error(`clear weather still fogs at ${dry.fog.toExponential(2)}`);
    }
    const sight = Math.sqrt(-Math.log(0.05)) / dry.fog / 100;
    if (sight < 20000) {
      throw new Error(`a clear day only shows ${Math.round(sight)} m`);
    }
    if (dry.sun < 1.8) throw new Error(`the sun is only ${dry.sun} on a clear day`);

    await page.screenshot({ path: 'probe-weather-clear.png' });
    if (errors.length) throw new Error(`clear run: ${errors[0]}`);
    notes.push(`clear: ${Math.round(sight / 1000)} km of sight, no rain, sun ${dry.sun.toFixed(2)}`);
    await page.close();
  }

  // ── 3. The network refused ────────────────────────────────────────
  {
    const { page, errors } = await play(async (route) => { await route.abort(); });
    await page.click('[data-ui="spawn-here"]');
    await page.waitForFunction(() => Boolean(window.__island), null, { timeout: 120000 });
    await simulate(page, 4, 'the offline run');

    const offline = await page.evaluate(() => {
      // The field still has to know the island, so ask it at both ends
      // of the real rain gradient.
      // Waiʻaleʻale and Kekaha, through the one geo transform.
      const summit = window.__island.weatherAt(497_186, -301_224);
      const lee = window.__island.weatherAt(-1_772_827, 826_631);
      return {
        source: window.__island.weatherSource(),
        fog: window.__island.fogDensity(),
        chip: Boolean(document.querySelector('[data-ui="weather-chip"]')),
        summitCloud: summit.cloud,
        leeCloud: lee.cloud,
      };
    });

    if (offline.source !== 'simulated') {
      throw new Error(`with no network the source is "${offline.source}"`);
    }
    // That the world is still turning is proved by asking it to turn
    // again, not by a threshold on a clock that started at this run.
    await simulate(page, 1, 'the world to keep turning with no weather');
    if (!offline.chip) throw new Error('the HUD lost its weather chip offline');
    if (!Number.isFinite(offline.fog) || offline.fog <= 0) {
      throw new Error(`fog went to ${offline.fog} offline`);
    }
    // ONE ISLAND, TWO WEATHERS. The whole point of the grid.
    if (!(offline.summitCloud > offline.leeCloud + 10)) {
      throw new Error(
        `the summit (${Math.round(offline.summitCloud)}%) is no cloudier than `
        + `the lee coast (${Math.round(offline.leeCloud)}%)`,
      );
    }

    // The browser logs its own line for a request that was refused, and
    // that line is the point of this run rather than a fault in it. What
    // must NOT appear is an unhandled rejection or a thrown error, and
    // those arrive as page errors, which are not filtered.
    const real = errors.filter((e) =>
      !/ERR_FAILED|ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(e));
    if (real.length) throw new Error(`offline run: ${real[0]}`);
    notes.push(
      `offline: playable on the simulated model, summit ${Math.round(offline.summitCloud)}% `
      + `vs lee ${Math.round(offline.leeCloud)}% cloud`,
    );
    await page.close();
  }

  console.log(`probe:weather OK — ${notes.join('; ')}`);
} catch (why) {
  console.error(`probe:weather FAILED — ${why.message}`);
  if (notes.length) console.error(`  got as far as: ${notes.join('; ')}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
