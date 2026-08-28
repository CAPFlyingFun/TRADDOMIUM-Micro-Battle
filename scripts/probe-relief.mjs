/**
 * THE MICRO-RELIEF, A/B'd. One camera, one fix, one sun — and the only
 * thing that moves between frames is how hard the derived normal is
 * allowed to bend the light. bump 0 is the control: the colour work,
 * the tile scale and the detail radius are all still there, and the
 * ONLY thing missing is the third dimension.
 *
 * It reports numbers as well as frames, because "it looks different"
 * is not evidence that a normal map is being lit — a changed screenshot
 * only says something changed.
 */
import { chromium } from 'playwright';
import { readPng } from './readPng.mjs';

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1000, height: 500 } });
await page.route('**://api.open-meteo.com/**', (r) => r.abort());
await page.goto('http://localhost:4225/?scene=island', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Boolean(window.__island), null, { timeout: 240000 });
// The relief bakes only once the colour maps land, so give it the time.
await page.waitForTimeout(9000);
await page.evaluate(() => window.__island.setSetting('detailRange', 2));

// ON THE GROUND, not hovering. There is no pause in the debug API
// (`paused` is a getter), so the only genuinely still queen is a
// standing one — a hovering queen drifts down between frames and then
// the difference between shots is her altitude, not the relief.
const AGL = Number(process.env.AGL ?? 0);
const fix = `21.86200000 -159.47834411 ${((878 + AGL) / 100).toFixed(2)}m 000.0° -32.0° ×1.00`;

/** Mean absolute Laplacian of luminance — how much fine structure is lit. */
function detail({ data, width, height }) {
  const lum = (i) => 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  let sum = 0;
  let n = 0;
  // Ground only: the lower half of frame, away from the HUD rails.
  for (let y = Math.floor(height * 0.55); y < height - 1; y++) {
    for (let x = Math.floor(width * 0.2); x < width * 0.8; x++) {
      const i = (y * width + x) * 4;
      sum += Math.abs(4 * lum(i) - lum(i - 4) - lum(i + 4)
        - lum(i - width * 4) - lum(i + width * 4));
      n++;
    }
  }
  return sum / n;
}

function difference(a, b) {
  const lum = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  let sum = 0;
  let n = 0;
  for (let y = Math.floor(a.height * 0.55); y < a.height; y++) {
    for (let x = Math.floor(a.width * 0.2); x < a.width * 0.8; x++) {
      const i = (y * a.width + x) * 4;
      sum += Math.abs(lum(a.data, i) - lum(b.data, i));
      n++;
    }
  }
  return sum / n;
}

// PUT HER SOMEWHERE AND STOP THE WORLD. The first attempt at this
// re-flew her to the fix between every frame and she was airborne and
// drifting, so the three shots were three different views and the
// numbers compared nothing. Freeze the sim once, then the ONLY thing
// that changes between frames is the uniform under test.
await page.evaluate((f) => window.__island.goTo(f), fix);
// WAIT FOR HER TO ACTUALLY STOP. Pausing a queen who is still falling
// freezes a different frame each time, and then the difference between
// shots is her altitude rather than the uniform under test — which is
// exactly how the first two runs of this probe lied.
const still = async () => {
  // Her altitude AND the camera's position. The camera eases for
  // several seconds after a teleport, so a queen who has landed can
  // still be filmed from a moving lens — which is precisely how the
  // previous run compared two different views and called them equal.
  let last = '';
  for (let tries = 0; tries < 60; tries++) {
    await page.waitForTimeout(500);
    const now = await page.evaluate(() => {
      const c = window.__island.cameraAt().map((v) => Math.round(v));
      return `${c.join(',')}|${Math.round(window.__island.column().clearance)}`;
    });
    if (now === last) return now;
    last = now;
  }
  return last;
};
const rest = await still();
console.log(`still at camera/agl ${rest}\n`);

const shots = {};
const seen = {};
for (const bump of [0, 1, 2]) {
  await page.evaluate((b) => window.__island.relief(b), bump);
  await page.waitForTimeout(900);
  const path = `/tmp/relief-bump${bump}-agl${AGL}.png`;
  await page.screenshot({ path, timeout: 120000, animations: 'disabled' });
  shots[bump] = readPng(path);
  const state = await page.evaluate(() => {
    const c = window.__island.column();
    return {
      agl: Math.round(c.clearance), msl: Math.round(c.msl),
      tris: window.__island.triangles(), calls: window.__island.drawCalls(),
    };
  });
  seen[bump] = await still();
  console.log(`bump ${bump}  lit detail ${detail(shots[bump]).toFixed(3)}`
    + `  (agl ${state.agl} msl ${state.msl} tris ${state.tris} calls ${state.calls})`);
}
const poses = Object.values(seen);
if (new Set(poses).size !== 1) {
  console.log('\nUNCONTROLLED: the camera moved between frames —');
  for (const [bump, pose] of Object.entries(seen)) console.log(`   bump ${bump}: ${pose}`);
  console.log('   the difference below is the view as much as the relief. Do not read it.');
} else {
  console.log(`\nCONTROLLED: one camera, ${poses[0]}, for all three frames.`);
}
console.log(`change vs control:  bump 1 ${difference(shots[1], shots[0]).toFixed(3)}`
  + `   bump 2 ${difference(shots[2], shots[0]).toFixed(3)}  mean |ΔL| per pixel`);
await browser.close();
