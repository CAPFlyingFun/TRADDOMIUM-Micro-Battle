/**
 * THE PROCEDURAL GARMENT'S CONTRACTS (Joshua, 2026-10-26: "one configurable garment family... approach this as a
 * modular garment system rather than a single mesh being stretched"; Stage 2 approved the same day).
 *
 * A garment is made the way a real one is: her MEASUREMENTS (`measure.ts`) -> a flat PATTERN of pieces with named edges
 * and named seams (`draft.ts`) -> each piece MESHED in its own flat plane (`mesh.ts`) -> the pieces SEWN into one
 * welded sheet (`sew.ts`), checked (`validate`), -> laid round her (`place.ts`) -> dressed and run by the existing cloth
 * simulation (`clothSim.ts`, `clothSkin.ts`). Everything in this folder but the last step is plain TypeScript with no
 * three.js and no DOM, so it is tested on its own and can run in a worker.
 *
 * Units: METRES throughout. A pattern's plane is its own 2D frame (x across, y up the garment as worn). Her body is in
 * rest metres (x her side to side, y up from the floor, z out of her front).
 */

/** A point in a pattern piece's plane, metres. */
export type Vec2 = readonly [number, number];
/** A point on (or about) her body, rest metres. */
export type Vec3 = readonly [number, number, number];

// ---------------------------------------------------------------------------------------------------------------------
// The pattern

/**
 * One stretch of a piece's outline, in outline order. The outline of a piece is its edges joined end to end: edge k's
 * last point IS edge k+1's first point (the same coordinates), and the last edge ends at the first edge's first point.
 * Walking the edges in order goes COUNTER-CLOCKWISE in the piece's plane, which is the fabric seen from its RIGHT side
 * (the outside of the garment).
 */
export interface PatternEdge {
  /** Unique within its piece, e.g. 'side', 'hem', 'neck', 'raglanFront'. */
  readonly name: string;
  /** The edge as a polyline, at least 2 points, densely enough sampled that straight segments follow its curve (<= 5 mm apart). */
  readonly points: readonly Vec2[];
  /**
   * The particle spacing wanted ALONG this edge, metres. A seam's two edges are sampled with the same number of points,
   * chosen by `planSeams` from both edges' lengths and spacings.
   */
  readonly spacing: number;
}

export type PieceRole = 'torso' | 'sleeve' | 'gusset';

export interface PatternPiece {
  /** Unique within the pattern, e.g. 'front', 'back', 'sleeve+', 'sleeve-', 'gusset+'. */
  readonly id: string;
  readonly role: PieceRole;
  /** Which of her sides it is for: +1 her +x side, -1 her -x side, 0 both (a front or back cut on the fold). */
  readonly side: -1 | 0 | 1;
  /** The outline, counter-clockwise, as named edges (see PatternEdge). */
  readonly edges: readonly PatternEdge[];
  /** The particle spacing wanted inside the piece, metres (it grades from its edges' spacing to this). */
  readonly spacing: number;
  /**
   * True when the piece is mirror-symmetric about x = 0 in its own plane (a front or back cut on the fold). The mesher
   * then meshes the half x >= 0 and mirrors it, so the mesh is exactly symmetric.
   */
  readonly symmetric: boolean;
}

/** One end of a seam: a named edge of a named piece. */
export interface SeamSide { readonly piece: string; readonly edge: string }

/**
 * A seam joins edge `a` (walked in its piece's outline order) to edge `b` walked BACKWARDS (from its last point to its
 * first), point for point: that is how two pieces sewn right side out meet. The two may differ in length (ease): the
 * welded edge's rest length is the mean of the two.
 */
export interface Seam {
  readonly name: string;
  readonly a: SeamSide;
  readonly b: SeamSide;
  /** Ease the seam is cut with on purpose (a longer side gathered onto a shorter one), as a share of its length; 0 if absent. */
  readonly ease?: number;
}

export interface Pattern {
  readonly pieces: readonly PatternPiece[];
  readonly seams: readonly Seam[];
}

// ---------------------------------------------------------------------------------------------------------------------
// One piece meshed

/** A piece meshed flat (`mesh.ts`). */
export interface PieceMesh {
  readonly piece: string;
  /** Points in the piece's plane, 2 per point. */
  readonly points: Float64Array;
  /** Triangles, 3 point indices each, every one counter-clockwise in the plane. */
  readonly triangles: Uint32Array;
  /**
   * Each edge of the outline as the point indices along it, in the edge's own order, first and last included (so a
   * corner point is the last of one edge and the first of the next). Keyed by edge name.
   */
  readonly edgePoints: ReadonlyMap<string, Uint32Array>;
}

// ---------------------------------------------------------------------------------------------------------------------
// The sewn garment

/** The pieces sewn into one sheet (`sew.ts`): what the cloth simulation runs and what is drawn. */
export interface SewnGarment {
  /** The pieces, in pattern order (indices below refer to this list). */
  readonly pieces: readonly string[];
  /** Particles: points of cloth, one per welded point. */
  readonly count: number;
  /** Per particle: the piece it was first made in (for a seam point, the earlier of its pieces in pattern order). */
  readonly particlePiece: Uint16Array;
  /** Per particle: 1 where it lies on a seam, else 0. */
  readonly onSeam: Uint8Array;
  /** Triangles in particle indices, 3 each, wound as their piece's plane counter-clockwise (outside = right side). */
  readonly triangles: Uint32Array;
  /** Per triangle: its piece index. */
  readonly trianglePiece: Uint16Array;
  /** Unique edges as particle pairs (lo, hi), and each one's rest length from the flat pattern (metres). */
  readonly edges: Uint32Array;
  readonly edgeRest: Float32Array;
  /**
   * Render vertices: one per point of every piece mesh, in piece order then point order (so a seam particle has one in
   * each piece it belongs to, two where a piece is sewn to itself, and the pattern's UVs stay whole). `vertexParticle`,
   * `vertexPiece`, `uv` (metres in the piece's plane, 2 each) per vertex; `renderTriangles` in vertex indices, triangle
   * for triangle with `triangles`.
   */
  readonly vertexParticle: Uint32Array;
  readonly vertexPiece: Uint16Array;
  readonly uv: Float32Array;
  readonly renderTriangles: Uint32Array;
  /** The open edges left after sewing, as closed loops of particles, each with the outline edge names it runs through. */
  readonly openings: readonly Opening[];
}

export interface Opening {
  /** The particles round the loop, in order. */
  readonly particles: Uint32Array;
  /** The names of the outline edges it is made of, as 'piece:edge', in order round the loop, each once. */
  readonly edges: readonly string[];
}

/** What `validate` found (`sew.ts`). */
export interface GarmentReport {
  readonly particles: number;
  readonly triangles: number;
  readonly edges: number;
  /** Edges used by exactly one triangle (on an opening), and by more than two (must be 0). */
  readonly boundaryEdges: number;
  readonly nonManifoldEdges: number;
  /** Edges two triangles share in the SAME direction (inconsistent winding; must be 0). */
  readonly flippedEdges: number;
  /** Separate pieces of cloth after sewing (must be 1). */
  readonly components: number;
  /** Openings: their count, and each one's edge names. */
  readonly openings: readonly (readonly string[])[];
  /** V - E + F. */
  readonly euler: number;
  /** Smallest triangle angle (degrees), and triangles with an angle under 15 degrees. */
  readonly minAngleDeg: number;
  readonly slivers: number;
  /** Rest edge lengths, metres. */
  readonly minEdge: number;
  readonly maxEdge: number;
  readonly meanEdge: number;
  /** For every seam: its two edges' lengths in the pattern (metres) and the points sewn along it. */
  readonly seams: readonly { readonly name: string; readonly lengthA: number; readonly lengthB: number; readonly points: number }[];
  /** Problems in words; empty when the garment is sound. */
  readonly problems: readonly string[];
}

// ---------------------------------------------------------------------------------------------------------------------
// Her body, measured (`measure.ts`)

/** Her skeleton's joints at rest (rest metres), as the garment needs them. Pairs are [her +x side, her -x side]. */
export interface BodyJoints {
  readonly pelvis: Vec3;
  readonly chest: Vec3;
  /** The base of her neck joint, and her head joint. */
  readonly neck: Vec3;
  readonly head: Vec3;
  readonly shoulder: readonly [Vec3, Vec3];
  readonly elbow: readonly [Vec3, Vec3];
  readonly wrist: readonly [Vec3, Vec3];
  readonly hip: readonly [Vec3, Vec3];
  readonly knee: readonly [Vec3, Vec3];
  readonly ankle: readonly [Vec3, Vec3];
}

/** Her body as the garment generator reads it: her rest shape in metres, as she is designed (belly as asked). */
export interface BodyInput {
  /** Rest positions, metres, 3 per vertex (x her side to side, y up from the floor, z out of her front). */
  readonly positions: Float32Array;
  /** Her triangles, 3 vertex indices each. */
  readonly triangles: Uint32Array;
  /** Per vertex, 0..1: how much of it her arm bones carry (shoulder down to the fingers). */
  readonly arm: Float32Array;
  readonly joints: BodyJoints;
  /** Her rest vertex normals (3 per vertex), when known: which way is out of her (`bind.ts`). */
  readonly normals?: Float32Array;
}

/**
 * Her trunk as a DRESS FORM: level slices every `step` metres from `y0` up, each the CONVEX outline (a tape measure's
 * path) of everything of her at that height that is not her arm, seen from above. Below her crotch it spans both legs,
 * as a skirt would.
 */
export interface DressForm {
  readonly y0: number;
  readonly step: number;
  /**
   * One per level (y = y0 + i * step): the convex outline as (x, z) pairs, counter-clockwise in the (x, z) plane (x to
   * the right, z up the page), starting at its point of largest x. Empty (length 0) where nothing of her is there.
   */
  readonly hulls: readonly Float64Array[];
}

/** One arm, measured: [her +x side, her -x side] in BodyMeasure. */
export interface ArmMeasure {
  readonly shoulder: Vec3;
  readonly elbow: Vec3;
  readonly wrist: Vec3;
  /** Girths (metres) of her arm cut square to its bones, at fractions 0, 0.05, ..., 1 of the way from her armpit's height down the arm to her wrist (21 values). */
  readonly girths: readonly number[];
  /** Metres along the outside of the arm from her shoulder point to her wrist joint. */
  readonly outsideLength: number;
  /** Metres along the inside of the arm from her armpit to her wrist joint. */
  readonly insideLength: number;
}

export interface Girth { readonly y: number; readonly girth: number }

export interface ArmholeMeasure { readonly loop: number; readonly front: number; readonly back: number }

export interface BodyMeasure {
  readonly form: DressForm;
  readonly neck: {
    /** The side neck points (where a shoulder seam meets the neck), [+x, -x]. */
    readonly side: readonly [Vec3, Vec3];
    /** Front neck point (the hollow at the base of her throat) and back neck point (the bone at the base of the back of her neck). */
    readonly front: Vec3;
    readonly back: Vec3;
    /** Round the base of the neck through those points, metres. */
    readonly girth: number;
  };
  /** The shoulder points (the top outside corner of each shoulder, where a set-in sleeve's seam crosses it), [+x, -x]. */
  readonly shoulderPoint: readonly [Vec3, Vec3];
  /** The top of each underarm hollow (where her arm leaves her side), [+x, -x]. */
  readonly armpit: readonly [Vec3, Vec3];
  /**
   * Round each arm where it meets her trunk (where her arm bones take half of her skin), [+x, -x], metres: the whole
   * loop and its front and back halves from its top (by her shoulder point) to its bottom (her armpit).
   */
  readonly armhole: readonly [ArmholeMeasure, ArmholeMeasure];
  readonly bust: Girth;
  readonly underbust: Girth;
  readonly waist: Girth;
  readonly highHip: Girth;
  readonly hip: Girth;
  readonly arms: readonly [ArmMeasure, ArmMeasure];
  /** The girth of each thigh just below her crotch, and her knees' height (joint). */
  readonly thigh: Girth;
  readonly kneeY: number;
  /** Floor to the top of her head, metres. */
  readonly height: number;
}
