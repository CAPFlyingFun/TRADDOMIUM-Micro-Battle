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

  // Walk, and confirm she actually travelled.
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1800);
  await page.keyboard.up('KeyW');
  const after = await page.evaluate(() => ({
    where: window.__island.where(),
    ground: window.__island.groundUnderfoot(),
    gait: window.__island.gait(),
  }));
  const gait = after.gait;
  const moved = Math.hypot(after.where[0] - start.where[0], after.where[2] - start.where[2]);
  if (moved < 1) throw new Error(`she barely moved: ${moved.toFixed(2)} units`);
  if (after.ground <= 0) throw new Error('she walked off into the sea');

  // Auto-move: L stands in for the double-tap. She must keep going
  // with nothing touching the controls, and stop when toggled off.
  await page.keyboard.press('KeyL');
  await page.waitForTimeout(400);
  if (!(await page.evaluate(() => window.__island.autoMoving()))) {
    throw new Error('the auto-move toggle did not engage');
  }
  const parked = await page.evaluate(() => window.__island.where());
  await page.waitForTimeout(1400);
  const cruised = await page.evaluate(() => ({
    where: window.__island.where(),
    gait: window.__island.gait(),
  }));
  const coasted = Math.hypot(
    cruised.where[0] - parked[0], cruised.where[2] - parked[2],
  );
  if (coasted < 2) {
    throw new Error(`auto-move engaged but she stopped: ${coasted.toFixed(2)} units`);
  }
  // She must keep the gait she was travelling at, not fall to a crawl
  // the moment the stick recentres.
  if (cruised.gait === 'crawl') {
    throw new Error('auto-move dropped to a crawl once the stick recentred');
  }
  await page.keyboard.press('KeyL');
  await page.waitForTimeout(400);
  if (await page.evaluate(() => window.__island.autoMoving())) {
    throw new Error('the auto-move toggle did not disengage');
  }
  const stopped = await page.evaluate(() => window.__island.where());
  await page.waitForTimeout(700);
  const afterStop = await page.evaluate(() => window.__island.where());
  const drifted = Math.hypot(
    afterStop[0] - stopped[0], afterStop[2] - stopped[2],
  );
  if (drifted > 1) throw new Error(`she kept going after auto-move was off: ${drifted.toFixed(2)}`);

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
    + `walked ${moved.toFixed(1)} units at a ${gait}, `
    + `auto-move cruised ${coasted.toFixed(1)} at a ${cruised.gait} and stopped on demand, `
    + `camera swings and settles back, survives a rotation\n`
    + `  ${start.triangles.toLocaleString()} triangles in ${start.drawCalls} draw calls`,
  );
} finally {
  await browser.close();
}
