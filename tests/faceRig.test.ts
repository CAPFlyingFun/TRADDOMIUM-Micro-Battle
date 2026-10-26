/**
 * HER FACE, AS A SHADER LAYER (Joshua, 2026-10-24: "would like to somehow add bones in or something around the mouth to
 * open and close like talking, and maybe the illusion of the eyes being able to look around in sync").
 * `faceRig.ts` draws a jaw, a mouth's inside, eyes that look, lids, lashes, brows and a lip tint on her approved body,
 * from where each point of her stands at rest. Here: the CPU mirrors say what the shader draws -- the jaw weight is 0
 * everywhere that must not move and 1 on the chin and the lower lip, with a sharp step across the lips and a soft one
 * across the cheeks, and a corner taper that opens the mouth as a lens without touching the chin; the jaw turns about
 * its hinge; the mouth's inside is measured from where the lips actually are against their analytic edges, so its
 * every edge is a smooth curve (the second pass, 2026-10-24: the first read as stripes and cracks), closes toward the
 * corners, paints nothing with the jaw shut and nothing on a lip's own surface; the teeth come in with the opening; the
 * eyes' regions follow the gaze and the blink; the brows are rounded at the head and pointed at the tail. The patch is applied once, chains whatever the material had, hooks
 * three's standard shader where it says and keeps every token, lives alongside the fabric's patch in either order, and
 * switched off leaves nothing on. `restFromWorld` inverts three's own skinning for the head bone. And the measured
 * constants are pinned against the file itself.
 */
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import {
  FACE_BROWS, FACE_DEFAULTS, FACE_EYE_CENTRES, FACE_EYES, FACE_HEAD, FACE_HEAD_BONE, FACE_JAW_HINGE, FACE_JAW_MAX,
  FACE_MOUTH, FACE_MOUTH_INSIDE, FACE_MOUTH_TAPER, FACE_REST_OFFSET, FACE_REST_SCALE,
  faceBrowAlpha, faceBrowLine, faceEyeRegion, faceJawMove, faceJawSeam, faceJawWeight, faceLipAlpha, faceMouthEdges,
  faceMouthInterior, faceMouthSample, patchFaceRig, restFromWorld, setFaceRig, type FaceEyeRegion, type FaceRigState,
} from '../src/sarahlab/faceRig';
import { FACE_MOTION_EYE_CENTRES } from '../src/sarahlab/faceMotion';
import { setFabricLayer } from '../src/sarahlab/fabricMaterial';

type P = [number, number, number];

/** Run a material's onBeforeCompile on three's own standard shader, the way the renderer would. */
function compiled(material: THREE.Material): { uniforms: Record<string, THREE.IUniform>; vertexShader: string; fragmentShader: string } {
  const shader = {
    uniforms: {} as Record<string, THREE.IUniform>,
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  };
  material.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
  return shader;
}
const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;
const dist = (a: readonly number[], b: readonly number[]): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const AHEAD: FaceRigState = { jaw: 0, gazeRight: [0, 0, 1], gazeLeft: [0, 0, 1], blink: 0 };
const face = (o: Partial<FaceRigState> = {}): FaceRigState => ({ ...AHEAD, ...o });

describe('the jaw weight', () => {
  it('is 0 everywhere that must not move: forehead, nose, upper lip, ears, the back of the head', () => {
    const still: Record<string, P> = {
      forehead: [0, 1.65, 0.005],
      brow: [0.03, 1.607, 0.0],
      eye: [-0.0302, 1.5835, 0.0],
      'nose tip': FACE_HEAD.noseTip as P,
      'upper lip centre': [0, 1.524, 0.015],
      'upper lip at the seam, 1 mm up': [0, FACE_MOUTH.seamY + 0.001, FACE_MOUTH.seamZ],
      'right ear': [-0.08, 1.57, -0.10],
      'left ear': [0.08, 1.57, -0.10],
      'back of the head': [0, 1.60, -0.12],
      'back of the head, low': [0, 1.52, -0.11],
      'nape': [0, 1.47, -0.09],
      'head top': [0, FACE_HEAD.top, -0.02],
    };
    for (const [name, p] of Object.entries(still)) expect(faceJawWeight(p), name).toBe(0);
  });

  it('is 1 on the chin and the lower lip', () => {
    expect(faceJawWeight([0, 1.495, 0.004])).toBeCloseTo(1, 6);
    expect(faceJawWeight([0, 1.514, 0.013])).toBeCloseTo(1, 6);
    expect(faceJawWeight([0.01, 1.505, 0.006])).toBeCloseTo(1, 6);
    expect(faceJawWeight([0, FACE_MOUTH.seamY - 0.001, FACE_MOUTH.seamZ])).toBeGreaterThan(0.99);
  });

  it('steps sharply across the lips: from over 0.9 to under 0.1 inside 1.2 mm at the middle, all of it inside 2 mm', () => {
    // the brief's step is 0.5° either side of the seam about a hinge 9.3 cm behind it: 0.1 to 0.9 spans 1.15 mm upright
    const at = (dy: number) => faceJawWeight([0, FACE_MOUTH.seamY + dy, FACE_MOUTH.seamZ]);
    expect(at(-0.0006)).toBeGreaterThan(0.9);
    expect(at(0.0006)).toBeLessThan(0.1);
    expect(at(-0.001)).toBe(1);
    expect(at(0.001)).toBe(0);
    // and it falls the whole way, never rising
    for (let dy = -0.002; dy < 0.002; dy += 0.0001) expect(at(dy + 0.0001)).toBeLessThanOrEqual(at(dy) + 1e-12);
  });

  it('changes gently across the cheek: no step, at most 0.6 over any 5 mm and 0.15 over any 1 mm at x = 0.04', () => {
    // the brief's 0.5 over 5 mm held for the seam weight alone; the corner taper (held at 0.35 out past the commissure
    // and gone 8 mm under the seam) steepens the cheek a little, to 0.57 at its worst
    for (const z of [-0.012, -0.006, 0]) {
      for (let y = 1.49; y <= 1.545; y += 0.0005) {
        const a = faceJawWeight([0.04, y, z]);
        expect(Math.abs(a - faceJawWeight([0.04, y + 0.005, z])), `y ${y.toFixed(4)} z ${z}`).toBeLessThan(0.6);
        expect(Math.abs(a - faceJawWeight([0.04, y + 0.001, z])), `y ${y.toFixed(4)} z ${z}`).toBeLessThan(0.15);
        expect(Math.abs(faceJawSeam([0.04, y, z]) - faceJawSeam([0.04, y + 0.005, z])), `seam y ${y.toFixed(4)} z ${z}`).toBeLessThan(0.5);
      }
    }
    // it does go all the way across there: the cheek below the mouth's corner opens with the jaw
    expect(faceJawWeight([0.04, 1.49, -0.006])).toBeGreaterThan(0.9);
    expect(faceJawWeight([0.04, 1.545, -0.006])).toBeLessThan(0.1);
  });

  it('is mirror-symmetric, and nothing moves past |x| 0.075', () => {
    for (const p of [[0.01, 1.51, 0.01], [0.03, 1.5, -0.01], [0.05, 1.49, -0.03]] as P[]) {
      expect(faceJawWeight([-p[0], p[1], p[2]])).toBe(faceJawWeight(p));
    }
    expect(faceJawWeight([0.0751, 1.49, 0.0])).toBe(0);
    expect(faceJawWeight([-0.0751, 1.49, 0.0])).toBe(0);
  });
});

describe('the jaw opening', () => {
  it('turns about the hinge: every point keeps its distance to it, and its x', () => {
    for (const p of [[0, 1.495, 0.004], [0, 1.514, 0.013], [0.02, 1.5, 0.0], [0.04, 1.51, -0.006], [0, 1.524, 0.015]] as P[]) {
      for (const jaw of [0.25, 0.6, 1]) {
        const moved = faceJawMove(p, jaw);
        expect(dist(moved, FACE_JAW_HINGE), `${p} ${jaw}`).toBeCloseTo(dist(p, FACE_JAW_HINGE), 12);
        expect(moved[0]).toBe(p[0]);
      }
    }
  });

  it('moves the chin down and back as it opens, by the whole angle at jaw 1, and nothing at jaw 0', () => {
    const chin: P = [0, 1.495, 0.004];
    let last = chin;
    for (const jaw of [0.2, 0.4, 0.6, 0.8, 1]) {
      const moved = faceJawMove(chin, jaw);
      expect(moved[1]).toBeLessThan(last[1]);
      expect(moved[2]).toBeLessThan(last[2]);
      last = moved;
    }
    const q0 = [chin[1] - FACE_JAW_HINGE[1], chin[2] - FACE_JAW_HINGE[2]], q1 = [last[1] - FACE_JAW_HINGE[1], last[2] - FACE_JAW_HINGE[2]];
    expect(Math.atan2(q0[0], q0[1]) - Math.atan2(q1[0], q1[1])).toBeCloseTo(FACE_JAW_MAX, 9);
    expect(faceJawMove(chin, 0)).toEqual(chin);
    // fully open drops the chin about 1.4 cm
    expect(chin[1] - last[1]).toBeGreaterThan(0.012);
    expect(chin[1] - last[1]).toBeLessThan(0.02);
    // a still point stays still, and the jaw is clamped as the uniforms are
    expect(faceJawMove([0, 1.524, 0.015], 1)).toEqual([0, 1.524, 0.015]);
    expect(faceJawMove(chin, 3)).toEqual(faceJawMove(chin, 1));
    expect(faceJawMove(chin, -1)).toEqual(chin);
    expect(faceJawMove(chin, Number.NaN)).toEqual(chin);
  });
});

describe('the corner taper', () => {
  const seamAt = (x: number): number => FACE_MOUTH.seamY + (FACE_MOUTH.cornerY - FACE_MOUTH.seamY) * Math.min(1, (x / FACE_MOUTH.cornerX) ** 2);

  it('takes nothing from the middle of the mouth, and is 0.35 of the seam weight at the commissure, just under the seam', () => {
    for (const x of [0, 0.004, 0.0099]) {
      for (const below of [0.0005, 0.002, 0.005]) {
        const p: P = [x, seamAt(x) - below, 0.008];
        expect(faceJawWeight(p), `${x} ${below}`).toBeCloseTo(faceJawSeam(p), 12);
      }
    }
    const corner: P = [FACE_MOUTH_TAPER.outerX, seamAt(FACE_MOUTH_TAPER.outerX) - 1e-9, -0.004];
    expect(faceJawWeight(corner) / faceJawSeam(corner)).toBeCloseTo(FACE_MOUTH_TAPER.corner, 6);
    // easing down between, never rising
    let last = 1;
    for (let x = FACE_MOUTH_TAPER.innerX; x <= FACE_MOUTH_TAPER.outerX; x += 0.0005) {
      const p: P = [x, seamAt(x) - 1e-9, 0.0];
      const share = faceJawWeight(p) / faceJawSeam(p);
      expect(share).toBeLessThanOrEqual(last + 1e-12);
      last = share;
    }
  });

  it('is gone 8 mm under the seam, so the lip\'s body and the chin move fully', () => {
    for (const x of [0.012, 0.018, 0.022, 0.024, 0.03]) {
      const p: P = [x, seamAt(x) - FACE_MOUTH_TAPER.depth, 0.0];
      expect(faceJawWeight(p), String(x)).toBeCloseTo(faceJawSeam(p), 12);
    }
  });

  it('leaves the chin\'s movement exactly as it was', () => {
    for (let x = -0.03; x <= 0.03; x += 0.005) {
      for (const y of [1.488, 1.495, 1.502]) {
        const chin: P = [x, y, 0.0];
        for (const jaw of [0.3, 1]) {
          const theta = jaw * FACE_JAW_MAX * faceJawSeam(chin);
          const qy = y - FACE_JAW_HINGE[1], qz = 0 - FACE_JAW_HINGE[2];
          const untapered = [x, FACE_JAW_HINGE[1] + qy * Math.cos(theta) - qz * Math.sin(theta), FACE_JAW_HINGE[2] + qy * Math.sin(theta) + qz * Math.cos(theta)];
          const moved = faceJawMove(chin, jaw);
          for (let k = 0; k < 3; k++) expect(moved[k], `${x} ${y} ${jaw}`).toBeCloseTo(untapered[k], 12);
        }
      }
    }
  });

  it('closes the opening toward the commissures: a lens, not a box', () => {
    for (const jaw of [0.3, 0.6, 1]) {
      const centre = faceMouthEdges(0, jaw).gap;
      expect(faceMouthEdges(0.022, jaw).gap, String(jaw)).toBeLessThan(0.4 * centre);
      // the gap only narrows going out, from |x| 0.01 to the corner
      let last = faceMouthEdges(0.01, jaw).gap;
      for (let x = 0.0105; x <= 0.024; x += 0.0005) {
        const g = faceMouthEdges(x, jaw).gap;
        expect(g).toBeLessThan(last);
        last = g;
      }
      // the upper lip's edge does not move; the lower lip's falls with the jaw
      expect(faceMouthEdges(0.01, jaw).up).toBe(faceMouthEdges(0.01, 0).up);
      expect(faceMouthEdges(0.01, jaw).lo).toBeLessThan(faceMouthEdges(0.01, 0).lo);
    }
    // shut, there is no gap anywhere
    for (const x of [0, 0.01, 0.02, 0.024]) expect(faceMouthEdges(x, 0).gap).toBe(0);
  });
});

/** The region at a rest (x, y) on the face's front, z 0. */
const region = (x: number, y: number, state: FaceRigState = AHEAD, z = 0): FaceEyeRegion => faceEyeRegion([x, y, z], state);
const yaw = (deg: number): P => [Math.sin(deg * Math.PI / 180), 0, Math.cos(deg * Math.PI / 180)];

describe('the eyes', () => {
  const eyes = { right: FACE_EYES.right, left: FACE_EYES.left } as const;

  for (const side of ['right', 'left'] as const) {
    const eye = eyes[side], [cx, cy] = eye.centre;

    it(`(${side}) looking ahead: the pupil in front of the eyeball's centre, sclera 6.5 mm either side`, () => {
      expect(region(cx, cy)).toBe('pupil');
      expect(region(cx + 0.0065, cy)).toBe('sclera');
      expect(region(cx - 0.0065, cy)).toBe('sclera');
      // the iris rings the pupil
      expect(region(cx + 0.0035, cy)).toBe('iris');
      expect(region(cx - 0.0035, cy)).toBe('iris');
      // a bigger pupil takes more of it
      expect(region(cx + 0.0025, cy)).toBe('iris');
      expect(region(cx + 0.0025, cy, face({ pupil: 0.003 }))).toBe('pupil');
    });

    it(`(${side}) the pupil goes where the gaze goes: 20° to her left moves it toward +x`, () => {
      const pupilX = (state: FaceRigState): number => {
        const xs: number[] = [];
        for (let x = cx - 0.01; x <= cx + 0.01; x += 0.0001) if (region(x, cy, state) === 'pupil') xs.push(x);
        expect(xs.length).toBeGreaterThan(5);
        return xs.reduce((a, b) => a + b, 0) / xs.length;
      };
      const ahead = pupilX(AHEAD);
      expect(ahead).toBeCloseTo(cx, 4);
      const g = yaw(20);
      const left = pupilX(face({ gazeRight: g, gazeLeft: g }));
      expect(left).toBeGreaterThan(ahead + 0.003);
      expect(left).toBeCloseTo(cx + FACE_EYES.radius * Math.sin(20 * Math.PI / 180), 3);
      const gr = yaw(-20);
      expect(pupilX(face({ gazeRight: gr, gazeLeft: gr }))).toBeLessThan(ahead - 0.003);
      // and up is up
      const up: P = [0, Math.sin(0.25), Math.cos(0.25)];
      expect(region(cx, cy + FACE_EYES.radius * Math.sin(0.25), face({ gazeRight: up, gazeLeft: up }))).toBe('pupil');
    });

    it(`(${side}) outside the almond is nothing, and so is behind her face`, () => {
      expect(region(cx, cy + 0.008)).toBe('none');
      expect(region(cx, cy - 0.008)).toBe('none');
      expect(region(eye.inner[0] + (eye.inner[0] < 0 ? 0.002 : -0.002), eye.inner[1])).toBe('none'); // past the inner corner
      expect(region(eye.outer[0] + (eye.outer[0] < 0 ? -0.002 : 0.002), eye.outer[1])).toBe('none'); // past the outer corner
      expect(region(cx, cy, AHEAD, -0.03)).toBe('none');
    });

    it(`(${side}) the inner corner is the caruncle, the outer corner sclera`, () => {
      const at = (u: number): [number, number] => {
        const x = eye.inner[0] + (u + 1) / 2 * (eye.outer[0] - eye.inner[0]);
        const base = eye.inner[1] + (u + 1) / 2 * (eye.outer[1] - eye.inner[1]);
        const bulge = 1 - u * u;
        return [x, base + (FACE_EYES.upperLid - FACE_EYES.lowerLid) / 2 * bulge];
      };
      expect(region(...at(-0.92))).toBe('caruncle');
      expect(region(...at(-0.88))).toBe('caruncle');
      expect(region(...at(-0.8))).toBe('sclera');
      expect(region(...at(0.9))).toBe('sclera');
    });

    it(`(${side}) a blink brings the lid down over it: shut, the opening is all lid`, () => {
      const seen = new Set<FaceEyeRegion>();
      const closing = new Set<FaceEyeRegion>();
      for (let x = Math.min(eye.inner[0], eye.outer[0]) - 0.003; x <= Math.max(eye.inner[0], eye.outer[0]) + 0.003; x += 0.0004) {
        for (let y = cy - 0.012; y <= cy + 0.012; y += 0.0001) {
          seen.add(region(x, y, face({ blink: 1 })));
          closing.add(region(x, y, face({ blink: 0.5 })));
        }
      }
      expect([...seen].sort()).toEqual(['lid', 'none']);
      // half shut there is lid above and eye below
      expect(closing.has('lid')).toBe(true);
      expect(closing.has('sclera')).toBe(true);
      // the centre is lid at 0.6 and pupil again once open
      expect(region(cx, cy, face({ blink: 1 }))).toBe('lid');
      expect(region(cx, cy, face({ blink: 0 }))).toBe('pupil');
      // open, there is no lid at all
      for (let y = cy - 0.012; y <= cy + 0.012; y += 0.0001) expect(region(cx, y)).not.toBe('lid');
    });
  }

  it('each eye answers to its own gaze', () => {
    const [rx, ry] = FACE_EYES.right.centre, [lx, ly] = FACE_EYES.left.centre;
    const state = face({ gazeRight: yaw(25), gazeLeft: [0, 0, 1] });
    expect(region(rx, ry, state)).not.toBe('pupil');
    expect(region(lx, ly, state)).toBe('pupil');
  });

  it('agrees with the animator on where the eyeballs are', () => {
    expect(FACE_EYE_CENTRES.right).toEqual([...FACE_MOTION_EYE_CENTRES.right]);
    expect(FACE_EYE_CENTRES.left).toEqual([...FACE_MOTION_EYE_CENTRES.left]);
    expect(FACE_EYE_CENTRES.right).toEqual([...FACE_EYES.right.centre]);
    expect(FACE_EYE_CENTRES.left).toEqual([...FACE_EYES.left.centre]);
  });
});

describe('the brows', () => {
  const A = FACE_BROWS, s = (x: number): number => (x - A.head[0]) / (A.tail[0] - A.head[0]);

  it('cover the arch and the head, fade to the tail, and are mirror-symmetric', () => {
    for (const sx of [-1, 1]) {
      expect(faceBrowAlpha([sx * A.arch[0], A.arch[1], 0])).toBeCloseTo(A.alpha, 6);
      expect(faceBrowAlpha([sx * 0.02, 1.6035, 0])).toBeGreaterThan(0.5);
      expect(faceBrowAlpha([sx * A.head[0], A.head[1], 0])).toBeGreaterThan(0.5);
      expect(faceBrowAlpha([sx * A.tail[0], A.tail[1], 0])).toBeLessThan(faceBrowAlpha([sx * A.arch[0], A.arch[1], 0]));
    }
  });

  it('are the thickness asked for: 4.8 mm at the head, 3.6 at the arch, toward 1.3 at the tail', () => {
    expect(A.thickness).toEqual([0.0048, 0.0036, 0.0013]);
    expect(faceBrowLine(A.arch[0]).thickness).toBeCloseTo(0.0036, 9);
    expect(faceBrowLine(A.arch[0]).y).toBeCloseTo(A.arch[1], 9);
    // just past the rounded head the band is its full head thickness
    const pastCap = A.head[0] + A.headEnd + A.headRound;
    expect(faceBrowLine(pastCap).thickness).toBeGreaterThan(0.0046);
    expect(faceBrowLine(pastCap).thickness).toBeLessThan(0.0048);
  });

  it('end in a rounded, slightly squared head: nothing before it, most of the thickness 0.4 mm in, all of it by 2.2 mm', () => {
    const end = A.head[0] + A.headEnd;
    expect(faceBrowLine(end - 0.0001).thickness).toBe(0);
    expect(faceBrowLine(end).thickness).toBe(0);
    const full = (x: number): number => A.thickness[0] + (x - A.head[0]) * 0; // the head's thickness, for the ratio
    expect(faceBrowLine(end + 0.0004).thickness / full(end)).toBeGreaterThan(0.6); // squarer than a circle's 0.56
    expect(faceBrowLine(end + 0.0004).thickness / full(end)).toBeLessThan(0.85);
    expect(faceBrowLine(end + A.headRound).thickness).toBeGreaterThan(0.95 * A.thickness[0]);
    // and it grows without a step
    let last = 0;
    for (let x = end; x <= end + 0.8 * A.headRound; x += 0.0001) {
      const t = faceBrowLine(x).thickness;
      expect(t).toBeGreaterThanOrEqual(last);
      last = t;
    }
    expect(faceBrowAlpha([end - 0.0003, faceBrowLine(end).y, 0])).toBe(0);
  });

  it('taper to a point at the tail', () => {
    let last = Infinity;
    for (let x = A.head[0] + A.tailFrom * (A.tail[0] - A.head[0]); s(x) < A.tailEnd; x += 0.0002) {
      const t = faceBrowLine(x).thickness;
      expect(t).toBeLessThan(last);
      last = t;
    }
    expect(last).toBeLessThan(0.0001);
    const tip = A.head[0] + A.tailEnd * (A.tail[0] - A.head[0]);
    expect(faceBrowLine(tip).thickness).toBe(0);
    expect(faceBrowLine(tip + 0.001).thickness).toBe(0);
    expect(faceBrowAlpha([tip + 0.0005, faceBrowLine(tip).y, 0])).toBe(0);
  });

  it('are nowhere else: not between them, not on the eyelid, not above or past the tail, not behind her face', () => {
    expect(faceBrowAlpha([0, 1.62, 0.01])).toBe(0);
    expect(faceBrowAlpha([0, 1.603, 0.01])).toBe(0);
    expect(faceBrowAlpha([0.008, 1.598, 0.01])).toBe(0);
    for (const sx of [-1, 1]) {
      expect(faceBrowAlpha([sx * 0.03, 1.589, 0])).toBe(0); // the upper eyelid
      expect(faceBrowAlpha([sx * 0.03, 1.5835, 0])).toBe(0); // the eye
      expect(faceBrowAlpha([sx * 0.033, 1.615, 0])).toBe(0); // the forehead above the arch
      expect(faceBrowAlpha([sx * 0.06, 1.6, 0])).toBe(0); // past the tail
      expect(faceBrowAlpha([sx * 0.033, 1.607, -0.031])).toBe(0);
    }
  });

  it('scale with their amount, and are a dark auburn brown by default (sRGB 0.24, 0.12, 0.07, held linear)', () => {
    const arch: P = [0.033, 1.607, 0];
    expect(faceBrowAlpha(arch, 0)).toBe(0);
    expect(faceBrowAlpha(arch, 0.5)).toBeCloseTo(faceBrowAlpha(arch) / 2, 12);
    expect(faceBrowAlpha(arch, 4)).toBe(faceBrowAlpha(arch, 1));
    const c = new THREE.Color().setRGB(0.24, 0.12, 0.07, THREE.SRGBColorSpace);
    expect(FACE_DEFAULTS.browColour[0]).toBeCloseTo(c.r, 3);
    expect(FACE_DEFAULTS.browColour[1]).toBeCloseTo(c.g, 3);
    expect(FACE_DEFAULTS.browColour[2]).toBeCloseTo(c.b, 3);
  });
});

describe('the lips', () => {
  it('cover both lips at the middle and fade to the corners', () => {
    expect(faceLipAlpha([0, 1.514, 0.013])).toBeGreaterThan(0.5);
    expect(faceLipAlpha([0, 1.524, 0.015])).toBeGreaterThan(0.5);
    expect(faceLipAlpha([0.012, FACE_MOUTH.seamY, 0.008])).toBeGreaterThan(0.5);
    // the cupid's bow dips the upper lip's top at the middle
    expect(faceLipAlpha([0, FACE_MOUTH.upperTop - 0.0005, 0.015])).toBeLessThan(faceLipAlpha([0.005, FACE_MOUTH.upperTop - 0.0005, 0.015]));
  });

  it('are not on the chin, the nose, past the corners or behind her face', () => {
    expect(faceLipAlpha([0, 1.495, 0.004])).toBe(0);
    expect(faceLipAlpha(FACE_HEAD.noseTip as P)).toBe(0);
    expect(faceLipAlpha([0, 1.535, 0.013])).toBe(0);
    expect(faceLipAlpha([0.025, FACE_MOUTH.cornerY, 0])).toBe(0);
    expect(faceLipAlpha([-0.025, FACE_MOUTH.cornerY, 0])).toBe(0);
    expect(faceLipAlpha([0, 1.514, -0.013])).toBe(0);
  });
});

describe('the mouth\'s inside', () => {
  const MI = FACE_MOUTH_INSIDE;
  /** A curtain fragment at x, posed height y (rest metres), its rest point near the seam and in front. */
  const at = (x: number, y: number, jaw: number, w = 0.5) => faceMouthSample(w, [x, FACE_MOUTH.seamY, 0.005], jaw, y);
  /** How tall the dark lens is in the column at x, metres, sampled every 10 µm. */
  const lensHeight = (x: number, jaw: number): number => {
    const e = faceMouthEdges(x, jaw);
    let n = 0;
    for (let y = e.lo - 0.003; y <= e.up + 0.003; y += 0.00001) if (at(x, y, jaw).lens > 0.5) n++;
    return n * 0.00001;
  };
  /** Bisect for the height where f crosses 0.5 between y0 (inside, above 0.5) and y1 (outside). */
  const edge = (f: (y: number) => number, y0: number, y1: number): number => {
    for (let i = 0; i < 60; i++) { const m = (y0 + y1) / 2; if (f(m) > 0.5) y0 = m; else y1 = m; }
    return (y0 + y1) / 2;
  };

  it('paints nothing with the jaw shut, anywhere', () => {
    for (let x = -0.03; x <= 0.03; x += 0.001) {
      for (let y = 1.50; y <= 1.535; y += 0.0005) {
        for (const w of [0.02, 0.3, 0.5, 0.7, 0.98]) {
          expect(faceMouthInterior(w, [x, FACE_MOUTH.seamY, 0.005], 0, y), `${x} ${y} ${w}`).toBe(0);
        }
      }
    }
    // nor at a jaw too small to open: the lens is under a millimetre and the paint has not come in
    expect(at(0, faceMouthEdges(0, 0.01).up - 0.0002, 0.01).amount).toBe(0);
  });

  it('paints nothing on the lips\' own surfaces, whose seam weight is exactly 0 or 1', () => {
    expect(faceJawSeam([0, 1.524, 0.015])).toBe(0);
    expect(faceJawSeam([0, 1.514, 0.013])).toBe(1);
    const mid = (faceMouthEdges(0, 0.6).up + faceMouthEdges(0, 0.6).lo) / 2;
    expect(at(0, mid, 0.6).amount).toBe(1);
    expect(at(0, mid, 0.6, 0).amount).toBe(0);
    expect(at(0, mid, 0.6, 1).amount).toBe(0);
    // nor behind her face
    expect(faceMouthSample(0.5, [0, FACE_MOUTH.seamY, -0.013], 0.6, mid).amount).toBe(0);
  });

  it('is the gap between the lips\' edges, with a soft edge 0.3 mm across', () => {
    const e = faceMouthEdges(0, 0.6);
    expect(at(0, e.up + 0.00016, 0.6).lens).toBe(0);
    expect(at(0, e.up - 0.00016, 0.6).lens).toBe(1);
    expect(at(0, e.up, 0.6).lens).toBeCloseTo(0.5, 6);
    expect(at(0, e.lo, 0.6).lens).toBeCloseTo(0.5, 6);
    expect(at(0, e.lo - 0.00016, 0.6).lens).toBe(0);
    expect(at(0, (e.up + e.lo) / 2, 0.6).lens).toBe(1);
    // the distance is measured in metres: the middle of a 11.4 mm gap is 5.7 mm in
    expect(at(0, (e.up + e.lo) / 2, 0.6).distance).toBeCloseTo(e.gap / 2, 5);
  });

  it('closes toward the corners as a lens: narrow at |x| 0.022, shut at the commissure, no step on the way', () => {
    for (const jaw of [0.3, 0.6, 1]) {
      const centre = lensHeight(0, jaw);
      expect(lensHeight(0.022, jaw), String(jaw)).toBeLessThan(0.3 * centre);
      expect(lensHeight(0.022, jaw), String(jaw)).toBeGreaterThan(0);
      expect(lensHeight(0.024, jaw)).toBe(0);
      expect(lensHeight(0.026, jaw)).toBe(0);
      expect(lensHeight(-0.022, jaw)).toBeCloseTo(lensHeight(0.022, jaw), 9);
      let last = centre;
      for (let x = 0.0005; x <= 0.024; x += 0.0005) {
        const h = lensHeight(x, jaw);
        expect(h, `${jaw} ${x}`).toBeLessThanOrEqual(last + 0.00002);
        expect(last - h, `${jaw} ${x}`).toBeLessThan(0.0015); // no square shoulder
        last = h;
      }
    }
  });

  it('edges every band with a smooth curve in x: the upper teeth\'s lower edge and the lens\'s, sampled every 0.5 mm', () => {
    const jaw = 0.6;
    const teeth: number[] = [], lens: number[] = [];
    for (let x = -0.014; x <= 0.01401; x += 0.0005) {
      const up = faceMouthEdges(x, jaw).up, lo = faceMouthEdges(x, jaw).lo;
      teeth.push(edge((y) => at(x, y, jaw).upperTeeth, up - 0.0012, up - 0.004));
      lens.push(edge((y) => at(x, y, jaw).lens, (up + lo) / 2, lo - 0.002));
    }
    for (const [name, curve, limit] of [['teeth', teeth, 0.00003], ['lens', lens, 0.0001]] as const) {
      for (let i = 1; i + 1 < curve.length; i++) {
        expect(Math.abs(curve[i - 1] - 2 * curve[i] + curve[i + 1]), `${name} ${i}`).toBeLessThan(limit);
      }
    }
    // the teeth are longest at the middle and round off toward the corners
    const mid = (teeth.length - 1) / 2;
    const depth = teeth.map((y, i) => faceMouthEdges(-0.014 + i * 0.0005, jaw).up - y);
    expect(depth[mid]).toBeCloseTo(MI.upperTeeth.to, 4);
    expect(depth[0]).toBeLessThan(depth[mid] - 0.0008);
    for (let i = 1; i <= mid; i++) expect(depth[i]).toBeGreaterThanOrEqual(depth[i - 1]);
  });

  it('has its upper teeth 0.4 to 2.6 mm under the upper lip, and only once the gap passes 1.5 mm', () => {
    const e = faceMouthEdges(0, 0.6);
    expect(at(0, e.up - 0.0015, 0.6).upperTeeth).toBe(1);
    expect(at(0, e.up - 0.0001, 0.6).upperTeeth).toBe(0);
    expect(at(0, e.up - 0.0031, 0.6).upperTeeth).toBe(0);
    expect(at(0.0165, e.up - 0.0015, 0.6).upperTeeth).toBe(0); // past the row's end
    // jaw 0.05 opens the middle under a millimetre: no teeth; 0.15 opens it 3 mm: teeth
    const small = faceMouthEdges(0, 0.05), bigger = faceMouthEdges(0, 0.15);
    expect(small.gap).toBeLessThan(MI.upperTeeth.opensFrom);
    expect(at(0, small.up - 0.0006, 0.05).upperTeeth).toBe(0);
    expect(bigger.gap).toBeGreaterThan(MI.upperTeeth.opensTo);
    expect(at(0, bigger.up - 0.0012, 0.15).upperTeeth).toBe(1);
  });

  it('has its lower teeth fainter, 0.3 to 1.6 mm over the lower lip, and only once the gap passes 4 mm', () => {
    const e = faceMouthEdges(0, 0.6);
    expect(at(0, e.lo + 0.0009, 0.6).lowerTeeth).toBeCloseTo(MI.lowerTeeth.share, 9);
    expect(at(0, e.lo + 0.00005, 0.6).lowerTeeth).toBe(0);
    expect(at(0, e.lo + 0.0021, 0.6).lowerTeeth).toBe(0);
    const third = faceMouthEdges(0, 0.15);
    expect(third.gap).toBeLessThan(MI.lowerTeeth.opensFrom);
    expect(at(0, third.lo + 0.0009, 0.15).lowerTeeth).toBe(0);
    for (let y = e.lo - 0.001; y < e.up + 0.001; y += 0.0001) expect(at(0, y, 0.6).lowerTeeth).toBeLessThanOrEqual(MI.lowerTeeth.share);
  });

  it('is red only along the lips\' inner edge, darkest in the middle', () => {
    const e = faceMouthEdges(0, 0.6);
    expect(at(0, e.up - 0.0002, 0.6).red).toBe(1);
    expect(at(0, e.up - 0.0012, 0.6).red).toBe(0);
    expect(at(0, e.lo + 0.0012, 0.6).red).toBe(0);
    const middle = at(0, (e.up + e.lo) / 2, 0.6);
    expect(middle.red).toBe(0);
    expect(middle.deep).toBeCloseTo(MI.deepShade, 9);
    expect(at(0, e.up - 0.0012, 0.6).deep).toBeGreaterThan(middle.deep);
  });

  it('hides the lips\' stretched texture with the inner lip, on the curtain just outside the lens, but not at the corners', () => {
    const e = faceMouthEdges(0, 0.6);
    expect(at(0, e.up + 0.0005, 0.6).amount).toBe(1);
    expect(at(0, e.up + 0.0005, 0.6).lens).toBe(0);
    expect(at(0, e.up + 0.0005, 0.6).dark).toBe(0);
    expect(at(0, e.up + MI.rim + 0.0001, 0.6).amount).toBe(0);
    expect(at(0, e.up + 0.0005, 0.6, 0).amount).toBe(0);
    const c = faceMouthEdges(0.0237, 0.6);
    expect(at(0.0237, c.up + 0.0005, 0.6).amount).toBe(0);
    // under the lens it fades out as the seam weight nears the lower lip's own 1, so it meets that lip in a blend
    const under = e.lo - 0.0005;
    expect(at(0, under, 0.6, 0.5).amount).toBe(1);
    expect(at(0, under, 0.6, 0.86).amount).toBeGreaterThan(0.3);
    expect(at(0, under, 0.6, 0.86).amount).toBeLessThan(0.7);
    expect(at(0, under, 0.6, 0.97).amount).toBe(0);
    let last = 1;
    for (let w = 0.5; w <= 1; w += 0.01) { const a = at(0, under, 0.6, w).amount; expect(a).toBeLessThanOrEqual(last + 1e-12); last = a; }
    // above it the curtain test alone decides
    expect(at(0, e.up + 0.0005, 0.6, 0.86).amount).toBe(1);
  });
});

/** The face's lines in the shader, each of which must sit behind the switch. */
const VERTEX_EFFECTS = ['objectNormal.yz = vec2(', 'transformed.yz = vec2(', 'transformed.yz = '];
const FRAGMENT_EFFECTS = ['diffuseColor.rgb *= mix(vec3(1.0)', 'diffuseColor.rgb = mix(diffuseColor.rgb, faceM, faceInner);', 'faceEye(vFaceF.xy', 'diffuseColor.rgb = mix(diffuseColor.rgb, faceBC', 'roughnessFactor = mix(roughnessFactor', 'normal = normalize(mix(normal, nonPerturbedNormal, faceWet));', 'normal = normalize(mix(normal, vec3(0.0, 0.0, 1.0), faceInner));'];
const UNIFORMS = ['faceBlink', 'faceBrow', 'faceBrowColour', 'faceGazeL', 'faceGazeR', 'faceIris', 'faceJaw', 'faceLashes', 'faceLips', 'faceOn', 'facePupil'];

describe('the patch', () => {
  it('is applied once, and later changes are uniforms', () => {
    const material = new THREE.MeshStandardMaterial();
    const version = material.version;
    patchFaceRig(material);
    const hook = material.onBeforeCompile, key = material.customProgramCacheKey;
    expect(material.version).toBe(version + 1);
    patchFaceRig(material);
    setFaceRig(material, face({ jaw: 0.4, blink: 0.3 }));
    setFaceRig(material, null);
    setFaceRig(material, AHEAD);
    expect(material.onBeforeCompile).toBe(hook);
    expect(material.customProgramCacheKey).toBe(key);
    expect(material.version).toBe(version + 1);
    const shader = compiled(material);
    expect(count(shader.vertexShader, 'float faceJawSeam(vec3 f)')).toBe(1);
    expect(count(shader.vertexShader, 'float faceJawTaper(vec3 f)')).toBe(1);
    expect(count(shader.vertexShader, 'float faceTheta = 0.0;')).toBe(1);
    expect(count(shader.fragmentShader, 'void faceEye(')).toBe(1);
    expect(count(shader.fragmentShader, 'float faceWet = 0.0, faceLipMask = 0.0, faceInner = 0.0;')).toBe(1);
  });

  it('chains the material\'s own onBeforeCompile and cache key, the earlier one running first', () => {
    const material = new THREE.MeshStandardMaterial();
    const before = vi.fn((shader: { fragmentShader: string }) => { shader.fragmentShader = `// earlier\n${shader.fragmentShader}`; });
    material.onBeforeCompile = before as unknown as THREE.Material['onBeforeCompile'];
    material.customProgramCacheKey = () => 'hem-cut-v3';
    patchFaceRig(material);
    const shader = compiled(material);
    expect(before).toHaveBeenCalledTimes(1);
    expect(before.mock.calls[0][0]).toBe(shader);
    expect(material.customProgramCacheKey()).toBe('hem-cut-v3|face-rig-v2');
    expect(shader.fragmentShader).toContain('// earlier');
    expect(shader.fragmentShader.indexOf('uniform float faceOn;')).toBeLessThan(shader.fragmentShader.indexOf('// earlier'));
  });

  it('hooks three\'s standard shader where it says, keeps every token, and puts all of it behind the switch', () => {
    const material = new THREE.MeshStandardMaterial();
    patchFaceRig(material);
    const { vertexShader: vert, fragmentShader: frag, uniforms } = compiled(material);
    // every hook still there, once
    for (const token of ['#include <morphnormal_vertex>', '#include <morphtarget_vertex>', '#include <begin_vertex>', '#include <beginnormal_vertex>', '#include <skinning_vertex>']) {
      expect(count(vert, token), token).toBe(1);
    }
    for (const token of ['#include <color_fragment>', '#include <roughnessmap_fragment>', '#include <map_fragment>', '#include <clipping_planes_fragment>', '#include <normal_fragment_begin>', '#include <normal_fragment_maps>']) {
      expect(count(frag, token), token).toBe(1);
    }
    // the normal turns after the morphs' normals and before skinning's; the point after the morphs and before skinning
    expect(vert).toMatch(/#include <morphnormal_vertex>\s*float faceTheta = 0\.0;/);
    expect(vert).toMatch(/#include <morphtarget_vertex>\s*if \(faceOn > 0\.5 && faceTheta != 0\.0\) \{/);
    expect(vert.indexOf('objectNormal.yz = vec2(')).toBeLessThan(vert.indexOf('#include <skinnormal_vertex>'));
    expect(vert.indexOf('objectNormal.yz = vec2(')).toBeGreaterThan(vert.indexOf('#include <morphnormal_vertex>'));
    expect(vert.indexOf('transformed.yz = ')).toBeGreaterThan(vert.indexOf('#include <morphtarget_vertex>'));
    expect(vert.indexOf('transformed.yz = ')).toBeLessThan(vert.indexOf('#include <skinning_vertex>'));
    // the varyings are written whatever the switch says, and from the rest position; the posed height again once turned
    expect(vert).toContain('vFaceF = position * ');
    expect(vert).toContain('vFaceJaw = 0.0;');
    expect(vert).toContain('vFacePosedY = vFaceF.y;');
    expect(vert.indexOf('vFacePosedY = transformed.y * ')).toBeGreaterThan(vert.indexOf('transformed.yz = '));
    // the curtain test carries the untapered seam weight; the turn is the seam weight times the taper
    expect(vert).toContain('vFaceJaw = faceJawSeam(vFaceF);');
    expect(vert).toContain('faceTheta = faceJaw * 0.24 * vFaceJaw * faceJawTaper(vFaceF);');
    // the colour after color_fragment, the roughness after roughnessmap_fragment, the normal after normal_fragment_maps
    expect(frag).toMatch(/#include <color_fragment>\s*float faceWet = 0\.0, faceLipMask = 0\.0, faceInner = 0\.0;\s*if \(faceOn > 0\.5\) \{\s*float facePx = /);
    expect(frag).toMatch(/#include <roughnessmap_fragment>\s*if \(faceOn > 0\.5\) \{/);
    expect(frag).toMatch(/#include <normal_fragment_maps>\s*if \(faceOn > 0\.5\) \{\s*normal = normalize\(mix\(normal, nonPerturbedNormal, faceWet\)\);/);
    expect(frag.indexOf('#include <color_fragment>')).toBeLessThan(frag.indexOf('#include <roughnessmap_fragment>'));
    expect(frag.indexOf('#include <roughnessmap_fragment>')).toBeLessThan(frag.indexOf('#include <normal_fragment_maps>'));
    // the pixel's size is taken under the uniform switch, before any branch on where the fragment is, and nowhere else
    expect(count(frag, 'fwidth(')).toBe(2);
    expect(frag.indexOf('fwidth(vFaceF.x)')).toBeLessThan(frag.indexOf('if (abs(vFaceF.x) <'));
    expect(frag.indexOf('fwidth(vFaceF.x)')).toBeGreaterThan(frag.indexOf('if (faceOn > 0.5) {'));
    // every effect sits after the switch that guards it
    const vertexSwitch = vert.indexOf('if (faceOn > 0.5) {');
    for (const line of VERTEX_EFFECTS) {
      const at = vert.indexOf(line, vert.indexOf('void main()'));
      expect(at, line).toBeGreaterThan(vertexSwitch);
    }
    const main = frag.indexOf('void main()');
    const colourSwitch = frag.indexOf('if (faceOn > 0.5) {', main);
    const roughSwitch = frag.indexOf('if (faceOn > 0.5) {', frag.indexOf('#include <roughnessmap_fragment>'));
    const normalSwitch = frag.indexOf('if (faceOn > 0.5) {', frag.indexOf('#include <normal_fragment_maps>'));
    for (const line of FRAGMENT_EFFECTS) {
      const at = frag.indexOf(line, main);
      expect(at, line).toBeGreaterThan(line.startsWith('roughness') ? roughSwitch : line.startsWith('normal') ? normalSwitch : colourSwitch);
    }
    // the mouth's colour reads where the point is, never the interpolated weight: that is read once, for the curtain test
    expect(count(frag, 'vFaceJaw')).toBe(2);
    expect(frag).toContain('faceInner = faceMouthAmount(vFaceJaw, vFaceF, vFacePosedY, faceJaw, faceDist, faceGap);');
    // its uniforms, declared once in each stage that reads them, and it starts off
    for (const name of UNIFORMS) {
      expect(count(frag, ` ${name};`), name).toBe(1);
      expect(uniforms[name], name).toBeDefined();
    }
    expect(count(vert, 'uniform float faceOn;')).toBe(1);
    expect(count(vert, 'uniform float faceJaw;')).toBe(1);
    expect(count(vert, 'varying float vFaceJaw;')).toBe(1);
    expect(count(frag, 'varying float vFaceJaw;')).toBe(1);
    expect(count(vert, 'varying vec3 vFaceF;')).toBe(1);
    expect(count(frag, 'varying vec3 vFaceF;')).toBe(1);
    expect(count(vert, 'varying float vFacePosedY;')).toBe(1);
    expect(count(frag, 'varying float vFacePosedY;')).toBe(1);
    expect(Object.keys(uniforms).sort()).toEqual(UNIFORMS);
    expect(uniforms.faceOn.value).toBe(0);
    // no discard, no texture read: the face only paints and turns
    expect(count(frag, 'discard') - count(THREE.ShaderLib.standard.fragmentShader, 'discard')).toBe(0);
  });

  it('reads the normal three r185 keeps before the normal map, which the eye white goes back to', () => {
    // pinned, so a three upgrade that renames it fails here and not on a phone
    expect(THREE.REVISION).toBe('185');
    expect(THREE.ShaderChunk.normal_fragment_begin).toContain('vec3 nonPerturbedNormal = normal;');
    const frag = THREE.ShaderLib.standard.fragmentShader;
    expect(frag.indexOf('#include <normal_fragment_begin>')).toBeLessThan(frag.indexOf('#include <normal_fragment_maps>'));
  });

  it('writes GLSL a compiler can read: decimal literals and smoothsteps never reversed', () => {
    const material = new THREE.MeshStandardMaterial();
    patchFaceRig(material);
    const { vertexShader: vert, fragmentShader: frag } = compiled(material);
    for (const src of [vert, frag]) {
      expect(src).not.toMatch(/NaN|undefined|Infinity/);
      // no local named after a GLSL built-in or a reserved word (a driver may refuse what ANGLE takes)
      expect(src).not.toMatch(/\b(?:float|vec2|vec3|vec4|int)\s+(?:cross|dot|mix|step|length|distance|normalize|half|sample|filter|input|output|fixed|common|active|partition)\b/);
      // every literal smoothstep's edges in order
      for (const m of src.matchAll(/smoothstep\(\(?(-?[\d.e-]+)\)?, \(?(-?[\d.e-]+)\)?,/g)) {
        expect(Number(m[1]), m[0]).toBeLessThan(Number(m[2]));
      }
      // braces balance
      expect(count(src, '{')).toBe(count(src, '}'));
      expect(count(src, '(')).toBe(count(src, ')'));
    }
  });

  for (const order of ['face first', 'fabric first'] as const) {
    it(`lives alongside the fabric painted on her body (${order})`, () => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
      const material = new THREE.MeshStandardMaterial();
      const mesh = new THREE.Mesh(g, material);
      const paint = (): void => setFabricLayer(mesh, material, 0, { texture: new THREE.Texture(), tile: 1, opacity: 1, roughness: 0.8 }, { layers: 2, masked: true, rest: null });
      if (order === 'face first') { patchFaceRig(material); paint(); } else { paint(); patchFaceRig(material); }
      const shader = compiled(material);
      const vert = shader.vertexShader, frag = shader.fragmentShader;
      // the face's
      expect(vert).toContain('float faceTheta = 0.0;');
      expect(vert).toContain('transformed.yz = ');
      expect(frag).toContain('void faceEye(');
      expect(frag).toContain('float faceWet = 0.0, faceLipMask = 0.0, faceInner = 0.0;');
      expect(frag).toContain(`roughnessFactor = mix(roughnessFactor, 0.12, faceWet);`);
      expect(frag).toContain('normal = normalize(mix(normal, nonPerturbedNormal, faceWet));');
      expect(frag).toContain('normal = normalize(mix(normal, nonPerturbedNormal, fabricMatte * (1.0 - vFabricDetailKeep)));');
      // the fabric's
      expect(vert).toContain('vFabricPos = fabricRest;');
      expect(frag).toContain('float fabricMatte = 0.0, fabricRoughness = 1.0;');
      expect(frag).toContain('roughnessFactor = mix(roughnessFactor, fabricRoughness, fabricMatte);');
      // every hook either uses, still there once
      for (const token of ['#include <begin_vertex>', '#include <beginnormal_vertex>', '#include <morphnormal_vertex>', '#include <morphtarget_vertex>']) {
        expect(count(vert, token), token).toBe(1);
      }
      for (const token of ['#include <map_fragment>', '#include <color_fragment>', '#include <roughnessmap_fragment>', '#include <metalnessmap_fragment>', '#include <normal_fragment_maps>']) {
        expect(count(frag, token), token).toBe(1);
      }
      // the face's colour lies over the fabric's
      expect(frag.indexOf('float faceWet = 0.0')).toBeGreaterThan(frag.indexOf('float fabricMatte = 0.0'));
      for (const name of [...UNIFORMS, 'fabricOn0', 'fabricOn1', 'fabricShowRegions']) expect(shader.uniforms[name], name).toBeDefined();
      const key = material.customProgramCacheKey();
      expect(key).toContain('|face-rig-v2');
      expect(key).toContain('|fabric-2-painted-v11');
    });
  }
});

describe('the face in the uniforms', () => {
  it('lands in the uniforms the shader reads, clamped and normalised, with the defaults filled in', () => {
    const material = new THREE.MeshStandardMaterial();
    patchFaceRig(material);
    const u = compiled(material).uniforms; // compiled before the setting arrives: it reaches it as uniform values
    setFaceRig(material, face({ jaw: 0.4, blink: 0.25, gazeRight: [0, 0, 2], gazeLeft: [3, 0, 4] }));
    expect(u.faceOn.value).toBe(1);
    expect(u.faceJaw.value).toBe(0.4);
    expect(u.faceBlink.value).toBe(0.25);
    expect((u.faceGazeR.value as THREE.Vector3).toArray()).toEqual([0, 0, 1]);
    expect((u.faceGazeL.value as THREE.Vector3).toArray()).toEqual([0.6, 0, 0.8]);
    expect(u.facePupil.value).toBe(FACE_DEFAULTS.pupil);
    expect((u.faceIris.value as THREE.Vector3).toArray()).toEqual([...FACE_DEFAULTS.iris]);
    expect(u.faceBrow.value).toBe(1);
    expect((u.faceBrowColour.value as THREE.Vector3).toArray()).toEqual([...FACE_BROWS.colour]);
    expect(u.faceLips.value).toBe(0.55);
    expect(u.faceLashes.value).toBe(1);
    setFaceRig(material, face({ jaw: 3, blink: -1, gazeRight: [0, 0, 0], gazeLeft: [Number.NaN, 0, 1], pupil: 1, iris: [2, -1, 0.5], brow: 0.3, browColour: [0.1, 0.2, 9], lips: 2, lashes: -3 }));
    expect([u.faceJaw.value, u.faceBlink.value]).toEqual([1, 0]);
    expect((u.faceGazeR.value as THREE.Vector3).toArray()).toEqual([0, 0, 1]);
    expect((u.faceGazeL.value as THREE.Vector3).toArray()).toEqual([0, 0, 1]);
    expect(u.facePupil.value).toBe(0.005);
    expect((u.faceIris.value as THREE.Vector3).toArray()).toEqual([1, 0, 0.5]);
    expect(u.faceBrow.value).toBe(0.3);
    expect((u.faceBrowColour.value as THREE.Vector3).toArray()).toEqual([0.1, 0.2, 1]);
    expect([u.faceLips.value, u.faceLashes.value]).toEqual([1, 0]);
    setFaceRig(material, face({ jaw: Number.NaN, pupil: 0 }));
    expect(u.faceJaw.value).toBe(0);
    expect(u.facePupil.value).toBe(0.0005);
  });

  it('patches on the first setting, and null switches all of it off', () => {
    const material = new THREE.MeshStandardMaterial();
    const version = material.version;
    setFaceRig(material, face({ jaw: 0.7, blink: 1 }));
    expect(material.version).toBe(version + 1);
    const u = compiled(material).uniforms;
    expect(u.faceOn.value).toBe(1);
    setFaceRig(material, null);
    expect(u.faceOn.value).toBe(0);
    expect([u.faceJaw.value, u.faceBlink.value]).toEqual([0, 0]);
    expect(material.version).toBe(version + 1);
  });

  it('leaves a material never patched alone on null', () => {
    const plain = new THREE.MeshStandardMaterial();
    const version = plain.version, hook = plain.onBeforeCompile, key = plain.customProgramCacheKey;
    setFaceRig(plain, null);
    expect(plain.version).toBe(version);
    expect(plain.onBeforeCompile).toBe(hook);
    expect(plain.customProgramCacheKey).toBe(key);
    const shader = compiled(plain);
    expect(shader.vertexShader).toBe(THREE.ShaderLib.standard.vertexShader);
    expect(shader.fragmentShader).toBe(THREE.ShaderLib.standard.fragmentShader);
    expect(shader.uniforms).toEqual({});
  });
});

/** A small skinned body: a chain of bones with her names, the head bone posed, the mesh moved after binding. */
function skinned(): { mesh: THREE.SkinnedMesh; head: THREE.Bone; neck: THREE.Bone } {
  const points = [[0, 0.85, 0.05], [0.02, 0.83, 0.04], [-0.03, 0.86, 0.0], [0.0, 0.9, -0.05]];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(points.flat()), 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(points.flatMap(() => [2, 0, 0, 0]), 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(points.flatMap(() => [1, 0, 0, 0]), 4));
  const root = new THREE.Bone(), neck = new THREE.Bone(), head = new THREE.Bone(), end = new THREE.Bone();
  root.name = 'Bone_000'; neck.name = 'Bone_017'; head.name = FACE_HEAD_BONE; end.name = 'Bone_015';
  root.position.set(0, 0.1, -0.06);
  neck.position.set(0, 0.6, 0);
  head.position.set(0, 0.1, 0.01);
  end.position.set(0, 0.09, 0);
  root.add(neck); neck.add(head); head.add(end);
  const mesh = new THREE.SkinnedMesh(g, new THREE.MeshStandardMaterial());
  mesh.position.set(0.3, -0.2, 0.5);
  mesh.rotation.set(0, 0.4, 0);
  mesh.add(root);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton([root, neck, head, end]));
  return { mesh, head, neck };
}

describe('where the camera is, in her rest frame', () => {
  it('inverts three\'s own skinning for the head bone, as posed now', () => {
    const { mesh, head, neck } = skinned();
    head.rotation.set(0.3, -0.5, 0.2);
    neck.rotation.set(0.15, 0.1, -0.05);
    mesh.position.set(1.2, 0.4, -2);
    mesh.rotation.set(0.1, 1.3, 0);
    mesh.scale.setScalar(1.25);
    mesh.updateMatrixWorld(true);
    const position = mesh.geometry.getAttribute('position');
    for (let i = 0; i < position.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(position, i);
      const world = mesh.applyBoneTransform(i, v.clone()).applyMatrix4(mesh.matrixWorld);
      const rest = restFromWorld(mesh, world);
      expect(rest).not.toBeNull();
      const expected = [0, 1, 2].map((k) => FACE_REST_SCALE * v.getComponent(k) + FACE_REST_OFFSET[k]);
      for (let k = 0; k < 3; k++) expect(rest![k]).toBeCloseTo(expected[k], 9);
    }
  });

  it('writes into the array it is given, and is null without the head bone', () => {
    const { mesh } = skinned();
    const out: [number, number, number] = [9, 9, 9];
    expect(restFromWorld(mesh, new THREE.Vector3(0.3, 0.6, 0.6), out)).toBe(out);
    expect(out.every(Number.isFinite)).toBe(true);
    const plain = new THREE.SkinnedMesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial());
    const bone = new THREE.Bone(); bone.name = 'Bone_001';
    plain.add(bone);
    plain.bind(new THREE.Skeleton([bone]));
    expect(restFromWorld(plain, new THREE.Vector3())).toBeNull();
  });
});

describe('the measurements, against the approved file', () => {
  it('her rest frame, her head bone and her head are as measured, no morph touches her head, and the jaw moves only what it should', async () => {
    await MeshoptDecoder.ready;
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    const doc = await io.read('public/models/sarah-v2-body-slim.glb');
    const skin = doc.getRoot().listSkins()[0];
    const joints = skin.listJoints(), ibm = skin.getInverseBindMatrices()!;
    const restOf = (k: number): THREE.Matrix4 => {
      const m = new THREE.Matrix4().fromArray(joints[k].getWorldMatrix());
      return m.multiply(new THREE.Matrix4().fromArray(ibm.getElement(k, [])));
    };
    const head = joints.findIndex((j) => j.getName() === FACE_HEAD_BONE);
    expect(head).toBeGreaterThan(0);
    // bone 0's world times its inverse bind is the rest transform, with no rotation, and so is the head bone's
    for (const k of [0, head]) {
      const e = restOf(k).elements;
      expect(e[0]).toBeCloseTo(FACE_REST_SCALE, 6);
      expect(e[5]).toBeCloseTo(FACE_REST_SCALE, 6);
      expect(e[10]).toBeCloseTo(FACE_REST_SCALE, 6);
      for (const off of [1, 2, 4, 6, 8, 9]) expect(Math.abs(e[off])).toBeLessThan(1e-6);
      expect(e[12]).toBeCloseTo(FACE_REST_OFFSET[0], 6);
      expect(e[13]).toBeCloseTo(FACE_REST_OFFSET[1], 6);
      expect(e[14]).toBeCloseTo(FACE_REST_OFFSET[2], 6);
    }
    const body = doc.getRoot().listMeshes()[0].listPrimitives().find((p) => p.getMaterial()?.getName() === 'Material_0')!;
    const position = body.getAttribute('POSITION')!;
    expect(position.getCount()).toBe(115710);
    const v: number[] = [];
    const rest = (i: number): P => { position.getElement(i, v); return [0, 1, 2].map((k) => FACE_REST_SCALE * v[k] + FACE_REST_OFFSET[k]) as P; };
    let top = -Infinity, above = 0, aboveMoving = 0, chin = 0, chinStill = 0;
    const onHead: number[] = [];
    for (let i = 0; i < position.getCount(); i++) {
      const r = rest(i);
      top = Math.max(top, r[1]);
      if (r[1] > 1.45) onHead.push(i);
      // nothing above the hinge moves: the eyes, the brows, the nose, the forehead
      if (r[1] > FACE_JAW_HINGE[1]) { above++; if (faceJawWeight(r) !== 0) aboveMoving++; }
      // the lower lip and the chin about the middle move wholly
      if (Math.abs(r[0]) < 0.01 && r[2] > 0 && r[1] > 1.49 && r[1] < 1.512) { chin++; if (faceJawWeight(r) <= 0.99) chinStill++; }
    }
    expect(top).toBeCloseTo(FACE_HEAD.top, 4);
    expect(above).toBeGreaterThan(5000);
    expect(aboveMoving).toBe(0);
    expect(chin).toBeGreaterThan(100);
    expect(chinStill).toBe(0);
    // the jaw weight reads `position`, which is her rest only because no morph moves her head
    const d: number[] = [];
    for (const target of body.listTargets()) {
      const t = target.getAttribute('POSITION');
      if (!t) continue;
      let moved = 0;
      for (const i of onHead) { t.getElement(i, d); if (d[0] !== 0 || d[1] !== 0 || d[2] !== 0) moved++; }
      expect(moved, target.getName()).toBe(0);
    }
  }, 60000);
});
