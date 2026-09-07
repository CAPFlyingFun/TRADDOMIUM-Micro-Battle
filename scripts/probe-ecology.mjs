/**
 * THE ISLAND'S ANIMALS, COUNTED: does the ecology pass put worms in the
 * forest and none in the sea, keep every species under its cap, say
 * plainly that the ground is not being edited, and stop when told to?
 *
 * Phase 7 (the ecology pass, 2026-09-07) adds four layers — `resources`,
 * `worms`, `aphids`, `flies` — and seven plant families, and Joshua
 * asked for "Performance World toggles per category ... and diagnostics
 * in dev tools, not the normal HUD". This probe reads those diagnostics
 * off the perf HUD at four real places — the Kekaha plain, a beach on
 * Hanalei Bay, three hundred metres out in the bay, and the Wailua
 * forest — and FAILS if the counts do not say what the island says:
 * nothing lives at sea, no worm lives in sand, a forest has all three
 * and something to eat, and no species is ever over its cap (a cap is a
 * maximum, never a quota). Then it switches each of the four layers off
 * and checks the line drops to nothing, which is what a toggle is for.
 *
 * WHAT IT EXPECTS OF THE SCENE (the contract, so a missing half fails by
 * name rather than by timeout):
 *
 *   - The perf HUD's `creatures()` hook is wired, so these lines exist:
 *       data-field="eco-worms"       `worms <n> of <cap>`
 *       data-field="eco-aphids"      `aphids <n> of <cap>`
 *       data-field="eco-flies"       `flies <n> of <cap>`
 *       data-field="eco-cost"        `eco <think>+<move>+<draw>ms`
 *       data-field="eco-resources"   `sites <n> wet <n>`, or `sites off`
 *       data-field="eco-ground"      `ground edits off`, or `ground edits <n>`
 *     and `data-field="veg-plants"` reads `plants <n>` once the objects
 *     readout carries the seven families' count. A line that exists but
 *     is EMPTY is a hook returning null: nothing has built a simulation.
 *   - The LAYERS column has `data-action="layer:<id>"` checkboxes for
 *     the four ids, built and ON when the world opens. Off, a species
 *     line reads `0 of <cap>` and the resources line reads `sites off`.
 *   - `?sky=clear&hour=12` hold the sky and the clock (read in
 *     `app/registerScenes.ts`), so the shot is stable AND the counts
 *     are: a worm surfaces at night and in rain, and a probe that ran
 *     at whatever hour it was would count a different island each time.
 *   - `?detail=high` holds the rung, so the caps are the high ones.
 *
 * THE SITES are the ones `probe-objects` stands at, so the plant and
 * creature counts can be read against the object counts that probe
 * prints for the same ground; the fourth is the one it does not have.
 * `+wz` is SOUTH (`world/dem.ts`), so three hundred metres offshore of
 * the north-shore beach is `z − 30 000`. The eye offshore stands three
 * metres over SEA LEVEL, not over the ground: the ground there is the
 * seabed, and the correction the land sites use would put the camera
 * under water.
 *
 * SWIFTSHADER, NOT A PHONE: a frame or two a second, so the run is
 * minutes long and the `eco` millisecond figures mean nothing here —
 * they are printed, not asserted. The COUNTS are what is measured.
 *
 * Usage:
 *
 *   npm run build
 *   npm run probe:ecology
 *
 * Shots land in `shots/ecology-<site>.png` and `shots/ecology-off.png`.
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { preview } from 'vite';
import { stubWeather } from './probeWeather.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST_INDEX = path.join(ROOT, 'dist', 'index.html');
const SHOTS = path.join(ROOT, 'shots');

const VIEWPORT = { width: 932, height: 430 };
const CHROMIUM_ARGS = ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'];
const TIMEOUT = { menu: 60_000, world: 300_000 };

/** The same three literals `probe-shot.mjs` carries, pinned by tests/probeShotConstants.test.ts. */
const SAVE_KEY = 'traddomium.v1.solo-save';
const SAVE_VERSION = 2;
const MAP_ID = 'perf-empty';

/** Frames to let the FRAME readout fill after arriving, and the most to wait for the bubble's queue to drain. */
const SETTLE_FRAMES = 30;
const DRAIN_FRAMES = 240;
/** The most WALL-CLOCK time to wait for the creature counts to stop moving at a site, and how often to look. */
const SETTLE_MS = 60_000;
const POLL_FRAMES = 10;
/** Consecutive identical reads that count as "settled". */
const STABLE_READS = 3;
/** The most to wait for a toggled-off layer to reach the line. */
const TOGGLE_MS = 30_000;
/**
 * How far above the TRUE ground the camera stands on land, and how far
 * off that it may be before the pose is corrected and the arrival
 * repeated — `probe-objects`' rule, for its reason: the site's `ground`
 * is the coarse survey's, and the streamed tiles put the real one
 * metres from it.
 */
const EYE_ABOVE_GROUND = 300;
const EYE_TOLERANCE = 60;

/** The rung and the sky held for the run. The caps asserted against are the ones the HUD prints, not these. */
const DETAIL = 'high';
const HELD = { sky: 'clear', hour: 12 };

/**
 * Four places. The forest goes LAST so the toggle checks can follow it
 * without another arrival: it is the one site where every count should
 * be above zero, so a drop to zero there means the toggle, not the
 * habitat.
 */
const SITES = [
  { name: 'grassland', x: -1_754_400, z: 738_400, ground: 16_839, facing: 40, want: 'grass', land: true },
  { name: 'beach', x: 413_600, z: -1_783_200, ground: 57, facing: 200, want: 'beach', land: true },
  // Three hundred metres north of the beach, in Hanalei Bay.
  { name: 'offshore', x: 413_600, z: -1_813_200, ground: 0, facing: 200, want: 'sea', land: false },
  { name: 'forest', x: 1_559_200, z: -2_400, ground: 12_501, facing: 300, want: 'fores', land: true },
];
const PITCH = -18;

/** The four layers, each with the line that answers for it and the word that line starts with. */
const LAYERS = [
  { id: 'worms', field: 'eco-worms', word: 'worms' },
  { id: 'aphids', field: 'eco-aphids', word: 'aphids' },
  { id: 'flies', field: 'eco-flies', word: 'flies' },
  { id: 'resources', field: 'eco-resources', word: null },
];

const FIELDS = ['veg-plants', 'eco-worms', 'eco-aphids', 'eco-flies', 'eco-cost', 'eco-resources', 'eco-ground'];
/** The lines a settled site holds still; `eco-cost` moves every refresh and is left out. */
const COUNT_FIELDS = FIELDS.filter((name) => name !== 'eco-cost');
const ECO_FIELDS = FIELDS.filter((name) => name.startsWith('eco-'));

let failures = 0;
const log = (message) => console.log(`[probe:ecology] ${message}`);
const fail = (message) => {
  failures += 1;
  console.error(`[probe:ecology] FAIL: ${message}`);
};

function yawForBearing(bearing) {
  const headingDeg = ((180 - bearing) % 360 + 360) % 360;
  return (headingDeg * Math.PI) / 180 - Math.PI;
}

function chromiumPath() {
  const override = process.env.PLAYWRIGHT_CHROMIUM;
  if (override) {
    if (existsSync(override)) return override;
    throw new Error(`PLAYWRIGHT_CHROMIUM=${override} does not exist`);
  }
  if (existsSync(chromium.executablePath())) return undefined;
  const browsers = process.env.PLAYWRIGHT_BROWSERS_PATH;
  const linked = browsers ? path.join(browsers, 'chromium') : null;
  if (linked && existsSync(linked)) return linked;
  throw new Error('no Chromium found; this probe never runs `playwright install`');
}

const runFrames = (page, count) => page.evaluate((n) => new Promise((done) => {
  let left = n;
  const step = () => {
    left -= 1;
    if (left <= 0) done();
    else requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}), count);

const uiText = (page) => page.evaluate(
  () => ((document.getElementById('ui') ?? document.body).innerText ?? '').replace(/\s+/g, ' '),
);

/** Every ecology `data-field` as its words: null for a line the HUD never built, '' for one it built and left empty. */
const readFields = (page) => page.evaluate((names) => {
  const out = {};
  for (const name of names) {
    const el = document.querySelector(`[data-field="${name}"]`);
    out[name] = el instanceof HTMLElement ? (el.textContent ?? '') : null;
  }
  return out;
}, FIELDS);

/** `12`, `12k`, `1.2M` back to a number — the HUD keeps its counts short. Null for anything else. */
function count(word) {
  const hit = /^(\d+(?:\.\d+)?)([kM])?$/.exec(word ?? '');
  if (hit === null) return null;
  const n = Number(hit[1]);
  return hit[2] === 'k' ? n * 1000 : hit[2] === 'M' ? n * 1_000_000 : n;
}

/** `worms 12 of 40` as a record, or null when the line is not in that shape. */
function parseSpecies(line, word) {
  const hit = new RegExp(`^${word} (\\d+) of (\\d+)$`).exec(line ?? '');
  return hit === null ? null : { resident: Number(hit[1]), cap: Number(hit[2]) };
}

/**
 * The seven lines as numbers and words. Each parse failure is reported
 * by NAME with the line as read, so a reworded line fails as "the line
 * reads X" and not as a count of nothing.
 */
function parseEcology(fields, where) {
  const out = { problems: [] };
  const plants = fields['veg-plants'];
  if (plants === '') out.plants = undefined;
  else {
    const hit = /^plants (\S+)$/.exec(plants ?? '');
    const n = hit === null ? null : count(hit[1]);
    if (n === null) out.problems.push(`${where}: the plants line reads "${plants}", which is not "plants <n>"`);
    out.plants = n ?? undefined;
  }
  for (const { field, word } of LAYERS) {
    if (word === null) continue;
    const s = parseSpecies(fields[field], word);
    if (s === null) out.problems.push(`${where}: ${field} reads "${fields[field]}", which is not "${word} <n> of <cap>"`);
    out[word] = s;
  }
  const cost = /^eco ([\d.]+)\+([\d.]+)\+([\d.]+)ms$/.exec(fields['eco-cost'] ?? '');
  if (cost === null) out.problems.push(`${where}: eco-cost reads "${fields['eco-cost']}", which is not "eco <think>+<move>+<draw>ms"`);
  out.cost = cost === null ? null : { thinkMs: Number(cost[1]), moveMs: Number(cost[2]), drawMs: Number(cost[3]) };
  const resources = fields['eco-resources'] ?? '';
  if (resources === 'sites off') out.resources = 'off';
  else {
    const hit = /^sites (\S+) wet (\S+)$/.exec(resources);
    const sites = hit === null ? null : count(hit[1]);
    const wet = hit === null ? null : count(hit[2]);
    if (sites === null || wet === null) out.problems.push(`${where}: eco-resources reads "${resources}", which is neither "sites <n> wet <n>" nor "sites off"`);
    out.resources = sites === null || wet === null ? null : { sites, wet };
  }
  const ground = /^ground edits (off|\S+)$/.exec(fields['eco-ground'] ?? '');
  if (ground === null) out.problems.push(`${where}: eco-ground reads "${fields['eco-ground']}", which is neither "ground edits off" nor "ground edits <n>"`);
  out.ground = ground === null ? null : ground[1] === 'off' ? 'off' : count(ground[1]);
  return out;
}

/** The habitat word the objects' cells line prints, or null when there is no such line. */
function habitatWord(text) {
  const hit = /cells (\d+)\+(\d+) ([a-z]+)/.exec(text);
  return hit === null ? null : { pending: Number(hit[2]), habitat: hit[3] };
}

/** Open the world through RESUME at a seeded pose — the returning player's own path — and wait for the bubble. */
async function resumeAt(page, url, site, height) {
  const query = `sky=${encodeURIComponent(HELD.sky)}&hour=${encodeURIComponent(String(HELD.hour))}&detail=${encodeURIComponent(DETAIL)}`;
  const opened = `${url}${url.includes('?') ? '&' : '?'}${query}`;
  await page.goto(opened, { waitUntil: 'load' });
  await page.evaluate(({ key, save }) => window.localStorage.setItem(key, JSON.stringify(save)), {
    key: SAVE_KEY,
    save: {
      version: SAVE_VERSION,
      savedAt: '2026-01-01T00:00:00.000Z',
      mapId: MAP_ID,
      camera: {
        at: { wx: site.x, wz: site.z },
        height,
        yaw: yawForBearing(site.facing),
        pitch: (PITCH * Math.PI) / 180,
      },
    },
  });
  await page.goto(opened, { waitUntil: 'load' });
  await page.waitForSelector('[data-action="resume"]', { timeout: TIMEOUT.menu });
  await page.click('[data-action="resume"]', { timeout: TIMEOUT.menu });
  await page.waitForSelector('[data-action="pause"]', { timeout: TIMEOUT.world });
  await runFrames(page, SETTLE_FRAMES);
  // The bubble streams a few cells a frame; wait until nothing is queued.
  for (let waited = 0; waited < DRAIN_FRAMES; waited += 10) {
    const cells = habitatWord(await uiText(page));
    if (cells === null || cells.pending === 0) break;
    await runFrames(page, 10);
  }
  return uiText(page);
}

/**
 * Stand the camera at a site: on land, three metres over the TRUE ground
 * (arrive at the coarse guess, read the HUD's ABOVE line, correct and
 * arrive again if it is off); at sea, three metres over sea level, once.
 */
async function arriveAt(page, url, site) {
  let height = site.land ? site.ground + EYE_ABOVE_GROUND : EYE_ABOVE_GROUND;
  let text = '';
  const tries = site.land ? 3 : 1;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    text = await resumeAt(page, url, site, height);
    const at = /x (-?[\d.]+) y (-?[\d.]+) z (-?[\d.]+)/.exec(text);
    if (!at) { fail(`${site.name}: the HUD printed no camera position`); return text; }
    const off = Math.hypot(Number(at[1]) - site.x, Number(at[3]) - site.z);
    if (off > 50) { fail(`${site.name}: asked for x ${site.x} z ${site.z}, arrived ${off.toFixed(0)} units away`); return text; }
    if (!site.land) return text;
    const above = /above (-?[\d.]+) m/.exec(text);
    if (above === null) { fail(`${site.name}: the HUD prints no ABOVE line, so the camera cannot be stood on the ground`); return text; }
    const error = Number(above[1]) * 100 - EYE_ABOVE_GROUND;
    if (Math.abs(error) <= EYE_TOLERANCE) return text;
    const trueGround = Number(at[2]) - Number(above[1]) * 100;
    height = trueGround + EYE_ABOVE_GROUND;
    log(`${site.name}: ${above[1]} m over the ground on attempt ${attempt + 1}; correcting to y ${height.toFixed(0)}`);
  }
  fail(`${site.name}: could not stand the camera ${EYE_ABOVE_GROUND / 100} m over the ground in three tries`);
  return text;
}

/**
 * Poll the ecology lines until `done(fields)` says so or `ms` of
 * wall-clock have passed. A line the HUD never built ends the wait at
 * once — that is a wiring failure, not something to wait for — and is
 * returned as `missing` so the caller can name it.
 */
async function pollFields(page, ms, done) {
  const started = Date.now();
  let fields = await readFields(page);
  for (;;) {
    const missing = FIELDS.filter((name) => fields[name] === null);
    if (missing.length > 0) return { fields, missing, timedOut: false };
    if (done(fields)) return { fields, missing: [], timedOut: false };
    if (Date.now() - started >= ms) return { fields, missing: [], timedOut: true };
    await runFrames(page, POLL_FRAMES);
    fields = await readFields(page);
  }
}

/** Wait for the counts to hold still for STABLE_READS reads, or for SETTLE_MS. */
async function settle(page) {
  let last = null;
  let same = 0;
  return pollFields(page, SETTLE_MS, (fields) => {
    // Empty eco lines are a hook returning null: not settled, nothing built yet.
    if (ECO_FIELDS.some((name) => fields[name] === '')) { last = null; same = 0; return false; }
    const key = COUNT_FIELDS.map((name) => fields[name]).join('|');
    if (key === last) same += 1;
    else { last = key; same = 0; }
    return same >= STABLE_READS - 1;
  });
}

/** Read one site: arrive, settle, parse, check what every site must satisfy, shoot. Null when there was nothing to read. */
async function readSite(page, url, site) {
  const text = await arriveAt(page, url, site);
  const cells = habitatWord(text);
  if (cells === null) fail(`${site.name}: the HUD prints no cells line — is the vegetation layer built?`);
  else if (!cells.habitat.startsWith(site.want)) fail(`${site.name}: the HUD names the habitat "${cells.habitat}", expected "${site.want}…"`);

  const { fields, missing, timedOut } = await settle(page);
  if (missing.length > 0) {
    fail(`${site.name}: the creatures hook is not wired — the HUD has no data-field="${missing[0]}" line (missing: ${missing.join(', ')})`);
    return null;
  }
  if (ECO_FIELDS.every((name) => fields[name] === '')) {
    fail(`${site.name}: the eco lines are still empty after ${SETTLE_MS / 1000} s — the creatures hook returns null; nothing has built a simulation`);
    return null;
  }
  if (timedOut) log(`${site.name}: the counts were still moving after ${SETTLE_MS / 1000} s; reading them as they stand`);
  const eco = parseEcology(fields, site.name);
  for (const problem of eco.problems) fail(problem);
  if (eco.problems.length > 0) return null;

  // What every site must satisfy.
  for (const word of ['worms', 'aphids', 'flies']) {
    const s = eco[word];
    if (s.resident > s.cap) fail(`${site.name}: ${word} ${s.resident} of ${s.cap} — over the cap; a cap is a maximum`);
  }
  // §2.9: v1 has no terrain editor. The seam is a no-op and the sheet must say so.
  if (eco.ground !== 'off') fail(`${site.name}: eco-ground reads "${fields['eco-ground']}" — v1 has no terrain-edit seam and the line must read "ground edits off"`);

  const file = path.join(SHOTS, `ecology-${site.name}.png`);
  await page.screenshot({ path: file });
  log(`saved ${path.relative(ROOT, file)}`);
  return { ...eco, habitat: cells?.habitat ?? '—', fields };
}

/** One row of the table. */
function row(name, r) {
  const species = (s) => (s === null ? '—' : `${s.resident} of ${s.cap}`);
  const plants = r.plants === undefined ? '—' : String(r.plants);
  const sites = r.resources === 'off' ? 'off' : r.resources === null ? '—' : String(r.resources.sites);
  const wet = r.resources === 'off' || r.resources === null ? '—' : String(r.resources.wet);
  const cost = r.cost === null ? '—' : `${r.cost.thinkMs}+${r.cost.moveMs}+${r.cost.drawMs}`;
  return `${name.padEnd(10)} ${r.habitat.padEnd(6)} ${plants.padStart(6)}  ${species(r.worms).padEnd(10)} ${species(r.aphids).padEnd(11)} ${species(r.flies).padEnd(10)} ${sites.padStart(6)} ${wet.padStart(4)}  ${cost.padEnd(14)} ${r.ground === 'off' ? 'off' : String(r.ground)}`;
}

const boxState = (page, id) => page.evaluate((layer) => {
  const box = document.querySelector(`[data-action="layer:${layer}"]`);
  return box instanceof HTMLInputElement ? { disabled: box.disabled, checked: box.checked } : null;
}, id);

/**
 * Switch a layer off the way the HUD listens for — a `change` event —
 * because Playwright's own click waits for an idle SwiftShader frame
 * that never comes.
 */
const flipOff = (page, id) => page.evaluate((layer) => {
  const box = document.querySelector(`[data-action="layer:${layer}"]`);
  if (!(box instanceof HTMLInputElement) || box.disabled || !box.checked) return false;
  box.checked = false;
  box.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}, id);

async function main() {
  if (!existsSync(DIST_INDEX)) {
    fail('dist/index.html is missing. Run `npm run build` first.');
    process.exitCode = 1;
    return;
  }
  mkdirSync(SHOTS, { recursive: true });
  let server = null;
  let browser = null;
  try {
    server = await preview({ preview: { port: 4189, strictPort: true }, logLevel: 'silent' });
    const url = server.resolvedUrls.local[0];
    browser = await chromium.launch({ executablePath: chromiumPath(), args: CHROMIUM_ARGS });
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await stubWeather(page);
    page.on('pageerror', (error) => fail(`uncaught page error: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') fail(`console error: ${message.text()}`);
    });

    // ── FOUR PLACES ─────────────────────────────────────────────────
    const read = {};
    for (const site of SITES) {
      const r = await readSite(page, url, site);
      if (r !== null) read[site.name] = r;
    }

    // ── THE TABLE ───────────────────────────────────────────────────
    log(`${'site'.padEnd(10)} ${'habitat'.padEnd(6)} ${'plants'.padStart(6)}  ${'worms'.padEnd(10)} ${'aphids'.padEnd(11)} ${'flies'.padEnd(10)} ${'sites'.padStart(6)} ${'wet'.padStart(4)}  ${'eco ms (t+m+d)'.padEnd(14)} ground`);
    for (const [name, r] of Object.entries(read)) log(row(name, r));

    // ── THE RULE: the island decides what lives where ──────────────
    const { beach, offshore, forest } = read;
    if (beach) {
      // No habitat generates worms on sand (`creatures/species.ts`,
      // `perHectare` has no `beach`). Two things can fail this: worms
      // generated on the sand, which is a bug; or the land behind the
      // strip — a beach is one 16 m cell wide and a worm's reach is
      // 30 m — which is the site, and is answered by moving the camera
      // seaward within the strip, not by loosening the bar.
      if (beach.worms.resident !== 0) fail(`the beach has ${beach.worms.resident} worms; no habitat generates worms on sand`);
    }
    if (offshore) {
      if (offshore.worms.resident !== 0) fail(`${offshore.worms.resident} worms three hundred metres out to sea`);
      if (offshore.aphids.resident !== 0) fail(`${offshore.aphids.resident} aphids three hundred metres out to sea, with no host plant to sit on`);
      // The species table forbids a sea density for every species, and its own test pins it.
      if (offshore.flies.resident !== 0) fail(`${offshore.flies.resident} flies three hundred metres out to sea`);
    }
    if (forest) {
      if (forest.plants === undefined) fail('forest: the plants line is empty — the objects readout carries no `plants` count; is the plant pass wired into ObjectsReadout.plants?');
      else if (!(forest.plants > 0)) fail(`forest: plants ${forest.plants}; a forest with no fern, shrub or broadleaf is a lawn with trees`);
      if (!(forest.worms.resident > 0)) fail(`forest: worms ${forest.worms.resident} of ${forest.worms.cap}; the forest floor generates worms`);
      if (!(forest.aphids.resident > 0)) fail(`forest: aphids ${forest.aphids.resident} of ${forest.aphids.cap}; a forest has hosts to sit on`);
      if (forest.resources === 'off') fail('forest: the resources line reads "sites off" with the layer on');
      else if (!(forest.resources.sites > 0)) fail('forest: sites 0; a forest offers litter, sap and hosts');
    }

    // ── THE LAYERS OFF: each species drops to nothing, the sites go ─
    // The page is on the forest. Each row must be built and on; each is
    // switched off in turn and its line must follow.
    if (forest) {
      for (const layer of LAYERS) {
        const state = await boxState(page, layer.id);
        if (state === null) { fail(`the LAYERS column has no ${layer.id} row`); continue; }
        if (state.disabled) { fail(`the ${layer.id} layer reads "not built": BUILT_LAYERS names it, but the scene built nothing behind it`); continue; }
        if (!state.checked) { fail(`the ${layer.id} layer is not on when the world opens`); continue; }
        if (!(await flipOff(page, layer.id))) { fail(`the ${layer.id} checkbox could not be switched off`); continue; }
        const want = layer.word === null
          ? (fields) => fields[layer.field] === 'sites off'
          : (fields) => parseSpecies(fields[layer.field], layer.word)?.resident === 0;
        const { fields, timedOut } = await pollFields(page, TOGGLE_MS, want);
        const stayed = await boxState(page, layer.id);
        if (stayed?.checked !== false) fail(`the ${layer.id} checkbox did not stay off; the scene refused the toggle`);
        const line = fields[layer.field];
        if (timedOut) {
          fail(layer.word === null
            ? `with the resources layer off the line should read "sites off" and after ${TOGGLE_MS / 1000} s reads "${line}"`
            : `with the ${layer.id} layer off the line should read "${layer.word} 0 of <cap>" and after ${TOGGLE_MS / 1000} s reads "${line}"`);
        } else {
          log(`${layer.id.padEnd(9)} off: ${line}`);
        }
      }
      await runFrames(page, 3);
      const file = path.join(SHOTS, 'ecology-off.png');
      await page.screenshot({ path: file });
      log(`saved ${path.relative(ROOT, file)} (all four layers off)`);
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  } finally {
    await browser?.close();
    await server?.close();
  }
  if (failures === 0) log('PASS: four places counted, nothing over its cap, nothing at sea, the seam says off, the four layers toggle.');
  process.exitCode = failures === 0 ? 0 : 1;
}

await main();
