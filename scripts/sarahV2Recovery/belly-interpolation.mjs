/**
 * MEASURE THE BELLY KEYS (the belly curve experiment, Joshua, 2026-10-22): how far her bump's surface moves between
 * neighbouring approved belly keys (0, 25, 30, 50, 60, 75, 100, 150, 200%), RMS over every vertex that moves more than
 * 5% of the most any does between 0% and 200%, the upper-belly target included at each key's own ratio. These are
 * `BELLY_KEY_GAPS` in `src/sarahlab/bellyInterpolation.ts`; `tests/bellyInterpolation.test.ts` holds them to the file.
 * Reads only; writes nothing.
 *
 *   node scripts/sarahV2Recovery/belly-interpolation.mjs [public/models/sarah-v2-body-slim.glb]
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const FILE = process.argv[2] ?? 'public/models/sarah-v2-body-slim.glb';
const KEYS = [[0, 'belly'], [0.25, 'belly25'], [0.3, 'belly30'], [0.5, 'belly50'], [0.6, 'belly60'], [0.75, 'belly75'], [1, null], [1.5, 'belly150'], [2, 'belly200']];
const UPPER = { 0: 0, 0.25: 0.01, 0.3: 0.042, 0.5: 0.169, 0.6: 0.306, 0.75: 0.513, 1: 1, 1.5: 1.32, 2: 1.649 };

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(FILE);
const mesh = doc.getRoot().listMeshes().find((m) => (m.getExtras()?.targetNames ?? []).includes('belly200'));
const names = mesh.getExtras().targetNames, prim = mesh.listPrimitives()[0], targets = prim.listTargets();
const n = prim.getAttribute('POSITION').getCount();
const read = (name) => { const a = targets[names.indexOf(name)].getAttribute('POSITION'), out = new Float64Array(n * 3), t = [0, 0, 0]; for (let i = 0; i < n; i++) { a.getElement(i, t); out.set(t, i * 3); } return out; };
const upper = read('bellyUpper');
const shapes = KEYS.map(([s, name]) => { const d = name ? read(name) : new Float64Array(n * 3); for (let i = 0; i < n * 3; i++) d[i] += UPPER[s] * upper[i]; return d; });
const move = (a, b, v) => Math.hypot(a[v * 3] - b[v * 3], a[v * 3 + 1] - b[v * 3 + 1], a[v * 3 + 2] - b[v * 3 + 2]);
let most = 0;
for (let v = 0; v < n; v++) most = Math.max(most, move(shapes[0], shapes[8], v));
const region = []; for (let v = 0; v < n; v++) if (move(shapes[0], shapes[8], v) > 0.05 * most) region.push(v);
const gaps = shapes.slice(1).map((s, k) => Math.sqrt(region.reduce((a, v) => a + move(shapes[k], s, v) ** 2, 0) / region.length));
console.log(`${FILE}: ${region.length} vertices in the bump`);
KEYS.slice(1).forEach(([s], k) => { const from = KEYS[k][0]; console.log(`  ${from * 100}-${s * 100}%: ${(gaps[k] * 100).toFixed(2)} cm, ${(gaps[k] / (s - from)).toFixed(4)} per 100% of slider`); });
console.log(`BELLY_KEY_GAPS = [${gaps.map((g) => g.toFixed(6)).join(', ')}]`);
