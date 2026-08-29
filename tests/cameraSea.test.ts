/**
 * THE CAMERA ON A SEA THAT MIGHT BE SLOW — Stage E.
 *
 * v0.0.101's camera was filtered in TIME: a first-order low pass on
 * its own height. That works on one sea and cannot survive another,
 * because a filter with memory lags by up to a quarter period, and a
 * quarter of the generated sea's 5.9 s swell is a second and a half of
 * camera still sitting in the last trough when the next crest arrives.
 * Every constant around it — how long a wash may last, how long before
 * the tint calls it a change of medium — was swept against a 1.5 s sea
 * too, and inherited as seconds they would have fired on every crest
 * of a slower one.
 *
 * So the filtering moved into the sea's own table, where the split can
 * be exact and instant:
 *
 *   LOSSLESS   heave + chop IS the sea, to the last bit
 *   SLICED     macro passes whole, meso is rejected, by physics
 *   IN STEP    no phase lag — that is the whole point of spectral
 *   BEATS      every patience is a fraction of the sea, not a second
 *   PHYSICS    nothing but the camera may read the split
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { FollowCamera } from '../src/camera/FollowCamera';
import { useWaterQuery, waterSpotAt } from '../src/world/waterQuery';
import {
  HEAVE_CORNER_S, HEAVE_ORDER, activeWaves, heaveGain,
  resetSwell, seaChopAt, seaHeaveAt, seaSwellAt, swellPeriod, tickSwell,
} from '../src/world/seaSwell';
import { SETTLE_BEATS, SPLASH_BEATS, settleSeconds, splashSeconds }
  from '../src/world/Underwater';
import { useFixedSea, useProceduralSea } from '../src/world/liveSea';

const GENERATION = { worldSeed: 20260829, nowMs: 0 } as const;
const BED = 800;
const DT = 1 / 60;
const REST = { yaw: 0, pitch: 0, active: false };

afterEach(() => { useWaterQuery(null); useFixedSea(); resetSwell(); });

const SEAS: [string, () => void][] = [
  ['the shipped sea', () => useFixedSea()],
  ['the procedural sea', () => { useProceduralSea(GENERATION); }],
];

/**
 * Float her on the installed sea, hands off, and report what the
 * PLAYER would have seen — the view's own pitch as well as the
 * camera's height, because the pitch is the thing that moves a
 * horizon.
 */
function float(seconds: number, dive = 0) {
  const ant = new THREE.Object3D();
  const follow = new FollowCamera(2);
  useWaterQuery((wx, wz) => ({
    depth: BED + seaSwellAt(wx, wz, BED), flowX: 0, flowZ: 0, salt: true,
  }));
  ant.position.set(0, BED, 0);
  follow.snapTo(ant);
  const her: number[] = []; const lens: number[] = []; const pitch: number[] = [];
  const wouldHave: number[] = []; const over: number[] = []; const gap: number[] = [];
  let washes = 0; let wet = false; let ups = 0; let last = 0;
  let deepest = 0; let streak = 0; let longestWash = 0;
  const dir = new THREE.Vector3();
  const right = new THREE.Vector3();
  const screen: number[] = [];
  let roll = 0;
  for (let t = -14; t < seconds; t += DT) {
    tickSwell(DT);
    const swell = seaSwellAt(0, 0, BED);
    ant.position.y = BED + swell - 0.15;
    follow.update(ant, REST, DT, true, dive);
    if (t < 0) { last = swell; continue; }
    follow.camera.getWorldDirection(dir);
    pitch.push((Math.asin(dir.y) * 180) / Math.PI);
    // Roll: how far the camera's own right vector has left level.
    right.set(1, 0, 0).applyQuaternion(follow.camera.quaternion);
    roll = Math.max(roll, Math.abs((Math.asin(
      Math.max(-1, Math.min(1, right.y))) * 180) / Math.PI));
    // What the same float would have looked like if the view still
    // aimed at her: the pitch of the line from this lens to her.
    wouldHave.push((Math.atan2(
      ant.position.y + 0.6 - follow.camera.position.y,
      Math.hypot(follow.camera.position.x - ant.position.x,
        follow.camera.position.z - ant.position.z),
    ) * 180) / Math.PI);
    her.push(ant.position.y);
    lens.push(follow.camera.position.y);
    over.push(follow.camera.position.y - BED);
    gap.push(ant.position.y - (follow.camera.position.y - 3.42));
    // Where she sits in the picture: -1 is the bottom edge, +1 the top.
    const flat = Math.hypot(follow.camera.position.x - ant.position.x,
      follow.camera.position.z - ant.position.z);
    const axis = Math.atan2(dir.y, Math.hypot(dir.x, dir.z));
    const off = Math.atan2(ant.position.y - follow.camera.position.y, flat) - axis;
    const half = Math.tan((follow.camera.fov * Math.PI) / 360);
    screen.push(Math.abs(off) >= Math.PI / 2 - 1e-3 ? 99 : Math.tan(off) / half);
    const under = BED + swell - follow.camera.position.y;
    if (under > 0 && !wet) { washes++; wet = true; } else if (under <= 0) wet = false;
    if (under > 0) { deepest = Math.max(deepest, under); streak += DT; } else streak = 0;
    longestWash = Math.max(longestWash, streak);
    if (last <= 0 && swell > 0) ups++;
    last = swell;
  }
  useWaterQuery(null);
  const span = (a: number[]) => Math.max(...a) - Math.min(...a);
  return {
    herSwing: span(her), lensSwing: span(lens),
    pitchSwingDeg: span(pitch), aimedAtHerSwingDeg: span(wouldHave),
    lensOverDatum: over.reduce((s2, v) => s2 + v, 0) / over.length,
    herAgainstAim: span(gap), washes, waves: ups, deepest, longestWash,
    worstRollDeg: roll,
    onScreen: screen.filter((v) => Math.abs(v) <= 1).length / screen.length,
    inBand: screen.filter((v) => Math.abs(v) <= 0.35).length / screen.length,
  };
}

describe('LOSSLESS — the split is the sea, not a second one', () => {
  for (const [name, install] of SEAS) {
    it(`adds back up to ${name}, everywhere, at every instant`, () => {
      resetSwell(); install();
      let worst = 0;
      for (let i = 0; i < 400; i++) {
        tickSwell(0.13);
        for (const x of [0, 137, -5678, 91_234]) {
          for (const d of [60, BED, 10_000]) {
            const full = seaSwellAt(x, -x * 0.7, d);
            const parts = seaHeaveAt(x, -x * 0.7, d) + seaChopAt(x, -x * 0.7, d);
            worst = Math.max(worst, Math.abs(full - parts));
          }
        }
      }
      // Floating point, and nothing else.
      expect(worst).toBeLessThan(1e-9);
    });
  }

  it('leaves the authoritative surface exactly as it was', () => {
    // The whole risk of this stage in one assertion: if the camera's
    // reference had been allowed to become the water, this is what
    // would have changed.
    resetSwell(); useProceduralSea(GENERATION);
    tickSwell(7.3);
    const heights = [0, 500, -900].map((x) => seaSwellAt(x, x * 2, BED));
    resetSwell(); useProceduralSea(GENERATION);
    tickSwell(7.3);
    expect([0, 500, -900].map((x) => seaSwellAt(x, x * 2, BED))).toEqual(heights);
    // And the query still hands out the FULL column, chop included.
    useWaterQuery((wx, wz) => ({
      depth: BED + seaSwellAt(wx, wz, BED), flowX: 0, flowZ: 0, salt: true,
    }));
    const spot = waterSpotAt(0, 0)!;
    expect(spot.depth - BED).toBeCloseTo(seaSwellAt(0, 0, BED), 9);
  });
});

describe('SLICED — macro passes, meso does not', () => {
  it('follows every macro component and rejects every meso one', () => {
    resetSwell();
    const field = useProceduralSea(GENERATION);
    const table = activeWaves();
    for (let i = 0; i < table.length; i++) {
      const gain = heaveGain(table[i].omega);
      if (field.components[i].scale === 'macro') {
        expect(gain).toBeGreaterThan(0.95);
      } else {
        expect(gain).toBeLessThan(0.25);
      }
    }
  });

  it('is the LEAST order that does it — the reason it is three', () => {
    // The comment on HEAVE_ORDER claims this; here it is, measured.
    resetSwell();
    const field = useProceduralSea(GENERATION);
    const table = activeWaves();
    const gainAt = (omega: number, order: number) => {
      const period = (2 * Math.PI) / omega;
      return 1 / Math.sqrt(1 + (HEAVE_CORNER_S / period) ** (2 * order));
    };
    const passes = (order: number) => table.every((w, i) => (
      field.components[i].scale === 'macro'
        ? gainAt(w.omega, order) > 0.95
        : gainAt(w.omega, order) < 0.25));
    expect(passes(HEAVE_ORDER)).toBe(true);
    expect(passes(HEAVE_ORDER - 1)).toBe(false);
  });

  it('sits in the gap the generator leaves, without being told', () => {
    // The corner is the geometric mean of the two periods the sea is
    // designed around, and the field puts nothing near it.
    resetSwell();
    useProceduralSea(GENERATION);
    const periods = activeWaves().map((w) => (2 * Math.PI) / w.omega).sort((a, b) => a - b);
    const below = periods.filter((p) => p < HEAVE_CORNER_S);
    const above = periods.filter((p) => p > HEAVE_CORNER_S);
    expect(below.length).toBe(2);
    expect(above.length).toBe(3);
    // A clear gap either side, not a component grazing the corner.
    expect(Math.max(...below)).toBeLessThan(HEAVE_CORNER_S * 0.7);
    expect(Math.min(...above)).toBeGreaterThan(HEAVE_CORNER_S * 1.5);
  });

  it('keeps the shipped sea where it already was', () => {
    // Both shipped components are chop by this measure, which is the
    // right answer — the whole table is 1.5 s — and the fraction the
    // camera passes stays at the v0.0.101 figure rather than jumping.
    resetSwell(); useFixedSea();
    const table = activeWaves();
    const followed = table.reduce((s, w) => s + w.amp * heaveGain(w.omega), 0)
      / table.reduce((s, w) => s + w.amp, 0);
    expect(followed).toBeLessThan(0.19);
    expect(followed).toBeGreaterThan(0.05);
  });
});

describe('IN STEP — a spectral filter has no lag, which is the point', () => {
  it('crosses zero when the slow sea does, not a moment later', () => {
    resetSwell(); useProceduralSea(GENERATION);
    // A temporal filter of the same corner would trail by roughly an
    // eighth of a period on the macro swell. Compare the reference
    // against one built by hand from the same components at the same
    // instant: if there were any lag at all, these would separate.
    const table = activeWaves();
    let worst = 0;
    for (let i = 0; i < 600; i++) {
      tickSwell(1 / 60);
      const byHand = table.reduce((sum, w) => sum
        + w.amp * (w.envelope ? w.envelope(i / 60) : 1) * heaveGain(w.omega)
        * Math.cos((0 * w.dx + 0 * w.dz) * w.k - w.omega * (i + 1) / 60), 0);
      worst = Math.max(worst, Math.abs(byHand - seaHeaveAt(0, 0, 10_000)));
    }
    // Deep water, so shoaling is one; what is left is phase.
    expect(worst).toBeLessThan(0.02);
  });

  it('travels WITH her now, which is what frames her', () => {
    // v0.0.111, at Joshua's direction. Four versions tried to hold the
    // camera still against the sea and every one of them lost her: the
    // picture accepts about eleven units of height at this boom and
    // she rides a hundred and ninety, so a camera that does not travel
    // with her cannot show her. It travels with her.
    resetSwell(); useProceduralSea(GENERATION);
    const r = float(120);
    expect(r.herSwing).toBeGreaterThan(100);
    // Her translation reaches the camera; the offset only softens the
    // transients, so in steady swell the two move as one object.
    expect(r.lensSwing).toBeGreaterThan(r.herSwing * 0.9);
  });

  it('and the horizon still does not move, because it TRANSLATES', () => {
    // THE POINT THE WHOLE SAGA TURNED ON. A camera rising and falling
    // with her moves the world past the lens; it does not ROTATE the
    // view, and a horizon kilometres away only answers to rotation.
    // What made every earlier version a washing machine was pitch —
    // an aim welded to a world height she rode past.
    for (const [name, install] of SEAS) {
      resetSwell(); install();
      const r = float(120);
      expect(r.pitchSwingDeg, name).toBeLessThan(2);
    }
  });

  it('keeps her near the middle of the picture', () => {
    // The acceptance in one number: she is where the boom puts her,
    // not wherever the last wave left her.
    for (const [name, install] of SEAS) {
      resetSwell(); install();
      const r = float(120);
      expect(r.onScreen, name).toBeGreaterThan(0.98);
      expect(r.inBand, name).toBeGreaterThan(0.9);
    }
  });

  it('is washed only occasionally, and never for long', () => {
    // The lens rides a few units over her, so what reaches it is the
    // water standing higher than she does — the transients the offset
    // ease leaves behind, not a rhythm.
    for (const [name, install] of SEAS) {
      resetSwell(); install();
      const r = float(240);
      expect(r.waves, name).toBeGreaterThan(20);
      expect(r.washes / r.waves, name).toBeLessThan(0.35);
      // And a wash ends well inside the splash the tint ignores.
      expect(r.longestWash, name).toBeLessThan(splashSeconds());
    }
  });

  it('never rolls — the horizon may pitch and nothing else', () => {
    resetSwell(); useProceduralSea(GENERATION);
    const r = float(60);
    expect(r.worstRollDeg).toBeLessThan(1e-6);
  });
});

describe('BEATS — every patience follows the sea it is in', () => {
  it('reports the sea\'s own period, energy weighted', () => {
    resetSwell(); useFixedSea();
    // The table these constants were swept against.
    expect(swellPeriod()).toBeCloseTo(1.47, 1);
    resetSwell(); useProceduralSea(GENERATION);
    // Four times slower — which is exactly the problem.
    expect(swellPeriod()).toBeGreaterThan(5);
  });

  it('reproduces the swept tint constants on the shipped sea', () => {
    resetSwell(); useFixedSea();
    expect(splashSeconds()).toBeCloseTo(0.55, 1);
    expect(settleSeconds()).toBeCloseTo(1.7, 1);
    expect(SPLASH_BEATS).toBeLessThan(SETTLE_BEATS);
  });

  it('stretches them for a slower sea, so a crest still cannot tint', () => {
    // THE REQUIREMENT. A 5-7 s crest washing the lens must not read as
    // a change of medium. Held as seconds, splash was 0.55 s and every
    // macro wash would have cleared it outright.
    //
    // A REPORTED CONSEQUENCE, not a defect. Once the camera stopped
    // riding the swell (v0.0.107, at Joshua's direction) it holds
    // station near mean sea level while crests stand nearly a metre
    // over it, so on the generated sea the lens is under for about
    // half of every wave — 2.9 s of a 5.9 s cycle. That is no longer
    // a BRIEF crossing, and the tint reads it as what it is: a few per
    // cent, pulsing with the swell. Bounded well below a change of
    // medium, and the shipped sea (the default build) is unaffected at
    // under 2%. Flagged to Joshua with the v0.0.107 measurements
    // rather than tuned away here — the tint's constants are his.
    resetSwell(); useProceduralSea(GENERATION);
    expect(splashSeconds()).toBeGreaterThan(2);
    const ant = new THREE.Object3D();
    const follow = new FollowCamera(2);
    useWaterQuery((wx, wz) => ({
      depth: BED + seaSwellAt(wx, wz, BED), flowX: 0, flowZ: 0, salt: true,
    }));
    ant.position.set(0, BED, 0);
    follow.snapTo(ant);
    let wetFor = 0;
    let longest = 0;
    for (let t = -12; t < 120; t += DT) {
      tickSwell(DT);
      const surface = BED + seaSwellAt(0, 0, BED);
      ant.position.y = surface - 0.15;
      follow.update(ant, REST, DT, true, 0);
      if (t < 0) continue;
      wetFor = surface > follow.camera.position.y ? wetFor + DT : 0;
      longest = Math.max(longest, wetFor);
    }
    const lo = splashSeconds();
    const t = Math.min(1, Math.max(0, (longest - lo) / (settleSeconds() - lo)));
    const engaged = t * t * (3 - 2 * t);
    // Nowhere near a change of medium, and nowhere near the 82% that
    // keying the look on depth alone produced.
    expect(engaged).toBeLessThan(0.15);
    // The shipped sea — what the default build runs — is still inside
    // the figure v0.0.101 was accepted on.
    resetSwell(); useFixedSea();
    const fixedWash = 0.62;             // measured, npm run measure:camera
    const flo = splashSeconds();
    const ft = Math.min(1, Math.max(0, (fixedWash - flo) / (settleSeconds() - flo)));
    expect(ft * ft * (3 - 2 * ft)).toBeLessThan(0.05);
  });

  it('still calls a real submersion a submersion', () => {
    // The other half: patience is not indifference. Held under two
    // metres of water, the tint must arrive.
    for (const [, install] of SEAS) {
      resetSwell(); install();
      const engaged = (wetFor: number) => {
        const lo = splashSeconds();
        const s = Math.min(1, Math.max(0, (wetFor - lo) / (settleSeconds() - lo)));
        return s * s * (3 - 2 * s);
      };
      expect(engaged(settleSeconds() + 0.1)).toBeCloseTo(1, 3);
    }
  });
});

describe('PHYSICS — the camera reads the water, it does not answer for it', () => {
  it('leaves the authoritative surface to everybody else', () => {
    // A source guard, because the damage this prevents is invisible
    // until two systems disagree about where the water is. Flotation,
    // the surf, the orbital current, the renderer and the submersion
    // test all read the FULL surface, and since v0.0.111 the camera
    // asks the water nothing but how deep it is.
    const strip = (f: string) => readFileSync(f, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    for (const f of [
      'src/world/surf.ts', 'src/world/waterLook.ts', 'src/world/Ocean.ts',
      'src/ant/wading.ts', 'src/world/Underwater.ts',
      'src/camera/FollowCamera.ts',
    ]) {
      const src = strip(f);
      expect(src, f).not.toContain('seaHeaveAt');
      expect(src, f).not.toContain('seaChopAt');
    }
    expect(strip('src/world/surf.ts')).toContain('surfFlowAt');
    // The one thing the camera does ask the water.
    expect(strip('src/camera/FollowCamera.ts')).toContain('waterSpotAt');
  });

  it('follows a climb the same frame — no filter on her own decisions', () => {
    // The v0.0.88 fault: any lag on her intent puts the camera below
    // her aiming up. The ease is on the OFFSET, so her translation
    // arrives immediately however fast she is moving.
    const ant = new THREE.Object3D();
    const follow = new FollowCamera(2);
    useWaterQuery(() => null);
    follow.snapTo(ant);
    for (let i = 0; i < 60; i++) {
      ant.position.y += 300 / 60;
      follow.update(ant, REST, DT, false, 0);
    }
    expect(follow.camera.position.y).toBeGreaterThan(ant.position.y);
  });

  it('and holds station on a queen carried by a current', () => {
    // Smoothing the OFFSET rather than the world position is what
    // makes this true afloat as well as flying: at any drift speed the
    // camera keeps the same station instead of trailing downwind.
    const ant = new THREE.Object3D();
    const follow = new FollowCamera(2);
    // Shallow enough that the lens is clear of it — this is about
    // station keeping, not about the water envelope.
    useWaterQuery(() => ({ depth: 2, flowX: 0, flowZ: 0, salt: true }));
    follow.snapTo(ant);
    const rest = follow.camera.position.clone().sub(ant.position);
    for (let i = 0; i < 400; i++) {
      ant.position.x += 179 / 60;
      follow.update(ant, REST, DT, true, 0);
    }
    const now = follow.camera.position.clone().sub(ant.position);
    expect(now.distanceTo(rest)).toBeLessThan(0.05);
  });
});
