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

const actorSites = [...actor].flatMap(([f, src]) => importsOf(f, src));
const viewSites = [...view].flatMap(([f, src]) => importsOf(f, src));
const terrainSites = [...terrain].flatMap(([f, src]) => importsOf(f, src));
const seaSites = [...sea].flatMap(([f, src]) => importsOf(f, src));

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
    // either filling a uniform (`.value.set`), naming a world-space
    // lattice origin (`ox:`/`oz:`), or building another WorldPoint
    // (`world(`). Anything else is a local position being computed by
    // hand, which is the bug the other two directories are banned from.
    const allowed = /\.value\.set\(|\bworld\(|\box:|\boz:/;
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
