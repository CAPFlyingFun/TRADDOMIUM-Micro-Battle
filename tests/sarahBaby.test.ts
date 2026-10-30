import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { babyLine, babyPlace, babySize, curlFrame, FETAL_CHART, fitInSac, MODEL_CROWN_RUMP, sacRadius, SAC_FILL, weekForBump, wombAt, wombFromSkin, wombRadius, WOMB_BACK_Z, WOMB_FLOOR_Y, WOMB_TISSUE_M } from '../src/sarahlab/baby';

describe('her baby: the chart', () => {
  it('runs weeks 12 to 41 in order, every weight inside its 10th to 90th', () => {
    expect(FETAL_CHART.map((r) => r.week)).toEqual(Array.from({ length: 30 }, (_, i) => 12 + i));
    for (const r of FETAL_CHART) { expect(r.lo).toBeLessThan(r.g); expect(r.hi).toBeGreaterThan(r.g); }
    for (let i = 1; i < FETAL_CHART.length; i++) expect(FETAL_CHART[i].g).toBeGreaterThan(FETAL_CHART[i - 1].g);
  });

  it('0% is week 12, 100% week 40, a straight line between; on to 42 at 200%', () => {
    expect(weekForBump(0)).toBe(12); expect(weekForBump(50)).toBe(26); expect(weekForBump(100)).toBe(40);
    expect(weekForBump(200)).toBe(42); expect(weekForBump(-10)).toBe(12); expect(weekForBump(500)).toBe(42);
  });

  it('week 40 is the chart: 51.0 cm, 3460 g, 2595 g light, 4617 g heavy', () => {
    expect(babySize(40).cm).toBeCloseTo(51.0, 6); expect(babySize(40).g).toBeCloseTo(3460, 6);
    expect(babySize(40, -100).g).toBeCloseTo(2595, 6); expect(babySize(40, 100).g).toBeCloseTo(4617, 6);
    expect(babySize(28).g).toBeCloseTo(1000, 6); expect(babySize(20).cm).toBeCloseTo(25.7, 6);
  });

  it('early weeks are crown-rump on the chart, drawn as a whole length', () => {
    expect(babySize(12).cm).toBeCloseTo(5.4 / MODEL_CROWN_RUMP, 6);
    // and it grows without stepping back where the chart switches to crown-heel
    for (let w = 12; w < 42; w += 0.25) expect(babySize(w + 0.25).cm).toBeGreaterThanOrEqual(babySize(w).cm);
  });

  it('reads as a line', () => {
    expect(babyLine(100, 0)).toBe('week 40 · 51.0 cm (20.1 in) · 3.46 kg (7 lb 10 oz)');
    expect(babyLine(25, 0)).toContain('240 g');
  });
});

describe('her baby: in her womb', () => {
  it('the womb is the fitted egg at each size, tipped forward and lower by a heavy baby', () => {
    const w = wombAt(100, 0);
    expect(w.centre.y).toBeCloseTo(1.0147, 4); expect(w.centre.z).toBeCloseTo(0.0606, 4);
    const heavy = wombAt(100, 100), light = wombAt(100, -100);
    expect(heavy.eu.z).toBeGreaterThan(w.eu.z); expect(light.eu.z).toBeLessThan(w.eu.z);
    expect(heavy.d).toBeGreaterThan(w.d);
    expect(wombRadius(w, 1, 0, 0)).toBeCloseTo(w.a, 9);
  });

  /** a curled stand-in: an ellipsoid of points, long along y, its head end up */
  const blob = () => {
    const pts: number[] = [];
    for (let i = 0; i < 400; i++) { const t = (i / 400) * Math.PI * 2 * 7, z = (i / 400) * 2 - 1, r = Math.sqrt(1 - z * z); pts.push(0.25 * r * Math.cos(t), 0.55 * z, 0.3 * r * Math.sin(t)); }
    return pts;
  };

  it('measures its curl: long axis to the head end, and its size', () => {
    const c = curlFrame(blob(), new THREE.Vector3(0, 1, 0));
    expect(Math.abs(c.long.y)).toBeGreaterThan(0.99); expect(c.long.y).toBeGreaterThan(0);
    expect(c.size.y).toBeGreaterThan(1.0);
    expect(curlFrame(blob(), new THREE.Vector3(0, -1, 0)).long.y).toBeLessThan(0);
  });

  /** a belly's front skin (rest metres): a half-ellipsoid bulge from her pubic bone to under her ribs, `depth` forward */
  const belly = (depth: number) => {
    const pts: number[] = [];
    for (let y = 0.80; y <= 1.23; y += 0.006) for (let x = -0.22; x <= 0.22; x += 0.006) {
      const u = (y - 1.02) / 0.2, w = x / 0.2, k = 1 - u * u - w * w;
      pts.push(x, y, 0.05 + (k > 0 ? depth * Math.sqrt(k) : 0));
    }
    return pts;
  };
  const inside = (pts: number[], p: { position: THREE.Vector3; quaternion: THREE.Quaternion }, scale: number, w: ReturnType<typeof wombFromSkin>) => {
    let worst = -Infinity; const q = new THREE.Vector3();
    for (let i = 0; i < pts.length / 3; i++) {
      q.set(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]).multiplyScalar(scale).applyQuaternion(p.quaternion).add(p.position).sub(w.centre);
      const r = q.length(); worst = Math.max(worst, r - sacRadius(w, q.x / r, q.y / r, q.z / r) * SAC_FILL);
    }
    return worst;
  };

  it('her womb is her belly: inside her skin by its tissue, in front of her spine, its top rising with the weeks', () => {
    const skin = belly(0.17), w = wombFromSkin(skin, 40);
    const front = w.centre.z + sacRadius(w, 0, 0, 1), back = w.centre.z - sacRadius(w, 0, 0, -1);
    expect(front).toBeLessThanOrEqual(0.05 + 0.17 - WOMB_TISSUE_M + 1e-3);
    expect(front).toBeGreaterThan(0.05 + 0.17 - WOMB_TISSUE_M - 0.02);
    expect(back).toBeGreaterThanOrEqual(WOMB_BACK_Z - 0.01);
    expect(w.centre.y - sacRadius(w, 0, -1, 0)).toBeGreaterThan(WOMB_FLOOR_Y - 0.01);
    const early = wombFromSkin(skin, 16);
    expect(early.centre.y + sacRadius(early, 0, 1, 0)).toBeLessThan(w.centre.y + sacRadius(w, 0, 1, 0) - 0.15);
    // never outside her skin, anywhere
    for (let i = 0; i < skin.length / 3; i += 7) {
      const q = new THREE.Vector3(skin[i * 3], skin[i * 3 + 1], skin[i * 3 + 2]).sub(w.centre), r = q.length();
      expect(sacRadius(w, q.x / r, q.y / r, q.z / r)).toBeLessThan(r + 1e-3);
    }
  });

  it('the baby lies head down, all of it inside the sac', () => {
    const pts = blob(), curl = curlFrame(pts, new THREE.Vector3(0, 1, 0));
    for (const [bump, weight, depth] of [[50, 0, 0.09], [100, 0, 0.17], [150, 0, 0.24], [200, 0, 0.3], [100, 100, 0.17]] as const) {
      const w = wombFromSkin(belly(depth), weekForBump(bump));
      const p = babyPlace(bump, weight, curl, w);
      expect(curl.long.clone().applyQuaternion(p.quaternion).dot(w.axis)).toBeLessThan(-0.99);
      const fit = fitInSac(pts, p, w);
      p.position.add(fit.move);
      expect(inside(pts, p, fit.scale, w)).toBeLessThan(1e-3);
      expect(fit.scale).toBeLessThanOrEqual(p.scale);
    }
  });

  it('a heavier baby is drawn bigger, a lighter one smaller', () => {
    const curl = curlFrame(blob(), new THREE.Vector3(0, 1, 0));
    const at = { centre: new THREE.Vector3(), axis: new THREE.Vector3(0, 1, 0) };
    expect(babyPlace(100, 100, curl, at).scale).toBeGreaterThan(babyPlace(100, 0, curl, at).scale);
    expect(babyPlace(100, -100, curl, at).scale).toBeLessThan(babyPlace(100, 0, curl, at).scale);
  });
});
