/**
 * The actor/view seam as a test (ARCHITECTURE §3).
 *
 *   actor → NEVER view, and never the floating origin: a state module
 *           does not know what it looks like or where it is drawn.
 *   view   reads ActorState (types only) and writes a mesh; the ONE
 *           WorldPoint → LocalPoint conversion lives in CapsuleView.
 *
 * Source text, like simulationCore.test.ts, so a type-only import or a
 * stray `.wx` is caught the day it is written. three and the DOM in
 * actor/ are that test's job; this one covers the seam between the two.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

interface ImportSite {
  readonly file: string;
  readonly specifier: string;
  readonly typeOnly: boolean;
  readonly statement: string;
}

/** `import … from 'x'` / `export … from 'x'`; the clause holds only names, braces and `type`. */
const FROM_RE = /\b(import|export)(\s+type)?\s+[\w\s{},*$]*?\bfrom\s*['"]([^'"]+)['"]/g;
const BARE_RE = /\bimport\s*['"]([^'"]+)['"]/g;
const DYNAMIC_RE = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function importsOf(file: string, source: string): ImportSite[] {
  const sites: ImportSite[] = [];
  for (const m of source.matchAll(FROM_RE)) sites.push({ file, specifier: m[3], typeOnly: m[2] !== undefined, statement: m[0] });
  for (const m of source.matchAll(BARE_RE)) sites.push({ file, specifier: m[1], typeOnly: false, statement: m[0] });
  for (const m of source.matchAll(DYNAMIC_RE)) sites.push({ file, specifier: m[1], typeOnly: false, statement: m[0] });
  return sites;
}

/** Comments blanked, so a doc comment that names the rule cannot trip it. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

function dir(rel: string): Map<string, string> {
  const abs = join(ROOT, rel);
  const files = readdirSync(abs).filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts')).sort();
  return new Map(files.map((f) => [f, readFileSync(join(abs, f), 'utf8')]));
}

const actor = dir('src/actor');
const view = dir('src/view');
const terrain = dir('src/terrain');
const sea = dir('src/sea');
const flora = dir('src/flora');
const sky = dir('src/sky');
const fauna = dir('src/fauna');

const actorSites = [...actor].flatMap(([f, src]) => importsOf(f, src));
const viewSites = [...view].flatMap(([f, src]) => importsOf(f, src));
const terrainSites = [...terrain].flatMap(([f, src]) => importsOf(f, src));
const seaSites = [...sea].flatMap(([f, src]) => importsOf(f, src));
const floraSites = [...flora].flatMap(([f, src]) => importsOf(f, src));
const skySites = [...sky].flatMap(([f, src]) => importsOf(f, src));
const faunaSites = [...fauna].flatMap(([f, src]) => importsOf(f, src));

const VIEW_DIR = /(^|\/)view(\/|$)/;
const ORIGIN = /(^|\/)world\/origin$/;
const ACTOR_DIR = /(^|\/)actor(\/|$)/;

describe('the actor/view seam', () => {
  it('has both sides to check', () => {
    expect([...actor.keys()]).toEqual(expect.arrayContaining(['ActorState.ts', 'spawnCapsule.ts', 'ScriptedMover.ts', 'playerColor.ts']));
    expect([...view.keys()]).toEqual(expect.arrayContaining(['CapsuleView.ts', 'ActorViews.ts', 'NameLabel.ts']));
    expect(actorSites.length).toBeGreaterThan(0);
    expect(viewSites.length).toBeGreaterThan(0);
  });

  it('actor/ never imports view/ or the floating origin', () => {
    const offenders = actorSites.filter((s) => VIEW_DIR.test(s.specifier) || ORIGIN.test(s.specifier));
    expect(offenders.map((s) => `${s.file}: ${s.statement}`)).toEqual([]);
  });

  it('actor/ reaches outside itself only for world/coords and input/Intent', () => {
    const outside = actorSites.filter((s) => s.specifier.startsWith('../'));
    const allowed = new Set(['../world/coords', '../input/Intent']);
    expect(outside.filter((s) => !allowed.has(s.specifier)).map((s) => `${s.file}: ${s.statement}`)).toEqual([]);
  });

  it('view/ imports actor/ as types only — it reads state, it does not run it', () => {
    const fromActor = viewSites.filter((s) => ACTOR_DIR.test(s.specifier));
    expect(fromActor.length).toBeGreaterThan(0);
    expect(fromActor.filter((s) => !s.typeOnly).map((s) => `${s.file}: ${s.statement}`)).toEqual([]);
  });

  it('converts WorldPoint → LocalPoint in CapsuleView alone, and reads no world coordinate anywhere', () => {
    const originImporters = viewSites.filter((s) => ORIGIN.test(s.specifier));
    expect(originImporters.map((s) => s.file)).toEqual(['CapsuleView.ts']);
    expect(originImporters[0].typeOnly).toBe(false);
    expect(code(view.get('CapsuleView.ts') ?? '')).toMatch(/\btoLocal\(/);
    // A view that read `.wx` would be doing the conversion by hand somewhere else.
    for (const [file, src] of view) {
      expect(code(src), `${file} reads a world coordinate`).not.toMatch(/\.w[xz]\b/);
    }
  });
});

/**
 * THE SAME SEAM, ON THE OTHER RENDERER (ARCHITECTURE §3, amended
 * 2026-09-04 with `terrain/`).
 *
 * `view/` draws actors; `terrain/` draws the ground. Both stand at the
 * render boundary and both must cross it the same way — through
 * `origin.toLocal`, never by subtracting an origin by hand. The `.wx`
 * ban is the test that catches the hand-rolled version, and it is why
 * `coords.snapTo` and `coords.translate` exist: a clipmap has to snap a
 * ring and offset a vertex, and it must be able to do both without ever
 * taking a world coordinate apart.
 */
describe('the world/terrain seam', () => {
  it('has a terrain renderer to check', () => {
    expect([...terrain.keys()]).toEqual(expect.arrayContaining(['TerrainView.ts']));
    expect(terrainSites.length).toBeGreaterThan(0);
  });

  it('never owns a Heightfield — it is handed one, and it does not construct or run it', () => {
    // The rule is about OWNERSHIP, not about the import keyword. terrain/
    // receives a Heightfield and reads it; it must never build one, which
    // is what importing the class as a value would let it do.
    const fromField = terrainSites.filter((s) => /world\/heightfield$/.test(s.specifier));
    expect(fromField.length).toBeGreaterThan(0);
    for (const [file, src] of terrain) {
      const body = code(src);
      expect(body, `${file} constructs a Heightfield`).not.toMatch(/new\s+Heightfield\b/);
      // `Heightfield` may only appear as a type: after `type`, or in a
      // type position (`: Heightfield`, `<Heightfield>`).
      const asValue = /(^|[^\w.])Heightfield\s*\(/.test(body);
      expect(asValue, `${file} calls Heightfield as a value`).toBe(false);
    }
    // What it MAY take as values are the pure conversions it has to agree
    // with — a normal from a gradient, a slope from a normal. The renderer
    // derives its vertex normals from heights it has already read rather
    // than paying the heightfield for four more samples each; sharing the
    // arithmetic is exactly what stops the mesh and the ground disagreeing,
    // and duplicating it here is what would let them.
    const valueImports = fromField.filter((s) => !s.typeOnly);
    for (const site of valueImports) {
      expect(site.statement, `${site.file} imports more than the shared conversions`)
        .toMatch(/normalOfGradient|slopeOfUp|SEA_LEVEL/);
    }
  });

  it('converts through the floating origin, and reads no world coordinate by hand', () => {
    const originImporters = terrainSites.filter((s) => ORIGIN.test(s.specifier));
    expect(originImporters.map((s) => s.file)).toEqual(['TerrainView.ts']);
    expect(originImporters[0].typeOnly).toBe(false);
    expect(code(terrain.get('TerrainView.ts') ?? '')).toMatch(/\btoLocal\(/);
    for (const [file, src] of terrain) {
      expect(code(src), `${file} reads a world coordinate`).not.toMatch(/\.w[xz]\b/);
    }
  });

  it('never imports actor/ or view/: the ground does not know who is standing on it', () => {
    const offenders = terrainSites.filter((s) => ACTOR_DIR.test(s.specifier) || VIEW_DIR.test(s.specifier));
    expect(offenders.map((s) => `${s.file}: ${s.statement}`)).toEqual([]);
  });
});


/**
 * THE THIRD RENDERER, AND THE ONE PLACE THE `.wx` BAN DOES NOT FIT
 * (ARCHITECTURE §3, amended 2026-09-05 with `sea/`).
 *
 * `view/` draws actors, `terrain/` draws the ground, `sea/` draws the
 * water. The first two may never read a world coordinate, because a
 * renderer that does is doing the origin subtraction by hand somewhere.
 * The sea genuinely must, and the reason is in the water audit's own
 * list of things that were CORRECT in v0: "floating-origin handling
 * across the water boundary (world-coordinate uniforms, per-frame
 * place(), y never rebased)".
 *
 * The water's SKIN is world-locked. The ripple tiles against world
 * position, the swell is evaluated at world position, and the far
 * sheet's hole is a world distance — so `uCentre` and `uHole` are world
 * coordinates by design, and float32 can hold them because the shader
 * only ever uses them modulo a tile or as a difference. What must NOT
 * happen is the mesh's own placement being computed by hand.
 *
 * So the rule here is sharper than a ban, and it is the rule the ban was
 * a proxy for: every world coordinate this directory reads goes STRAIGHT
 * TO THE GPU or straight back into another world coordinate, and the
 * mesh crosses the boundary through `toLocal` like everything else.
 */
describe('the world/sea seam', () => {
  it('has a sea renderer to check', () => {
    expect([...sea.keys()]).toEqual(expect.arrayContaining(['OceanView.ts', 'waterLook.ts', 'SeaTextures.ts']));
    expect(seaSites.length).toBeGreaterThan(0);
  });

  it('never owns a Heightfield or a SeaSwell — it is handed both', () => {
    for (const [file, src] of sea) {
      const body = code(src);
      expect(body, `${file} constructs a Heightfield`).not.toMatch(/new\s+Heightfield\b/);
      expect(body, `${file} constructs a SeaSwell`).not.toMatch(/new\s+SeaSwell\b/);
    }
    const fromField = seaSites.filter((s) => /world\/heightfield$/.test(s.specifier));
    for (const site of fromField) {
      expect(site.typeOnly || /SEA_LEVEL/.test(site.statement), `${site.file} imports the heightfield as a value`).toBe(true);
    }
  });

  it('seats the mesh through toLocal and never subtracts an origin by hand', () => {
    const originImporters = seaSites.filter((s) => ORIGIN.test(s.specifier));
    expect(originImporters.map((s) => s.file)).toEqual(['OceanView.ts']);
    expect(code(sea.get('OceanView.ts') ?? '')).toMatch(/\btoLocal\(/);
    // `originAt` is the tool you would reach for to do it by hand. The
    // sea has no use for it and importing it is the smell.
    for (const site of originImporters) {
      expect(site.statement, `${site.file} imports originAt`).not.toMatch(/\boriginAt\b/);
    }
  });

  it('reads a world coordinate ONLY to hand it to the GPU or to another world coordinate', () => {
    // The sharpened ban. Every `.wx`/`.wz` must be on a line that is
    // either filling a uniform (`.value.set`), handing the pair to one
    // of the doors that own a shader's world anchors (`setCentre`,
    // `setHole`, `setEye` on a `WaterLook`), naming a world-space
    // lattice origin (`ox:`/`oz:`), or building another WorldPoint
    // (`world(`). Anything else is a local position being computed by
    // hand, which is the bug the other two directories are banned from.
    //
    // THE SETTERS ARE STRICTER THAN THE UNIFORM WRITE THEY REPLACED, not
    // a loophole cut for them: a world centre now has a wave phase and a
    // set of ripple offsets derived from it in float64, and `setCentre`
    // is what keeps those in step. Writing `centre.value` alone would
    // leave the shader drawing the sea of a different coast, so the
    // uniform is read-only from out here and this list says which door
    // is open.
    const allowed = /\.value\.set\(|\bset(?:Centre|Hole|Eye)\(|\bworld\(|\box:|\boz:/;
    let examined = 0;
    for (const [file, src] of sea) {
      for (const [i, line] of code(src).split('\n').entries()) {
        if (!/\.w[xz]\b/.test(line)) continue;
        examined += 1;
        expect(allowed.test(line), `${file}:${i + 1} takes a world coordinate apart: ${line.trim()}`).toBe(true);
      }
    }
    // A renderer that stopped reading world coordinates entirely would
    // pass this vacuously, and so would a scan that lost the directory.
    expect(examined).toBeGreaterThan(0);
  });

  it('never imports actor/ or view/: the water does not know who is swimming in it', () => {
    const offenders = seaSites.filter((s) => ACTOR_DIR.test(s.specifier) || VIEW_DIR.test(s.specifier));
    expect(offenders.map((s) => `${s.file}: ${s.statement}`)).toEqual([]);
  });
});


/**
 * THE FOURTH RENDERER (ARCHITECTURE §3, amended 2026-09-06 with `flora/`).
 *
 * `flora/` draws the world's objects — the grass, twigs, stones, rocks
 * and trees `world/objects/` places. Like the sea it has a genuine use
 * for world coordinates that is not the mesh's placement: an object's
 * distance from the camera is a WORLD distance (world minus world), and
 * the populator hands it world positions in float64 because a local
 * position stored anywhere is the bug the whole coordinate system exists
 * to prevent. So it is held to the sea's sharpened rule: a world
 * coordinate it reads goes back into another world coordinate or through
 * `toLocal`, in ONE file, and the geometry bakes touch none at all.
 */
describe('the world/flora seam', () => {
  it('has a flora renderer to check', () => {
    expect([...flora.keys()]).toEqual(expect.arrayContaining(['WorldObjects.ts', 'bladeGeometry.ts', 'propGeometry.ts', 'treeGeometry.ts']));
    expect(floraSites.length).toBeGreaterThan(0);
  });

  it('never owns a Heightfield or a HabitatMap — it is handed a field and a query', () => {
    for (const [file, src] of flora) {
      const body = code(src);
      expect(body, `${file} constructs a Heightfield`).not.toMatch(/new\s+Heightfield\b/);
      expect(body, `${file} constructs a HabitatMap`).not.toMatch(/new\s+HabitatMap\b/);
      expect(body, `${file} decodes the survey`).not.toMatch(/\b(decodeCoarse|decodeVeg|repairGrid)\(/);
    }
    const fromField = floraSites.filter((s) => /world\/heightfield$/.test(s.specifier));
    for (const site of fromField) expect(site.typeOnly, `${site.file} imports the heightfield as a value`).toBe(true);
  });

  it('seats every instance through toLocal, in WorldObjects alone, and never subtracts an origin by hand', () => {
    const originImporters = floraSites.filter((s) => ORIGIN.test(s.specifier));
    expect(originImporters.map((s) => s.file)).toEqual(['WorldObjects.ts']);
    expect(code(flora.get('WorldObjects.ts') ?? '')).toMatch(/\btoLocal\(/);
    for (const site of originImporters) expect(site.statement, `${site.file} imports originAt`).not.toMatch(/\boriginAt\b/);
    // The geometry bakes work in a unit space and read no world coordinate.
    for (const [file, src] of flora) {
      if (file === 'WorldObjects.ts') continue;
      expect(code(src), `${file} reads a world coordinate`).not.toMatch(/\.w[xz]\b/);
    }
  });

  it('reads a world coordinate ONLY to measure against another one or to hand it to toLocal', () => {
    // Every `.wx`/`.wz` line in WorldObjects is a world-minus-world
    // difference, a world-space comparison for a recentre, a cell
    // address, the argument of `toLocal`/`world(`/`cellsWithin`, or a
    // world coordinate being written INTO a scratch WorldPoint that is
    // handed to the heightfield (`point.wx = c.wx[i]` — building another
    // WorldPoint without allocating one per blade).
    const allowed = /\btoLocal\(|\bworld\(|- at\.w[xz]|at\.w[xz] -|\.w[xz] - |wantedAt\.w[xz]|refreshedAt\.w[xz]|wx: at\.wx|wz: at\.wz|Math\.floor\(at\.w[xz]|Number\.isFinite\(at\.w[xz]|wx: batch\.wx|wz: batch\.wz|point\.w[xz] = \w+\.w[xz]\[/;
    let examined = 0;
    for (const [i, line] of code(flora.get('WorldObjects.ts') ?? '').split('\n').entries()) {
      if (!/\.w[xz]\b/.test(line)) continue;
      examined += 1;
      expect(allowed.test(line), `WorldObjects.ts:${i + 1} takes a world coordinate apart: ${line.trim()}`).toBe(true);
    }
    expect(examined).toBeGreaterThan(0);
  });

  it('never imports actor/, view/, session/, ui/ or net/: the grass does not know who walks through it', () => {
    const banned = /(^|\/)(actor|view|session|ui|net)(\/|$)/;
    const offenders = floraSites.filter((s) => banned.test(s.specifier));
    expect(offenders.map((s) => `${s.file}: ${s.statement}`)).toEqual([]);
  });
});


/**
 * THE FIFTH RENDERER (ARCHITECTURE §3, amended 2026-09-07 with `sky/`).
 *
 * `sky/` draws the air: the dome the baked skies wear, the sun and
 * sky-light it drives, and the rain around the camera. It is held to the
 * `.wx` ban the way `flora/` is held to the sharpened rule — and here
 * the sharpened rule has NO allowed sites, because nothing in the sky
 * has a world position. The dome and the rain stand on the camera's
 * RENDERED position; the sun's place is an angle, not a point. A world
 * coordinate read anywhere in this directory would be a renderer
 * inventing a location for something that has none, so there is no
 * `toLocal` here to hide one behind either.
 *
 * It reads the weather and the sun as TYPES ONLY: `skyLook` is handed a
 * reading and a position and decides nothing about time or weather
 * itself, which is what keeps it pure enough to test without a canvas.
 */
describe('the world/sky seam', () => {
  it('has a sky renderer to check', () => {
    expect([...sky.keys()]).toEqual(expect.arrayContaining(['skyLook.ts', 'SkyView.ts', 'RainView.ts']));
    expect(skySites.length).toBeGreaterThan(0);
  });

  it('reads no world coordinate anywhere: the sky and the rain stand on the camera, the sun is an angle', () => {
    for (const [file, src] of sky) {
      expect(code(src), `${file} reads a world coordinate`).not.toMatch(/\.w[xz]\b/);
    }
    // Nothing to convert, so nothing imports the floating origin; and
    // `originAt` — the tool for doing the subtraction by hand — least of all.
    const originImporters = skySites.filter((s) => ORIGIN.test(s.specifier));
    expect(originImporters.map((s) => `${s.file}: ${s.statement}`)).toEqual([]);
  });

  it('imports world/ as types only — it is handed a weather reading and a sun position, and decides neither', () => {
    const fromWorld = skySites.filter((s) => /(^|\/)world(\/|$)/.test(s.specifier));
    expect(fromWorld.length).toBeGreaterThan(0);
    expect(fromWorld.filter((s) => !s.typeOnly).map((s) => `${s.file}: ${s.statement}`)).toEqual([]);
    for (const [file, src] of sky) {
      const body = code(src);
      expect(body, `${file} constructs a SkyModel`).not.toMatch(/new\s+SkyModel\b/);
      expect(body, `${file} computes the sun itself`).not.toMatch(/\bsunPosition\(/);
      expect(body, `${file} reads the clock`).not.toMatch(/\bDate\.now\(/);
    }
  });

  it('keeps skyLook pure: no three, no DOM, so the look is testable without a canvas', () => {
    const look = sky.get('skyLook.ts') ?? '';
    const sites = importsOf('skyLook.ts', look);
    expect(sites.filter((s) => s.specifier === 'three' || s.specifier.startsWith('three/')).map((s) => s.statement)).toEqual([]);
    expect(sites.filter((s) => !s.typeOnly).map((s) => s.statement)).toEqual([]);
    expect(code(look)).not.toMatch(/\b(document|window|navigator|localStorage)\b/);
  });

  it('never imports actor/, view/, session/, ui/ or net/: the sky does not know who is under it', () => {
    const banned = /(^|\/)(actor|view|session|ui|net)(\/|$)/;
    const offenders = skySites.filter((s) => banned.test(s.specifier));
    expect(offenders.map((s) => `${s.file}: ${s.statement}`)).toEqual([]);
  });
});


/**
 * THE SIXTH RENDERER (ARCHITECTURE §3, amended 2026-09-07 with `fauna/`).
 *
 * `fauna/` draws the island's animals: rigs lent to the nearest
 * creatures, impostors for the rest. Like `flora/` it has a genuine
 * need for world distances — which creature is nearest the eye is a
 * world question — and like `flora/` it seats every body through
 * `toLocal`. But it is held to the SKY'S rule rather than the flora's
 * sharpened one, with NO allowed `.wx` sites at all: every distance it
 * measures goes through `coords.distanceSquared` and `coords.distance`,
 * the worm's trail is a ring of `WorldPoint`s made by `coords.translate`
 * and read back only through `toLocal`, so there is nothing left for a
 * hand-rolled subtraction to hide behind. `rig.ts` and `motion.ts` work
 * on a rig at the identity and a path already in render space, and
 * import neither the origin nor the coordinates.
 *
 * It reads `creatures/` as TYPES and the table's own arithmetic: the
 * one scale (`rigScale`), the one unit conversion (`unitsOfMm`), the
 * id list and the set of airborne behaviours the state module publishes
 * for renderers. It never imports the simulation, and it never
 * constructs a loader — `assets.loadModel` is handed in.
 */
describe('the creatures/fauna seam', () => {
  const ORIGIN_VALUE = /\boriginAt\b/;
  /** The values `fauna/` may take from `creatures/`: the table's arithmetic and its published lists, never the simulation. */
  const CREATURE_VALUES = new Set(['AIRBORNE', 'CREATURE_IDS', 'rigScale', 'unitsOfMm', 'CREATURE_SPECIES']);

  it('has a fauna renderer to check', () => {
    expect([...fauna.keys()]).toEqual(expect.arrayContaining(['FaunaView.ts', 'motion.ts', 'rig.ts']));
    expect(faunaSites.length).toBeGreaterThan(0);
  });

  it('seats every body through toLocal, in FaunaView alone, and never subtracts an origin by hand', () => {
    const originImporters = faunaSites.filter((s) => ORIGIN.test(s.specifier));
    expect(originImporters.map((s) => s.file)).toEqual(['FaunaView.ts']);
    expect(originImporters[0].typeOnly).toBe(false);
    expect(code(fauna.get('FaunaView.ts') ?? '')).toMatch(/\btoLocal\(/);
    for (const site of originImporters) expect(site.statement, `${site.file} imports originAt`).not.toMatch(ORIGIN_VALUE);
  });

  it('reads no world coordinate anywhere: distances are coords\', the trail is WorldPoints, positions cross through toLocal', () => {
    for (const [file, src] of fauna) {
      expect(code(src), `${file} reads a world coordinate`).not.toMatch(/\.w[xz]\b/);
    }
    // The distance helpers are the door: a renderer that stopped using
    // them would have to take a coordinate apart, which the line above
    // catches — or stop measuring distance, which this catches.
    expect(code(fauna.get('FaunaView.ts') ?? '')).toMatch(/\bdistanceSquared\(/);
    // The rig and motion files never see a coordinate of either kind.
    for (const file of ['rig.ts', 'motion.ts']) {
      const sites = faunaSites.filter((s) => s.file === file);
      expect(sites.filter((s) => /world\/(coords|origin)$/.test(s.specifier)).map((s) => s.statement)).toEqual([]);
    }
  });

  it('imports creatures/ as types and the table\'s own arithmetic only — never the simulation', () => {
    const fromCreatures = faunaSites.filter((s) => /(^|\/)creatures(\/|$)/.test(s.specifier));
    expect(fromCreatures.length).toBeGreaterThan(0);
    for (const site of fromCreatures) {
      if (site.typeOnly) continue;
      const clause = /\{([^}]*)\}/.exec(site.statement)?.[1] ?? '';
      const names = clause.split(',').map((n) => n.trim()).filter((n) => n.length > 0 && !n.startsWith('type '));
      expect(names.length, `${site.file}: ${site.statement}`).toBeGreaterThan(0);
      for (const name of names) expect(CREATURE_VALUES.has(name), `${site.file} imports ${name} from creatures/ as a value`).toBe(true);
    }
    for (const [file, src] of fauna) {
      expect(code(src), `${file} runs the simulation`).not.toMatch(/\bCreatureSim\b|\bnewCreature\(/);
    }
  });

  it('never constructs a loader: assets/ is a type, and the loader is handed in', () => {
    const fromAssets = faunaSites.filter((s) => /(^|\/)assets(\/|$)/.test(s.specifier));
    expect(fromAssets.filter((s) => !s.typeOnly).map((s) => `${s.file}: ${s.statement}`)).toEqual([]);
    for (const [file, src] of fauna) {
      expect(code(src), `${file} constructs a loader`).not.toMatch(/new\s+(GLTFLoader|TextureLoader|FileLoader)\b/);
    }
  });

  it('never imports actor/, view/, session/, ui/, net/ or perf/: the animals do not know who is watching', () => {
    const banned = /(^|\/)(actor|view|session|ui|net|perf)(\/|$)/;
    const offenders = faunaSites.filter((s) => banned.test(s.specifier));
    expect(offenders.map((s) => `${s.file}: ${s.statement}`)).toEqual([]);
  });
});
