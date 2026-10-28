/**
 * TAILORING, END TO END (Stage 2): her body -> measured -> the pattern drafted -> each piece meshed -> sewn and checked ->
 * laid round her -> bound to her skin. Everything the cloth needs to put the garment on her, and nothing of three.js,
 * so it can run in a worker. Each step's time is kept for the review.
 */
import { bindParticles, type GarmentBinding } from './bind';
import { draftTee, TEE_DEFAULTS, type Draft, type TeeParams } from './draft';
import { measureBody } from './measure';
import { meshPiece } from './mesh';
import { placeGarment, type Placed } from './place';
import { edgeKey, planSeams, sew, validate } from './sew';
import type { BodyInput, BodyMeasure, GarmentReport, PieceMesh, SewnGarment } from './types';

export interface Tailored {
  readonly measure: BodyMeasure;
  readonly draft: Draft;
  readonly meshes: ReadonlyMap<string, PieceMesh>;
  readonly sewn: SewnGarment;
  readonly report: GarmentReport;
  readonly placed: Placed;
  readonly binding: GarmentBinding;
  readonly ms: { readonly measure: number; readonly draft: number; readonly mesh: number; readonly sew: number; readonly place: number; readonly bind: number };
}

export interface TailorOptions {
  /** rest metres -> her geometry units (Sarah: FACE_REST_SCALE / FACE_REST_OFFSET). */
  readonly scale: number;
  readonly offset: readonly [number, number, number];
  /** Her measurements already taken (the same body): skips measuring. */
  readonly measure?: BodyMeasure;
}

const clock = () => globalThis.performance?.now() ?? Date.now();

export function tailor(body: BodyInput, params: TeeParams = TEE_DEFAULTS, options: TailorOptions): Tailored {
  const t0 = clock();
  const measure = options.measure ?? measureBody(body);
  const t1 = clock();
  const draft = draftTee(measure, params);
  const t2 = clock();
  const counts = planSeams(draft.pattern);
  const meshes = new Map<string, PieceMesh>();
  for (const p of draft.pattern.pieces) {
    const c = new Map<string, number>();
    for (const e of p.edges) c.set(e.name, counts.get(edgeKey(p.id, e.name))!);
    meshes.set(p.id, meshPiece(p, c));
  }
  const t3 = clock();
  const sewn = sew(draft.pattern, meshes);
  const report = validate(sewn, draft.pattern, meshes);
  const t4 = clock();
  const placed = placeGarment(sewn, draft.pattern, draft, measure, measure.form, params.armholeBand ?? 0);
  const t5 = clock();
  const binding = bindParticles({ positions: body.positions, triangles: body.triangles, arm: body.arm, normals: body.normals }, placed.positions, placed.region, { scale: options.scale, offset: options.offset });
  const t6 = clock();
  return { measure, draft, meshes, sewn, report, placed, binding, ms: { measure: t1 - t0, draft: t2 - t1, mesh: t3 - t2, sew: t4 - t3, place: t5 - t4, bind: t6 - t5 } };
}
