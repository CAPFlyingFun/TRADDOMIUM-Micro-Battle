/**
 * HER NAVEL AS ITS OWN PIECE (Joshua, 2026-10-29: "I want the bellybutton independent of the belly size, so I could
 * do a max outie at 0% belly or 200%, or no outie at 200%... make the bellybutton outie look the same from belly
 * 0-200%, then work on the innie from 0-200%, but still allow the default sync"; the innie: "same size and shape as
 * the reference model... smoother and like a bowl").
 *
 * Why it cannot ride her belly shapes: they squeeze the skin round her navel to half its width as she shrinks (6 cm
 * across at 100% is 2.9 cm at 0%, measured), so a navel modelled at one size crumples or pinches at another. So the
 * navel is laid fresh on her skin whenever her shape changes, from two fixed shapes baked as height fields: her clean
 * 100% outie and the reference body's bowl.
 *
 * Each time (`apply`), on the zone round her navel, in her body file's geometry units:
 *   1. where each point of the zone is: her CPU rest shape plus the GPU's morphs at their weights;
 *   2. her skin's facing there, from a plane through the ring round the zone, and a quadric of that ring;
 *   3. the zone laid out clean in that frame (each inside point the mean of its neighbours, the zone's edge held), and
 *      what the edge differs from the quadric carried inward the same way, so the zone meets her skin round it;
 *   4. the navel's shape set on that skin, centred on her navel, for the in/out number `x` -- navelFlat's own number,
 *      so the automatic sync, the NAVEL control and the settling under fabric all mean what they did: 0 the outie,
 *      1 the bowl, through flat between (the outie settles to flat by 0.5, the bowl deepens after); below 0 a fuller
 *      outie, above 1 a deeper bowl;
 *   5. written into the rest shape less the GPU's share, normals too, so the GPU lands each point where it belongs.
 * The file's own navel morphs are left at zero on her body while this runs.
 */
import * as THREE from 'three';

export interface NavelData {
  /** The zone's points (her texture seams split a point into copies; each listed once here). */
  readonly count: number;
  /** Per point: 1 inside (laid out), 2 the zone's edge (held), 4 the ring round it (for her skin's facing). */
  readonly flags: Uint8Array;
  readonly splitStart: Uint32Array;
  /** Each point's copies in her mesh. */
  readonly splits: Uint32Array;
  readonly neighbourStart: Uint32Array;
  /** Each inside point's neighbours (zone indices). */
  readonly neighbours: Uint32Array;
  /** The triangles touching an inside point (zone indices), for normals. */
  readonly triangles: Uint32Array;
  /** Her navel's own point (zone index): the shapes are centred where the layout puts it. */
  readonly seed: number;
  /** Both shapes: grid × grid heights over ±gridRadius (geometry units), [across][up]. */
  readonly grid: number;
  readonly gridRadius: number;
  readonly outie: Float32Array;
  readonly bowl: Float32Array;
}

/** The file's navel morphs: zero on her body while the piece runs (it is her navel). */
export const NAVEL_MORPHS: readonly string[] = ['navelFlat', 'navelIn', 'navelOut'];
/** Layout passes (Gauss-Seidel), from where the points are each time: the same shape always lays the same navel. */
const LAYOUT_PASSES = 400;

/** The height the navel's shape stands over her skin for in/out `x` at (u, v) from its centre. */
export function navelHeight(data: NavelData, x: number, u: number, v: number): number {
  const sample = (g: Float32Array) => {
    const n = data.grid, r = data.gridRadius;
    const fi = ((u + r) / (2 * r)) * (n - 1), fj = ((v + r) / (2 * r)) * (n - 1);
    if (!(fi >= 0 && fj >= 0 && fi <= n - 1 && fj <= n - 1)) return 0;
    const i = Math.min(n - 2, Math.floor(fi)), j = Math.min(n - 2, Math.floor(fj)), a = fi - i, b = fj - j;
    return (g[i * n + j] * (1 - a) + g[(i + 1) * n + j] * a) * (1 - b) + (g[i * n + j + 1] * (1 - a) + g[(i + 1) * n + j + 1] * a) * b;
  };
  const s = Number.isFinite(x) ? x : 1;
  if (s <= 0) return (1 - s) * sample(data.outie);
  if (s <= 0.5) return (1 - 2 * s) * sample(data.outie);
  if (s <= 1) return (2 * s - 1) * sample(data.bowl);
  return s * sample(data.bowl);
}

/** The smallest-eigenvalue direction of a symmetric 3×3 (cyclic Jacobi): a plane's normal from its scatter. */
export function smallestAxis(m: number[]): [number, number, number] {
  const a = [[m[0], m[1], m[2]], [m[1], m[3], m[4]], [m[2], m[4], m[5]]];
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 24; sweep += 1) {
    let off = 0;
    for (let p = 0; p < 3; p += 1) for (let q = p + 1; q < 3; q += 1) off += a[p][q] * a[p][q];
    if (off < 1e-30) break;
    for (let p = 0; p < 3; p += 1) for (let q = p + 1; q < 3; q += 1) {
      if (Math.abs(a[p][q]) < 1e-30) continue;
      const th = (a[q][q] - a[p][p]) / (2 * a[p][q]), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k += 1) { const x = a[k][p], y = a[k][q]; a[k][p] = c * x - s * y; a[k][q] = s * x + c * y; }
      for (let k = 0; k < 3; k += 1) { const x = a[p][k], y = a[q][k]; a[p][k] = c * x - s * y; a[q][k] = s * x + c * y; }
      for (let k = 0; k < 3; k += 1) { const x = v[k][p], y = v[k][q]; v[k][p] = c * x - s * y; v[k][q] = s * x + c * y; }
    }
  }
  const i = a[0][0] <= a[1][1] && a[0][0] <= a[2][2] ? 0 : a[1][1] <= a[2][2] ? 1 : 2;
  return [v[0][i], v[1][i], v[2][i]];
}

/** Least-squares quadric w = c0 + c1 u + c2 v + c3 u² + c4 uv + c5 v² through points. */
export function fitQuadric(us: number[], vs: number[], ws: number[]): number[] {
  const M = Array.from({ length: 6 }, () => new Array(7).fill(0));
  for (let k = 0; k < us.length; k += 1) {
    const u = us[k], v = vs[k], row = [1, u, v, u * u, u * v, v * v];
    for (let i = 0; i < 6; i += 1) { for (let j = 0; j < 6; j += 1) M[i][j] += row[i] * row[j]; M[i][6] += row[i] * ws[k]; }
  }
  for (let c = 0; c < 6; c += 1) {
    let p = c; for (let r = c + 1; r < 6; r += 1) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-30;
    for (let r = 0; r < 6; r += 1) if (r !== c) { const f = M[r][c] / d; for (let j = c; j < 7; j += 1) M[r][j] -= f * M[c][j]; }
  }
  return M.map((row, i) => row[6] / (row[i] || 1e-30));
}
const quadricAt = (c: number[], u: number, v: number) => c[0] + c[1] * u + c[2] * v + c[3] * u * u + c[4] * u * v + c[5] * v * v;

export class NavelPiece {
  private readonly pos: Float64Array;
  private readonly lay: Float64Array;
  /** What was written last (first copy of each inside point), to know whether the rest shape was reset since. */
  private written: Float32Array | null = null;
  private key = '';
  /** The last in/out number laid (for a probe). */
  lastX = Number.NaN;

  constructor(readonly data: NavelData) {
    this.pos = new Float64Array(data.count * 3);
    this.lay = new Float64Array(data.count * 3);
  }

  /**
   * Lay her navel for in/out `x` on her shape as it stands: her rest shape (`position`/`normal`, after her shape
   * fields) and the GPU morphs that will be added to it at `weights` (by name; the navel morphs are ignored and must
   * be zero on her). Writes the zone's points and normals into the rest shape.
   */
  apply(mesh: THREE.Mesh, weights: Readonly<Record<string, number>>, x: number): void {
    const d = this.data, geom = mesh.geometry as THREE.BufferGeometry;
    const pAttr = geom.getAttribute('position') as THREE.BufferAttribute, nAttr = geom.getAttribute('normal') as THREE.BufferAttribute | undefined;
    const P = pAttr.array as Float32Array, N = nAttr ? (nAttr.array as Float32Array) : null;
    const dict = mesh.morphTargetDictionary ?? {}, mp = geom.morphAttributes.position ?? [], mn = geom.morphAttributes.normal ?? [];
    const live = Object.entries(weights).filter(([name, w]) => w !== 0 && Number.isFinite(w) && dict[name] !== undefined && !NAVEL_MORPHS.includes(name)).map(([name, w]) => [dict[name], w] as const);
    const gpu = (s: number, out: number[], normals: boolean) => {
      out[0] = 0; out[1] = 0; out[2] = 0;
      for (const [k, w] of live) {
        // read through the attribute: her morphs are stored quantized (normalized integers) and getX decodes them
        const a = (normals ? mn[k] : mp[k]) as THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined;
        if (!a) continue;
        out[0] += w * a.getX(s); out[1] += w * a.getY(s); out[2] += w * a.getZ(s);
      }
    };
    const g = [0, 0, 0], first = (k: number) => d.splits[d.splitStart[k]];
    // skip when nothing it reads has changed and what it wrote is still there
    const key = `${x.toFixed(4)}|${live.map(([k, w]) => `${k}:${w.toFixed(5)}`).join(',')}|${this.edgeSum(P)}`;
    if (key === this.key && this.stillWritten(P)) return;
    this.key = key;
    this.lastX = x;
    const X = this.pos;
    for (let k = 0; k < d.count; k += 1) { const s = first(k); gpu(s, g, false); X[k * 3] = P[s * 3] + g[0]; X[k * 3 + 1] = P[s * 3 + 1] + g[1]; X[k * 3 + 2] = P[s * 3 + 2] + g[2]; }
    // 2. her skin's facing: a plane through the ring
    let cx = 0, cy = 0, cz = 0, m = 0;
    for (let k = 0; k < d.count; k += 1) if (d.flags[k] & 4) { cx += X[k * 3]; cy += X[k * 3 + 1]; cz += X[k * 3 + 2]; m += 1; }
    cx /= m; cy /= m; cz /= m;
    const C = [0, 0, 0, 0, 0, 0];
    for (let k = 0; k < d.count; k += 1) if (d.flags[k] & 4) {
      const a = X[k * 3] - cx, b = X[k * 3 + 1] - cy, c = X[k * 3 + 2] - cz;
      C[0] += a * a; C[1] += a * b; C[2] += a * c; C[3] += b * b; C[4] += b * c; C[5] += c * c;
    }
    let nrm = smallestAxis(C);
    if (nrm[2] < 0) nrm = [-nrm[0], -nrm[1], -nrm[2]];
    // e1 = up × n (across her), e2 = n × e1 (up her)
    let e1 = [nrm[2], 0, -nrm[0]]; const l1 = Math.hypot(e1[0], e1[1], e1[2]) || 1; e1 = [e1[0] / l1, e1[1] / l1, e1[2] / l1];
    const e2 = [nrm[1] * e1[2] - nrm[2] * e1[1], nrm[2] * e1[0] - nrm[0] * e1[2], nrm[0] * e1[1] - nrm[1] * e1[0]];
    const L = this.lay;
    const local = (k: number, out: number[]) => {
      const a = X[k * 3] - cx, b = X[k * 3 + 1] - cy, c = X[k * 3 + 2] - cz;
      out[0] = a * e1[0] + b * e1[1] + c * e1[2]; out[1] = a * e2[0] + b * e2[1] + c * e2[2]; out[2] = a * nrm[0] + b * nrm[1] + c * nrm[2];
    };
    const us: number[] = [], vs: number[] = [], ws: number[] = [], t = [0, 0, 0];
    for (let k = 0; k < d.count; k += 1) if (d.flags[k] & 4) { local(k, t); us.push(t[0]); vs.push(t[1]); ws.push(t[2]); }
    const q = fitQuadric(us, vs, ws);
    // 3. the layout and the carry: held points as they are, inside points from where they are
    for (let k = 0; k < d.count; k += 1) {
      const inside = (d.flags[k] & 1) !== 0;
      local(k, t);
      L[k * 3] = t[0]; L[k * 3 + 1] = t[1]; L[k * 3 + 2] = inside ? 0 : t[2] - quadricAt(q, t[0], t[1]);
    }
    for (let pass = 0; pass < LAYOUT_PASSES; pass += 1) {
      for (let k = 0; k < d.count; k += 1) {
        if (!(d.flags[k] & 1)) continue;
        const a = d.neighbourStart[k], b = d.neighbourStart[k + 1];
        let su = 0, sv = 0, sc = 0;
        for (let j = a; j < b; j += 1) { const o = d.neighbours[j] * 3; su += L[o]; sv += L[o + 1]; sc += L[o + 2]; }
        const n = b - a || 1;
        L[k * 3] = su / n; L[k * 3 + 1] = sv / n; L[k * 3 + 2] = sc / n;
      }
    }
    // 4. the navel's shape, centred where the layout puts her navel
    const uc = L[d.seed * 3], vc = L[d.seed * 3 + 1];
    const F = new Float64Array(d.count * 3);
    for (let k = 0; k < d.count; k += 1) {
      if (!(d.flags[k] & 1)) { F[k * 3] = X[k * 3]; F[k * 3 + 1] = X[k * 3 + 1]; F[k * 3 + 2] = X[k * 3 + 2]; continue; }
      const u = L[k * 3], v = L[k * 3 + 1], w = quadricAt(q, u, v) + L[k * 3 + 2] + navelHeight(d, x, u - uc, v - vc);
      F[k * 3] = cx + u * e1[0] + v * e2[0] + w * nrm[0];
      F[k * 3 + 1] = cy + u * e1[1] + v * e2[1] + w * nrm[1];
      F[k * 3 + 2] = cz + u * e1[2] + v * e2[2] + w * nrm[2];
    }
    // normals of the laid shape (area-weighted over the triangles touching the inside)
    const NN = new Float64Array(d.count * 3);
    for (let i = 0; i < d.triangles.length; i += 3) {
      const a = d.triangles[i] * 3, b = d.triangles[i + 1] * 3, c = d.triangles[i + 2] * 3;
      const ux = F[b] - F[a], uy = F[b + 1] - F[a + 1], uz = F[b + 2] - F[a + 2], vx = F[c] - F[a], vy = F[c + 1] - F[a + 1], vz = F[c + 2] - F[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const o of [a, b, c]) { NN[o] += nx; NN[o + 1] += ny; NN[o + 2] += nz; }
    }
    // 5. written back less the GPU's share
    if (!this.written) this.written = new Float32Array(d.count);
    for (let k = 0; k < d.count; k += 1) {
      if (!(d.flags[k] & 1)) continue;
      const l = Math.hypot(NN[k * 3], NN[k * 3 + 1], NN[k * 3 + 2]) || 1;
      for (let j = d.splitStart[k]; j < d.splitStart[k + 1]; j += 1) {
        const s = d.splits[j];
        gpu(s, g, false);
        P[s * 3] = F[k * 3] - g[0]; P[s * 3 + 1] = F[k * 3 + 1] - g[1]; P[s * 3 + 2] = F[k * 3 + 2] - g[2];
        if (N) { gpu(s, g, true); N[s * 3] = NN[k * 3] / l - g[0]; N[s * 3 + 1] = NN[k * 3 + 1] / l - g[1]; N[s * 3 + 2] = NN[k * 3 + 2] / l - g[2]; }
      }
      this.written[k] = P[first(k) * 3];
    }
    pAttr.needsUpdate = true;
    if (nAttr) nAttr.needsUpdate = true;
  }

  /** A fingerprint of the held points (the zone's edge and ring) as the rest shape has them. */
  private edgeSum(P: Float32Array): string {
    const d = this.data;
    let s = 0;
    for (let k = 0; k < d.count; k += 1) if (!(d.flags[k] & 1)) { const i = d.splits[d.splitStart[k]] * 3; s += P[i] * 1.3 + P[i + 1] * 1.7 + P[i + 2] * 2.1; }
    return s.toFixed(7);
  }

  private stillWritten(P: Float32Array): boolean {
    const d = this.data, w = this.written;
    if (!w) return false;
    for (let k = 0; k < d.count; k += 1) if ((d.flags[k] & 1) && P[d.splits[d.splitStart[k]] * 3] !== w[k]) return false;
    return true;
  }
}
