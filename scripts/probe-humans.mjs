/**
 * LOOK AT JACK AND SARAH — a turntable of the baked models, lit the way
 * the TOMBS laboratory will light them, so their materials can be judged
 * from a picture rather than from a table of numbers.
 *
 *     npm run probe:humans
 *
 * Writes `shots/humans-*.png` and prints the material each body arrived
 * with. It renders the models `bake:humans` produced, from
 * `public/models/`, through the game's own loader and the game's own
 * renderer settings — a preview that flattered them with different tone
 * mapping would be a preview of nothing.
 *
 * WHY IT EXISTS. Joshua, 2026-09-18: "Can you do a render screenshot of
 * Jack and Sarah and see how glossy the clothes and body looks? I know we
 * had to do something with BE to help with it before continuing?"
 *
 * WHAT IT FOUND, and what `bake:humans` now does about it: both masters
 * carry ONE `BakedMaterial` over the whole body whose roughness map is
 * very nearly a single number — 0.549 on average, 97% of it between 0.4
 * and 0.7, none above 0.8. Cloth belongs at 0.85-0.95 and skin at
 * 0.6-0.75, so one value for both puts the same broad highlight on a
 * cotton top as on a forearm, and on screen that reads as latex. The
 * bake lifts it (`TARGET_ROUGHNESS`), so shot 4 is the SHIPPED body and
 * needs no override.
 *
 * Shots 5 and 6 still force a flat roughness over the top, because the
 * ladder is what the number was chosen from and a choice nobody can
 * re-run is a choice nobody can revisit.
 *
 * ONE TRAP, worth the line: `roughness` is a FACTOR three MULTIPLIES by
 * the map. Raising it over a 0.55 map cannot make anything rougher —
 * 0.9 x 0.549 is 0.494, which is glossier, which is backwards. The
 * comparison takes the map off and lets the factor stand alone.
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
const VIEWPORT = { width: 1200, height: 700 };
/** The page is written beside the app so the dev server serves it, and removed again. */
const HTML_NAME = 'probe-humans.html';
const HTML = path.join(ROOT, HTML_NAME);

const log = (m) => console.log(`[probe:humans] ${m}`);

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
 * The page. It imports three from the built bundle's own copy so the
 * preview is the renderer the game ships, not another one that happens to
 * be installed.
 */
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;background:#15171c;overflow:hidden}canvas{display:block}
</style></head><body><script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(${VIEWPORT.width}, ${VIEWPORT.height});
// The game's own output settings.
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x15171c);
// A laboratory at night: a key over the consoles, a cool fill, and a room
// environment so the metallic-roughness map has something to reflect —
// without one, a gloss problem cannot be seen at all.
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.35;
const key = new THREE.DirectionalLight(0xfff3e0, 2.2); key.position.set(2, 4, 3); scene.add(key);
const fill = new THREE.DirectionalLight(0x8fb4ff, 0.6); fill.position.set(-3, 2, -2); scene.add(fill);
scene.add(new THREE.AmbientLight(0xffffff, 0.15));

const camera = new THREE.PerspectiveCamera(35, ${VIEWPORT.width} / ${VIEWPORT.height}, 0.01, 100);
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

const report = [];
window.__ready = false;
(async () => {
  let x = -0.55;
  for (const name of ['jack', 'sarah']) {
    const gltf = await loader.loadAsync('/models/' + name + '.glb');
    const root = gltf.scene;
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.frustumCulled = false;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m.isMeshStandardMaterial) continue;
        report.push({ who: name, mat: m.name, rough: m.roughness, metal: m.metalness,
          hasMR: !!m.metalnessMap, hasNormal: !!m.normalMap, hasMap: !!m.map });
      }
    });
    root.position.set(x, 0, 0);
    scene.add(root);
    window['__' + name] = root;
    x += 1.1;
  }
  // Frame both bodies: they are 1.70 m tall and stand on the origin plane.
  camera.position.set(0, 1.1, 3.2);
  camera.lookAt(0, 0.95, 0);
  window.__report = report;
  window.__ready = true;
})();

window.__render = () => { renderer.render(scene, camera); };
// THE COMPARISON. "roughness" is a FACTOR three MULTIPLIES by the map's
// green channel, so raising it cannot make anything rougher than the map
// already is — setting 0.9 over a 0.549 map gives 0.494, which is
// glossier, which is the opposite of the question. So the map is taken
// off and the factor stands alone. That is also the shape of the real
// fix: the map carries no cloth-vs-skin information to preserve (97% of
// it lies between 0.4 and 0.7 and none of it is above 0.8), so there is
// nothing lost by replacing it with one honest number.
window.__setRoughness = (v) => {
  scene.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m.isMeshStandardMaterial) continue;
      m.roughnessMap = null;
      m.roughness = v;
      m.needsUpdate = true;
    }
  });
};
window.__frame = (who, y, dist) => {
  const t = window['__' + who];
  camera.position.set(t.position.x, y, dist);
  camera.lookAt(t.position.x, y, 0);
};
<\/script></body></html>`;

async function main() {
  if (!existsSync(SHOTS)) mkdirSync(SHOTS, { recursive: true });
  let server; let browser;
  try {
    // THE DEV SERVER, not `preview`. This page imports `three` by name and
    // loads the models from `public/` — dev resolves both, and a preview
    // of `dist/` has neither.
    writeFileSync(HTML, PAGE);
    server = await createServer({ root: ROOT, server: { host: '127.0.0.1', port: 4183, strictPort: false, open: false }, logLevel: 'error' });
    await server.listen();
    const url = server.resolvedUrls?.local?.[0];
    if (!url) throw new Error('vite dev reported no URL');
    browser = await chromium.launch({ executablePath: chromiumPath(), args: CHROMIUM_ARGS });
    const page = await browser.newPage({ viewport: VIEWPORT });
    page.on('console', (m) => { if (m.type() === 'error') log(`page error: ${m.text()}`); });
    page.on('pageerror', (e) => log(`page threw: ${e.message}`));
    await page.goto(`${url}${HTML_NAME}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 180_000 });

    const report = await page.evaluate(() => window.__report);
    for (const r of report) {
      log(`${r.who}: material "${r.mat}" roughness ${r.rough} metalness ${r.metal}` +
        ` — maps: ${[r.hasMap && 'colour', r.hasNormal && 'normal', r.hasMR && 'metal-rough'].filter(Boolean).join(', ')}`);
    }

    const shot = async (file, note) => {
      await page.evaluate(() => window.__render());
      await page.screenshot({ path: path.join(SHOTS, file) });
      log(`saved shots/${file}${note ? ` — ${note}` : ''}`);
    };

    await shot('humans-1-pair.png', 'both, as baked');
    await page.evaluate(() => window.__frame('jack', 1.5, 1.0));
    await shot('humans-2-jack-face.png', 'Jack close, as baked');
    await page.evaluate(() => window.__frame('sarah', 1.5, 1.0));
    await shot('humans-3-sarah-face.png', 'Sarah close, as baked');
    // THE LADDER, on the body the question was about: Sarah's top is the
    // shiniest thing either of them wears.
    await page.evaluate(() => window.__frame('sarah', 1.25, 1.1));
    await shot('humans-4-sarah-rough-asbaked.png', 'Sarah torso, AS SHIPPED (bake lifts roughness to 0.80)');
    for (const r of [0.7, 0.8, 0.9]) {
      await page.evaluate((v) => window.__setRoughness(v), r);
      await shot(`humans-5-sarah-rough${String(r).replace('.', '')}.png`, `Sarah torso, roughness ${r.toFixed(2)} flat`);
    }
    await page.evaluate(() => window.__frame('jack', 1.25, 1.1));
    await shot('humans-6-jack-rough090.png', 'Jack torso, roughness 0.90 flat');
    log('PASS: both models loaded, rendered and were photographed');
  } finally {
    await browser?.close();
    await server?.close();
    rmSync(HTML, { force: true });
  }
}

await main();
