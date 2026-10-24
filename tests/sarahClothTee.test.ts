/**
 * THE CLOTH TEE (Joshua, 2026-10-23: "create another copy of that same shirt, but make that one a true soft body/cloth
 * with simulation over the whole thing"; 2026-10-23: "allow the shirt length to be adjustable… 0% and make 100% at
 * mid-thigh"; 2026-10-24: "test making the fabric more weighty… tight/form fitting… Could potentially even add sliders").
 *
 * `scripts/sarahV2Recovery/shirt-cloth.mjs` writes the cloth from the light tee; this holds what the room reads from it
 * (`sarahlab/clothShirt.ts`), and what the room's dials mean (`sarahLabTool.ts`). The solver, the skin reader and the
 * neckline's cut have their own tests (`clothSim.test.ts`, `clothSkin.test.ts`, `clothNeckline.test.ts`).
 */
import { statSync } from 'node:fs';
import { NodeIO, type Document, type Primitive } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  CLOTH_DIALS, CLOTH_NECKLINE_DEFAULT, CLOTH_SHIRT_PATH, CLOTH_TEE_LENGTH_DEFAULT, CLOTH_TUNE_DEFAULT, type ClothDial, clothCompliance, clothDamping, clothFriction, clothFrictionAcross, clothGravityScale, clothLine,
  clothMaxStretch, clothRestScale, clothStandOffMm, clothSubsteps, clothTuning, necklineLine, neckShapeLine, teeLengthLine,
} from '../src/sarahlab/sarahLabTool';
import { clothNecklineBelow } from '../src/sarahlab/clothNeckline';
import { SARAH_V2_DETAIL_POINTS } from '../src/sarahlab/detailSpots';

const CLOTH = `public/${CLOTH_SHIRT_PATH}`;
interface ClothExtras {
  detail: { navel: number; navelRings: number[][]; nipples: number[]; nippleRings: number[][][]; navelZoneM: number[]; ringsM: number[][] }; version: number; particles: number; teeParticles: number; rows: number; columns: number; armBones: number[]; rowStepM: number; midThighM: number; localToMetres: number; pinIn: number; pinOut: number;
  collar: { start: number; rows: number; columns: number; neck: number[]; lengthM: number; topM: number; chinM: number };
  neckline: { deepestM: number; scoopM: number; foldM: number; acrossM: number[]; farM: number };
}
let doc: Document, prim: Primitive, cloth: ClothExtras;
beforeAll(async () => {
  await MeshoptDecoder.ready;
  doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder }).read(CLOTH);
  const mesh = doc.getRoot().listMeshes()[0];
  prim = mesh.listPrimitives()[0];
  cloth = (mesh.getExtras() as { cloth: ClothExtras }).cloth;
}, 60000);

const column = (name: string): Float32Array => prim.getAttribute(name)!.getArray() as Float32Array;

describe('the cloth tee file', () => {
  it('is one small mesh: the tee as one sheet, and rows below its hem to mid-thigh', () => {
    expect(statSync(CLOTH).size).toBeLessThan(1024 * 1024);
    expect(doc.getRoot().listMeshes()).toHaveLength(1);
    expect(doc.getRoot().listSkins()).toHaveLength(0); // it is not skinned: the cloth moves it
    expect(prim.listTargets()).toHaveLength(0);
    expect(cloth.version).toBe(3);
    expect(cloth.collar.start).toBe(cloth.teeParticles + cloth.rows * cloth.columns);
    expect(cloth.particles).toBe(cloth.collar.start + cloth.collar.rows * cloth.collar.columns);
    expect(cloth.teeParticles).toBeGreaterThan(3000);
    expect(cloth.teeParticles).toBeLessThan(8000);
    expect(cloth.rows).toBeGreaterThan(10);
    expect(cloth.midThighM).toBeGreaterThan(0.6);
    expect(cloth.midThighM).toBeLessThan(0.8);
    expect(cloth.armBones.length).toBeGreaterThan(0);
    expect(cloth.pinIn).toBeLessThan(cloth.pinOut);
  });

  it('takes her arms for arms and her thighs for legs: the same bones each side, every one hanging from her chest', async () => {
    // the first rule took her left thigh's bone (10.3 cm off her middle, 0.89 m up) for an arm, and the rows below the hem
    // wrapped her right leg only, and the cloth could not rest on her left thigh
    const body = await new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder }).read('public/models/sarah-v2-body-slim.glb');
    const joints = body.getRoot().listSkins()[0].listJoints(), parent = new Map<unknown, (typeof joints)[number]>();
    for (const n of body.getRoot().listNodes()) for (const c of n.listChildren()) parent.set(c, n);
    let left = 0, right = 0;
    for (const k of cloth.armBones) {
      const j = joints[k];
      let chest = false; for (let n = parent.get(j); n; n = parent.get(n)) if (n.getWorldTranslation()[1] > 1.2) chest = true;
      expect(chest, j.getName()).toBe(true);
      if (j.getWorldTranslation()[0] < 0) left++; else right++;
    }
    expect(left).toBe(right);
    expect(left).toBeGreaterThan(3);
  }, 60000);

  it('knows where her navel and nipples are, each with a ring of skin round it, and smooths only round her navel', () => {
    // Joshua, 2026-10-24: "there are two bellybuttons, the top is the real one, the bottom for some reason is fixed on
    // the shirt": the tee's own navel impression is the _NAVEL zone, smoothed away in the room (clothShirt.ts)
    const d = cloth.detail;
    expect(d.navel).toBeGreaterThanOrEqual(0);
    expect(d.nipples).toHaveLength(2);
    expect(new Set([d.navel, ...d.nipples]).size).toBe(3);
    // an inner and an outer ring round each, the outer wider: her smooth surface and its curve without the detail
    expect(d.ringsM).toHaveLength(2);
    expect(d.ringsM[0][1]).toBeLessThan(d.ringsM[1][0]);
    for (const rings of [d.navelRings, ...d.nippleRings]) {
      expect(rings).toHaveLength(2);
      for (const ring of rings) { expect(ring.length).toBeGreaterThanOrEqual(12); expect(new Set(ring).size).toBe(ring.length); }
    }
    expect(d.navelZoneM[0]).toBeLessThan(d.navelZoneM[1]);
    const zone = column('_NAVEL'), row = column('_ROW');
    let inZone = 0;
    for (let v = 0; v < zone.length; v++) { expect(zone[v]).toBeGreaterThanOrEqual(0); expect(zone[v]).toBeLessThanOrEqual(1); if (zone[v] > 0) { inZone++; expect(row[v]).toBe(0); } }
    expect(inZone).toBeGreaterThan(20);
    expect(inZone).toBeLessThan(zone.length / 20);
  });

  it('names the same navel and nipples, and the same rings, as the room holds for the fitted tee', () => {
    // detailSpots.ts keeps a copy for the fitted tee, which never loads the cloth file: the two must not drift
    const d = cloth.detail, p = SARAH_V2_DETAIL_POINTS;
    expect(p.navel).toBe(d.navel);
    expect(p.navelRings).toEqual(d.navelRings);
    expect(p.nipples).toEqual(d.nipples);
    expect(p.nippleRings).toEqual(d.nippleRings);
  });

  it('has a hem spaced like the rest of the cloth, not the modelled fold\'s every point', () => {
    // Joshua, 2026-10-24: "the 0% shirt bottom hem/seams, was not straight": 327 points, some 0.1 mm apart, crumpled
    const particle = column('_PARTICLE'), row = column('_ROW'), pos = prim.getAttribute('POSITION')!.getArray() as Float32Array, I = prim.getIndices()!.getArray()!;
    const use = new Map<string, number>(), next = new Map<number, number>();
    const tee: number[][] = [];
    for (let t = 0; t < I.length; t += 3) { const v = [I[t], I[t + 1], I[t + 2]]; if (v.some((x) => row[x] !== 0 || particle[x] >= cloth.collar.start)) continue; tee.push(v.map((x) => particle[x])); }
    for (const [a, b, c] of tee) for (const [x, y] of [[a, b], [b, c], [c, a]]) { const k = x < y ? `${x},${y}` : `${y},${x}`; use.set(k, (use.get(k) ?? 0) + 1); }
    for (const [a, b, c] of tee) for (const [x, y] of [[a, b], [b, c], [c, a]]) if (use.get(x < y ? `${x},${y}` : `${y},${x}`) === 1) next.set(x, y);
    const at = new Map<number, number>(); for (let v = 0; v < particle.length; v++) at.set(particle[v], v);
    const y = (p: number) => pos[at.get(p)! * 3 + 1];
    const loops: number[][] = [], seen = new Set<number>();
    for (const s of next.keys()) { if (seen.has(s)) continue; const l: number[] = []; let v: number | undefined = s; while (v !== undefined && !seen.has(v)) { seen.add(v); l.push(v); v = next.get(v); } loops.push(l); }
    expect(loops).toHaveLength(4); // neckline, two sleeves, hem
    const hem = loops.reduce((a, b) => (a.reduce((s, p) => s + y(p), 0) / a.length < b.reduce((s, p) => s + y(p), 0) / b.length ? a : b));
    const gap = (a: number, b: number) => { const i = at.get(a)! * 3, j = at.get(b)! * 3; return Math.hypot(pos[i] - pos[j], pos[i + 1] - pos[j + 1], pos[i + 2] - pos[j + 2]) * cloth.localToMetres * 1000; };
    const gaps = hem.map((p, i) => gap(p, hem[(i + 1) % hem.length])).sort((a, b) => a - b);
    expect(gaps[gaps.length >> 1]).toBeGreaterThan(8);
    expect(gaps[0]).toBeGreaterThan(1);
    // and the neckline and sleeves thinned too (Joshua, 2026-10-24: "around the top and sleeves, it's all messed up
    // and jagged looking like something ripped it"): they kept the modelled folds' every point, 2-3 mm apart (the
    // neckline 242 of them, the sleeves 146 and 126), where the cloth is 11 mm apart
    for (const edge of loops.filter((l) => l !== hem)) {
      const g = edge.map((p, i) => gap(p, edge[(i + 1) % edge.length])).sort((a, b) => a - b);
      expect(edge.length).toBeLessThan(110);
      expect(g[g.length >> 1]).toBeGreaterThan(4.5);
    }
  });

  it('holds each sleeve\'s hem fully to her arm, easing off up the sleeve', () => {
    // seated, her arms come forward; held only at its very edge the sleeve's front stayed with her trunk and her arm
    // went through it. Held softly (0.35) the hem ruffled between its holds, and its run under her arm, held to her side
    // while the rest was held to her arm, was pulled apart into teeth (Joshua, 2026-10-24: "these don't have a straight
    // shoulder edge like all the rest"): the hem is held as the neckline is, and only where it is on her arm.
    const pin = column('_PIN'), particle = column('_PARTICLE'), pos = prim.getAttribute('POSITION')!.getArray() as Float32Array;
    const at = new Map<number, number>(); for (let v = 0; v < particle.length; v++) at.set(particle[v], v);
    const neck = cloth.collar.neck.map((p) => at.get(p)!), m = cloth.localToMetres;
    let full = 0, easing = 0;
    for (let v = 0; v < pin.length; v++) {
      if (particle[v] >= cloth.teeParticles || pin[v] <= 0) continue;
      // a sleeve's hold: further from the neckline than the neckline's own hold reaches
      let d = Infinity; for (const n of neck) d = Math.min(d, Math.hypot(pos[v * 3] - pos[n * 3], pos[v * 3 + 1] - pos[n * 3 + 1], pos[v * 3 + 2] - pos[n * 3 + 2]) * m);
      if (d < cloth.pinOut) continue;
      if (pin[v] === 1) full++; else easing++;
    }
    expect(full).toBeGreaterThan(20);
    expect(easing).toBeGreaterThan(20);
  });

  it('lays the tee over her skin, never inside it, and binds each point to skin it stands over', () => {
    // the modelled tee's underarms passed through her arms by up to 3.7 cm, and points in the hollow of her armpit were
    // bound to her arm along a triangle's plane far past its edges: carried that far, they swung as she moved
    const off = column('_OFFSET'), bary = column('_BODY_BARY'), particle = column('_PARTICLE');
    const seen = new Set<number>(); let under = 0, past = 0;
    for (let v = 0; v < particle.length; v++) {
      const p = particle[v]; if (p >= cloth.teeParticles || seen.has(p)) continue; seen.add(p);
      if (off[v] * cloth.localToMetres < -0.003) under++;
      if (Math.min(bary[v * 3], bary[v * 3 + 1], bary[v * 3 + 2]) < -0.1) past++;
    }
    expect(under).toBeLessThanOrEqual(5);   // was 126
    expect(past).toBeLessThan(200);         // was 908
  });

  it('carries every column the room reads, one value per drawn vertex', () => {
    const count = prim.getAttribute('POSITION')!.getCount();
    for (const name of ['TEXCOORD_0', '_PARTICLE', '_BODY_TRI', '_BODY_BARY', '_OFFSET', '_PIN', '_ROW', '_ANCHOR', '_NAVEL', '_NECK']) {
      expect(prim.getAttribute(name), name).not.toBeNull();
      expect(prim.getAttribute(name)!.getCount(), name).toBe(count);
    }
    expect(prim.getIndices()!.getCount() % 3).toBe(0);
  });

  it('names every particle, rows run from the tee (0) to mid-thigh, and each row below the hem hangs from the tee', () => {
    const particle = column('_PARTICLE'), row = column('_ROW'), anchor = column('_ANCHOR'), pin = column('_PIN'), bary = column('_BODY_BARY');
    const seen = new Uint8Array(cloth.particles);
    let rows = 0;
    for (let v = 0; v < particle.length; v++) {
      const p = particle[v];
      expect(Number.isInteger(p) && p >= 0 && p < cloth.particles).toBe(true);
      seen[p] = 1;
      rows = Math.max(rows, row[v]);
      // the tee's own particles are row 0, and the collar's; the rows below the hem are the particles between them
      expect(row[v] === 0).toBe(p < cloth.teeParticles || p >= cloth.collar.start);
      // every particle below the hem is laid from a particle of the tee's hem
      if (p >= cloth.teeParticles && p < cloth.collar.start) expect(anchor[v]).toBeLessThan(cloth.teeParticles);
      expect(pin[v]).toBeGreaterThanOrEqual(0);
      expect(pin[v]).toBeLessThanOrEqual(1);
      const b = bary[v * 3] + bary[v * 3 + 1] + bary[v * 3 + 2];
      expect(Math.abs(b - 1)).toBeLessThan(1e-3);
    }
    expect(seen.every((s) => s === 1)).toBe(true);
    expect(rows).toBe(cloth.rows);
    // it hangs from her neckline: some particles are held, most are free; the collar is held by the room, not the file
    const held = [...pin].filter((x) => x > 0).length;
    expect(held).toBeGreaterThan(0);
    expect(held).toBeLessThan(pin.length / 3);
    for (let v = 0; v < particle.length; v++) if (particle[v] >= cloth.collar.start) expect(pin[v]).toBe(0);
  });

  it('carries a collar up her neck from the neckline to below her chin, wound as the tee is', () => {
    // Joshua, 2026-10-24: "can the neckline also be adjustable like the length so you can do U/V shape and select how
    // deep up to turtleneck?"
    const c = cloth.collar, particle = column('_PARTICLE'), neck = column('_NECK'), pos = prim.getAttribute('POSITION')!.getArray() as Float32Array, I = prim.getIndices()!.getArray()!;
    expect(c.columns).toBe(c.neck.length);
    expect(c.rows).toBeGreaterThanOrEqual(8);
    expect(c.rows).toBeLessThanOrEqual(24);
    for (const p of c.neck) expect(p).toBeLessThan(cloth.teeParticles);
    // its top 1-3 cm under her chin; its columns a few cm (at her back) to a hand's width (down her front)
    expect(c.chinM - c.topM).toBeGreaterThan(0.01);
    expect(c.chinM - c.topM).toBeLessThan(0.03);
    expect(c.lengthM).toBeGreaterThan(0.05);
    expect(c.lengthM).toBeLessThan(0.15);
    // each collar particle's share of its height is its row over the rows, and only the collar has one
    for (let v = 0; v < particle.length; v++) {
      const p = particle[v], share = neck[v * 4 + 3];
      if (p < c.start) expect(share).toBe(0);
      else expect(share).toBeCloseTo(Math.floor((p - c.start) / c.columns + 1) / c.rows, 5);
    }
    // wound as the tee is: every edge two triangles share runs one way in one and the other way in the other, across
    // the neckline too (the collar's normals face out from her as the tee's do)
    const runs = new Map<string, number>();
    for (let t = 0; t < I.length; t += 3) for (let e = 0; e < 3; e++) { const a = particle[I[t + e]], b = particle[I[t + (e + 1) % 3]]; runs.set(`${a},${b}`, (runs.get(`${a},${b}`) ?? 0) + 1); }
    let across = 0;
    for (const [k, n] of runs) { expect(n, k).toBe(1); const [a, b] = k.split(',').map(Number); if (c.neck.includes(a) && c.neck.includes(b) && runs.has(`${b},${a}`)) across++; }
    expect(across).toBeGreaterThan(c.columns * 1.5); // the neckline's edges, each once each way
    // its top row is a ring round her neck, level: within 2 mm of one height
    const at = new Map<number, number>(); for (let v = 0; v < particle.length; v++) at.set(particle[v], v);
    const top = Array.from({ length: c.columns }, (_, j) => pos[at.get(c.start + (c.rows - 1) * c.columns + j)! * 3 + 1] * cloth.localToMetres);
    expect(Math.max(...top) - Math.min(...top)).toBeLessThan(0.004);
  });

  it('knows how far below the neckline each point of its front stands, so a U or a V can be cut to under her bust', () => {
    // Joshua, 2026-10-24: "I would set the deepest/lowest point between the breasts and top belly"
    const n = cloth.neckline, particle = column('_PARTICLE'), neck = column('_NECK');
    expect(n.deepestM).toBeGreaterThan(0.08);
    expect(n.deepestM).toBeLessThan(0.16);
    expect(n.scoopM - n.foldM).toBeCloseTo(n.deepestM, 3);
    expect(n.acrossM[0]).toBeLessThan(-0.06);
    expect(n.acrossM[1]).toBeGreaterThan(0.06);
    let front = 0, inU = 0, inV = 0;
    const seen = new Set<number>();
    for (let v = 0; v < particle.length; v++) {
      const p = particle[v], q: [number, number, number, number] = [neck[v * 4], neck[v * 4 + 1], neck[v * 4 + 2], neck[v * 4 + 3]];
      if (q[0] >= n.farM) { expect(q[1]).toBe(n.farM); expect(q[2]).toBe(0); continue; }
      // only the tee's own front is ever cut: never the rows below its hem or the collar
      expect(p).toBeLessThan(cloth.teeParticles);
      expect(q[2]).toBeGreaterThanOrEqual(0); expect(q[2]).toBeLessThan(1);
      // never above the neckline by more than its own smoothing, and as made nothing is cut
      expect(q[0]).toBeGreaterThan(-0.007);
      expect(clothNecklineBelow(q, 0, 'U')).toBe(q[0]);
      if (seen.has(p)) continue;
      seen.add(p); front++;
      if (clothNecklineBelow(q, n.deepestM, 'U') < 0) inU++;
      if (clothNecklineBelow(q, n.deepestM, 'V') < 0) inV++;
    }
    // a front of a few thousand points, of which a U at its deepest takes a couple of hundred and a V about half that
    expect(front).toBeGreaterThan(500);
    expect(inU).toBeGreaterThan(100);
    expect(inU).toBeLessThan(400);
    expect(inV).toBeGreaterThan(50);
    expect(inV).toBeLessThan(inU);
  });
});

describe('the cloth dials', () => {
  const keys = Object.keys(CLOTH_TUNE_DEFAULT) as ClothDial[];

  it('has one dial for every setting, each a 0-100 slider whose line reads what it sets', () => {
    expect(CLOTH_DIALS.map((d) => d.key).sort()).toEqual([...keys].sort());
    for (const k of keys) {
      expect(CLOTH_TUNE_DEFAULT[k]).toBeGreaterThanOrEqual(0);
      expect(CLOTH_TUNE_DEFAULT[k]).toBeLessThanOrEqual(100);
    }
    for (const d of CLOTH_DIALS) for (const v of [0, 50, 100]) expect(d.line(v)).toMatch(/^[A-Z]+ · /);
  });

  it('runs each from one end to the other, clamped, and never to a number the solver cannot take', () => {
    expect(clothGravityScale(0)).toBeCloseTo(0.25);
    expect(clothGravityScale(100)).toBeCloseTo(4);
    expect(clothGravityScale(50)).toBeCloseTo(1); // the middle is real gravity
    expect(clothDamping(0)).toBe(0);
    expect(clothDamping(100)).toBe(12);
    expect(clothRestScale(0)).toBeCloseTo(1.05);
    expect(clothRestScale(100)).toBeCloseTo(0.85);
    expect(clothStandOffMm(0)).toBeCloseTo(6);
    expect(clothStandOffMm(100)).toBeCloseTo(0.5);
    expect(clothCompliance(0)).toBeCloseTo(1e-8);
    expect(clothCompliance(100)).toBeCloseTo(1e-4);
    expect(clothMaxStretch(0)).toBeCloseTo(1.15);
    expect(clothFriction(100)).toBe(1);
    expect(clothFrictionAcross(100)).toBeCloseTo(0.2); // "only a max of 20% loss horizontally"
    expect(CLOTH_DIALS.find((d) => d.key === 'grip')!.line(50)).toBe('GRIP · up and down 0.50 · across 0.10');
    expect(clothSubsteps(0)).toBe(2);
    expect(clothSubsteps(100)).toBe(16);
    for (const f of [clothGravityScale, clothDamping, clothRestScale, clothStandOffMm, clothCompliance, clothMaxStretch, clothFriction, clothFrictionAcross, clothSubsteps]) {
      expect(f(-50)).toBe(f(0));
      expect(f(250)).toBe(f(100));
      expect(f(Number.NaN)).toBe(f(0));
    }
  });

  it('opens at Joshua\'s own setting, found on his phone: half gravity, settling fast, snug, half a millimetre off her, STRETCH in the middle', () => {
    expect(CLOTH_TUNE_DEFAULT).toEqual({ weight: 25, calm: 100, fit: 100, close: 100, stretch: 50, grip: 50, steps: 43 });
    const { settings, standOff } = clothTuning(CLOTH_TUNE_DEFAULT);
    expect(-settings.gravity[1]).toBeCloseTo(981 * 0.5);
    expect(settings.damping).toBeCloseTo(12);
    expect(settings.restScale).toBeCloseTo(0.85);
    expect(standOff).toBeCloseTo(0.05); // world units, 100 a metre: 0.5 mm
    expect(settings.maxStretch).toBeCloseTo(1.4);
    expect(settings.stretchCompliance).toBeCloseTo(1e-6, 9);
    expect(settings.friction).toBeCloseTo(0.5);
    expect(settings.frictionAcross).toBeCloseTo(0.1); // GRIP holds mostly up and down: a fifth of it across her
    expect(settings.substeps).toBe(8);
    expect(settings.gravity[0]).toBe(0);
    expect(settings.gravity[2]).toBe(0);
    expect(CLOTH_TEE_LENGTH_DEFAULT).toBeCloseTo(0.2);
  });
});

describe('the cloth lines', () => {
  it('reads the tee length from as made to mid-thigh, and says it needs the cloth', () => {
    expect(teeLengthLine(0, true)).toBe('TEE LENGTH · 0% · as made');
    expect(teeLengthLine(1, true)).toBe('TEE LENGTH · 100% · mid-thigh');
    expect(teeLengthLine(2, true)).toBe('TEE LENGTH · 100% · mid-thigh');
    expect(teeLengthLine(0.3, true)).toContain('over her hips');
    expect(teeLengthLine(0.6, true)).toContain('upper thigh');
    expect(teeLengthLine(0.6, false)).toContain('with CLOTH SIM');
  });

  it('reads the neckline from a turtleneck through the scoop as made to a U or a V under her bust', () => {
    expect(CLOTH_NECKLINE_DEFAULT).toBe(0);
    expect(necklineLine(0, 'U', 12.6, true)).toBe('NECKLINE · as made (scoop)');
    expect(necklineLine(-100, 'U', 12.6, true)).toBe('NECKLINE · turtleneck · 100% of the collar');
    expect(necklineLine(-60, 'U', 12.6, true)).toContain('mock neck');
    expect(necklineLine(-30, 'U', 12.6, true)).toContain('crew neck');
    expect(necklineLine(-10, 'U', 12.6, true)).toContain('higher scoop');
    expect(necklineLine(50, 'U', 12.6, true)).toBe('NECKLINE · U · 6.3 cm deeper');
    expect(necklineLine(100, 'V', 12.6, true)).toBe('NECKLINE · V · 12.6 cm deeper · to under her bust');
    expect(necklineLine(250, 'V', 12.6, true)).toBe(necklineLine(100, 'V', 12.6, true));
    expect(necklineLine(Number.NaN, 'V', 12.6, true)).toBe(necklineLine(0, 'V', 12.6, true));
    expect(necklineLine(40, 'U', 12.6, false)).toContain('with CLOTH SIM');
    expect(neckShapeLine('V', 40)).toBe('NECK SHAPE · V');
    expect(neckShapeLine('U', 0)).toBe('NECK SHAPE · U · for a deeper cut');
  });

  it('prints what the cloth costs, part by part, and the frame rate', () => {
    const line = clothLine({ particles: 5160, skinMs: 1.24, simMs: 2.5, drawMs: 0.3, substeps: 8, posed: 5160 }, 16.7);
    expect(line).toBe('CLOTH · 4.0 ms · 60 fps · 5,160 points · skin 1.2 + cloth 2.5 + draw 0.3 · 8 steps');
    expect(clothLine({ particles: 1, skinMs: 0, simMs: 0, drawMs: 0, substeps: 2, posed: 1 }, 0)).toContain('1000 fps');
  });
});
