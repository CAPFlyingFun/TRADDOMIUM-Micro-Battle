/**
 * HER CREASE, WORKED OUT OFF THE PAGE: `creaseRelax.ts` in a worker, so the tenths of a second her most extreme shapes
 * take to untangle never hold up a frame or a finger (`sarahlab/bodyCrease.ts` posts to it, and does the same arithmetic
 * on the page itself wherever a worker cannot start).
 *
 * Two messages in: `prepare` (once per body: her approved rest shape and normals, her triangles, and the zone as a box in
 * her rest metres with the frame that turns her geometry's units into them) and `solve` (the summed shape now, per local
 * vertex). One out: `solved`, the answer for the `seq` it was asked with, its arrays handed over rather than copied.
 */
import { prepareCrease, relaxCrease, type CreaseMesh, type CreaseResult } from './creaseRelax';

/** The zone, in rest metres, and the frame from her geometry's units: `rest = scale * position + offset`. */
export interface CreaseZoneBox {
  readonly halfWidth: number;
  readonly yFrom: number;
  readonly yTo: number;
  readonly zFrom: number;
  readonly scale: number;
  readonly offset: readonly [number, number, number];
}

export type CreaseRequest =
  | { readonly type: 'prepare'; readonly body: number; readonly base: Float32Array; readonly baseNormal: Float32Array; readonly index: Uint32Array; readonly zone: CreaseZoneBox }
  | { readonly type: 'solve'; readonly body: number; readonly seq: number; readonly position: Float32Array; readonly normal: Float32Array };

export type CreaseReply =
  | { readonly type: 'prepared'; readonly body: number; readonly reps: Uint32Array; readonly ms: number }
  | { readonly type: 'solved'; readonly body: number; readonly seq: number; readonly result: CreaseResult; readonly ms: number }
  | { readonly type: 'failed'; readonly body: number; readonly seq: number; readonly message: string };

/** Whether a point of her geometry is in the box: the test `prepareCrease` is given, on either side of the worker. */
export function zoneTest(z: CreaseZoneBox): (x: number, y: number, zz: number) => boolean {
  return (x, y, zz) => {
    const rx = z.scale * x + z.offset[0], ry = z.scale * y + z.offset[1], rz = z.scale * zz + z.offset[2];
    return Math.abs(rx) < z.halfWidth && ry > z.yFrom && ry < z.yTo && rz > z.zFrom;
  };
}

interface WorkerScope {
  onmessage: ((e: MessageEvent<CreaseRequest>) => void) | null;
  postMessage(message: CreaseReply, transfer: Transferable[]): void;
}

// only when loaded as a worker (no `document`): importing this file for its types or `zoneTest` does nothing
if (typeof self !== 'undefined' && typeof (globalThis as { document?: unknown }).document === 'undefined') {
  const scope = self as unknown as WorkerScope;
  let prepared: { body: number; mesh: CreaseMesh } | null = null;
  scope.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'prepare') {
      const t0 = performance.now();
      prepared = { body: m.body, mesh: prepareCrease(m.base, m.baseNormal, m.index, zoneTest(m.zone)) };
      const reps = prepared.mesh.reps.slice();
      scope.postMessage({ type: 'prepared', body: m.body, reps, ms: performance.now() - t0 }, [reps.buffer]);
      return;
    }
    if (!prepared || prepared.body !== m.body) {
      scope.postMessage({ type: 'failed', body: m.body, seq: m.seq, message: 'not prepared for this body' }, []);
      return;
    }
    try {
      const t0 = performance.now();
      const result = relaxCrease(prepared.mesh, m.position, m.normal);
      scope.postMessage({ type: 'solved', body: m.body, seq: m.seq, result, ms: performance.now() - t0 }, [result.vertices.buffer, result.offset.buffer, result.normal.buffer]);
    } catch (err) {
      scope.postMessage({ type: 'failed', body: m.body, seq: m.seq, message: String(err) }, []);
    }
  };
}
