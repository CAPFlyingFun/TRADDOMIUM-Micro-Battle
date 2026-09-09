/**
 * THE CREATURE LAB, DRIVEN THE WAY A THUMB DRIVES IT.
 *
 * Joshua's brief, §36 (the test matrix), §39 (the visual acceptance
 * list) and §40 ("I should be able to open Creature Lab on my iPhone
 * and…"): five creatures in a metre box, one of them the player's, the
 * other four living; tap a name and BECOME it; a hundred switches with
 * nothing duplicated, nothing teleported and nothing reset; every AI
 * word legal for its species; a disturbance that alarms; a reset that
 * is the spawn again. This probe presses those things against the BUILT
 * game and reads back what the lab's own overlay says, so a phone
 * opening the same build reads the same words.
 *
 * REACHED THE WAY A PHONE REACHES IT. The bare URL, the menu's EDITORS,
 * the hub's OPEN on `tool:lab.creatures` — never a `?scene=` route
 * (CLAUDE.md, TCS: "the project has already shipped a build that
 * passed every check against something the device was not running").
 * On the 932 × 430 design canvas, with touch, against `dist/`.
 *
 * DRIVEN BY FRAMES, NOT SECONDS. The headless renderer draws about a
 * frame and a half a second, and every frame's simulation is capped at
 * `SIM_DT_CAP` (0.1 s, `app/FrameClock.ts`): twenty frames of W here is
 * two simulated seconds however long the wall clock took. Every hold
 * and every wait is a count of animation frames, and nothing below
 * retunes anything from wall-clock ("never retune a per-second system
 * from probe wall-clock").
 *
 * WHAT A TELEPORT IS, MEASURED. A switch may not move a body: §4,
 * "nothing teleports, nobody respawns". But the frame a switch takes is
 * a frame the animal LIVES — a fly climbing at its wing's 600 mm/s moves
 * 60 mm in one capped frame, nine of its body lengths, and a check that
 * called that a teleport would fail the fly for flying. So the budget
 * for one switch is a body length PLUS what the body could honestly
 * travel in the frames the switch took, from the species' own rates in
 * `creatures/species.ts` (and `DROP_MM_S` for the aphid's fall), with a
 * margin for a drawn body up to twice the cited length. A respawn to
 * the block top (200 mm), or to the far corner of the lab, is metres of
 * that; a hop is not. `tests/probeLab.test.ts` pins the table here to
 * the species file, so a retuned rate cannot leave this probe measuring
 * a stale one.
 *
 * WHAT IT EXPECTS OF THE SCENE (so a missing half fails by NAME rather
 * than by timeout). Actions, on `data-action`:
 *   lab:possess:<queen|worker|earthworm|aphid|housefly>  the name row
 *   lab:observe   lab:camera   lab:predation   lab:disturb
 *   lab:camera-disturbs   lab:reset   lab:debug
 * Fields, on `data-field`:
 *   lab-control  lab-predation  lab-fps  lab-frame-ms  lab-ai-ms  lab-anim-ms
 *   lab-<creature>: one text block per animal, read LENIENTLY — PLAYER
 *   or AI, the behaviour word, hunger / fatigue / alarm as percentages,
 *   a height AGL (or a depth) in mm, and, where the overlay prints them,
 *   a position and a speed. The parser at `parseBlock` says exactly what
 *   it looks for; a block it cannot read fails the check that needed the
 *   number, by name.
 *
 * THE KEYS are `KEYS` in `src/control/PlayerDemand.ts`: W ahead, E up,
 * Q down. Never Space, though it is also "up": a button just pressed
 * keeps focus, and Space on a focused button CLICKS it.
 *
 * SHOTS 9 AND 10 of the brief's §39 — the queen on the pillar's wall and
 * the slab's underside, and her release from the underside to the air —
 * are Creature Lab D's, driven here by W into the pillar and read back
 * off the overlay's surface word; a walker whose height jumps more than
 * it can walk in a chunk of frames fails by name (`driveUntil`).
 *
 * Run after npm run build:
 *
 *     npm run build && npm run probe:lab
 *
 * PLAYWRIGHT_CHROMIUM can select an installed browser, as with the other
 * probes. PROBE_LAB_QUICK=1 shortens the soaks (20 switches, 60 frames)
 * for working on the lab itself; the default is the brief's hundred.
 * Exit code 0 only when every check passed and the page logged nothing.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { preview } from 'vite';
import { readPng } from './probePng.mjs';
import { stubWeather } from './probeWeather.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST_INDEX = path.join(ROOT, 'dist', 'index.html');
const SHOTS = path.join(ROOT, 'shots');
const VIEWPORT = { width: 932, height: 430 };
const PORT = 4199;
/** Carried from the other probes: what Playwright's Chromium needs to give three a WebGL context here. */
const CHROMIUM_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'];
const QUICK = process.env.PROBE_LAB_QUICK === '1';

// ─── THE LAB'S NAMES. Repeated from the lab's source because a .mjs probe cannot import TypeScript; tests/probeLab.test.ts pins them. ───

/** The tool id the hub lists (`src/devtools/DevTool.ts`, `toolAction`). */
const TOOL_ID = 'lab.creatures';
const toolAction = (id) => `tool:${id}`;
const ACTION = {
  newGame: 'new-game',
  editors: 'editors',
  observe: 'lab:observe',
  camera: 'lab:camera',
  predation: 'lab:predation',
  disturb: 'lab:disturb',
  cameraDisturbs: 'lab:camera-disturbs',
  reset: 'lab:reset',
  debug: 'lab:debug',
};
const possessAction = (id) => `lab:possess:${id}`;
const FIELD = {
  control: 'lab-control',
  predation: 'lab-predation',
  disturb: 'lab-disturb',
  debug: 'lab-debug',
  fps: 'lab-fps',
  frameMs: 'lab-frame-ms',
  aiMs: 'lab-ai-ms',
  animMs: 'lab-anim-ms',
};
/** The debug overlay's root (`LabUi`, `data-role`): `hidden` while DEBUG is off, and every shot wants it up. */
const OVERLAY_ROLE = 'lab-overlay';
const creatureField = (id) => `lab-${id}`;
/** The five, in the brief's own order (§4), which is the switch order of §36. */
const CREATURES = ['queen', 'worker', 'earthworm', 'aphid', 'housefly'];
/** What the CONTROL line must name for each held creature (§7: "CONTROL: WINGED QUEEN", "CONTROL: EARTHWORM"). */
const CONTROL_NAME = { queen: /queen/i, worker: /worker/i, earthworm: /worm/i, aphid: /aphid/i, housefly: /fly/i };
/** `KEYS` in src/control/PlayerDemand.ts. Never Space (the header). */
const KEY = { ahead: 'KeyW', up: 'KeyE', down: 'KeyQ' };
/** `BEHAVIOURS` in src/creatures/state.ts: the whole vocabulary, so a word the overlay prints is never unparsed. */
const BEHAVIOURS = ['idle', 'wander', 'feed', 'rest', 'flee', 'burrow', 'surface', 'takeoff', 'fly', 'hover', 'land', 'defend', 'attack'];
/** Words in which a body is going somewhere: a possessed creature that shows one has answered the thumbs. */
const MOVING_WORDS = ['wander', 'flee', 'burrow', 'surface', 'takeoff', 'fly', 'attack'];
const AIR_WORDS = ['takeoff', 'fly', 'hover', 'land'];
/** §10: only the fire ants are predator-capable in this set. The rest may NEVER choose these. */
const NON_PREDATORS = ['earthworm', 'aphid', 'housefly'];
const PREDATOR_WORDS = ['attack', 'hunt'];

/** `SIM_DT_CAP` in src/app/FrameClock.ts: the most simulated time one frame can carry. */
const SIM_DT_CAP = 0.1;
/** `lengthMm` per species in src/creatures/species.ts. */
const BODY_LENGTH_MM = { queen: 8, worker: 3, earthworm: 150, aphid: 1.4, housefly: 6.5 };
/**
 * The fastest a body's HEIGHT can honestly change, mm/s: a winged
 * body's `flight.climbMmS`, a plant body's fall (`DROP_MM_S`, demand.ts),
 * everyone else's `pace.fleeMmS` (the burrower rises and sinks at its
 * own pace; a walker's height is the ground's, and the flee pace bounds
 * what ground it can cross).
 */
const HONEST_VERTICAL_MM_S = { queen: 350, worker: 27, earthworm: 25, aphid: 1000, housefly: 600 };
/** The fastest a body can honestly cross the floor, mm/s: `flight.burstMmS` for the winged, `pace.fleeMmS` for the rest. */
const HONEST_PLANE_MM_S = { queen: 1000, worker: 27, earthworm: 25, aphid: 2.5, housefly: 3000 };
/** `lengthRangeMm` tops out at twice the cited length (the worker's 6 mm of 3), and a pace scales with the length. */
const LENGTH_MARGIN = 2;
/** Frames the overlay may take to show a switch. The ledger changes in the click; the overlay repaints on a frame. */
const SWITCH_FRAMES = 3;

const SWITCH_CYCLES = QUICK ? 4 : 20;
const OBSERVE_FRAMES = QUICK ? 60 : 120;
/** More frames for the fly alone, when it has not left its perch inside the soak: a hop is on its own timer. */
const OBSERVE_EXTRA_FRAMES = QUICK ? 30 : 60;
const SAMPLE_EVERY = 5;
const HOLD_FRAMES = 20;
const SETTLE_FRAMES = 30;
/** The follow camera's handoff is a blend (`control/FollowCamera.ts`, HANDOFF_S); a few frames and the lens is on the animal. */
const HANDOFF_FRAMES = 6;
/** The surface drive (Creature Lab D): W in chunks this long, up to this many frames per stage — the wall is ~5 s off at 20 mm/s, the underside ~6 s more. */
const DRIVE_CHUNK = 10;
const SURFACE_FRAMES = QUICK ? 100 : 160;
const ALARM_FRAMES = 12;
const TIMEOUT = { menu: 90_000, lab: 240_000, overlay: 60_000, click: 60_000, shot: 120_000 };

const t0 = Date.now();
const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(0)} s`;
const log = (message) => console.log(`[probe:lab] ${message}`);
const phase = (name) => log(`── ${name} (${elapsed()})`);
const failures = [];
const fail = (message) => {
  failures.push(message);
  console.error(`[probe:lab] FAIL: ${message}`);
};
/** A soft assertion: records and carries on, so one broken thing does not hide the next. */
const check = (condition, message) => {
  if (!condition) fail(message);
  return Boolean(condition);
};
const pageNoise = [];

/**
 * The same order every other probe here uses: an explicit override,
 * Playwright's own pinned path when it exists, then the browsers this
 * machine actually has. Never `playwright install`.
 */
function browserPath() {
  const override = process.env.PLAYWRIGHT_CHROMIUM;
  if (override) {
    assert(existsSync(override), `PLAYWRIGHT_CHROMIUM=${override} does not exist`);
    return override;
  }
  const pinned = chromium.executablePath();
  if (existsSync(pinned)) return pinned;
  const browsers = process.env.PLAYWRIGHT_BROWSERS_PATH;
  for (const guess of [
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    '/opt/pw-browsers/chromium/chrome',
    browsers ? path.join(browsers, 'chromium') : null,
  ]) {
    if (guess !== null && existsSync(guess)) return guess;
  }
  assert.fail(`No installed Chromium: Playwright expects ${pinned}. Set PLAYWRIGHT_CHROMIUM.`);
}

// ─── instruments ─────────────────────────────────────────────────────

async function frames(page, count) {
  if (count <= 0) return;
  await page.evaluate((n) => new Promise((resolve) => {
    const step = () => (--n <= 0 ? resolve() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  }), count);
}

const uiText = (page) => page.evaluate(() => ((document.getElementById('ui') ?? document.body).innerText ?? '').replace(/\s+/g, ' ').trim());

/** Every named field in one trip, with how many elements wear each creature's name: duplication shows up as a count. */
const snapshot = (page) => page.evaluate(({ creatures, fields }) => {
  const text = (el) => (el.innerText ?? el.textContent ?? '');
  const out = { creatures: {}, counts: {}, fields: {} };
  for (const id of creatures) {
    const nodes = document.querySelectorAll(`[data-field="lab-${id}"]`);
    out.counts[id] = nodes.length;
    out.creatures[id] = nodes.length > 0 ? text(nodes[0]) : null;
  }
  for (const f of fields) {
    const el = document.querySelector(`[data-field="${f}"]`);
    out.fields[f] = el ? text(el) : null;
  }
  return out;
}, { creatures: CREATURES, fields: Object.values(FIELD) });

const toMm = (value, unit) => (unit === 'cm' ? value * 10 : unit === 'm' ? value * 1000 : value);
const num = (hit, i = 1) => (hit ? Number(hit[i]) : null);

/** A percentage the overlay prints, as a number 0..100; a bare fraction ≤ 1 without a sign is read as one. */
function percent(text, name) {
  const hit = new RegExp(`\\b${name}\\s*[:=]?\\s*(-?\\d+(?:\\.\\d+)?)\\s*(%)?`, 'i').exec(text);
  if (!hit) return null;
  const value = Number(hit[1]);
  return hit[2] === '%' || value > 1 ? value : value * 100;
}

/**
 * The overlay's text for one creature, read leniently (the header).
 * `LabUi.blockText` prints five lines —
 *
 *   NAME · PLAYER|AI · medium
 *   word · target N mm|— · host id|—
 *   hunger N% · fatigue N% · alarm N%
 *   speed N.N mm/s · AGL N mm · surface word [· ground edits ON|OFF]
 *   think a/b s · at x,z · px X,Y|—
 *
 * — and the second line's first word is read as the behaviour when it
 * is one. Failing that shape, the word is taken as a labelled value,
 * then as a word printed in CAPITALS on its own (the brief's own
 * examples: "FEED", "BURROW"), then as the first whole word from the
 * vocabulary — so a "Ground/surface state" line cannot pass for the
 * word `surface` while the block also says BURROW. Everything else is
 * found by its label wherever it sits.
 */
function parseBlock(raw) {
  const text = (raw ?? '').replace(/take[ -]off/gi, 'takeoff');
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const flat = text.replace(/\s+/g, ' ').trim();
  const control = /\bPLAYER\b/i.test(flat) ? 'PLAYER' : /\bAI\b/.test(flat) ? 'AI' : null;

  let behaviour = null;
  const second = /^([a-z]+)\s*·/i.exec(lines[1] ?? '');
  if (second && BEHAVIOURS.includes(second[1].toLowerCase())) behaviour = second[1].toLowerCase();
  const labelled = behaviour === null ? /\b(?:behaviou?r|word|doing)\s*[:=]?\s*([a-z]+)/i.exec(flat) : null;
  if (labelled && BEHAVIOURS.includes(labelled[1].toLowerCase())) behaviour = labelled[1].toLowerCase();
  if (behaviour === null) {
    for (const line of text.split(/\r?\n/)) {
      const word = line.trim();
      if (BEHAVIOURS.includes(word.toLowerCase()) && word === word.toUpperCase()) { behaviour = word.toLowerCase(); break; }
    }
  }
  if (behaviour === null) {
    let first = Infinity;
    for (const word of BEHAVIOURS) {
      const at = flat.search(new RegExp(`\\b${word}\\b`, 'i'));
      if (at !== -1 && at < first) { first = at; behaviour = word; }
    }
  }

  const agl = /\b(?:height(?:\s*agl)?|agl|altitude)\s*[:=]?\s*(-?\d+(?:\.\d+)?)\s*(mm|cm|m)?\b/i.exec(flat);
  const depth = /\bdepth\s*[:=]?\s*(-?\d+(?:\.\d+)?)\s*(mm|cm|m)?\b/i.exec(flat);
  const heightMm = agl ? toMm(Number(agl[1]), agl[2]) : depth ? -toMm(Number(depth[1]), depth[2]) : null;

  const xyz = /\bx\s*[:=]?\s*(-?\d+(?:\.\d+)?)(?:\s*,?\s*y\s*[:=]?\s*(-?\d+(?:\.\d+)?))?\s*,?\s*z\s*[:=]?\s*(-?\d+(?:\.\d+)?)/i.exec(flat);
  const pair = xyz ? null : /\b(?:at|pos(?:ition)?)\s*[:=]?\s*\(?\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)?/i.exec(flat);
  const position = xyz ? { x: Number(xyz[1]), z: Number(xyz[3]) } : pair ? { x: Number(pair[1]), z: Number(pair[2]) } : null;

  const speed = /\bspeed\s*[:=]?\s*(-?\d+(?:\.\d+)?)\s*(mm\/s|cm\/s|m\/s)?/i.exec(flat);
  const host = /\bhost\s*[:=]?\s*([\w.:-]+)/i.exec(flat);
  // Where the body is DRAWN, CSS pixels: what a DISTURB tap is aimed at. `px —` is a body not drawn this frame.
  const px = /\bpx\s+(-?\d+)\s*,\s*(-?\d+)/i.exec(flat);
  // Where the feet are (`CreatureLabScene.surfaceWord`): the face under a climber — Creature Lab D — or the ground, air, host or soil word.
  const surface = /\b(on top|on wall|on ceiling|on ground|on host|on surface|airborne|underground|no ground)\b/i.exec(flat);
  return {
    text: flat,
    control,
    behaviour,
    hunger: percent(flat, 'hunger'),
    fatigue: percent(flat, 'fatigue'),
    alarm: percent(flat, 'alarm'),
    heightMm,
    position,
    screen: px ? { x: Number(px[1]), y: Number(px[2]) } : null,
    surface: surface ? surface[1].toLowerCase() : null,
    speedMmS: speed ? toMm(Number(speed[1]), speed[2] ? speed[2].slice(0, -2) : 'mm') : null,
    host: host ? host[1] : null,
    lengthMm: num(/\b(?:length|body)\s*[:=]?\s*(-?\d+(?:\.\d+)?)\s*mm\b/i.exec(flat)),
  };
}

/** One reading of the whole overlay, parsed. */
async function read(page) {
  const s = await snapshot(page);
  const creatures = {};
  for (const id of CREATURES) creatures[id] = s.creatures[id] === null ? null : parseBlock(s.creatures[id]);
  return { creatures, counts: s.counts, fields: s.fields };
}

const players = (r) => CREATURES.filter((id) => r.creatures[id]?.control === 'PLAYER');
const summary = (r, id) => {
  const c = r.creatures[id];
  if (!c) return `${id}: (no block)`;
  const bits = [c.control ?? '?', c.behaviour ?? '?'];
  if (c.heightMm !== null) bits.push(`${c.heightMm} mm`);
  if (c.alarm !== null) bits.push(`alarm ${c.alarm}%`);
  if (c.host) bits.push(`host ${c.host}`);
  return `${id}: ${bits.join(' ')}`;
};
const describeAll = (r) => CREATURES.map((id) => summary(r, id)).join(' | ');

async function press(page, action) {
  await page.click(`[data-action="${action}"]`, { timeout: TIMEOUT.click });
}

/**
 * A toggle's state: `aria-pressed` where the button carries it, else
 * the readout it wears (`LabUi`: "DEBUG: ON", "DISTURB: TAP THE BENCH"
 * armed and bare "DISTURB" not), else null — and a toggle that says
 * nothing is pressed blind, once.
 */
const toggleState = (page, action, field) => page.evaluate(({ a, f }) => {
  const el = document.querySelector(`[data-action="${a}"]`);
  if (!el) return null;
  const aria = el.getAttribute('aria-pressed');
  if (aria !== null) return aria === 'true';
  const text = (f ? document.querySelector(`[data-field="${f}"]`)?.textContent : el.textContent) ?? '';
  if (/\bON\b|TAP THE BENCH/i.test(text)) return true;
  if (/\bOFF\b/i.test(text) || /^\s*DISTURB\s*$/i.test(text)) return false;
  return null;
}, { a: action, f: field ?? null });

async function turnOn(page, action, field) {
  if ((await toggleState(page, action, field)) === true) return;
  await press(page, action);
  await frames(page, 1);
}
async function turnOff(page, action, field) {
  if ((await toggleState(page, action, field)) === false) return;
  await press(page, action);
  await frames(page, 1);
}

/** Hold keys for a count of frames; `midway` reads while they are still down. Blurs first: a focused button eats keys. */
async function hold(page, codes, count, midway) {
  await page.evaluate(() => document.activeElement?.blur?.());
  for (const code of codes) await page.keyboard.down(code);
  try {
    await frames(page, Math.ceil(count / 2));
    if (midway) await midway();
    await frames(page, Math.floor(count / 2));
  } finally {
    for (const code of codes) await page.keyboard.up(code);
  }
}

/** Save a shot and hand back its pixels, so a check never reads a different frame from the one on disk. */
async function shot(page, name) {
  const bytes = await page.screenshot({ timeout: TIMEOUT.shot });
  writeFileSync(path.join(SHOTS, `lab-${name}.png`), bytes);
  log(`saved shots/lab-${name}.png`);
  return readPng(bytes);
}

/**
 * Not a blank frame: on a grid of every fourth pixel, the share that is
 * not the single most common colour. A lab that drew its box, its
 * plants and its animals is well above a hundredth; a black canvas
 * (a context that never came up) or one flat colour is nothing.
 */
function drawnShare(png) {
  const counts = new Map();
  let total = 0;
  for (let y = 0; y < png.height; y += 4) for (let x = 0; x < png.width; x += 4) {
    const i = (y * png.width + x) * 4;
    const key = ((png.data[i] >> 3) << 10) | ((png.data[i + 1] >> 3) << 5) | (png.data[i + 2] >> 3);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    total += 1;
  }
  let most = 0;
  for (const n of counts.values()) most = Math.max(most, n);
  return 1 - most / total;
}

/**
 * The bench's block is a slab on a pedestal, a solid a climber walks up
 * and under (Creature Lab D, creatures/labWorld PILLAR and SLAB), and
 * the overlay's height is AGL — measured against the FLOOR under the
 * body, since the block is no longer in the ground. A walker's height
 * therefore changes at its walking pace, never in a step; but a FLIER
 * crossing the slab's edge below its top is lifted onto it in one frame
 * (`floorOverBoxes`: the floor under a body over the slab is the slab),
 * which reads as a jump of up to the block's height with no motion.
 * The budget stays as the honest bound for that one case.
 */
const BLOCK_STEP_MM = 200;

/** The most one switch may move a body, in mm of height and units of floor, given the frames the switch took. */
function jumpBudget(id, framesTaken) {
  const seconds = framesTaken * SIM_DT_CAP;
  return {
    heightMm: LENGTH_MARGIN * (BODY_LENGTH_MM[id] + seconds * HONEST_VERTICAL_MM_S[id]) + BLOCK_STEP_MM,
    planeUnits: LENGTH_MARGIN * (BODY_LENGTH_MM[id] + seconds * HONEST_PLANE_MM_S[id]) / 10,
  };
}

/** The distance a block moved between two readings, by the position when it prints one, else by height alone. */
function moved(before, after) {
  if (!before || !after) return { plane: null, height: null };
  const plane = before.position && after.position
    ? Math.hypot(after.position.x - before.position.x, after.position.z - before.position.z) : null;
  const height = before.heightMm !== null && after.heightMm !== null ? Math.abs(after.heightMm - before.heightMm) : null;
  return { plane, height };
}

/**
 * A point on the bare canvas to tap: where the overlay says the body
 * is drawn (`px X,Y`) when that is on the canvas and inside the frame,
 * else near the middle of the screen — a tap that lands on a panel
 * reaches the panel, not the scene.
 */
async function canvasPoint(page, preferred) {
  const centre = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
  const candidates = [];
  if (preferred && preferred.x >= 0 && preferred.y >= 0 && preferred.x < VIEWPORT.width && preferred.y < VIEWPORT.height) candidates.push(preferred);
  candidates.push(centre, { x: centre.x, y: centre.y + 40 }, { x: centre.x - 60, y: centre.y }, { x: centre.x + 60, y: centre.y }, { x: centre.x, y: centre.y - 40 });
  for (const p of candidates) {
    const isCanvas = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName === 'CANVAS', p);
    if (isCanvas) return { ...p, drawn: p === preferred };
  }
  return null;
}

// ─── the run ─────────────────────────────────────────────────────────

/** Boot → menu → EDITORS → hub → OPEN the lab → the overlay is up. Hard failures: nothing after this means anything without it. */
async function arrive(page, url) {
  phase('boot through the front door');
  await page.goto(url, { waitUntil: 'load' });
  try {
    await page.waitForSelector(`[data-action="${ACTION.newGame}"]`, { timeout: TIMEOUT.menu });
  } catch {
    assert.fail(`[data-action="${ACTION.newGame}"] did not appear within ${TIMEOUT.menu / 1000} s. UI reads: "${await uiText(page)}"`);
  }
  await press(page, ACTION.editors);
  try {
    await page.waitForSelector(`[data-action="${toolAction(TOOL_ID)}"]`, { state: 'attached', timeout: TIMEOUT.menu });
  } catch {
    assert.fail(`the dev-tools hub has no [data-action="${toolAction(TOOL_ID)}"] OPEN button. UI reads: "${await uiText(page)}"`);
  }
  log(`bare URL → EDITORS → hub lists "${TOOL_ID}"`);
  await press(page, toolAction(TOOL_ID));
  try {
    await page.waitForSelector(`[data-field="${FIELD.control}"]`, { state: 'attached', timeout: TIMEOUT.lab });
  } catch {
    assert.fail(`the lab's [data-field="${FIELD.control}"] did not appear within ${TIMEOUT.lab / 1000} s. UI reads: "${await uiText(page)}"`);
  }
  await frames(page, SETTLE_FRAMES);
  // The debug overlay (§8) may be off by default. Its blocks are written
  // whether or not it shows (`LabUi.render`), so the READINGS are fresh
  // either way; the SHOTS want it on the screen, so it is turned on here
  // and every shot after this is taken with it up.
  await turnOn(page, ACTION.debug, FIELD.debug);
  const overlayHidden = await page.evaluate((role) => document.querySelector(`[data-role="${role}"]`)?.hidden ?? null, OVERLAY_ROLE);
  check(overlayHidden === false, `the debug overlay ([data-role="${OVERLAY_ROLE}"]) is ${overlayHidden === null ? 'not there' : 'still hidden'} after DEBUG was turned on`);
  let r = await read(page);
  if (CREATURES.some((id) => r.counts[id] === 0)) {
    await page.waitForFunction((ids) => ids.every((id) => document.querySelector(`[data-field="lab-${id}"]`)), CREATURES, { timeout: TIMEOUT.overlay });
    await frames(page, 2);
    r = await read(page);
  }
  const missing = CREATURES.filter((id) => r.counts[id] === 0);
  assert.equal(missing.length, 0, `the overlay has no block for: ${missing.join(', ')}. UI reads: "${await uiText(page)}"`);
  log(`the lab is up after ${elapsed()} (${r.fields[FIELD.debug]}): ${describeAll(r)}`);
  return r;
}

/** §28: exactly one PLAYER, the rest AI, five blocks, no duplication. Used at arrival, after every switch and after reset. */
function checkOneControlled(r, expected, where) {
  const held = players(r);
  check(held.length === 1 && held[0] === expected, `${where}: expected exactly ${expected} to read PLAYER; PLAYER reads: [${held.join(', ')}]`);
  for (const id of CREATURES) {
    if (id === expected) continue;
    check(r.creatures[id]?.control === 'AI', `${where}: ${id} should read AI, reads "${r.creatures[id]?.control ?? 'nothing'}"`);
  }
  for (const id of CREATURES) check(r.counts[id] === 1, `${where}: ${r.counts[id]} blocks wear "${creatureField(id)}"; exactly one may`);
  check(CONTROL_NAME[expected].test(r.fields[FIELD.control] ?? ''),
    `${where}: the CONTROL line reads "${r.fields[FIELD.control]}", which does not name the ${expected}`);
}

/** Possess `id` by its row button and wait, a frame at a time, for the overlay to say so. Returns the reading and the frames it took. */
async function possess(page, id) {
  await press(page, possessAction(id));
  let r = null;
  for (let took = 1; took <= SWITCH_FRAMES; took += 1) {
    await frames(page, 1);
    r = await read(page);
    if (r.creatures[id]?.control === 'PLAYER') return { r, took };
  }
  return { r, took: SWITCH_FRAMES };
}

/**
 * §36 "selected actor responds immediately": hold W and prove the body
 * went somewhere — by its position when the overlay prints one, by its
 * speed read mid-hold, or by its word turning into a moving one. Which
 * of the three proved it is logged, and a block that offers none of
 * them fails by name.
 */
async function proveResponds(page, id) {
  const before = (await read(page)).creatures[id];
  let mid = null;
  await hold(page, [KEY.ahead], HOLD_FRAMES, async () => { mid = (await read(page)).creatures[id]; });
  const after = (await read(page)).creatures[id];
  const m = moved(before, after);
  const byPosition = m.plane !== null && m.plane > 0;
  const bySpeed = mid?.speedMmS !== null && mid?.speedMmS !== undefined && mid.speedMmS > 0;
  const byWord = MOVING_WORDS.includes(mid?.behaviour) || MOVING_WORDS.includes(after?.behaviour);
  const evidence = byPosition ? `moved ${m.plane.toFixed(2)} units` : bySpeed ? `speed ${mid.speedMmS} mm/s mid-hold` : byWord ? `word ${mid?.behaviour ?? after?.behaviour}` : null;
  if (!check(evidence !== null, `${id} held W for ${HOLD_FRAMES} frames and the overlay shows no movement (no position change, no speed, no moving word): "${after?.text}"`)) return;
  const offered = [before?.position ? 'position' : null, mid?.speedMmS !== null ? 'speed' : null].filter(Boolean).join(', ') || 'word only';
  log(`${id} answers W: ${evidence} (the overlay offers ${offered}; ${summary({ creatures: { [id]: after } }, id)})`);
}

/**
 * Hold W for `id` in chunks of `DRIVE_CHUNK` frames, reading the overlay
 * between chunks, until `wanted(block)` is true or `maxFrames` have gone.
 * Every chunk's height change is held to what the body could honestly
 * climb in it: a walker's flee pace over the chunk plus a body length,
 * at twice the cited length — the no-teleport rule of the switch soak,
 * applied to a climb. Returns whether it got there, the frames it took,
 * and the last reading.
 */
async function driveUntil(page, id, wanted, maxFrames) {
  let last = (await read(page)).creatures[id];
  let frames = 0;
  const seconds = DRIVE_CHUNK * SIM_DT_CAP;
  const budget = LENGTH_MARGIN * (BODY_LENGTH_MM[id] + seconds * HONEST_PLANE_MM_S[id]);
  while (frames < maxFrames) {
    await hold(page, [KEY.ahead], DRIVE_CHUNK);
    frames += DRIVE_CHUNK;
    const now = (await read(page)).creatures[id];
    const dh = moved(last, now).height;
    if (dh !== null) check(dh <= budget, `${id} climbed ${dh} mm in ${DRIVE_CHUNK} frames of W (allowed ${budget.toFixed(0)}): a walker teleported, not walked`);
    last = now;
    if (wanted(now)) return { hit: true, frames, last };
  }
  return { hit: false, frames, last };
}

/** The switch soak, §36: the five in a ring, `cycles` times round, every switch checked. */
async function switchSoak(page, cycles) {
  phase(`the ${cycles * CREATURES.length}-switch soak`);
  const ring = [...CREATURES.slice(1), CREATURES[0]];
  let held = CREATURES[0];
  let last = await read(page);
  checkOneControlled(last, held, 'before the soak');
  let switches = 0;
  let slowest = 0;
  const worstHeight = Object.fromEntries(CREATURES.map((id) => [id, 0]));
  const worstPlane = Object.fromEntries(CREATURES.map((id) => [id, 0]));
  for (let cycle = 0; cycle < cycles; cycle += 1) {
    for (const next of ring) {
      const before = last;
      const { r, took } = await possess(page, next);
      switches += 1;
      slowest = Math.max(slowest, took);
      const where = `switch ${switches} (${held} → ${next})`;
      checkOneControlled(r, next, where);
      check(r.creatures[held]?.control === 'AI', `${where}: the released ${held} reads "${r.creatures[held]?.control}" ${took} frame(s) on, not AI`);
      // Nothing teleports: every body, not just the two involved.
      for (const id of CREATURES) {
        const m = moved(before.creatures[id], r.creatures[id]);
        const budget = jumpBudget(id, took + 1);
        if (m.height !== null) {
          worstHeight[id] = Math.max(worstHeight[id], m.height);
          check(m.height <= budget.heightMm,
            `${where}: ${id}'s height moved ${m.height.toFixed(1)} mm in ${took + 1} frame(s); ${budget.heightMm.toFixed(1)} mm is the most it could honestly travel (a body length and its own rate)`);
        }
        if (m.plane !== null) {
          worstPlane[id] = Math.max(worstPlane[id], m.plane);
          check(m.plane <= budget.planeUnits,
            `${where}: ${id} moved ${m.plane.toFixed(2)} units across the floor in ${took + 1} frame(s); ${budget.planeUnits.toFixed(2)} is the most it could honestly travel`);
        }
      }
      held = next;
      last = r;
      if (switches % 25 === 0) log(`${switches} switches (${elapsed()}): ${describeAll(r)}`);
    }
  }
  check(slowest <= SWITCH_FRAMES, `a switch took more than ${SWITCH_FRAMES} frames to show on the overlay`);
  log(`${switches} switches: slowest showed in ${slowest} frame(s); largest height move per switch: `
    + CREATURES.map((id) => `${id} ${worstHeight[id].toFixed(1)} mm`).join(', ')
    + (Object.values(worstPlane).some((v) => v > 0) ? `; across the floor: ${CREATURES.map((id) => `${id} ${worstPlane[id].toFixed(2)} u`).join(', ')}` : '; (no position printed)'));
  return switches;
}

/** §29 / §36 AI: everyone on their brain for a soak; every word collected; the legal ones seen, the illegal ones never. */
async function observerSoak(page) {
  phase('observer soak');
  await press(page, ACTION.observe);
  await frames(page, 2);
  let r = await read(page);
  check(players(r).length === 0, `observer mode: PLAYER still reads on [${players(r).join(', ')}]`);
  check(/observ|none|free/i.test(r.fields[FIELD.control] ?? ''), `observer mode: the CONTROL line reads "${r.fields[FIELD.control]}"`);
  const predation = r.fields[FIELD.predation] ?? '';
  const antsMayNotAttack = /\boff\b/i.test(predation);
  log(`predation reads "${predation}"${antsMayNotAttack ? ': the ants may not attack either' : ''}`);

  const seen = Object.fromEntries(CREATURES.map((id) => [id, new Set()]));
  const hosts = new Set();
  const stats = [];
  const sample = async () => {
    r = await read(page);
    for (const id of CREATURES) {
      const c = r.creatures[id];
      if (c?.behaviour) seen[id].add(c.behaviour);
      if (id === 'aphid' && c?.host) hosts.add(c.host);
      const forbidden = NON_PREDATORS.includes(id) || antsMayNotAttack;
      if (forbidden && c?.behaviour && PREDATOR_WORDS.includes(c.behaviour)) fail(`observer soak: ${id} shows "${c.behaviour}" — a non-predator (or predation OFF) may never`);
    }
    stats.push({ fps: r.fields[FIELD.fps], frame: r.fields[FIELD.frameMs], ai: r.fields[FIELD.aiMs], anim: r.fields[FIELD.animMs] });
  };
  let framesRun = 0;
  for (; framesRun < OBSERVE_FRAMES; framesRun += SAMPLE_EVERY) {
    await frames(page, SAMPLE_EVERY);
    await sample();
  }
  const flew = () => AIR_WORDS.some((w) => seen.housefly.has(w));
  if (!flew()) {
    log(`the fly has not left its perch in ${framesRun} frames; giving it ${OBSERVE_EXTRA_FRAMES} more`);
    for (let extra = 0; extra < OBSERVE_EXTRA_FRAMES && !flew(); extra += SAMPLE_EVERY) {
      await frames(page, SAMPLE_EVERY);
      await sample();
      framesRun += SAMPLE_EVERY;
    }
  }
  const words = (id) => [...seen[id]].join(', ') || 'nothing';
  log(`${framesRun} frames observed: ` + CREATURES.map((id) => `${id} {${words(id)}}`).join('; '));
  check(seen.earthworm.has('burrow') || seen.earthworm.has('surface'), `the worm never showed burrow or surface; it showed {${words('earthworm')}}`);
  check(seen.aphid.has('feed') || seen.aphid.has('idle'), `the aphid never showed feed or idle; it showed {${words('aphid')}}`);
  if (hosts.size > 0) log(`the aphid names its host: ${[...hosts].join(', ')}`);
  check(flew(), `the fly never showed takeoff, fly, hover or land in ${framesRun} frames; it showed {${words('housefly')}}`);
  check(seen.worker.has('wander') || seen.worker.has('feed'), `the worker never showed wander or feed; it showed {${words('worker')}}`);
  await shot(page, '7-observer');
  const last = stats[stats.length - 1];
  log(`frame stats at the end of the soak: fps "${last.fps}", frame "${last.frame}", AI "${last.ai}", animation "${last.anim}"`);
  return stats;
}

/**
 * §30: arm DISTURB, tap by the animal, and its alarm climbs. The camera
 * is brought onto the animal by possessing it — the follow camera
 * frames whoever is held — and then the brain is handed back with
 * OBSERVE so the reaction is the AI's; the free camera takes over
 * where the follow camera was. If the alarm does not climb that way,
 * the possessed path is tried too (senses keep running under a player,
 * `CreatureSim`), and which path proved it is logged.
 */
async function disturb(page, id) {
  const attempt = async (label) => {
    const before = (await read(page)).creatures[id];
    if (!check(before?.alarm !== null && before?.alarm !== undefined, `${id}: the overlay prints no alarm percentage to watch: "${before?.text}"`)) return false;
    const point = await canvasPoint(page, before.screen);
    if (!check(point !== null, 'no bare canvas near the middle of the screen to tap on')) return false;
    log(`tapping ${point.drawn ? `where the ${id} is drawn` : 'the middle of the screen'} (${point.x}, ${point.y}) with DISTURB armed`);
    await turnOn(page, ACTION.disturb, FIELD.disturb);
    await page.mouse.click(point.x, point.y);
    for (let i = 0; i < ALARM_FRAMES; i += 1) {
      await frames(page, 1);
      const now = (await read(page)).creatures[id];
      if (now?.alarm !== null && now.alarm > before.alarm) {
        log(`${id} alarmed by a tap (${label}): ${before.alarm}% → ${now.alarm}% in ${i + 1} frame(s); word ${now.behaviour}`);
        return true;
      }
    }
    log(`${id}: alarm stayed at ${before.alarm}% for ${ALARM_FRAMES} frames after a tap (${label})`);
    return false;
  };
  await possess(page, id);
  await frames(page, HANDOFF_FRAMES);
  await press(page, ACTION.observe);
  await frames(page, 2);
  let ok = await attempt('AI, free camera where the follow camera left it');
  if (!ok) {
    await possess(page, id);
    await frames(page, HANDOFF_FRAMES);
    ok = await attempt('possessed, follow camera');
  }
  await turnOff(page, ACTION.disturb, FIELD.disturb);
  check(ok, `${id}'s alarm never rose after a DISTURB tap by it`);
}

async function main() {
  assert(existsSync(DIST_INDEX), 'no dist/index.html; run `npm run build` first');
  mkdirSync(SHOTS, { recursive: true });
  const server = await preview({
    root: ROOT,
    configFile: path.join(ROOT, 'vite.config.ts'),
    logLevel: 'silent',
    preview: { host: '127.0.0.1', port: PORT, strictPort: false, open: false },
  });
  const url = server.resolvedUrls?.local[0];
  assert(url, 'Vite must report the built-game URL.');
  const browser = await chromium.launch({ executablePath: browserPath(), args: CHROMIUM_ARGS });
  const page = await browser.newPage({ viewport: VIEWPORT, hasTouch: true, deviceScaleFactor: 1 });
  page.setDefaultTimeout(TIMEOUT.click);
  await stubWeather(page);
  page.on('pageerror', (e) => pageNoise.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') pageNoise.push(`console: ${m.text()}`); });

  try {
    // ── 1. ALL FIVE, THE QUEEN HELD ──────────────────────────────
    const arrival = await arrive(page, url);
    checkOneControlled(arrival, 'queen', 'at arrival');
    const first = await shot(page, '1-all-five');
    const share = drawnShare(first);
    check(share >= 0.01, `shots/lab-1-all-five.png is ${(share * 100).toFixed(1)}% not-one-colour: the lab drew nothing`);
    log(`lab-1: ${(share * 100).toFixed(0)}% of the frame is not the dominant colour`);

    // ── 2. EACH ONE ANSWERS THE THUMBS ───────────────────────────
    phase('possession: each creature answers');
    await proveResponds(page, 'queen');
    await shot(page, '2-queen-controlled');

    let p = await possess(page, 'worker');
    checkOneControlled(p.r, 'worker', 'possessing the worker');
    await proveResponds(page, 'worker');
    await shot(page, '6-worker');

    p = await possess(page, 'earthworm');
    checkOneControlled(p.r, 'earthworm', 'possessing the worm');
    // Room to burrow first: a worm already at the bottom of its band cannot fall.
    await hold(page, [KEY.up], HOLD_FRAMES);
    const surfaced = (await read(page)).creatures.earthworm;
    await hold(page, [KEY.down], HOLD_FRAMES);
    const buried = (await read(page)).creatures.earthworm;
    if (check(surfaced?.heightMm !== null && buried?.heightMm !== null, `the worm's block prints no height or depth: "${buried?.text}"`)) {
      check(buried.heightMm < surfaced.heightMm, `DOWN for ${HOLD_FRAMES} frames did not lower the worm: ${surfaced.heightMm} → ${buried.heightMm} mm`);
      log(`worm DOWN: ${surfaced.heightMm} → ${buried.heightMm} mm (word ${buried.behaviour})`);
    }
    await shot(page, '8-worm-underground');
    log(`lab-8 overlay reads: "${buried?.text}"`);
    await hold(page, [KEY.up], HOLD_FRAMES);
    const risen = (await read(page)).creatures.earthworm;
    if (buried?.heightMm !== null && risen?.heightMm !== null) {
      check(risen.heightMm > buried.heightMm, `UP for ${HOLD_FRAMES} frames did not raise the worm: ${buried.heightMm} → ${risen.heightMm} mm`);
      log(`worm UP: ${buried.heightMm} → ${risen.heightMm} mm (word ${risen.behaviour})`);
    }
    await proveResponds(page, 'earthworm');
    await shot(page, '3-worm');

    p = await possess(page, 'aphid');
    checkOneControlled(p.r, 'aphid', 'possessing the aphid');
    await proveResponds(page, 'aphid');
    const aphid = (await read(page)).creatures.aphid;
    if (aphid?.host) log(`the possessed aphid is still on its host: ${aphid.host}`);
    await shot(page, '5-aphid');
    // Joshua, 2026-09-09: "grab a screenshot of the model with maybe no
    // overlay to make sure everything is good." The overlay off, the
    // legs mid-stride, the follow camera four bodies back.
    await turnOff(page, ACTION.debug, FIELD.debug);
    await hold(page, [KEY.ahead], Math.ceil(HOLD_FRAMES / 2));
    await shot(page, '5-aphid-model');
    await turnOn(page, ACTION.debug, FIELD.debug);

    p = await possess(page, 'housefly');
    checkOneControlled(p.r, 'housefly', 'possessing the fly');
    const perched = (await read(page)).creatures.housefly;
    await hold(page, [KEY.up], HOLD_FRAMES);
    const aloft = (await read(page)).creatures.housefly;
    if (check(perched?.heightMm !== null && aloft?.heightMm !== null, `the fly's block prints no height: "${aloft?.text}"`)) {
      check(aloft.heightMm > perched.heightMm, `UP for ${HOLD_FRAMES} frames did not raise the fly: ${perched.heightMm} → ${aloft.heightMm} mm`);
      log(`fly UP: ${perched.heightMm} → ${aloft.heightMm} mm (word ${aloft.behaviour})`);
    }
    await shot(page, '4-fly');
    await proveResponds(page, 'housefly');

    // ── 3. THE SWITCH SOAK ───────────────────────────────────────
    p = await possess(page, 'queen');
    checkOneControlled(p.r, 'queen', 'back to the queen');
    const switches = await switchSoak(page, SWITCH_CYCLES);

    // ── 4. OBSERVER ──────────────────────────────────────────────
    const stats = await observerSoak(page);

    // ── 5. DISTURB ───────────────────────────────────────────────
    phase('disturbance');
    for (const id of ['earthworm', 'aphid', 'housefly']) await disturb(page, id);

    // ── 6. RESET ─────────────────────────────────────────────────
    phase('reset');
    await press(page, ACTION.reset);
    await frames(page, 2);
    const fresh = await read(page);
    checkOneControlled(fresh, 'queen', 'after reset');
    // The reset invariant is the PLACEMENT and the calm, not a first word:
    // a fresh spawn may already be acting on its needs by the second frame
    // (a hungry fly takes off within a think). So: back where it arrived
    // (within a third of the bench for a flier, a fifth for the rest —
    // the arrival read was itself a few frames after the spawn), alarm 0,
    // and no alarm word.
    const ALARM_WORDS = ['flee', 'attack', 'defend'];
    for (const id of CREATURES) {
      const c = fresh.creatures[id];
      const a = arrival.creatures[id];
      check(c !== null && !ALARM_WORDS.includes(c.behaviour), `after reset ${id} reads "${c?.behaviour}", an alarm word`);
      check(c?.alarm !== null && c?.alarm <= 0, `after reset ${id}'s alarm reads ${c?.alarm}%, not 0`);
      if (a?.position && c?.position) {
        const away = Math.hypot(a.position.x - c.position.x, a.position.z - c.position.z);
        const allowed = id === 'housefly' ? 33 : 20;
        check(away <= allowed, `after reset ${id} stands ${away.toFixed(1)} units from where it arrived (allowed ${allowed})`);
      }
    }
    log(`after reset: ${describeAll(fresh)}`);

    // ── 8. PREDATION ─────────────────────────────────────────────
    phase('predation');
    const start = (await read(page)).fields[FIELD.predation];
    check(start !== null && start.length > 0, 'the predation line is empty');
    let label = start;
    const seen = [start];
    for (let i = 0; i < 4 && !/force/i.test(label ?? ''); i += 1) {
      await press(page, ACTION.predation);
      await frames(page, 1);
      label = (await read(page)).fields[FIELD.predation];
      seen.push(label);
    }
    check(/force/i.test(label ?? ''), `cycling predation never reached FORCE: ${seen.map((s) => `"${s}"`).join(' → ')}`);
    for (let i = 0; i < 4 && label !== start; i += 1) {
      await press(page, ACTION.predation);
      await frames(page, 1);
      label = (await read(page)).fields[FIELD.predation];
      seen.push(label);
    }
    check(label === start, `cycling predation did not return to "${start}": ${seen.map((s) => `"${s}"`).join(' → ')}`);
    log(`predation cycled: ${seen.map((s) => `"${s}"`).join(' → ')}`);

    // ── 9. FRAME STATS ───────────────────────────────────────────
    const end = await read(page);
    log(`frame stats: fps "${end.fields[FIELD.fps]}", frame "${end.fields[FIELD.frameMs]}", AI "${end.fields[FIELD.aiMs]}", animation "${end.fields[FIELD.animMs]}" (software rendering, not a phone)`);
    for (const f of [FIELD.fps, FIELD.frameMs, FIELD.aiMs, FIELD.animMs]) check(end.fields[f] !== null, `the overlay has no [data-field="${f}"]`);
    check(stats.length > 0, 'no frame stats were sampled during the observer soak');

    // ── 7. SURFACES (Creature Lab D): shots 9 and 10 ─────────────
    phase('surfaces: the queen up the pillar, under the slab, and let go');
    // The reset put the queen at her spawn, (14, 0) facing −x, and the
    // pillar's east face stands at x = 4 (creatures/labWorld PILLAR): W
    // walks her into it and, the surface step being real, UP it — never
    // onto its top in one frame, which is what Joshua saw on alpha.39.
    const climb = await driveUntil(page, 'queen', (c) => c?.surface === 'on wall', SURFACE_FRAMES);
    if (check(climb.hit, `the queen held W for ${climb.frames} frames and never read "on wall" (last: "${climb.last?.text}")`)) {
      log(`queen on the wall after ${climb.frames} frames: ${summary({ creatures: { queen: climb.last } }, 'queen')}`);
    }
    await shot(page, '9-queen-wall');
    const under = await driveUntil(page, 'queen', (c) => c?.surface === 'on ceiling', SURFACE_FRAMES);
    if (check(under.hit, `the queen held W for ${under.frames} more frames and never read "on ceiling" (last: "${under.last?.text}")`)) {
      const agl = under.last?.heightMm;
      check(agl !== null && agl >= 100 && agl <= 140, `on the ceiling the queen's AGL reads ${agl} mm; the slab's underside is 120 mm up`);
      log(`queen on the underside after ${under.frames} frames: ${summary({ creatures: { queen: under.last } }, 'queen')}`);
    }
    await shot(page, '9-queen-underside');
    // THE RELEASE (§14): UP on a standing winged body is a takeoff; she
    // lets go of the ceiling, the air takes her, and her up is the world's
    // again — the renderer rolls her over rather than snapping.
    await hold(page, [KEY.up], HOLD_FRAMES);
    const released = (await read(page)).creatures.queen;
    check(AIR_WORDS.includes(released?.behaviour ?? '') || released?.surface === 'airborne',
      `UP from the underside did not release the queen: word "${released?.behaviour}", surface "${released?.surface}"`);
    log(`queen released: ${summary({ creatures: { queen: released } }, 'queen')} (surface ${released?.surface})`);
    await shot(page, '10-queen-release');

    if (pageNoise.length > 0) fail(`the page logged errors: ${pageNoise.join(' | ')}`);
    log(`${switches} switches, ${elapsed()} on the wall clock`);
  } finally {
    await browser.close();
    await server.close();
  }

  if (failures.length > 0) {
    console.error(`[probe:lab] ${failures.length} check(s) failed:\n${failures.map((f) => `  - ${f}`).join('\n')}`);
    process.exitCode = 1;
  } else {
    log('PASS: five up with the queen held; each answers the thumbs; the switch soak duplicated, teleported and reset nothing; '
      + 'the AI words were legal and the fly flew; a tap alarms; reset is the spawn; the queen climbed the pillar, walked the underside and let go; predation cycles; the page logged nothing');
  }
}

main().catch((error) => {
  console.error(`[probe:lab] FAIL: ${error instanceof Error ? error.stack : String(error)}`);
  if (pageNoise.length > 0) console.error(pageNoise.join('\n'));
  process.exitCode = 1;
});
