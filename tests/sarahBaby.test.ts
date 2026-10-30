import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { AUTO_DEPTH_MOST, babiesInHer, babyBody, babySolid, balanceDeg, BALANCE_MOST_DEG, FIT_TOLERANCE, PACK_SOFT, SHRINK_MOST, solidDeep, type BabyPlace, multipleShare, placeBabies, sacAround, babyPast, bellyPush, growSac, placeBaby, pushAt, pushZone, babyLine, babyPlace, babySize, curlFrame, FETAL_CHART, fitInSac, MODEL_CROWN_RUMP, sacRadius, SAC_FILL, weekForBump, wombAt, wombFromSkin, wombRadius, WOMB_BACK_Z, WOMB_FLOOR_Y, WOMB_TISSUE_M } from '../src/sarahlab/baby';

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

  it('the baby first: where it fits, her belly is left exactly as it is', () => {
    const pts = blob(), curl = curlFrame(pts, new THREE.Vector3(0, 1, 0));
    const room = wombFromSkin(belly(0.3), weekForBump(60));
    const fit = placeBaby(pts, 60, 0, curl, room);
    expect(fit.squeezed).toBe(1);
    const push = bellyPush(growSac(room, babyPast(pts, fit, room)));
    expect(push.most).toBe(0);
    expect(pushAt(push, 0, 1.0, 0.3, new THREE.Vector3())).toBe(false);
  });

  it('where it does not, the sac grows round it and her belly is pushed out -- on her belly only', () => {
    const pts = blob().map((v) => v * 1.5), curl = curlFrame(pts, new THREE.Vector3(0, 1, 0));
    const room = wombFromSkin(belly(0.1), weekForBump(100));
    const fit = placeBaby(pts, 100, 0, curl, room);
    expect(fit.scale).toBeCloseTo(babyPlace(100, 0, curl, room).scale, 9);   // never shrunk
    const grown = growSac(room, babyPast(pts, fit, room));
    // the whole baby inside the grown sac
    const q = new THREE.Vector3();
    for (let i = 0; i < pts.length / 3; i++) {
      q.set(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]).multiplyScalar(fit.scale).applyQuaternion(fit.quaternion).add(fit.position).sub(grown.centre);
      const r = q.length(); expect(r).toBeLessThanOrEqual(sacRadius(grown, q.x / r, q.y / r, q.z / r) * SAC_FILL + 2e-3);
    }
    const push = bellyPush(grown);
    expect(push.most).toBeGreaterThan(0.005);
    // on the front of her belly it moves out; under her breasts, at her groin and out at her sides it does not
    const out = new THREE.Vector3();
    let moved = 0;
    for (let y = 0.92; y <= 1.1; y += 0.02) if (pushAt(push, 0, y, 0.05 + 0.1 * Math.sqrt(Math.max(0, 1 - ((y - 1.02) / 0.2) ** 2)), out)) moved = Math.max(moved, out.z);
    expect(moved).toBeGreaterThan(0.002);
    expect(pushZone(0, 1.25)).toBe(0); expect(pushZone(0, 0.83)).toBe(0); expect(pushZone(0.31, 1.0)).toBe(0); expect(pushZone(0, 1.0)).toBe(1);
  });

  it('a heavier baby is drawn bigger, a lighter one smaller', () => {
    const curl = curlFrame(blob(), new THREE.Vector3(0, 1, 0));
    const at = { centre: new THREE.Vector3(), axis: new THREE.Vector3(0, 1, 0) };
    expect(babyPlace(100, 100, curl, at).scale).toBeGreaterThan(babyPlace(100, 0, curl, at).scale);
    expect(babyPlace(100, -100, curl, at).scale).toBeLessThan(babyPlace(100, 0, curl, at).scale);
  });
});

describe('her babies: twins and triplets, and how they lie', () => {
  it('twins and triplets grow as one until the womb is shared, then slower', () => {
    expect(multipleShare(20, 2)).toBe(1); expect(multipleShare(31, 2)).toBe(1); expect(multipleShare(28, 3)).toBe(1);
    expect(multipleShare(40, 2)).toBeCloseTo(0.84, 9); expect(multipleShare(40, 3)).toBeCloseTo(0.78, 9);
    expect(multipleShare(34, 3)).toBeCloseTo(0.89, 9);   // ~10% below a singleton by 34 (triplet EFW 1.9 kg against 2.1)
    expect(multipleShare(40, 1)).toBe(1);
    expect(babySize(40, 0, 2).g).toBeCloseTo(3460 * 0.84, 6);
    // and the same belly holds them earlier: twins at 32 weeks at 100%, triplets at 29; born around 36-37 and 33-35
    expect(weekForBump(100, 2)).toBe(32); expect(weekForBump(150, 2)).toBe(36); expect(weekForBump(100, 3)).toBe(29);
    expect(weekForBump(100)).toBe(40); expect(weekForBump(0, 3)).toBe(12);
    expect(babySize(40, 0, 2).cm).toBeLessThan(babySize(40).cm);
    expect(babyLine(100, 0, 2)).toContain('TWINS'); expect(babyLine(100, 0, 2)).toContain('each');
  });

  // a curled baby's stand-in: an egg's skin, points close enough together to close it
  const blob = (n = 300) => {
    const pts: number[] = [];
    for (let i = 0; i < n; i++) { const t = i * 2.39996, z = ((i + 0.5) / n) * 2 - 1, r = Math.sqrt(1 - z * z); pts.push(0.25 * r * Math.cos(t), 0.55 * z, 0.3 * r * Math.sin(t)); }
    return pts;
  };
  const belly = (depth: number) => {
    const pts: number[] = [];
    for (let y = 0.80; y <= 1.23; y += 0.008) for (let x = -0.22; x <= 0.22; x += 0.008) { const u = (y - 1.02) / 0.2, w = x / 0.2, k = 1 - u * u - w * w; pts.push(x, y, 0.05 + (k > 0 ? depth * Math.sqrt(k) : 0)); }
    return pts;
  };

  it('each lies as asked, none inside another, none down through her pelvic floor', () => {
    const pts = blob(4000), curl = curlFrame(pts, new THREE.Vector3(0, 1, 0)), room = wombFromSkin(belly(0.3), weekForBump(150));
    for (const lies of [['head', 'breech'], ['head', 'breech', 'side'], ['side', 'side']] as const) {
      const fits = placeBabies(pts, 150, 0, curl, room, lies);
      expect(fits).toHaveLength(lies.length);
      fits.forEach((f, i) => {
        const along = curl.long.clone().applyQuaternion(f.quaternion);   // toward its head
        if (lies[i] === 'head') expect(along.y).toBeLessThan(-0.5);
        if (lies[i] === 'breech') expect(along.y).toBeGreaterThan(0.5);
        if (lies[i] === 'side') expect(Math.abs(along.x)).toBeGreaterThan(0.7);
        expect(babyBody(f, curl).centre.y).toBeGreaterThan(0.85);
      });
      // apart: no point of one more than a soft press (and a cube of the solid) inside another's body
      const solid = babySolid(pts, curl);
      for (let a = 0; a < fits.length; a++) for (let b = 0; b < fits.length; b++) {
        if (a === b) continue;
        const q = new THREE.Vector3(), back = fits[b].quaternion.clone().invert();
        for (let i = 0; i < pts.length / 3; i += 3) {
          q.set(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]).multiplyScalar(fits[a].scale).applyQuaternion(fits[a].quaternion).add(fits[a].position)
            .sub(fits[b].position).applyQuaternion(back).divideScalar(fits[b].scale).sub(curl.centre);
          expect(solidDeep(solid, q.x, q.y, q.z) * fits[b].scale).toBeLessThan(PACK_SOFT + 0.012);
        }
      }
    }
  });

  it('a solid from its skin: inside is inside, outside is not, deepest at its middle', () => {
    const pts = blob(4000), curl = curlFrame(pts, new THREE.Vector3(0, 1, 0)), solid = babySolid(pts, curl);
    const mid = solidDeep(solid, 0, 0, 0);
    expect(mid).toBeGreaterThan(0.18); expect(mid).toBeLessThan(0.26);   // the egg's smallest half width is 0.25
    expect(solidDeep(solid, 0, 0.45, 0)).toBeLessThan(mid);
    expect(solidDeep(solid, 0.4, 0, 0)).toBe(0); expect(solidDeep(solid, 0, 0.7, 0)).toBe(0); expect(solidDeep(solid, 5, 5, 5)).toBe(0);
  });

  /** her belly's skin and how far her DEPTH moves each point (forward, most at the bump's middle) */
  const depthOf = (skin: number[]) => skin.map((_, i) => {
    if (i % 3 !== 2) return 0;
    const u = (skin[i - 1] - 1.02) / 0.2, w = skin[i - 2] / 0.2, k = 1 - u * u - w * w;
    return k > 0 ? 0.016 * Math.sqrt(k) : 0;
  });

  it('as they are where they fit: not smaller, not deeper, nothing pushed', () => {
    const pts = blob(4000), curl = curlFrame(pts, new THREE.Vector3(0, 1, 0)), solid = babySolid(pts, curl), skin = belly(0.3);
    for (const lies of [['head'], ['head', 'breech']] as const) {
      const her = babiesInHer(pts, pts, solid, 150, -100, curl, skin, depthOf(skin), 0.1, lies);
      expect(her.shrink).toBe(1); expect(her.depth).toBe(0); expect(her.push.most).toBe(0);
      expect(her.over).toBeLessThanOrEqual(FIT_TOLERANCE);
    }
  });

  it('where they do not: a little smaller first (a tenth at most), then her own DEPTH, never past its most', () => {
    const pts = blob(4000), curl = curlFrame(pts, new THREE.Vector3(0, 1, 0)), solid = babySolid(pts, curl);
    for (const d of [0.14, 0.10]) {
      const skin = belly(d), her = babiesInHer(pts, pts, solid, 150, 100, curl, skin, depthOf(skin), 0.1, ['head', 'breech']);
      expect(her.shrink).toBeGreaterThanOrEqual(1 - SHRINK_MOST - 1e-9); expect(her.shrink).toBeLessThan(1);
      expect(her.depth).toBeGreaterThanOrEqual(0); expect(her.depth).toBeLessThanOrEqual(AUTO_DEPTH_MOST);
      // deeper only once as small as they may be
      if (her.depth > 0) expect(her.shrink).toBeCloseTo(1 - SHRINK_MOST, 9);
    }
  });

  it('the balance: against her spine none, at the front of her womb all of it -- by how many, by how heavy', () => {
    const pts = blob(), curl = curlFrame(pts, new THREE.Vector3(0, 1, 0)), room = wombFromSkin(belly(0.3), weekForBump(150));
    const back = room.centre.z - sacRadius(room, 0, 0, -1), front = room.centre.z + sacRadius(room, 0, 0, 1);
    const at = (z: number): BabyPlace => ({ position: new THREE.Vector3(0, room.centre.y, z).sub(curl.centre.clone().multiplyScalar(0.3)), quaternion: new THREE.Quaternion(), scale: 0.3 });
    expect(balanceDeg([at(back)], curl, room, 3460)).toBeCloseTo(0, 6);
    expect(balanceDeg([at((back + front) / 2)], curl, room, 3460)).toBeCloseTo(BALANCE_MOST_DEG[1] / 2, 6);
    expect(balanceDeg([at(front)], curl, room, 3460)).toBeCloseTo(15, 6);
    expect(balanceDeg([at(front), at(front)], curl, room, 3460)).toBeCloseTo(25, 6);
    expect(balanceDeg([at(front), at(front), at(front)], curl, room, 6000)).toBeCloseTo(35, 6);
    // the middle of all of them; and a light one sags her less
    expect(balanceDeg([at(front), at(back)], curl, room, 3460)).toBeCloseTo(12.5, 6);
    expect(balanceDeg([at(front)], curl, room, 1730)).toBeCloseTo(7.5, 6);
  });

  it('each of several has its own sac round it', () => {
    const pts = blob(), curl = curlFrame(pts, new THREE.Vector3(0, 1, 0)), room = wombFromSkin(belly(0.3), weekForBump(150));
    const [f] = placeBabies(pts, 150, 0, curl, room, ['head', 'breech']), sac = sacAround(pts, f, curl), q = new THREE.Vector3();
    for (let i = 0; i < pts.length / 3; i++) {
      q.set(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]).multiplyScalar(f.scale).applyQuaternion(f.quaternion).add(f.position).sub(sac.centre);
      const r = q.length(); expect(r).toBeLessThanOrEqual(sacRadius(sac, q.x / r, q.y / r, q.z / r) + 1e-3);
    }
  });
});
