/**
 * THE TEE AS TRUE CLOTH (Joshua, 2026-10-23: "make that one a true soft body/cloth with simulation over the whole thing
 * and I want to be able to see how much or little having a full soft body cloth fabric would be… if it's not a big
 * performance loss, I'd say, do the soft body cloth as there would be no more trying to sync and match to each point to
 * another point… it would naturally adjust and look better in the game").
 *
 * So this is an experiment whose RESULT IS ITS COST: about 6,000 particles and 18,000 edges, stepped on the main thread
 * of a phone every frame, next to everything else the room draws. Everything here is written for that: typed arrays
 * only, built once in the constructor; `step` allocates nothing (it even hands back the same stats object every call);
 * every pass is one flat loop over a flat array. It imports nothing from three or the DOM, so the same file can move to
 * a worker, or be measured in a test, without a scene.
 *
 * The method is XPBD with "small steps" (Macklin et al. 2019): many substeps, each with ONE Gauss-Seidel pass over the
 * constraints and its Lagrange multipliers starting from zero, which converges stiffer per millisecond than iterating.
 * Each substep, h = dt / substeps:
 *   1. damp and integrate: v *= exp(-damping·h), v += g·h, remember x, then x += v·h (a fully pinned particle is placed
 *      straight on its target instead, so the constraints that follow pull against where it really is);
 *   2. stretch: every unique edge back toward restScale × its rest length (stretchCompliance);
 *   3. bend: every pair of vertices facing each other across an edge two triangles share, the same way (bendCompliance);
 *   4. pins: a partly pinned particle blends `pin` of the way to its target; pinned particles are heavy in 2-3 and 5
 *      (inverse mass 1 - pin), so the cloth hangs from them rather than dragging them;
 *   5. the strain limit: no edge left longer than maxStretch × its (unscaled) rest length, the end nearer the pins
 *      holding (why is in the constructor);
 *   6. her skin: a particle closer to her than its standOff along her normal is pushed out to it -- a fully pinned one
 *      too, since her bones can carry its hold into her (it then takes no friction: it moves with its hold) -- and loses some of its
 *      slip over her: the tangential part of its motion this substep RELATIVE to her skin's own motion this substep, so
 *      cloth lying on skin that moves is carried with it. Two things about that, both learned the hard way:
 *      - "her skin's own motion" is the motion of the SPOT of skin the particle touched -- `after.carried -
 *        before.point`, last frame's contact carried by her pose -- and not of the nearest point, `after.point -
 *        before.point`. The nearest point moves with the particle: when the particle slid, so did it, and friction 1 was
 *        told her skin had made the slide and made the particle repeat it, every frame, never decaying. At GRIP's top
 *        stuck cloth walked across her and tore the tee in about three seconds (Joshua, 2026-10-24); at 0.5 a substep
 *        the same echo still kept 99.6% of itself a frame.
 *      - the grip is mostly UP AND DOWN her (Joshua, 2026-10-24: "I would make grip instead how fast the animation moves
 *        vertically, with small changes to horizontally… with only a max of 20% loss horizontally"). The slip is split
 *        along "up across her skin" -- against gravity, laid flat on her tangent plane -- and square to it: `friction`
 *        of the first is taken, `frictionAcross` of the second. Where her skin faces nearly straight up or down there is
 *        no "up across her" to speak of, so the vertical share fades smoothly to `frictionAcross` there (see step()).
 *   7. v = (x - x_prev) / h.
 * Her skin under each particle comes from the caller at the start and end of the frame (`before`, `after`) and is
 * interpolated linearly to (s + 1) / substeps for substep s, so a body that moves a long way in one frame is met a slice
 * at a time and not all at once on the first substep.
 *
 * Units are the room's world units (100 to the metre) and seconds. Every particle has unit mass (inverse mass 1 before
 * pinning), so a compliance α is an inverse spring constant per unit-mass particle: a constraint of compliance α holding
 * up the weight of n particles gives by about n · |g| · α world units. That is how the defaults below were chosen.
 */
import type { SkinContacts } from './clothTypes';

export interface ClothTopology {
  /** Particles. */
  readonly count: number;
  /** Particle indices, 3 per triangle (UV seams already welded: one particle per point of cloth). */
  readonly triangles: Uint32Array;
  /** Rest positions (count × 3), world units: stretch and bend lengths are measured here. */
  readonly rest: Float32Array;
  /** 0..1 per particle: 0 free, 1 held exactly at its SkinContacts.pinTarget, between: a soft hold. */
  readonly pin: Float32Array;
  /**
   * Mass per particle, 1 where missing: a hem's turned-up band weighs more than the cloth above it, and pulls it down
   * the harder (gravity accelerates every particle alike; mass decides who gives way in a constraint).
   */
  readonly mass?: Float32Array;
}

export interface ClothSettings {
  /** XPBD substeps per step: one constraint pass each, multipliers reset each substep. */
  substeps: number;
  /** XPBD compliance of every edge's length (world units per unit-mass load; 0 is inextensible). */
  stretchCompliance: number;
  /** XPBD compliance of every bend pair's distance: much softer than stretch. */
  bendCompliance: number;
  /** Stretch and bend rest lengths × this: a fitted spandex tee is worn a little stretched. */
  restScale: number;
  /** After each substep's strain limit no edge is longer than this × its rest length (the unscaled one). */
  maxStretch: number;
  /** Per second: velocity × exp(-damping · h) each substep. */
  damping: number;
  /** World units / s² (the room is 100 units to the metre). */
  gravity: [number, number, number];
  /**
   * 0..1, the share of a touching particle's slip UP AND DOWN her skin (along "up", against gravity, laid on her tangent
   * plane) removed each substep: 1 holds the cloth from sliding down her, or being dragged up her, while in contact.
   */
  friction: number;
  /**
   * 0..1, the share of a touching particle's slip ACROSS her -- square to "up" on her skin -- removed each substep. The
   * room sets it to a fifth of `friction` (GRIP holds mostly vertically, "with only a max of 20% loss horizontally"),
   * so the tee can still ease round her as she turns. Where her skin faces nearly straight up or down (the top of her
   * shoulder, under her bust) every direction is "across" and this is the whole grip.
   */
  frictionAcross: number;
}

export interface ClothStepStats {
  /** Wall-clock milliseconds the whole step took. */
  readonly ms: number;
  /** Substeps taken (0 when dt was 0). */
  readonly substeps: number;
  /** Particles touching her skin in the step's last substep. */
  readonly contacts: number;
  /** The largest push out of her skin in any substep of the step, world units. */
  readonly deepest: number;
}

/**
 * The defaults, and why.
 * - substeps 8: at 60 fps h ≈ 2.1 ms; gravity moves a particle g·h² ≈ 0.004 units a substep, so one pass catches it
 *   before it becomes stretch. Fewer is cheaper and saggier; the strain limit keeps even 2 from tearing.
 * - stretchCompliance 1e-7: under the weight of a 40-row column (a tee hung from her shoulders at ~1 unit spacing) the
 *   top edge gives 40 · 981 · 1e-7 ≈ 0.004 units, 0.4% -- a knit that holds its shape -- while α̃ = α / h² ≈ 0.02 against
 *   w_i + w_j = 2 keeps the solve well conditioned. With one pass a substep the real give is set more by convergence
 *   than by α; the strain limit is what bounds it.
 * - bendCompliance 1e-4: a thousand times softer, so one particle's weight folds a bend pair by about 0.1 unit. Jersey
 *   folds easily; her skin, not the bend, gives the tee its shape, and the bend only keeps the folds from being a lattice.
 * - restScale 0.98, maxStretch 1.15, damping 1.5, friction 0.6: the brief's. Friction is applied per substep, so at 8
 *   substeps 0.6 keeps 0.4⁸ ≈ 0.07% of a frame's slip up and down her: the knob grips from about 0.2 up, which suits
 *   spandex on skin.
 * - frictionAcross 0.12, a fifth of friction, as the room keeps it: 0.88⁸ ≈ 36% of a frame's slip across her is kept,
 *   so the cloth holds its height on her and still settles round her.
 */
export const CLOTH_DEFAULTS: Readonly<ClothSettings> = Object.freeze({
  substeps: 8,
  stretchCompliance: 1e-7,
  bendCompliance: 1e-4,
  restScale: 0.98,
  maxStretch: 1.15,
  damping: 1.5,
  gravity: [0, -981, 0] as [number, number, number],
  friction: 0.6,
  frictionAcross: 0.12,
});

/** The longest step: a hitch longer than this is taken as this, so a stalled frame cannot fling the cloth. */
const MAX_DT = 1 / 20;
/** Shorter than this, an edge or a normal has no direction and is left alone rather than divided by. */
const TINY = 1e-12;
/**
 * The grip's "up across her skin" is (-gravity) laid on her tangent plane; its length is the sine of her skin's tilt
 * from facing straight up (or down). Below UP_FADE_FROM (her skin within about 6° of level) it is all `frictionAcross`;
 * above UP_FADE_TO (about 17°) the vertical share is all `friction`; between, a smoothstep, so a fold of cloth rolling
 * over her shoulder meets no step in its grip.
 */
const UP_FADE_FROM = 0.1, UP_FADE_TO = 0.3;

/** `limitSide` values: the strain limit moves both ends by inverse mass, or holds end a, or holds end b. */
const SHARE = 0, HOLD_A = 1, HOLD_B = 2;
/** The depth of a particle no pin reaches: equal to every other such particle, so their edges share. */
const UNREACHED = 0x7fffffff;

const now: () => number = () => globalThis.performance?.now() ?? Date.now();

/** Mutable behind the readonly face `step` hands out: one object, reused, so a step allocates nothing. */
interface StatsSlot { ms: number; substeps: number; contacts: number; deepest: number }

export class ClothSim {
  /** May be changed between steps; read afresh at the start of every step. */
  settings: ClothSettings;
  readonly count: number;
  /** count × 3, world. */
  readonly positions: Float32Array;
  /** count × 3, world units / s. */
  readonly velocities: Float32Array;
  /** Unique edges, 2 particle indices per edge. */
  readonly edges: Uint32Array;
  /** Bend pairs, 2 per pair: the vertices facing each other across an edge two triangles share. */
  readonly bendPairs: Uint32Array;

  private readonly triangles: Uint32Array;
  private readonly prev: Float32Array;
  /** Inverse mass per particle: 1 - pin, so a fully pinned particle never moves for a constraint. */
  private readonly invMass: Float32Array;
  private readonly pin: Float32Array;
  private readonly edgeRest: Float32Array;
  private readonly edgeRestSq: Float32Array;
  /** Per edge, which end the strain limit leaves where it is: HOLD_A, HOLD_B or SHARE (see the constructor). */
  private readonly limitSide: Uint8Array;
  private readonly bendRest: Float32Array;
  private normalsBuffer: Float32Array | null = null;
  private readonly stats: StatsSlot = { ms: 0, substeps: 0, contacts: 0, deepest: 0 };

  constructor(topology: ClothTopology, settings?: Partial<ClothSettings>) {
    const { count, triangles, rest, pin, mass } = topology;
    if (rest.length < count * 3) throw new Error(`ClothSim: rest holds ${rest.length / 3} points, count is ${count}`);
    if (pin.length < count) throw new Error(`ClothSim: pin holds ${pin.length} values, count is ${count}`);
    if (triangles.length % 3 !== 0) throw new Error('ClothSim: triangles is not a multiple of 3');
    for (let i = 0; i < triangles.length; i++) if (triangles[i] >= count) throw new Error(`ClothSim: triangle index ${triangles[i]} ≥ count ${count}`);

    this.settings = { ...CLOTH_DEFAULTS, gravity: [...CLOTH_DEFAULTS.gravity] as [number, number, number] };
    // Only what the caller actually set: an explicit `undefined` keeps the default rather than becoming a NaN in the solve.
    if (settings) for (const [k, v] of Object.entries(settings)) if (v !== undefined) (this.settings as unknown as Record<string, unknown>)[k] = v;
    this.count = count;
    this.triangles = triangles;
    this.positions = new Float32Array(count * 3);
    this.positions.set(rest.subarray(0, count * 3));
    this.prev = new Float32Array(this.positions);
    this.velocities = new Float32Array(count * 3);
    this.pin = new Float32Array(count);
    this.invMass = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const p = Math.min(1, Math.max(0, pin[i] || 0));
      this.pin[i] = p;
      this.invMass[i] = (1 - p) / Math.max(1e-3, mass && Number.isFinite(mass[i]) ? mass[i] : 1);
    }

    // Unique edges and bend pairs, once. An edge is keyed lo·count + hi (exact in a double up to ~94 million particles);
    // the first triangle to name it leaves its third corner, the second makes the bend pair with its own. A third
    // triangle on one edge (non-manifold) adds nothing.
    const firstOpposite = new Map<number, number>();
    const edgeList: number[] = [];
    const bendList: number[] = [];
    for (let t = 0; t < triangles.length; t += 3) {
      for (let k = 0; k < 3; k++) {
        const a = triangles[t + k], b = triangles[t + ((k + 1) % 3)], c = triangles[t + ((k + 2) % 3)];
        if (a === b) continue;
        const lo = a < b ? a : b, hi = a < b ? b : a;
        const key = lo * count + hi;
        const seen = firstOpposite.get(key);
        if (seen === undefined) {
          firstOpposite.set(key, c);
          edgeList.push(lo, hi);
        } else if (seen >= 0) {
          if (seen !== c) bendList.push(seen < c ? seen : c, seen < c ? c : seen);
          firstOpposite.set(key, -1);
        }
      }
    }

    // How many edges each particle is from the nearest pin. It orders the solve and decides the strain limit:
    // - Edges are solved from the pins outward (then by particle index, which keeps neighbours near in memory), so one
    //   Gauss-Seidel pass carries a pin's hold down the cloth instead of a step at a time.
    // - The strain limit moves only an edge's end FARTHER from the pins: the nearer end has already been put right this
    //   pass and holds. With both ends moved, the edge below a pinned row re-stretched the one above it, and a 20 × 20
    //   sheet hanging from its top row reached 1.20 × rest against a limit of 1.15, iterating 32 passes still left 1.151;
    //   this way one pass holds it at 1.150. It is also what a shirt does: stretched too far, it rides up toward where it
    //   hangs from. Edges between particles equally far (or in a piece with no pin at all) share the move by inverse mass.
    const depth = pinDepth(count, edgeList, this.pin);
    const edgeOrder = sortedPairs(edgeList, (a, b) => Math.min(depth[a], depth[b]));
    this.edges = new Uint32Array(edgeList.length);
    this.limitSide = new Uint8Array(edgeList.length / 2);
    for (let e = 0; e < edgeOrder.length; e++) {
      const a = edgeList[edgeOrder[e] * 2], b = edgeList[edgeOrder[e] * 2 + 1];
      this.edges[e * 2] = a; this.edges[e * 2 + 1] = b;
      this.limitSide[e] = depth[a] < depth[b] ? HOLD_A : depth[b] < depth[a] ? HOLD_B : SHARE;
    }
    const bendOrder = sortedPairs(bendList, () => 0);
    this.bendPairs = new Uint32Array(bendList.length);
    for (let e = 0; e < bendOrder.length; e++) {
      this.bendPairs[e * 2] = bendList[bendOrder[e] * 2];
      this.bendPairs[e * 2 + 1] = bendList[bendOrder[e] * 2 + 1];
    }
    this.edgeRest = new Float32Array(this.edges.length / 2);
    this.edgeRestSq = new Float32Array(this.edges.length / 2);
    for (let e = 0; e < this.edgeRest.length; e++) {
      const d = distance(rest, this.edges[e * 2], this.edges[e * 2 + 1]);
      this.edgeRest[e] = d;
      this.edgeRestSq[e] = d * d;
    }
    this.bendRest = new Float32Array(this.bendPairs.length / 2);
    for (let e = 0; e < this.bendRest.length; e++) this.bendRest[e] = distance(rest, this.bendPairs[e * 2], this.bendPairs[e * 2 + 1]);
  }

  /**
   * Measure the pattern again from `rest` (count × 3, world units): every edge's and bend pair's rest length. The room
   * does this when her belly or shape changes, so the tee is cut for the body it is on (a maternity tee is), rather
   * than a 100% tee pulled over 200%. Allocates nothing.
   */
  setRest(rest: ArrayLike<number>): void {
    if (rest.length < this.count * 3) throw new Error(`ClothSim.setRest: ${rest.length / 3} points for ${this.count} particles`);
    const at = (a: number, b: number) => { const dx = rest[b * 3] - rest[a * 3], dy = rest[b * 3 + 1] - rest[a * 3 + 1], dz = rest[b * 3 + 2] - rest[a * 3 + 2]; return Math.sqrt(dx * dx + dy * dy + dz * dz); };
    for (let e = 0; e < this.edgeRest.length; e++) { const d = at(this.edges[e * 2], this.edges[e * 2 + 1]); this.edgeRest[e] = d; this.edgeRestSq[e] = d * d; }
    for (let e = 0; e < this.bendRest.length; e++) this.bendRest[e] = at(this.bendPairs[e * 2], this.bendPairs[e * 2 + 1]);
  }

  /** Place every particle, zero velocity. */
  reset(positions: ArrayLike<number>): void {
    const n = this.count * 3;
    if (positions.length < n) throw new Error(`ClothSim.reset: ${positions.length / 3} points for ${this.count} particles`);
    for (let i = 0; i < n; i++) this.positions[i] = positions[i];
    this.prev.set(this.positions);
    this.velocities.fill(0);
  }

  /**
   * Advance dt seconds (clamped to [0, 1/20]). `before` and `after` are her skin under the cloth at the start and the
   * end of this frame; substep s uses them interpolated at (s + 1) / substeps (point, normal re-normalized, standOff,
   * pinTarget). A particle whose interpolated normal has no length has no skin under it this substep. Friction holds
   * to her skin's motion `(after.carried - before.point) / substeps` a substep: the spot of her the particle touched
   * at the start of the frame, carried by her pose (`SkinContacts.carried`). Returns the SAME stats object every call:
   * copy it to keep it.
   */
  step(dt: number, before: SkinContacts, after: SkinContacts): ClothStepStats {
    const t0 = now();
    const stats = this.stats;
    stats.substeps = 0; stats.contacts = 0; stats.deepest = 0;
    const n = this.count;
    if (before.point.length < n * 3 || after.point.length < n * 3 || before.normal.length < n * 3 || after.normal.length < n * 3
      || before.standOff.length < n || after.standOff.length < n || before.pinTarget.length < n * 3 || after.pinTarget.length < n * 3
      || after.carried.length < n * 3) {
      throw new Error(`ClothSim.step: contacts hold fewer than ${n} particles`);
    }
    dt = dt > 0 ? Math.min(dt, MAX_DT) : 0; // NaN lands here too
    if (dt === 0) { stats.ms = now() - t0; return stats; }

    const s = this.settings;
    const substeps = Math.max(1, Math.floor(s.substeps) || 1);
    const h = dt / substeps;
    const invH = 1 / h;
    const damp = Math.exp(-Math.max(0, s.damping) * h);
    const gx = s.gravity[0] * h, gy = s.gravity[1] * h, gz = s.gravity[2] * h;
    const stretchAlpha = Math.max(0, s.stretchCompliance) / (h * h);
    const bendAlpha = Math.max(0, s.bendCompliance) / (h * h);
    const restScale = s.restScale;
    const maxStretchSq = s.maxStretch * s.maxStretch;
    const friction = unit(s.friction), across = unit(s.frictionAcross);
    // "up" for the grip: against gravity; straight up the world when there is no gravity to be against
    const gl = Math.hypot(s.gravity[0], s.gravity[1], s.gravity[2]);
    const upx = gl > TINY ? -s.gravity[0] / gl : 0, upy = gl > TINY ? -s.gravity[1] / gl : 1, upz = gl > TINY ? -s.gravity[2] / gl : 0;

    const x = this.positions, xp = this.prev, v = this.velocities, w = this.invMass, pin = this.pin;
    const bp = before.point, ap = after.point, bn = before.normal, an = after.normal, ac = after.carried;
    const bs = before.standOff, as = after.standOff, bt = before.pinTarget, at = after.pinTarget;
    let deepest = 0, contacts = 0;

    for (let sub = 0; sub < substeps; sub++) {
      const f = (sub + 1) / substeps, g = 1 - f;

      // 1. damp, integrate, predict; a fully pinned particle goes straight to its target.
      for (let i = 0, i3 = 0; i < n; i++, i3 += 3) {
        xp[i3] = x[i3]; xp[i3 + 1] = x[i3 + 1]; xp[i3 + 2] = x[i3 + 2];
        if (pin[i] >= 1) {
          x[i3] = g * bt[i3] + f * at[i3];
          x[i3 + 1] = g * bt[i3 + 1] + f * at[i3 + 1];
          x[i3 + 2] = g * bt[i3 + 2] + f * at[i3 + 2];
          continue;
        }
        const vx = v[i3] * damp + gx, vy = v[i3 + 1] * damp + gy, vz = v[i3 + 2] * damp + gz;
        v[i3] = vx; v[i3 + 1] = vy; v[i3 + 2] = vz;
        x[i3] += vx * h; x[i3 + 1] += vy * h; x[i3 + 2] += vz * h;
      }

      // 2. stretch, 3. bend: one Gauss-Seidel pass each, λ from zero (small steps), so Δλ = -C / (w_a + w_b + α̃).
      project(x, w, this.edges, this.edgeRest, restScale, stretchAlpha);
      project(x, w, this.bendPairs, this.bendRest, restScale, bendAlpha);

      // 4. soft pins blend toward their targets (full pins were placed in 1 and never moved since).
      for (let i = 0, i3 = 0; i < n; i++, i3 += 3) {
        const p = pin[i];
        if (p <= 0 || p >= 1) continue;
        x[i3] += p * (g * bt[i3] + f * at[i3] - x[i3]);
        x[i3 + 1] += p * (g * bt[i3 + 1] + f * at[i3 + 1] - x[i3 + 1]);
        x[i3 + 2] += p * (g * bt[i3 + 2] + f * at[i3 + 2] - x[i3 + 2]);
      }

      // 5. the strain limit, against the unscaled rest length; the end nearer the pins holds.
      const edges = this.edges, restSq = this.edgeRestSq, side = this.limitSide;
      for (let e = 0, e2 = 0; e < restSq.length; e++, e2 += 2) {
        const a = edges[e2], b = edges[e2 + 1];
        const a3 = a * 3, b3 = b * 3;
        const dx = x[b3] - x[a3], dy = x[b3 + 1] - x[a3 + 1], dz = x[b3 + 2] - x[a3 + 2];
        const lenSq = dx * dx + dy * dy + dz * dz;
        const maxSq = restSq[e] * maxStretchSq;
        if (lenSq <= maxSq) continue;
        const sd = side[e];
        let wa = sd === HOLD_A ? 0 : w[a], wb = sd === HOLD_B ? 0 : w[b];
        if (wa + wb <= 0) { wa = w[a]; wb = w[b]; }
        const ws = wa + wb;
        if (ws <= 0) continue;
        const len = Math.sqrt(lenSq);
        const k = (len - Math.sqrt(maxSq)) / (len * ws);
        const ka = k * wa, kb = k * wb;
        x[a3] += dx * ka; x[a3 + 1] += dy * ka; x[a3 + 2] += dz * ka;
        x[b3] -= dx * kb; x[b3 + 1] -= dy * kb; x[b3 + 2] -= dz * kb;
      }

      // 6. her skin: push out to standOff along her normal, then friction on the slip relative to her skin's own motion,
      // `friction` of it up and down her and `frictionAcross` of it across.
      const last = sub === substeps - 1;
      for (let i = 0, i3 = 0; i < n; i++, i3 += 3) {
        let nx = g * bn[i3] + f * an[i3], ny = g * bn[i3 + 1] + f * an[i3 + 1], nz = g * bn[i3 + 2] + f * an[i3 + 2];
        const nl = nx * nx + ny * ny + nz * nz;
        if (nl < TINY) continue;
        const inl = 1 / Math.sqrt(nl);
        nx *= inl; ny *= inl; nz *= inl;
        const px = g * bp[i3] + f * ap[i3], py = g * bp[i3 + 1] + f * ap[i3 + 1], pz = g * bp[i3 + 2] + f * ap[i3 + 2];
        const d = (x[i3] - px) * nx + (x[i3 + 1] - py) * ny + (x[i3 + 2] - pz) * nz - (g * bs[i] + f * as[i]);
        if (d >= 0) continue;
        x[i3] -= nx * d; x[i3 + 1] -= ny * d; x[i3 + 2] -= nz * d;
        if (-d > deepest) deepest = -d;
        if (last) contacts++;
        // A fully held particle is put out of her too, and only that: its hold is a place on her carried by her bones, and
        // where her shoulder bulges as her arm comes forward that place sinks into her. Held there, the hem of a sleeve
        // stayed inside her shoulder and her skin showed through it in a ragged line whenever she sat (Joshua,
        // 2026-10-24: "these don't have a straight shoulder edge like all the rest"). It slides with its hold, not over her.
        if (w[i] <= 0) continue;
        if (friction > 0 || across > 0) {
          // Her skin's motion this substep is that of the spot the particle touched: (after.carried - before.point) /
          // substeps (never after.point - before.point, which has the particle's own slide in it: see the header). The
          // slip is the particle's motion less it, laid on her tangent plane.
          const inv = 1 / substeps;
          const rx = x[i3] - xp[i3] - (ac[i3] - bp[i3]) * inv;
          const ry = x[i3 + 1] - xp[i3 + 1] - (ac[i3 + 1] - bp[i3 + 1]) * inv;
          const rz = x[i3 + 2] - xp[i3 + 2] - (ac[i3 + 2] - bp[i3 + 2]) * inv;
          const rn = rx * nx + ry * ny + rz * nz;
          const tx = rx - rn * nx, ty = ry - rn * ny, tz = rz - rn * nz;
          // "up across her": up laid on her tangent plane (length: the sine of her skin's tilt from level). All of the
          // slip loses `across`; the part along up loses `friction - across` more, faded out where she is nearly level.
          const un = upx * nx + upy * ny + upz * nz;
          const ux = upx - un * nx, uy = upy - un * ny, uz = upz - un * nz;
          const ul2 = ux * ux + uy * uy + uz * uz;
          let k = 0;
          if (ul2 > UP_FADE_FROM * UP_FADE_FROM) {
            const q = Math.min(1, (Math.sqrt(ul2) - UP_FADE_FROM) / (UP_FADE_TO - UP_FADE_FROM));
            k = q * q * (3 - 2 * q) * (friction - across) * (tx * ux + ty * uy + tz * uz) / ul2;
          }
          x[i3] -= across * tx + k * ux;
          x[i3 + 1] -= across * ty + k * uy;
          x[i3 + 2] -= across * tz + k * uz;
        }
      }

      // 7. velocity from what actually happened.
      for (let i = 0, i3 = 0; i < n; i++, i3 += 3) {
        v[i3] = (x[i3] - xp[i3]) * invH;
        v[i3 + 1] = (x[i3 + 1] - xp[i3 + 1]) * invH;
        v[i3 + 2] = (x[i3 + 2] - xp[i3 + 2]) * invH;
      }
    }

    stats.substeps = substeps;
    stats.contacts = contacts;
    stats.deepest = deepest;
    stats.ms = now() - t0;
    return stats;
  }

  /**
   * Area-weighted vertex normals from the triangles (count × 3), for drawing. Into `out` when given; otherwise into a
   * buffer this sim keeps, the same one every call, so drawing every frame allocates nothing after the first.
   */
  normals(out?: Float32Array): Float32Array {
    const n3 = this.count * 3;
    const o = out ?? (this.normalsBuffer ??= new Float32Array(n3));
    if (o.length < n3) throw new Error(`ClothSim.normals: out holds ${o.length / 3} normals for ${this.count} particles`);
    o.fill(0, 0, n3);
    const x = this.positions, tri = this.triangles;
    for (let t = 0; t < tri.length; t += 3) {
      const a3 = tri[t] * 3, b3 = tri[t + 1] * 3, c3 = tri[t + 2] * 3;
      const ux = x[b3] - x[a3], uy = x[b3 + 1] - x[a3 + 1], uz = x[b3 + 2] - x[a3 + 2];
      const vx = x[c3] - x[a3], vy = x[c3 + 1] - x[a3 + 1], vz = x[c3 + 2] - x[a3 + 2];
      // The cross product's length is twice the triangle's area: that is the weighting.
      const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
      o[a3] += cx; o[a3 + 1] += cy; o[a3 + 2] += cz;
      o[b3] += cx; o[b3 + 1] += cy; o[b3 + 2] += cz;
      o[c3] += cx; o[c3 + 1] += cy; o[c3 + 2] += cz;
    }
    for (let i3 = 0; i3 < n3; i3 += 3) {
      const l = o[i3] * o[i3] + o[i3 + 1] * o[i3 + 1] + o[i3 + 2] * o[i3 + 2];
      if (l < TINY * TINY) continue;
      const il = 1 / Math.sqrt(l);
      o[i3] *= il; o[i3 + 1] *= il; o[i3 + 2] *= il;
    }
    return o;
  }
}

/**
 * One XPBD Gauss-Seidel pass over distance constraints `pairs` toward `rest × restScale`, with α̃ = compliance / h².
 * λ starts at zero each substep (small steps), so the update is Δλ = -C / (w_a + w_b + α̃) and the pass keeps no λ.
 */
function project(x: Float32Array, w: Float32Array, pairs: Uint32Array, rest: Float32Array, restScale: number, alphaTilde: number): void {
  for (let e = 0, e2 = 0; e < rest.length; e++, e2 += 2) {
    const a = pairs[e2], b = pairs[e2 + 1];
    const wa = w[a], wb = w[b];
    const denom = wa + wb + alphaTilde;
    if (wa + wb <= 0) continue;
    const a3 = a * 3, b3 = b * 3;
    const dx = x[b3] - x[a3], dy = x[b3 + 1] - x[a3 + 1], dz = x[b3 + 2] - x[a3 + 2];
    const lenSq = dx * dx + dy * dy + dz * dz;
    if (lenSq < TINY) continue;
    const len = Math.sqrt(lenSq);
    // C = len - L; the gradient for b is the unit vector d / len (and its negative for a).
    const k = (len - rest[e] * restScale) / (denom * len);
    const ka = k * wa, kb = k * wb;
    x[a3] += dx * ka; x[a3 + 1] += dy * ka; x[a3 + 2] += dz * ka;
    x[b3] -= dx * kb; x[b3 + 1] -= dy * kb; x[b3 + 2] -= dz * kb;
  }
}

/** Edges from each particle to the nearest particle with any pin (breadth first over `pairs`); UNREACHED where none. */
function pinDepth(count: number, pairs: readonly number[], pin: Float32Array): Int32Array {
  const degree = new Int32Array(count + 1);
  for (let e = 0; e < pairs.length; e++) degree[pairs[e] + 1]++;
  for (let i = 0; i < count; i++) degree[i + 1] += degree[i];
  const next = degree.slice(0, count);
  const neighbours = new Int32Array(pairs.length);
  for (let e = 0; e < pairs.length; e += 2) {
    neighbours[next[pairs[e]]++] = pairs[e + 1];
    neighbours[next[pairs[e + 1]]++] = pairs[e];
  }
  const depth = new Int32Array(count).fill(UNREACHED);
  const queue = new Int32Array(count);
  let tail = 0;
  for (let i = 0; i < count; i++) if (pin[i] > 0) { depth[i] = 0; queue[tail++] = i; }
  for (let head = 0; head < tail; head++) {
    const a = queue[head];
    for (let k = degree[a]; k < degree[a + 1]; k++) {
      const b = neighbours[k];
      if (depth[b] === UNREACHED) { depth[b] = depth[a] + 1; queue[tail++] = b; }
    }
  }
  return depth;
}

/** The order of `pairs` (2 indices each, lo first) by `rank`, then lo, then hi. */
function sortedPairs(pairs: readonly number[], rank: (a: number, b: number) => number): Uint32Array {
  const n = pairs.length / 2;
  const ranks = new Float64Array(n);
  const order = new Uint32Array(n);
  for (let e = 0; e < n; e++) { ranks[e] = rank(pairs[e * 2], pairs[e * 2 + 1]); order[e] = e; }
  return order.sort((p, q) => ranks[p] - ranks[q] || pairs[p * 2] - pairs[q * 2] || pairs[p * 2 + 1] - pairs[q * 2 + 1]);
}

/** A share, 0..1: clamped, and 0 for a value that is not a number (a setting left unset by a plain-JS caller). */
function unit(v: number): number {
  return v > 0 ? (v < 1 ? v : 1) : 0;
}

function distance(p: Float32Array, a: number, b: number): number {
  const dx = p[b * 3] - p[a * 3], dy = p[b * 3 + 1] - p[a * 3 + 1], dz = p[b * 3 + 2] - p[a * 3 + 2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
