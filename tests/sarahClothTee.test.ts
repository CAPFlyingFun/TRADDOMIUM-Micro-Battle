/**
 * THE CLOTH TEE (Joshua, 2026-10-23: "create another copy of that same shirt, but make that one a true soft body/cloth
 * with simulation over the whole thing"; 2026-10-23: "allow the shirt length to be adjustable… 0% and make 100% at
 * mid-thigh"; 2026-10-24: "test making the fabric more weighty… tight/form fitting… Could potentially even add sliders").
 *
 * `scripts/sarahV2Recovery/shirt-cloth.mjs` writes the cloth from the light tee; this holds what the room reads from it
 * (`sarahlab/clothShirt.ts`), and what the room's dials mean (`sarahLabTool.ts`). The solver and the skin reader have
 * their own tests (`clothSim.test.ts`, `clothSkin.test.ts`).
 */
import { statSync } from 'node:fs';
import { NodeIO, type Document, type Primitive } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  CLOTH_DIALS, CLOTH_SHIRT_PATH, CLOTH_TUNE_DEFAULT, type ClothDial, clothCompliance, clothDamping, clothFriction, clothGravityScale, clothLine,
  clothMaxStretch, clothRestScale, clothStandOffMm, clothSubsteps, clothTuning, teeLengthLine,
} from '../src/sarahlab/sarahLabTool';

const CLOTH = `public/${CLOTH_SHIRT_PATH}`;
interface ClothExtras { version: number; particles: number; teeParticles: number; rows: number; columns: number; armBones: number[]; rowStepM: number; midThighM: number; localToMetres: number; pinIn: number; pinOut: number }
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
    expect(cloth.version).toBe(1);
    expect(cloth.particles).toBe(cloth.teeParticles + cloth.rows * cloth.columns);
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

  it('carries every column the room reads, one value per drawn vertex', () => {
    const count = prim.getAttribute('POSITION')!.getCount();
    for (const name of ['TEXCOORD_0', '_PARTICLE', '_BODY_TRI', '_BODY_BARY', '_OFFSET', '_PIN', '_ROW', '_ANCHOR']) {
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
      // the tee's own particles are row 0; the rows below it are the particles past the tee
      expect(row[v] === 0).toBe(p < cloth.teeParticles);
      // every particle below the hem is laid from a particle of the tee's hem
      if (p >= cloth.teeParticles) expect(anchor[v]).toBeLessThan(cloth.teeParticles);
      expect(pin[v]).toBeGreaterThanOrEqual(0);
      expect(pin[v]).toBeLessThanOrEqual(1);
      const b = bary[v * 3] + bary[v * 3 + 1] + bary[v * 3 + 2];
      expect(Math.abs(b - 1)).toBeLessThan(1e-3);
    }
    expect(seen.every((s) => s === 1)).toBe(true);
    expect(rows).toBe(cloth.rows);
    // it hangs from her neckline: some particles are held, most are free
    const held = [...pin].filter((x) => x > 0).length;
    expect(held).toBeGreaterThan(0);
    expect(held).toBeLessThan(pin.length / 3);
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
    expect(clothSubsteps(0)).toBe(2);
    expect(clothSubsteps(100)).toBe(16);
    for (const f of [clothGravityScale, clothDamping, clothRestScale, clothStandOffMm, clothCompliance, clothMaxStretch, clothFriction, clothSubsteps]) {
      expect(f(-50)).toBe(f(0));
      expect(f(250)).toBe(f(100));
      expect(f(Number.NaN)).toBe(f(0));
    }
  });

  it('opens weighty and form-fitting, as Joshua asked: heavier than real, settling, snug and close to her', () => {
    const { settings, standOff } = clothTuning(CLOTH_TUNE_DEFAULT);
    expect(-settings.gravity[1]).toBeGreaterThan(981);
    expect(settings.damping).toBeGreaterThan(2);
    expect(settings.restScale).toBeLessThan(1);
    expect(standOff).toBeLessThan(0.3); // world units, 100 a metre: under 3 mm
    expect(standOff).toBeGreaterThan(0);
    expect(settings.friction).toBeGreaterThan(0.5);
    expect(settings.substeps).toBeGreaterThanOrEqual(6);
    expect(settings.gravity[0]).toBe(0);
    expect(settings.gravity[2]).toBe(0);
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

  it('prints what the cloth costs, part by part, and the frame rate', () => {
    const line = clothLine({ particles: 5160, skinMs: 1.24, simMs: 2.5, drawMs: 0.3, substeps: 8, posed: 5160 }, 16.7);
    expect(line).toBe('CLOTH · 5,160 points · skin 1.2 + cloth 2.5 + draw 0.3 = 4.0 ms · 8 steps · 60 fps');
    expect(clothLine({ particles: 1, skinMs: 0, simMs: 0, drawMs: 0, substeps: 2, posed: 1 }, 0)).toContain('1000 fps');
  });
});
