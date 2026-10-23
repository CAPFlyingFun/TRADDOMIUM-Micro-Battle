/**
 * The clothing builder's data (Joshua, 2026-10-23: "one editable strip or bikini strap that attaches correctly,
 * survives the sliders and animations, saves and reloads"): pieces of points pinned to her skin by triangle and
 * barycentric weights, immutable updaters, a defensive reader for saved JSON, and undo/redo.
 */
import { describe, expect, it } from 'vitest';
import {
  History, MAX_PIECES, MAX_POINTS, STRAP_DATA_VERSION, STRAP_RANGES, addPoint, builtToJson, movePoint, newPiece, newPoint, pieceId,
  removePoint, reversed, sanitizeBuilt, setPiece, setPointBridge, setPointLift, type BuiltPieces, type StrapPiece,
} from '../src/sarahlab/strapData';

const at = (tri: number, a = 1 / 3, b = 1 / 3, c = 1 / 3) => ({ tri, bary: [a, b, c] as const });
/** A strip with `n` points on triangles 10, 11, 12, ... */
function strip(n: number, id = 'a'): StrapPiece {
  let p = newPiece('strip', id);
  for (let i = 0; i < n; i++) p = addPoint(p, newPoint(at(10 + i, 0.5, 0.25, 0.25), i, i % 2 === 1));
  return p;
}
const snapshot = (v: unknown): string => JSON.stringify(v);
const roundTrip = (b: BuiltPieces, triangleCount?: number) => sanitizeBuilt(JSON.parse(JSON.stringify(builtToJson(b))), triangleCount);

describe('new pieces and points', () => {
  it('starts a strip and a cord at their own defaults', () => {
    const s = newPiece('strip', 'strap-1');
    expect(s).toEqual({
      id: 'strap-1', kind: 'strip', name: 'Strap', points: [], closed: false, width: 1.2, thickness: 1.5, clearance: 1, fabric: null, edging: true,
    });
    const c = newPiece('cord', 'strap-2', 'Halter');
    expect(c).toEqual({
      id: 'strap-2', kind: 'cord', name: 'Halter', points: [], closed: false, width: 0.4, thickness: 1.5, clearance: 1, fabric: null, edging: false,
    });
    expect(newPiece('cord', 'x').name).toBe('Cord');
    expect(STRAP_RANGES.width).toMatchObject({ min: 0.2, max: 6, step: 0.1, strip: 1.2, cord: 0.4 });
    expect(Object.isFrozen(STRAP_RANGES) && Object.isFrozen(STRAP_RANGES.width)).toBe(true);
  });

  it('normalizes barycentric weights and clamps lift', () => {
    expect(newPoint({ tri: 4, bary: [2, 1, 1] }).bary).toEqual([0.5, 0.25, 0.25]);
    expect(newPoint({ tri: 4, bary: [-1, 1, 1] }).bary).toEqual([0, 0.5, 0.5]);
    expect(newPoint({ tri: 4, bary: [0, 0, 0] }).bary).toEqual([1, 0, 0]);
    expect(newPoint({ tri: 4, bary: [-2, -1, 0] }).bary).toEqual([1, 0, 0]);
    expect(newPoint({ tri: 4, bary: [NaN, 1, Infinity] }).bary).toEqual([0, 1, 0]);
    const p = newPoint({ tri: 4, bary: [1, 1, 1] }, 55, true);
    expect(p.lift).toBe(40);
    expect(p.bridge).toBe(true);
    expect(newPoint({ tri: 4, bary: [1, 0, 0] }, -3).lift).toBe(0);
    expect(newPoint({ tri: 4, bary: [1, 0, 0] }).lift).toBe(0);
    // Normalizing twice changes nothing: a save reads back exactly.
    const once = newPoint({ tri: 4, bary: [0.3, 0.3, 0.3] });
    expect(newPoint(once).bary).toEqual(once.bary);
  });
});

describe('immutable updaters', () => {
  it('never mutate their input and hand back the same piece for an index out of range', () => {
    const p = strip(3);
    const before = snapshot(p);
    const anchor = at(99, 1, 0, 0);
    const changed = [
      addPoint(p, newPoint(anchor)), movePoint(p, 1, anchor), removePoint(p, 1), setPointLift(p, 0, 7), setPointBridge(p, 0, true), setPiece(p, { width: 2 }),
      reversed(p, 'b'),
    ];
    for (const q of changed) { expect(Object.is(q, p)).toBe(false); expect(q.points).not.toBe(p.points); }
    expect(snapshot(p)).toBe(before);
    for (const bad of [-1, 3, 1.5, NaN]) {
      expect(movePoint(p, bad, anchor)).toBe(p);
      expect(removePoint(p, bad)).toBe(p);
      expect(setPointLift(p, bad, 5)).toBe(p);
      expect(setPointBridge(p, bad, true)).toBe(p);
    }
    expect(addPoint(p, newPoint(anchor), 4)).toBe(p);
    expect(addPoint(p, newPoint(anchor), -1)).toBe(p);
    expect(snapshot(p)).toBe(before);
  });

  it('inserts before an index, appends by default, and refuses past MAX_POINTS', () => {
    const p = strip(3);
    const q = addPoint(p, newPoint(at(77)), 1);
    expect(q.points.map((x) => x.tri)).toEqual([10, 77, 11, 12]);
    expect(addPoint(p, newPoint(at(78)), 0).points[0].tri).toBe(78);
    expect(addPoint(p, newPoint(at(79)), 3).points[3].tri).toBe(79);
    expect(addPoint(p, newPoint(at(80))).points.map((x) => x.tri)).toEqual([10, 11, 12, 80]);
    let full = newPiece('cord', 'full');
    for (let i = 0; i < MAX_POINTS; i++) full = addPoint(full, newPoint(at(i)));
    expect(full.points).toHaveLength(MAX_POINTS);
    expect(addPoint(full, newPoint(at(1)))).toBe(full);
    expect(addPoint(full, newPoint(at(1)), 0)).toBe(full);
  });

  it('moves a point but keeps its lift and bridge; edits lift (clamped) and bridge', () => {
    const p = strip(3);
    const m = movePoint(p, 1, { tri: 50, bary: [3, 0, 1] });
    expect(m.points[1]).toEqual({ tri: 50, bary: [0.75, 0, 0.25], lift: 1, bridge: true });
    expect(removePoint(p, 0).points.map((x) => x.tri)).toEqual([11, 12]);
    expect(setPointLift(p, 2, 100).points[2].lift).toBe(40);
    expect(setPointLift(p, 2, -1).points[2].lift).toBe(0);
    expect(setPointBridge(p, 1, false).points[1].bridge).toBe(false);
  });

  it('clamps settings, validates fabric, and keeps the points when the kind changes', () => {
    const p = strip(3);
    const q = setPiece(p, { width: 99, thickness: 0, clearance: -4 });
    expect([q.width, q.thickness, q.clearance]).toEqual([6, 0.5, 0]);
    expect(setPiece(p, { width: NaN }).width).toBe(p.width);
    expect(setPiece(p, { clearance: 20 }).clearance).toBe(15);
    expect(setPiece(p, { fabric: { family: 'ribbed', colour: 15.6 } }).fabric).toEqual({ family: 'ribbed', colour: 15 });
    expect(setPiece(p, { fabric: { family: 'ribbed', colour: 2.4 } }).fabric).toEqual({ family: 'ribbed', colour: 2 });
    expect(setPiece(p, { fabric: { family: 'denim' as never, colour: 3 } }).fabric).toBeNull();
    expect(setPiece(setPiece(p, { fabric: { family: 'jersey', colour: 3 } }), { fabric: null }).fabric).toBeNull();
    expect(setPiece(p, { name: '  Left strap  ' }).name).toBe('Left strap');
    expect(setPiece(p, { name: '   ' }).name).toBe('Strap');
    expect(setPiece(p, { name: 'x'.repeat(80) }).name).toHaveLength(40);
    const c = setPiece(p, { kind: 'cord', closed: true, edging: false });
    expect(c.kind).toBe('cord');
    expect(c.closed).toBe(true);
    expect(c.edging).toBe(false);
    expect(c.points).toEqual(p.points);
    expect(c.width).toBe(p.width);
    expect(setPiece(p, {})).toEqual(p);
  });

  it('reverses into a copy with a new id, keeping each lift and each bridged stretch', () => {
    // Points 0..3 with lifts 0..3; bridges on stretches 0->1 and 2->3.
    let p = strip(4);
    p = setPointBridge(setPointBridge(setPointBridge(setPointBridge(p, 0, true), 1, false), 2, true), 3, false);
    const r = reversed(p, 'mirror');
    expect(r.id).toBe('mirror');
    expect(r.name).toBe(p.name);
    expect(r.points.map((x) => x.tri)).toEqual([13, 12, 11, 10]);
    expect(r.points.map((x) => x.lift)).toEqual([3, 2, 1, 0]);
    // Reversed stretches: 13->12 (was 2->3, bridged), 12->11 (1->2, not), 11->10 (0->1, bridged).
    expect(r.points.map((x) => x.bridge)).toEqual([true, false, true, false]);
    // A closed loop's closing stretch (3->0) stays bridged too.
    const loop = setPointBridge(setPiece(p, { closed: true }), 3, true);
    const rl = reversed(loop, 'loop');
    // Reversed closing stretch is 10->13, the last point's.
    expect(rl.points[3].tri).toBe(10);
    expect(rl.points[3].bridge).toBe(true);
    expect(reversed(rl, 'back').points).toEqual(loop.points);
    expect(reversed(newPiece('strip', 'e'), 'f').points).toEqual([]);
  });

  it('makes ids like strap-1a2b3c', () => {
    const ids = new Set(Array.from({ length: 50 }, () => pieceId()));
    for (const id of ids) expect(id).toMatch(/^strap-[0-9a-f]{6}$/);
    expect(ids.size).toBeGreaterThan(45);
  });
});

describe('saves: sanitizeBuilt and builtToJson', () => {
  const good = (): BuiltPieces => {
    const a = setPiece(strip(5, 'left'), { name: 'Left strap', fabric: { family: 'athletic', colour: 8 }, clearance: 2.5 });
    const b = setPiece(addPoint(addPoint(newPiece('cord', 'tie'), newPoint({ tri: 3, bary: [0.1, 0.2, 0.7] }, 4)), newPoint({ tri: 9, bary: [0.3, 0.3, 0.3] })),
      { closed: true, width: 0.3 });
    return { version: 1, base: 'sarah-v3', pieces: [a, b] };
  };

  it('round-trips a good document unchanged', () => {
    const b = good();
    const json = builtToJson(b);
    expect(JSON.parse(JSON.stringify(json))).toEqual(json);
    expect(roundTrip(b)).toEqual(b);
    expect(roundTrip(b, 100)).toEqual(b);
    const again = roundTrip(b)!;
    expect(roundTrip(again)).toEqual(again);
    expect((json as { version: number }).version).toBe(STRAP_DATA_VERSION);
  });

  it('returns null for anything that is not a document', () => {
    for (const raw of [null, undefined, 0, 42, 'pieces', '', true, [], [{ pieces: [] }], {}, { pieces: {} }, { pieces: 'x' }, { version: 2, pieces: [] },
      { version: '1', pieces: [] }, { version: null, pieces: [] }]) {
      expect(sanitizeBuilt(raw)).toBeNull();
    }
    expect(sanitizeBuilt({ pieces: [] })).toEqual({ version: 1, base: '', pieces: [] });
    expect(sanitizeBuilt({ version: 1, pieces: [] })).toEqual({ version: 1, base: '', pieces: [] });
  });

  it('never throws, even on a hostile object', () => {
    const hostile = new Proxy({}, { get() { throw new Error('boom'); }, has() { throw new Error('boom'); } });
    expect(() => sanitizeBuilt(hostile)).not.toThrow();
    expect(sanitizeBuilt(hostile)).toBeNull();
    const getter = { pieces: [{ get points(): unknown { throw new Error('boom'); } }] };
    expect(() => sanitizeBuilt(getter)).not.toThrow();
  });

  it('drops points it cannot place on her', () => {
    const raw = {
      pieces: [{
        id: 'p', kind: 'strip', points: [
          { tri: 5, bary: [1, 0, 0] }, // kept
          { tri: 100, bary: [1, 0, 0] }, // past the triangle count
          { tri: -1, bary: [1, 0, 0] }, // negative
          { tri: 2.5, bary: [1, 0, 0] }, // not a whole triangle
          { tri: '7', bary: [1, 0, 0] }, // not a number
          { tri: 6 }, // no weights
          { tri: 6, bary: [1, 0] }, // too few weights
          null, 'x', [1, 2, 3],
          { tri: 99, bary: [0, 0, 0] }, // kept, weights defaulted to the first corner
        ],
      }],
    };
    const out = sanitizeBuilt(raw, 100)!;
    expect(out.pieces[0].points.map((p) => p.tri)).toEqual([5, 99]);
    expect(out.pieces[0].points[1].bary).toEqual([1, 0, 0]);
    // Without a triangle count only the shape is checked.
    expect(sanitizeBuilt(raw)!.pieces[0].points.map((p) => p.tri)).toEqual([5, 100, 99]);
  });

  it('turns NaN, Infinity and strings into the defaults, and clamps finite numbers', () => {
    const out = sanitizeBuilt({
      base: '  sarah  ',
      pieces: [
        { id: 'a', kind: 'cord', width: NaN, thickness: Infinity, clearance: -Infinity, points: [{ tri: 1, bary: [NaN, Infinity, 1], lift: NaN, bridge: 'yes' }] },
        { id: 'b', kind: 'strip', width: '3', thickness: 100, clearance: -2, points: [{ tri: 1, bary: [1, 1, 0], lift: 900, bridge: true }] },
        { id: 'c', kind: 'ribbon', width: 0.01, closed: 'true', edging: 1 },
      ],
    })!;
    expect(out.base).toBe('sarah');
    const [a, b, c] = out.pieces;
    expect([a.width, a.thickness, a.clearance]).toEqual([0.4, 1.5, 1]);
    expect(a.points[0]).toEqual({ tri: 1, bary: [0, 0, 1], lift: 0, bridge: false });
    expect([b.width, b.thickness, b.clearance]).toEqual([1.2, 6, 0]);
    expect(b.points[0]).toEqual({ tri: 1, bary: [0.5, 0.5, 0], lift: 40, bridge: true });
    expect(c.kind).toBe('strip');
    expect(c.width).toBe(0.2);
    expect(c.closed).toBe(false);
    expect(c.edging).toBe(true);
    expect(c.name).toBe('Strap');
  });

  it('reads only known fabric families, with the colour rounded and clamped', () => {
    const read = (fabric: unknown) => sanitizeBuilt({ pieces: [{ id: 'a', fabric }] })!.pieces[0].fabric;
    expect(read({ family: 'denim', colour: 3 })).toBeNull();
    expect(read({ family: 'Jersey', colour: 3 })).toBeNull();
    expect(read('jersey')).toBeNull();
    expect(read(null)).toBeNull();
    expect(read({ family: 'pantyhose', colour: 20 })).toEqual({ family: 'pantyhose', colour: 15 });
    expect(read({ family: 'sweater', colour: -2 })).toEqual({ family: 'sweater', colour: 0 });
    expect(read({ family: 'sweater', colour: 6.5 })).toEqual({ family: 'sweater', colour: 7 });
    expect(read({ family: 'sweater', colour: NaN })).toEqual({ family: 'sweater', colour: 0 });
    expect(read({ family: 'jersey', colour: 4, extra: 'x' })).toEqual({ family: 'jersey', colour: 4 });
  });

  it('caps pieces, points and strings, and keeps only known fields', () => {
    const many = sanitizeBuilt({ pieces: Array.from({ length: MAX_PIECES + 10 }, (_, i) => ({ id: `p${i}` })) })!;
    expect(many.pieces).toHaveLength(MAX_PIECES);
    expect(many.pieces[MAX_PIECES - 1].id).toBe(`p${MAX_PIECES - 1}`);
    const long = sanitizeBuilt({ base: 'b'.repeat(90), pieces: [{
      id: 'i'.repeat(90), name: `  ${'n'.repeat(90)}`, secret: 'x', points: Array.from({ length: MAX_POINTS + 50 }, (_, i) => ({ tri: i, bary: [1, 0, 0], extra: 1 })),
    }] })!;
    expect(long.base).toHaveLength(40);
    expect(long.pieces[0].id).toHaveLength(40);
    expect(long.pieces[0].name).toBe('n'.repeat(40));
    expect(long.pieces[0].points).toHaveLength(MAX_POINTS);
    expect(Object.keys(long.pieces[0]).sort()).toEqual(['clearance', 'closed', 'edging', 'fabric', 'id', 'kind', 'name', 'points', 'thickness', 'width']);
    expect(Object.keys(long.pieces[0].points[0]).sort()).toEqual(['bary', 'bridge', 'lift', 'tri']);
    expect(Object.keys(long).sort()).toEqual(['base', 'pieces', 'version']);
  });

  it('makes duplicate ids unique and gives a missing id one', () => {
    const out = sanitizeBuilt({ pieces: [{ id: 'x' }, { id: 'x' }, { id: ' x ' }, { id: 'x-2' }, {}, { id: 7 }, { id: 'y'.repeat(40) }, { id: 'y'.repeat(45) }] })!;
    const ids = out.pieces.map((p) => p.id);
    expect(ids.slice(0, 6)).toEqual(['x', 'x-2', 'x-3', 'x-2-2', 'strap-5', 'strap-6']);
    expect(ids[6]).toBe('y'.repeat(40));
    expect(ids[7]).toBe(`${'y'.repeat(38)}-2`);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.length).toBeLessThanOrEqual(40);
  });
});

describe('History', () => {
  it('pushes, undoes and redoes, and a push drops the redo', () => {
    const h = new History('a');
    expect(h.current).toBe('a');
    expect(h.canUndo).toBe(false);
    expect(h.undo()).toBeNull();
    expect(h.redo()).toBeNull();
    h.push('b'); h.push('c');
    expect(h.current).toBe('c');
    expect(h.undo()).toBe('b');
    expect(h.undo()).toBe('a');
    expect(h.undo()).toBeNull();
    expect(h.canRedo).toBe(true);
    expect(h.redo()).toBe('b');
    h.push('d');
    expect(h.canRedo).toBe(false);
    expect(h.redo()).toBeNull();
    expect(h.undo()).toBe('b');
    expect(h.undo()).toBe('a');
  });

  it('records nothing for the state already shown', () => {
    const p = strip(2);
    const h = new History(p);
    h.push(removePoint(p, 9)); // refused: the same piece
    expect(h.canUndo).toBe(false);
    const q = removePoint(p, 0);
    h.push(q);
    h.undo();
    h.push(p); // the same state as shown: the redo survives
    expect(h.canRedo).toBe(true);
    expect(h.redo()).toBe(q);
  });

  it('holds at most `limit` states, forgetting the oldest', () => {
    const h = new History(0, 3);
    for (let i = 1; i <= 5; i++) h.push(i);
    expect(h.current).toBe(5);
    expect(h.undo()).toBe(4);
    expect(h.undo()).toBe(3);
    expect(h.undo()).toBeNull();
    const d = new History(0);
    for (let i = 1; i <= 150; i++) d.push(i);
    let n = 0;
    while (d.undo() !== null) n++;
    expect(n).toBe(99);
    expect(d.current).toBe(51);
  });

  it('reset clears the history to one state', () => {
    const h = new History('a');
    h.push('b'); h.push('c'); h.undo();
    h.reset('z');
    expect(h.current).toBe('z');
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
  });
});
