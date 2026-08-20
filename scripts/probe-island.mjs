/**
 * probe:island — boots the island lab headless, walks the ant, swings
 * the look pad, and fails on console/page errors, on her standing off
 * the island, or on the camera pad not moving the view.
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
  const page = await browser.newPage({ viewport: { width: 932, height: 430 } });
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
  }));
  const moved = Math.hypot(after.where[0] - start.where[0], after.where[2] - start.where[2]);
  if (moved < 1) throw new Error(`she barely moved: ${moved.toFixed(2)} units`);
  if (after.ground <= 0) throw new Error('she walked off into the sea');

  // Swing the look pad with the keyboard. Compare camera positions
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

  await page.screenshot({ path: 'probe-island.png' });
  if (errors.length) throw new Error(`page errors:\n${errors.join('\n')}`);

  console.log(
    `probe:island OK — spawned ${start.ground.toFixed(1)} units above the sea, `
    + `walked ${moved.toFixed(1)} units, look pad swings the view\n`
    + `  ${start.triangles.toLocaleString()} triangles in ${start.drawCalls} draw calls`,
  );
} finally {
  await browser.close();
}
