/**
 * THE ISLAND'S WEATHER, STUBBED FOR A PROBE.
 *
 * The world's first act is to ask Open-Meteo what Kauaʻi's sky is doing
 * (Phase 5, `assets/openMeteo.ts`). A probe runs where there is no way
 * out to the internet, and a request that cannot leave is a resource
 * error in the console — which every probe here rightly counts as a
 * failure, because on a phone a console error is a bug. So a probe
 * answers the request itself: this routes the endpoint to a canned
 * reply for exactly the places asked for, in Open-Meteo's own shape, so
 * the LIVE path is what runs — the provider parses it, the field
 * interpolates it, the HUD says `live` — and nothing leaves the machine.
 *
 * A module, not a command: every probe that opens the world calls
 * `stubWeather(page)` once its page exists. Listed under Manual-only in
 * scripts/MANUAL.md for that reason, like probePng.mjs.
 *
 * The default reply is a trade-wind afternoon (the provider's TYPICAL
 * numbers); a probe that wants rain passes its own `current`.
 */
export const OPEN_METEO_GLOB = 'https://api.open-meteo.com/**';

/** What one place answers with, in Open-Meteo's `current` field names. */
export const FAIR_CURRENT = Object.freeze({
  temperature_2m: 25,
  relative_humidity_2m: 74,
  precipitation: 0,
  rain: 0,
  showers: 0,
  cloud_cover: 45,
  wind_speed_10m: 20,
  wind_direction_10m: 65,
  wind_gusts_10m: 30,
  weather_code: 2,
});

/**
 * Route Open-Meteo to a canned reply on this page. `current` overrides
 * the fair defaults for every place; `visibilityM` is the hourly row.
 */
export async function stubWeather(page, options = {}) {
  const current = { ...FAIR_CURRENT, ...(options.current ?? {}) };
  const visibility = options.visibilityM ?? 24_000;
  await page.route(OPEN_METEO_GLOB, async (route) => {
    const url = new URL(route.request().url());
    const latitudes = (url.searchParams.get('latitude') ?? '').split(',').filter((s) => s.length > 0);
    const count = Math.max(1, latitudes.length);
    // Open-Meteo stamps its times zoneless in the zone asked for (UTC here).
    const now = new Date();
    const stamp = now.toISOString().slice(0, 16);
    const hour = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000);
    const times = [];
    const values = [];
    for (let i = -2; i <= 2; i += 1) {
      times.push(new Date(hour.getTime() + i * 3_600_000).toISOString().slice(0, 16));
      values.push(visibility);
    }
    const place = (i) => ({
      latitude: Number(latitudes[i] ?? 22),
      longitude: 0,
      current: { time: stamp, interval: 900, ...current },
      hourly: { time: times, visibility: values },
    });
    const body = count === 1 ? place(0) : Array.from({ length: count }, (_, i) => place(i));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}
