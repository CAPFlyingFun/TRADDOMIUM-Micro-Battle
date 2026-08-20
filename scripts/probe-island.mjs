/**
 * probe:island — boots the island lab headless, walks the ant and
 * swings the camera. Fails on console/page errors, on her standing off
 * the island, or on the camera not moving or not settling back.
 *
 * Writes probe-island.png for eyes-on checks. Expects a server on
 * PROBE_URL (default vite preview :4173).
 */
import { chromium } from 'playwright';

const url = process.env.PROBE_URL ?? 'http://localhost:4173/?scene=island';
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader'],
});

try {
  const page = await browser.newPage({
    viewport: { width: 932, height: 430 },
    hasTouch: true,
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto(url, { waitUntil: 'networkidle' });
  // The island is 2 MB of elevation and 64 section meshes to build.
  await page.waitForFunction(() => window.__island !== undefined, { timeout: 60000 });
  await page.waitForTimeout(1200);

  const start = await page.evaluate(() => ({
    where: window.__island.where(),
    ground: window.__island.groundUnderfoot(),
    triangles: window.__island.triangles(),
    drawCalls: window.__island.drawCalls(),
  }));
  if (start.ground <= 0) {
    throw new Error(`she spawned in the sea: ground ${start.ground.toFixed(2)}`);
  }

  // The telegraph. W steps it up; she must then travel with nothing
  // held, which is the whole point of a setting rather than a stick.
  await page.keyboard.press('KeyW');
  await page.keyboard.press('KeyW');
  await page.waitForTimeout(400);
  const set = await page.evaluate(() => window.__island.notch());
  if (set !== 'walk') throw new Error(`two steps up from stop gave ${set}, not walk`);

  const parked = await page.evaluate(() => window.__island.where());
  await page.waitForTimeout(1400);
  const after = await page.evaluate(() => ({
    where: window.__island.where(),
    ground: window.__island.groundUnderfoot(),
  }));
  const moved = Math.hypot(after.where[0] - parked[0], after.where[2] - parked[2]);
  if (moved < 2) throw new Error(`the telegraph did not carry her: ${moved.toFixed(2)} units`);
  if (after.ground <= 0) throw new Error('she walked off into the sea');

  // Down through stop into astern, from ahead, without a mode change.
  await page.evaluate(() => window.__island.setNotch('crawl'));
  for (let i = 0; i < 2; i++) await page.keyboard.press('KeyS');
  await page.waitForTimeout(400);
  const astern = await page.evaluate(() => window.__island.notch());
  if (astern !== 'backCrawl') {
    throw new Error(`two steps down from crawl gave ${astern}, not backCrawl`);
  }
  const beforeBack = await page.evaluate(() => window.__island.where());
  await page.waitForTimeout(900);
  const backed = await page.evaluate(() => window.__island.where());
  if (Math.hypot(backed[0] - beforeBack[0], backed[2] - beforeBack[2]) < 0.5) {
    throw new Error('astern did not move her');
  }

  // Sprinting must cost stamina and drop her a notch when it runs dry.
  await page.evaluate(() => window.__island.setNotch('sprint'));
  await page.waitForTimeout(600);
  const mid = await page.evaluate(() => window.__island.stamina());
  if (mid >= 1) throw new Error('sprinting cost no stamina');
  await page.waitForTimeout(9000);
  const spentNotch = await page.evaluate(() => window.__island.notch());
  if (spentNotch === 'sprint') throw new Error('an exhausted sprint never eased off');

  // And it must come back on its own — a bar that only falls is a trap.
  await page.evaluate(() => window.__island.setNotch('stop'));
  const dry = await page.evaluate(() => window.__island.stamina());
  await page.waitForTimeout(3000);
  const recovered = await page.evaluate(() => window.__island.stamina());
  if (recovered <= dry) throw new Error('stamina did not recover at rest');
  await page.evaluate(() => window.__island.setNotch('walk'));

  // Swing the camera with the keyboard. Compare camera positions
  // rather than pixels: the WebGL canvas has no preserved drawing
  // buffer, so toDataURL would read back blank every time and the
  // check would pass or fail for reasons that have nothing to do with
  // the camera.
  const orbit = () =>
    page.evaluate(() => {
      const c = window.__island.cameraAt();
      const a = window.__island.where();
      return Math.atan2(c[0] - a[0], c[2] - a[2]);
    });
  const restYaw = await orbit();
  await page.keyboard.down('KeyE');
  await page.waitForTimeout(900);
  const swungYaw = await orbit();
  await page.keyboard.up('KeyE');
  const swing = Math.abs(Math.atan2(
    Math.sin(swungYaw - restYaw), Math.cos(swungYaw - restYaw),
  ));
  if (swing < 0.2) {
    throw new Error(`the look pad barely moved the camera: ${swing.toFixed(3)} rad`);
  }

  // And it must come home on its own once released.
  await page.waitForTimeout(2200);
  const homeYaw = await orbit();
  const strayed = Math.abs(Math.atan2(
    Math.sin(homeYaw - restYaw), Math.cos(homeYaw - restYaw),
  ));
  if (strayed > 0.15) {
    throw new Error(`the camera did not settle back behind her: ${strayed.toFixed(3)} rad`);
  }

  // Rotation. Turning a phone fires resize before the viewport has
  // settled, so a handler that trusts the event reads the old size and
  // strands the canvas at the wrong dimensions — which is what going
  // landscape -> portrait -> landscape used to do.
  const fitted = async (label) => {
    await page.waitForTimeout(700);
    const box = await page.evaluate(() => {
      const c = document.querySelector('canvas');
      return { cw: c.clientWidth, ch: c.clientHeight, vw: innerWidth, vh: innerHeight };
    });
    const slack = 2;
    if (Math.abs(box.cw - box.vw) > slack || Math.abs(box.ch - box.vh) > slack) {
      throw new Error(
        `canvas did not track the viewport in ${label}: `
        + `${box.cw}x${box.ch} against ${box.vw}x${box.vh}`,
      );
    }
    return box;
  };

  await page.setViewportSize({ width: 430, height: 932 });
  await fitted('portrait');
  const gated = await page.evaluate(
    () => [...document.querySelectorAll('[role="alertdialog"]')]
      .some((el) => getComputedStyle(el).display !== 'none'),
  );
  if (!gated) throw new Error('portrait did not ask the player to rotate');

  await page.setViewportSize({ width: 932, height: 430 });
  await fitted('back in landscape');
  const ungated = await page.evaluate(
    () => [...document.querySelectorAll('[role="alertdialog"]')]
      .every((el) => getComputedStyle(el).display === 'none'),
  );
  if (!ungated) throw new Error('the rotate prompt stayed up in landscape');

  // The case the observer exists for: the canvas host changes size
  // WITHOUT a trustworthy window resize event. On a phone that happens
  // because orientationchange fires before the viewport settles, so the
  // event carries the old numbers; here we reproduce the same shape by
  // shrinking the host directly, which fires no window event at all.
  await page.evaluate(() => {
    const app = document.getElementById('app');
    app.style.right = '200px';
    app.style.bottom = '100px';
  });
  await page.waitForTimeout(700);
  const squeezed = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    const app = document.getElementById('app');
    return {
      cw: c.clientWidth, ch: c.clientHeight,
      hw: app.clientWidth, hh: app.clientHeight,
    };
  });
  if (Math.abs(squeezed.cw - squeezed.hw) > 2 || Math.abs(squeezed.ch - squeezed.hh) > 2) {
    throw new Error(
      'canvas ignored a host resize that fired no window event: '
      + `${squeezed.cw}x${squeezed.ch} against ${squeezed.hw}x${squeezed.hh}`,
    );
  }
  await page.evaluate(() => {
    const app = document.getElementById('app');
    app.style.right = '';
    app.style.bottom = '';
  });
  await page.waitForTimeout(500);

  await page.screenshot({ path: 'probe-island.png' });
  if (errors.length) throw new Error(`page errors:\n${errors.join('\n')}`);

  console.log(
    `probe:island OK — spawned ${start.ground.toFixed(1)} units above the sea, `
    + `telegraph carried her ${moved.toFixed(1)} units and reversed, `
    + `sprint drained to ${mid.toFixed(2)} and eased off, stamina recovered, `
    + `camera swings and settles back, survives a rotation\n`
    + `  ${start.triangles.toLocaleString()} triangles in ${start.drawCalls} draw calls`,
  );
} finally {
  await browser.close();
}
