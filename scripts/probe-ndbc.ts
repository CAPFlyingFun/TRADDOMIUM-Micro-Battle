/**
 * CAN A BROWSER AT OUR ORIGIN FETCH THE BUOY?
 *
 * The one Stage F question no unit test can answer: whether a
 * cross-origin GET to NDBC from a page — not from node — is allowed.
 * A page, a real fetch, and whatever comes back reported verbatim.
 *
 * READ THE RESULT CAREFULLY. A browser refused by CORS and a browser
 * that could not reach the host at all BOTH reject with
 * "TypeError: Failed to fetch" — the spec deliberately gives a page no
 * way to tell them apart. So this proves the request is really made
 * and the reason really captured; whether NDBC ALLOWS it can only be
 * settled from an origin with a clear path to NDBC.
 *
 *   npx vite-node scripts/probe-ndbc.ts     (needs a preview server)
 */
import { chromium } from 'playwright';
import { ndbcFeedUrl } from '../src/weather/ndbcFeed.ts';

const URL_ = 'https://www.ndbc.noaa.gov/data/latest_obs/51208.rss';
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
await page.goto('http://localhost:4225/', { waitUntil: 'domcontentloaded' });

const result = await page.evaluate(async (url) => {
  const started = performance.now();
  try {
    const reply = await fetch(url, { mode: 'cors' });
    const text = await reply.text();
    return {
      ok: reply.ok,
      status: reply.status,
      bytes: text.length,
      allowOrigin: reply.headers.get('access-control-allow-origin'),
      hasWaves: /Significant Wave Height/i.test(text),
      ms: Math.round(performance.now() - started),
    };
  } catch (err) {
    return {
      failed: true,
      name: err && err.name,
      message: err && err.message,
      ms: Math.round(performance.now() - started),
    };
  }
}, URL_);

console.log(`\norigin        ${await page.evaluate(() => location.origin)}`);
console.log(`url           ${URL_}`);
console.log(`\nRESULT        ${JSON.stringify(result, null, 2)}`);
console.log(`\n(feed url helper agrees: ${ndbcFeedUrl('51208')})`);
await browser.close();
