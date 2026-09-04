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

const actorSites = [...actor].flatMap(([f, src]) => importsOf(f, src));
const viewSites = [...view].flatMap(([f, src]) => importsOf(f, src));
const terrainSites = [...terrain].flatMap(([f, src]) => importsOf(f, src));

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

  it('reads the heightfield as types only — it draws state, it does not run it', () => {
    const fromField = terrainSites.filter((s) => /world\/heightfield$/.test(s.specifier));
    expect(fromField.length).toBeGreaterThan(0);
    expect(fromField.filter((s) => !s.typeOnly).map((s) => `${s.file}: ${s.statement}`)).toEqual([]);
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
