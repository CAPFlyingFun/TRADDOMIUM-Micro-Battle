/**
 * LOOK INSIDE THE TOMBS LABORATORY — the building `world/tombs/plan.ts`
 * describes, drawn by `tombs/LabView.ts`, photographed from the places a
 * person would stand in it.
 *
 *     npm run probe:tombs
 *
 * Writes `shots/tombs-*.png` and prints what the building cost: slabs,
 * pillars, rings, lamps, real lights, draw calls, and the triangles and
 * calls the renderer actually issued for each shot.
 *
 * WHY A STANDALONE PROBE RATHER THAN THE GAME. The world scene loads the
 * survey, the sea, the weather and the ecology before it draws anything,
 * and the headless renderer runs at about a frame and a half a second
 * (CLAUDE.md: "use the smallest thing that answers the question"). This
 * probe answers ONE question — does the building look like a laboratory
 * and what does it cost — and answers it in seconds. The question of
 * whether the building is in the right place ON THE ISLAND is a
 * different one and belongs to the scene's own probe.
 *
 * It renders the SHIPPED modules through the game's own renderer
 * settings. A preview with different tone mapping would be a preview of
 * nothing.
 *
 * THE LEVER IS PHOTOGRAPHED TWICE. Chapter 2: "He pulled the physical
 * shutdown lever, and the room went dark… The emergency lights switched
 * on." That is a state the building has, not a colour grade, so the
 * control room is shot under both sets from the same camera — which is
 * the only way to see that the second is a twelfth of the first rather
 * than a filter over it.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SHOTS = path.join(ROOT, 'shots');
const CHROMIUM_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'];
/** Joshua's phone in landscape, the viewport every visual decision is measured at. */
const VIEWPORT = { width: 932, height: 430 };
const HTML_NAME = 'probe-tombs.html';
const HTML = path.join(ROOT, HTML_NAME);

const log = (m) => console.log(`[probe:tombs] ${m}`);

function chromiumPath() {
  const override = process.env.PLAYWRIGHT_CHROMIUM;
  if (override && existsSync(override)) return override;
  const pinned = chromium.executablePath();
  if (existsSync(pinned)) return undefined;
  const browsers = process.env.PLAYWRIGHT_BROWSERS_PATH;
  const linked = browsers ? path.join(browsers, 'chromium') : null;
  if (linked && existsSync(linked)) return linked;
  throw new Error('no Chromium found; this probe never runs `playwright install`');
}

/**
 * Where the camera stands, in LOCAL METRES — the plan's own frame, so a
 * shot can be checked against the floor plan without arithmetic. Eye
 * height 1.65 m: a person, since a person is who the building is for.
 */
const EYE = 1.65;
const SHOTS_WANTED = [
  { id: '1-lab', room: 'laboratory', at: [-6.0, EYE, 14.6], look: [-6.0, 1.2, 10.2], note: "Jack's laboratory from the spawn: his workstation, Sarah's, the far end" },
  { id: '2-lab-door', room: 'laboratory', at: [-8.0, EYE, 11.5], look: [-1.0, 1.4, 10.0], note: 'the sliding door and the intercom Jack reaches for' },
  { id: '3-corridor', room: 'corridor', at: [-9.0, EYE, 7.7], look: [6.0, 1.5, 7.7], note: 'the corridor they hurry along' },
  { id: '4-control', room: 'control', at: [-6.0, EYE, 5.2], look: [-6.0, 1.6, -0.4], note: 'the main control room, both consoles, the reinforced port' },
  { id: '5-control-dark', room: 'control', at: [-6.0, EYE, 5.2], look: [-6.0, 1.6, -0.4], note: 'the same camera after the lever: emergency power', emergency: true },
  { id: '6-lever', room: 'control', at: [-11.0, EYE, 3.0], look: [-13.0, 1.3, 3.0], note: 'the emergency panel and the physical shutdown lever' },
  { id: '7-array', room: 'chamber', at: [-6.0, 2.2, -1.2], look: [-6.0, 2.6, -5.2], note: 'the array: five articulated rings around the central platform' },
  { id: '8-utility', room: 'utility', at: [7.2, EYE, 4.6], look: [7.2, 1.6, -6.0], note: 'the plant: capacitors, the reactor housing, the grid feed' },
  { id: '9-outside', room: null, at: [4.0, 12.0, 34.0], look: [0.0, 2.0, 3.0], note: 'the building on its ground, from the south' },
];

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;background:#05070a;overflow:hidden}canvas{display:block}
</style></head><body><script type="module">
import * as THREE from 'three';
import { planLab } from '/src/world/tombs/index.ts';
import { LabView } from '/src/tombs/index.ts';

const M = 100; // world units per metre; the probe's cameras are written in metres

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(${VIEWPORT.width}, ${VIEWPORT.height});
renderer.setPixelRatio(1);
// The game's own output settings.
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, ${VIEWPORT.width} / ${VIEWPORT.height}, 2, 200_000);

const layout = planLab();
// groundUnits 0 so the plan's own metres are the scene's own metres x 100
// and a camera written from the floor plan lands where the floor plan says.
const view = new LabView({ groundUnits: 0, ambient: true, detail: 'medium' });
view.build(layout);
scene.add(view.group);
scene.fog = new THREE.Fog(view.lighting.fog, 6 * M, 46 * M);
scene.background = new THREE.Color(view.lighting.fog);

window.__stats = () => view.stats;
window.__lighting = (mode) => {
  view.setLighting(mode);
  scene.fog.color.setHex(view.lighting.fog);
  scene.background.setHex(view.lighting.fog);
};
window.__place = (ax, ay, az, lx, ly, lz) => {
  camera.position.set(ax * M, ay * M, az * M);
  camera.lookAt(lx * M, ly * M, lz * M);
};
window.__render = () => {
  renderer.info.reset();
  renderer.render(scene, camera);
  return { calls: renderer.info.render.calls, tris: renderer.info.render.triangles };
};
window.__ready = true;
<\/script></body></html>`;

let server;
let browser;
try {
  mkdirSync(SHOTS, { recursive: true });
  writeFileSync(HTML, PAGE);
  server = await createServer({
    root: ROOT,
    server: { host: '127.0.0.1', port: 4188, strictPort: false },
    logLevel: 'error',
  });
  await server.listen();
  const url = server.resolvedUrls.local[0];
  browser = await chromium.launch({ executablePath: chromiumPath(), args: CHROMIUM_ARGS });
  const page = await browser.newPage({ viewport: VIEWPORT });
  page.on('pageerror', (e) => console.log(`[probe:tombs] page threw: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') console.log(`[probe:tombs] console: ${m.text()}`); });
  await page.goto(`${url}${HTML_NAME}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 180_000 });

  const stats = await page.evaluate(() => window.__stats());
  log(`built: ${stats.slabs} slabs, ${stats.pillars} pillars, ${stats.rings} rings, ${stats.lamps} lamps`);
  log(`lights: ${stats.realLights} real, ${stats.roomsLit}/${stats.roomsWithLamps} rooms lit — ${stats.drawCalls} draw calls`);

  let mode = 'normal';
  for (const shot of SHOTS_WANTED) {
    const want = shot.emergency === true ? 'emergency' : 'normal';
    if (want !== mode) {
      await page.evaluate((m) => window.__lighting(m), want);
      mode = want;
    }
    await page.evaluate(([a, l]) => window.__place(a[0], a[1], a[2], l[0], l[1], l[2]), [shot.at, shot.look]);
    const drawn = await page.evaluate(() => window.__render());
    const file = `tombs-${shot.id}.png`;
    await page.screenshot({ path: path.join(SHOTS, file) });
    log(`${file}  ${drawn.calls} calls, ${drawn.tris} tris — ${shot.note}`);
  }
  if (mode !== 'normal') await page.evaluate(() => window.__lighting('normal'));
  log(`${SHOTS_WANTED.length} shots in shots/`);
} finally {
  await browser?.close();
  await server?.close();
  rmSync(HTML, { force: true });
}

// ---------------------------------------------------------------------------
// The door a player actually opens
// ---------------------------------------------------------------------------

/**
 * THE SECOND HALF, and the one that can fail for a reason the first cannot:
 * the shots above prove the BUILDING draws, not that anybody can reach it.
 * A module that renders beautifully and is registered nowhere is a module
 * nobody can see, which is exactly what the laboratory was until it was wired
 * into the hub. So this half boots the BUILT app at the bare URL and walks the
 * route Joshua walks — menu, EDITORS, the hub's OPEN on `tool:lab.tombs` —
 * pressing the same `data-action`s his thumbs press and reading the same
 * `data-field`s he reads. No `?scene=` shortcut: a probe that skips a step a
 * player cannot skip is measuring a route nobody plays.
 */
import { preview } from 'vite';

const TOOL = 'lab.tombs';
const HUD = 'tombs-lab-hud';
const APP_PORT = 4193;

async function walkTheApp() {
  log('--- the route a player takes ---');
  const server = await preview({
    root: ROOT,
    preview: { host: '127.0.0.1', port: APP_PORT, strictPort: false, open: false },
    logLevel: 'error',
  });
  const url = server.resolvedUrls.local[0];
  const browser = await chromium.launch({ executablePath: chromiumPath(), args: CHROMIUM_ARGS });
  try {
    const page = await browser.newPage({ viewport: VIEWPORT });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForSelector('[data-action="new-game"]', { timeout: 120_000 });
    log('bare URL -> menu');
    await page.click('[data-action="editors"]', { timeout: 60_000 });
    await page.waitForSelector(`[data-action="tool:${TOOL}"]`, { state: 'attached', timeout: 60_000 });
    log(`EDITORS -> the hub lists "${TOOL}"`);
    await page.click(`[data-action="tool:${TOOL}"]`, { timeout: 60_000 });
    await page.waitForSelector(`[data-role="${HUD}"]`, { timeout: 180_000 });
    log('OPEN -> the laboratory is up');

    const read = async () => page.evaluate(() => {
      const out = {};
      for (const el of document.querySelectorAll('[data-field]')) out[el.getAttribute('data-field')] = el.textContent.trim();
      return out;
    });
    await page.waitForTimeout(1500);
    let hud = await read();
    for (const [k, v] of Object.entries(hud)) log(`  ${k}: ${v}`);
    await page.screenshot({ path: path.join(SHOTS, 'tombs-app-1-arrive.png') });

    // CHAPTER 2 ON A BUTTON: "He pulled the physical shutdown lever, and the
    // room went dark… The emergency lights switched on."
    await page.click('[data-action="tombs:lever"]', { timeout: 60_000 });
    await page.waitForTimeout(1200);
    hud = await read();
    log(`  after the lever -> ${hud['tombs-lighting'] ?? '(no lighting line)'}`);
    await page.screenshot({ path: path.join(SHOTS, 'tombs-app-2-lever.png') });

    await page.click('[data-action="tombs:teleport:chamber"]', { timeout: 60_000 });
    await page.click('[data-action="tombs:lever"]', { timeout: 60_000 });
    await page.click('[data-action="tombs:array"]', { timeout: 60_000 });
    await page.waitForTimeout(1500);
    hud = await read();
    log(`  in the chamber -> room ${hud['tombs-room'] ?? '?'}, array ${hud['tombs-array'] ?? '?'}`);
    await page.screenshot({ path: path.join(SHOTS, 'tombs-app-3-array.png') });

    if (errors.length) {
      log(`PAGE ERRORS: ${errors.slice(0, 3).join(' | ')}`);
      process.exitCode = 1;
    } else {
      log('no page errors');
    }
  } finally {
    await browser.close();
    await server.close();
  }
}

await walkTheApp();
