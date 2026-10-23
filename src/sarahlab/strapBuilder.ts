/**
 * THE CLOTHING BUILDER, MILESTONE 1: ONE EDITABLE STRAP (Joshua, 2026-10-23: "a simple clothing and fabric builder
 * inside Character Creation... Please keep the first milestone small: make one editable strip or bikini strap that
 * attaches correctly, survives the sliders and animations, saves and reloads, and works well on mobile. Show me that
 * working before expanding to panels and more advanced tools").
 *
 * The CLOTHES tab gains BUILD, a drawer of its own under the outfit editor:
 *
 *   PIECES -- the straps built for this outfit, + STRIP (a flat band: a bikini strap, a trim) and + CORD (a round
 *             string). One piece is selected; its points carry handles on her.
 *   EDIT / CAMERA -- the switch that keeps gestures from fighting. In EDIT one finger edits (ADD: tap her for a point,
 *             or drag across her to draw a path; MOVE: drag a handle along her skin) and two fingers still turn and
 *             zoom. In CAMERA one finger turns her, as everywhere else in the room.
 *   POINT  -- the selected point: step to the previous or next, nudge it across her (X), up and down her (Y) and off her
 *             skin (Z), let the stretch to the next point BRIDGE straight across instead of following her skin, delete.
 *   SHAPE  -- width, thickness, clearance off her skin, LOOP, EDGING; the fabric family and colour from the pack.
 *   UNDO, REDO, MIRROR COPY (the same strap on her other side), DELETE PIECE.
 *   MOTION -- play, pause, slow and step her animation (WALK, SIT), to watch the strap ride her.
 *
 * Where the work is done: every point is a SURFACE ANCHOR (a triangle of her body and barycentric weights,
 * `strapData.ts`), snapped to her by `bodySurface.ts` and never searched for again; between points that follow her
 * skin, the path along it is walked once when the points change (at rest, so it is the same path at every belly size);
 * every frame each anchor is read off her posed body and `strapMesh.ts` lays the strap along a smooth curve through
 * them, standing CLEARANCE off her skin. So the strap rides every slider, morph, bounce and pose, and what a save keeps
 * is only the data (`BuiltPieces`): the mesh is generated from it.
 *
 * WHERE A FABRIC'S EDGE COMES FROM (Joshua asked): a strip in a fabric wears that family's TRIM strip -- the pack's
 * edging, stitched edges and all -- laid along its length with the stitched edges on its two sides, so its edging
 * follows the strap's own smooth curve. That is unlike painted clothes, whose edge is where the paint's coverage
 * crosses one half on her skin (`fabricMaterial.ts`), and unlike the recovered garments, whose edging is baked into
 * their textures. With EDGING off a strip (and a cord always) wears the plain knit.
 */
import * as THREE from 'three';
import { FABRIC_FAMILIES, SWATCH_HEX, colourName, fabricFamily, swatchRect, type FabricFamilyId, type FabricLayout } from './fabricLibrary';
import { BodySurface, type SurfaceAnchor } from './bodySurface';
import { StrapMesh, type StrapShape } from './strapMesh';
import {
  History, MAX_PIECES, STRAP_RANGES, addPoint, movePoint, newPiece, newPoint, pieceId, removePoint, sanitizeBuilt, setPiece, setPointBridge,
  setPointLift, type BuiltPieces, type StrapKind, type StrapPiece,
} from './strapData';

export const BUILDER_ROLE = 'sarahlab-builder';
export type BuilderMode = 'edit' | 'camera';
export type BuilderTool = 'add' | 'move';
export const BUILDER_ACTION = Object.freeze({
  piece: (id: string) => `sarahlab:build:piece:${id}`,
  add: (kind: StrapKind) => `sarahlab:build:add:${kind}`,
  mode: (m: BuilderMode) => `sarahlab:build:mode:${m}`,
  tool: (t: BuilderTool) => `sarahlab:build:tool:${t}`,
  prev: 'sarahlab:build:point-prev',
  next: 'sarahlab:build:point-next',
  nudge: (axis: 'x' | 'y' | 'z', sign: 1 | -1) => `sarahlab:build:nudge:${axis}${sign > 0 ? '+' : '-'}`,
  bridge: 'sarahlab:build:bridge',
  deletePoint: 'sarahlab:build:delete-point',
  loop: 'sarahlab:build:loop',
  edging: 'sarahlab:build:edging',
  family: (id: FabricFamilyId | 'none') => `sarahlab:build:family:${id}`,
  colour: (i: number) => `sarahlab:build:colour:${i}`,
  undo: 'sarahlab:build:undo',
  redo: 'sarahlab:build:redo',
  mirror: 'sarahlab:build:mirror',
  remove: 'sarahlab:build:remove',
  play: 'sarahlab:build:play',
  speed: (s: number) => `sarahlab:build:speed:${s}`,
  step: 'sarahlab:build:step',
});
export const BUILDER_FIELD = Object.freeze({ width: 'builder-width', thickness: 'builder-thickness', clearance: 'builder-clearance', status: 'builder-status', point: 'builder-point' });

export interface StrapBuilderHooks {
  /** Her skin, or null before she is in. */
  body(): THREE.SkinnedMesh | null;
  /** Her FULL triangle list (the index before any garment hides skin): what an anchor's `tri` counts in. */
  triangles(body: THREE.SkinnedMesh): ArrayLike<number>;
  /** Her rest shape, xyz per vertex: where the builder measures. */
  rest(body: THREE.SkinnedMesh): Float32Array;
  /** How many of the mesh's own units make one centimetre on her. */
  unitsPerCm(mesh: THREE.Mesh): number;
  view(): { camera: THREE.Camera; width: number; height: number };
  loadImage(path: string): Promise<(CanvasImageSource & { width: number; height: number }) | null>;
  /** The model she is (anchors are triangles of it). */
  base(): string;
  /** Her clothes changed (the room's SAVE status follows). */
  changed?(): void;
  /** The room's animation clock. */
  clock: { paused(): boolean; setPaused(paused: boolean): void; speed(): number; setSpeed(speed: number): void; step(): void };
}

export interface StrapBuilder {
  readonly element: HTMLElement;
  /** True while one finger edits: EDIT chosen, the drawer open and on screen. */
  editing(): boolean;
  pointerDown(x: number, y: number): void;
  pointerMove(x: number, y: number): void;
  pointerUp(): void;
  /** Once a frame, after her bones have moved: every strap laid on her as she is now, the handles kept their size. */
  frame(): void;
  /** What a save keeps; null with nothing built. */
  built(): BuiltPieces | null;
  /** Put saved pieces on (null takes them all off). False when they were built on another model. */
  load(built: BuiltPieces | null): boolean;
  /** Whether the drawer is on screen (held upright, the CLOTHES tab may be folded away). */
  setActive(on: boolean): void;
  dispose(): void;
}

/** How far a nudge moves a point across or up her (cm), and off her skin (mm). */
const NUDGE_CM = 0.5, NUDGE_LIFT_MM = 1;
/** Drawing a path: a new point every this many centimetres of her skin. */
const DRAW_STEP_CM = 2.5;
/**
 * Between two points that follow her skin and are further apart than FOLLOW_FROM_CM, the path along her skin is walked,
 * an anchor about every FOLLOW_STEP_CM. Closer points need none: the strap's smooth curve between them sags inside her
 * by less than its clearance (a 4 cm chord on her bump, about 20 cm round, sags 1 mm), and the walk's own small sideways
 * steps, stretched by a big bump, read as a wave in a drawn band.
 */
const FOLLOW_STEP_CM = 1, FOLLOW_FROM_CM = 4;
/** The strap's smoothed samples are this far apart (cm). */
const SPACING_CM = 0.3;
/**
 * Handles, CSS pixels across: the selected point large (a thumb's target), the first point (green, where the strap
 * starts) a little smaller, every other point a small dot so a drawn path does not hide its own strap. A finger within
 * GRAB_PX of any of them takes it.
 */
const HANDLE_PX = 24, FIRST_PX = 14, DOT_PX = 9, GRAB_PX = 30;
/** A tap that misses her by this many pixels still lands on her edge. */
const PICK_SLOP_PX = 14;
const SPEEDS = [1, 0.5, 0.25] as const;

const BTN = 'min-height:42px;padding:6px 10px;border:1px solid #ffffff30;border-radius:9px;background:#151b23;color:#e8e2d8;font:700 11px system-ui;letter-spacing:.04em';
const ON = '#806020', OFF = '#151b23', GOLD = '#d4a853';

type Drag = { kind: 'handle'; index: number; moved: boolean } | { kind: 'draw'; last: THREE.Vector3; added: boolean } | null;

interface PieceView {
  readonly strap: StrapMesh;
  readonly material: THREE.MeshStandardMaterial;
  /** The points the anchors below were walked for. */
  key: string;
  /** Every anchor the strap runs through (its points and the path along her skin between them), with its lift (mm). */
  anchors: { readonly anchor: SurfaceAnchor; readonly lift: number }[];
  /** The look its material wears now. */
  look: string;
}

export function strapBuilder(hooks: StrapBuilderHooks): StrapBuilder {
  let pieces: readonly StrapPiece[] = [];
  const history = new History<readonly StrapPiece[]>(pieces);
  let selected = -1, point = -1;
  let mode: BuilderMode = 'edit', tool: BuilderTool = 'add';
  let active = true, disposed = false;
  let surface: BodySurface | null = null;
  let drag: Drag = null;
  let note = '';
  const views = new Map<string, PieceView>();
  const atlases = new Map<string, Promise<(CanvasImageSource & { width: number; height: number }) | null>>();
  const textures = new Map<string, THREE.Texture | null>();
  const loading = new Set<string>();

  // ------------------------------------------------------------ building blocks
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, css = '') => { const e = document.createElement(tag); if (css) e.style.cssText = css; return e; };
  const heading = (text: string) => { const h = el('div', 'font-size:11px;opacity:.75;margin-top:2px;letter-spacing:.06em'); h.textContent = text; return h; };
  const row = () => el('div', 'display:flex;gap:5px;flex-wrap:wrap');
  const button = (label: string, action: string, onClick: () => void) => {
    const b = el('button', BTN); b.type = 'button'; b.textContent = label; b.dataset.action = action;
    b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); draw(); }); return b;
  };
  const press = (b: HTMLButtonElement, on: boolean) => { b.setAttribute('aria-pressed', String(on)); b.style.background = on ? ON : OFF; };
  const slider = (field: string, range: { min: number; max: number; step: number }, onInput: (v: number) => void, onDone: () => void) => {
    const label = el('label', 'font-size:12px');
    const input = el('input', `width:100%;accent-color:${GOLD};height:28px`); input.type = 'range'; input.dataset.field = field;
    input.min = String(range.min); input.max = String(range.max); input.step = String(range.step);
    input.addEventListener('input', () => onInput(Number(input.value)));
    input.addEventListener('change', onDone);
    const wrap = el('div', 'display:flex;flex-direction:column;gap:2px'); wrap.append(label, input);
    return { wrap, label, input };
  };

  // ------------------------------------------------------------ the drawer
  const panel = el('details', 'border-top:1px solid #ffffff25;padding-top:8px;touch-action:pan-y');
  panel.dataset.role = BUILDER_ROLE;
  const summary = el('summary', 'cursor:pointer;padding:8px 0;font:700 12px system-ui;letter-spacing:.06em');
  const content = el('div', 'display:flex;flex-direction:column;gap:8px;padding:4px 0');

  const pieceRow = el('div', 'display:flex;gap:6px;overflow-x:auto;padding-bottom:4px;touch-action:pan-x');
  const addRow = row();
  addRow.append(button('+ STRIP', BUILDER_ACTION.add('strip'), () => addPiece('strip')), button('+ CORD', BUILDER_ACTION.add('cord'), () => addPiece('cord')));

  // EDIT / CAMERA: big, so the switch is easy to find with a thumb
  const modes = el('div', 'display:grid;grid-template-columns:1fr 1fr;gap:4px;background:#0b0f14;border-radius:10px;padding:3px');
  const modeButtons = new Map<BuilderMode, HTMLButtonElement>((['edit', 'camera'] as const).map((m) => {
    const b = button(m === 'edit' ? 'EDIT POINTS' : 'MOVE CAMERA', BUILDER_ACTION.mode(m), () => { mode = m; drag = null; });
    b.style.minHeight = '46px'; b.style.border = '0'; return [m, b];
  }));
  modes.append(...modeButtons.values());
  const tools = row();
  const toolButtons = new Map<BuilderTool, HTMLButtonElement>([
    ['add', button('ADD · tap or draw', BUILDER_ACTION.tool('add'), () => { tool = 'add'; })],
    ['move', button('MOVE · drag a handle', BUILDER_ACTION.tool('move'), () => { tool = 'move'; })],
  ]);
  tools.append(...toolButtons.values());

  // the selected point
  const pointBox = el('div', 'display:flex;flex-direction:column;gap:5px');
  const pointLine = el('div', 'font-size:12px'); pointLine.dataset.field = BUILDER_FIELD.point;
  const stepRow = row();
  stepRow.append(button('◀ POINT', BUILDER_ACTION.prev, () => selectPoint(point - 1)), button('POINT ▶', BUILDER_ACTION.next, () => selectPoint(point + 1)));
  const nudgeGrid = el('div', 'display:grid;grid-template-columns:repeat(3,1fr);gap:5px');
  for (const [axis, label] of [['x', 'X across'], ['y', 'Y up/down'], ['z', 'Z off skin']] as const) {
    nudgeGrid.append(button(`${label} −`, BUILDER_ACTION.nudge(axis, -1), () => nudge(axis, -1)));
  }
  for (const [axis, label] of [['x', 'X across'], ['y', 'Y up/down'], ['z', 'Z off skin']] as const) {
    nudgeGrid.append(button(`${label} +`, BUILDER_ACTION.nudge(axis, 1), () => nudge(axis, 1)));
  }
  const pointActions = row();
  const bridgeButton = button('BRIDGE TO NEXT', BUILDER_ACTION.bridge, () => {
    const p = current();
    if (!p || point < 0) return;
    commit(replace(selected, setPointBridge(p, point, !p.points[point].bridge)));
  });
  pointActions.append(bridgeButton, button('DELETE POINT', BUILDER_ACTION.deletePoint, () => {
    const p = current();
    if (!p || point < 0) return;
    commit(replace(selected, removePoint(p, point)));
    point = Math.min(point, (current()?.points.length ?? 0) - 1);
  }));
  pointBox.append(heading('POINT'), pointLine, stepRow, nudgeGrid, pointActions);

  // the piece's shape and fabric
  const shapeBox = el('div', 'display:flex;flex-direction:column;gap:6px');
  const width = slider(BUILDER_FIELD.width, { min: STRAP_RANGES.width.min, max: STRAP_RANGES.width.max, step: STRAP_RANGES.width.step }, (v) => live({ width: v }), settle);
  const thickness = slider(BUILDER_FIELD.thickness, STRAP_RANGES.thickness, (v) => live({ thickness: v }), settle);
  const clearance = slider(BUILDER_FIELD.clearance, STRAP_RANGES.clearance, (v) => live({ clearance: v }), settle);
  const toggles = row();
  const loopButton = button('LOOP', BUILDER_ACTION.loop, () => { const p = current(); if (p) commit(replace(selected, setPiece(p, { closed: !p.closed }))); });
  const edgingButton = button('EDGING', BUILDER_ACTION.edging, () => { const p = current(); if (p) commit(replace(selected, setPiece(p, { edging: !p.edging }))); });
  toggles.append(loopButton, edgingButton);
  const families = row();
  const familyButtons = new Map<FabricFamilyId | 'none', HTMLButtonElement>();
  familyButtons.set('none', button('PLAIN', BUILDER_ACTION.family('none'), () => { const p = current(); if (p) commit(replace(selected, setPiece(p, { fabric: null }))); }));
  for (const f of FABRIC_FAMILIES) familyButtons.set(f.id, button(f.name.toUpperCase(), BUILDER_ACTION.family(f.id), () => {
    const p = current(); if (p) commit(replace(selected, setPiece(p, { fabric: { family: f.id, colour: p.fabric?.colour ?? 8 } })));
  }));
  families.append(...familyButtons.values());
  const colours = el('div', 'display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:5px');
  const colourButtons = Array.from({ length: 16 }, (_, i) => {
    const b = el('button', 'aspect-ratio:1;min-height:32px;border-radius:7px;border:2px solid transparent;padding:0'); b.type = 'button'; b.dataset.action = BUILDER_ACTION.colour(i);
    b.addEventListener('click', (e) => { e.stopPropagation(); const p = current(); if (p) commit(replace(selected, setPiece(p, { fabric: { family: p.fabric?.family ?? 'athletic', colour: i } }))); draw(); });
    return b;
  });
  colours.append(...colourButtons);
  shapeBox.append(heading('SHAPE'), width.wrap, thickness.wrap, clearance.wrap, toggles, heading('FABRIC'), families, colours);

  // the piece's edits
  const edits = row();
  const undoButton = button('UNDO', BUILDER_ACTION.undo, () => { const s = history.undo(); if (s) show(s); });
  const redoButton = button('REDO', BUILDER_ACTION.redo, () => { const s = history.redo(); if (s) show(s); });
  const removeButton = twoTap('DELETE PIECE', 'DELETE? TAP AGAIN', BUILDER_ACTION.remove, () => {
    if (selected < 0) return;
    commit(pieces.filter((_, i) => i !== selected));
    selected = Math.min(selected, pieces.length - 1); point = -1;
  });
  edits.append(undoButton, redoButton, button('MIRROR COPY', BUILDER_ACTION.mirror, mirrorCopy), removeButton);

  // her motion, to watch the strap ride her
  const motion = row();
  const playButton = button('PAUSE', BUILDER_ACTION.play, () => hooks.clock.setPaused(!hooks.clock.paused()));
  const speedButtons = SPEEDS.map((s) => button(s === 1 ? '1×' : s === 0.5 ? '½×' : '¼×', BUILDER_ACTION.speed(s), () => hooks.clock.setSpeed(s)));
  motion.append(playButton, ...speedButtons, button('STEP', BUILDER_ACTION.step, () => hooks.clock.step()));
  const motionNote = el('div', 'font-size:10px;opacity:.7'); motionNote.textContent = 'WALK and SIT are the pose buttons; the belly slider is in BODY.';

  const status = el('div', 'font-size:11px;line-height:1.4;overflow-wrap:anywhere;opacity:.85');
  status.dataset.field = BUILDER_FIELD.status; status.setAttribute('aria-live', 'polite');

  content.append(heading('PIECES'), pieceRow, addRow, modes, tools, pointBox, shapeBox, heading('EDIT'), edits, heading('MOTION'), motion, motionNote, status);
  panel.append(summary, content);
  for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'wheel']) panel.addEventListener(ev, (e) => e.stopPropagation());
  panel.addEventListener('toggle', () => { drag = null; draw(); });

  function twoTap(label: string, armed: string, action: string, onConfirm: () => void): HTMLButtonElement {
    const reset = () => { b.dataset.armed = ''; b.textContent = label; b.style.borderColor = '#ffffff30'; };
    const b = button(label, action, () => {
      if (b.dataset.armed === '1') { reset(); onConfirm(); return; }
      b.dataset.armed = '1'; b.textContent = armed; b.style.borderColor = '#d46a53';
      setTimeout(() => { if (b.dataset.armed === '1') reset(); }, 3000);
    });
    return b;
  }

  // ------------------------------------------------------------ state
  const current = (): StrapPiece | null => pieces[selected] ?? null;
  const replace = (index: number, piece: StrapPiece): readonly StrapPiece[] => pieces.map((p, i) => (i === index ? piece : p));
  /** A finished edit: shown, and a step to undo. */
  function commit(next: readonly StrapPiece[]): void {
    if (next === pieces) return;
    pieces = next; history.push(next); touched();
  }
  /** A slider moving: shown at once, one undo step when it is let go. */
  function live(change: Parameters<typeof setPiece>[1]): void { const p = current(); if (p) { pieces = replace(selected, setPiece(p, change)); draw(); } }
  function settle(): void { if (pieces !== history.current) { history.push(pieces); touched(); } draw(); }
  /** Undo or redo: that state, the selection kept where it still can be. */
  function show(state: readonly StrapPiece[]): void {
    pieces = state;
    if (selected >= pieces.length) selected = pieces.length - 1;
    point = Math.min(point, (current()?.points.length ?? 0) - 1);
    touched();
  }
  let notify = false;
  function touched(): void {
    if (notify || !hooks.changed) return;
    notify = true;
    queueMicrotask(() => { notify = false; if (!disposed) hooks.changed?.(); });
  }
  function addPiece(kind: StrapKind): void {
    if (pieces.length >= MAX_PIECES) { note = `At most ${MAX_PIECES} pieces.`; return; }
    const n = pieces.filter((p) => p.kind === kind).length + 1;
    commit([...pieces, newPiece(kind, pieceId(), `${kind === 'strip' ? 'Strip' : 'Cord'} ${n}`)]);
    selected = pieces.length - 1; point = -1; mode = 'edit'; tool = 'add';
    note = 'Tap her to place the first point, or drag across her to draw it.';
  }
  function selectPoint(i: number): void {
    const p = current();
    if (!p || !p.points.length) return;
    point = Math.max(0, Math.min(p.points.length - 1, i));
  }

  // ------------------------------------------------------------ her surface
  function surfaceNow(): BodySurface | null {
    const body = hooks.body();
    if (!body) return null;
    if (surface?.mesh !== body) {
      for (const v of views.values()) v.strap.mesh.removeFromParent();
      surface = new BodySurface(body, hooks.triangles(body), hooks.rest(body));
      for (const v of views.values()) v.key = '';
      handles.removeFromParent(); body.add(handles);
    }
    return surface;
  }
  const units = () => { const body = hooks.body(); return body ? hooks.unitsPerCm(body) : 1; };
  const restAt = (a: SurfaceAnchor, out = new THREE.Vector3()) => surface!.restPoint(a, out);

  /** Move the selected point across her (x), up her (y) or off her (z, its lift). */
  function nudge(axis: 'x' | 'y' | 'z', sign: 1 | -1): void {
    const p = current(), s = surfaceNow();
    if (!p || !s || point < 0) return;
    const at = p.points[point];
    if (axis === 'z') { commit(replace(selected, setPointLift(p, point, at.lift + sign * NUDGE_LIFT_MM))); return; }
    const q = restAt(at);
    if (axis === 'x') q.x += sign * NUDGE_CM * units(); else q.y += sign * NUDGE_CM * units();
    const landed = s.closestRest(q, 3 * NUDGE_CM * units());
    if (landed) commit(replace(selected, movePoint(p, point, landed)));
  }
  /** The selected piece again on her other side, as a new piece. */
  function mirrorCopy(): void {
    const p = current(), s = surfaceNow();
    if (!p || !s || !p.points.length) return;
    if (pieces.length >= MAX_PIECES) { note = `At most ${MAX_PIECES} pieces.`; return; }
    let copy = setPiece(newPiece(p.kind, pieceId(), `${p.name} (mirror)`), { closed: p.closed, width: p.width, thickness: p.thickness, clearance: p.clearance, fabric: p.fabric, edging: p.edging });
    let lost = 0;
    for (const at of p.points) {
      const m = s.mirror(at);
      if (m) copy = addPoint(copy, newPoint(m, at.lift, at.bridge)); else lost++;
    }
    commit([...pieces, copy]);
    selected = pieces.length - 1; point = copy.points.length - 1;
    note = lost ? `Mirrored; ${lost} point${lost === 1 ? '' : 's'} had no place on her other side.` : 'Mirrored onto her other side as a new piece.';
  }

  // ------------------------------------------------------------ gestures (EDIT)
  const editing = () => active && panel.open && mode === 'edit' && !!hooks.body();
  /** The handle within reach of a screen point, or -1. */
  function handleAt(x: number, y: number): number {
    const p = current(), body = hooks.body(), s = surface;
    if (!p || !body || !s) return -1;
    const { camera, width: w, height: h } = hooks.view(), v = new THREE.Vector3();
    let best = -1, bestD = GRAB_PX * GRAB_PX;
    p.points.forEach((at, i) => {
      if (!s.valid(at)) return;
      s.evaluate(at, v); v.applyMatrix4(body.matrixWorld).project(camera);
      if (v.z < -1 || v.z > 1) return;
      const dx = (v.x * 0.5 + 0.5) * w - x, dy = (0.5 - v.y * 0.5) * h - y, d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }
  function pointerDown(x: number, y: number): void {
    if (!editing()) return;
    const s = surfaceNow(), body = hooks.body();
    if (!s || !body) return;
    const { camera, width: w, height: h } = hooks.view();
    s.capture(camera, w, h);
    const grab = handleAt(x, y);
    if (grab >= 0) { point = grab; drag = { kind: 'handle', index: grab, moved: false }; draw(); return; }
    if (tool !== 'add') { note = 'MOVE: drag one of the handles. Choose ADD to place new points.'; draw(); return; }
    const hit = s.pick(x, y, PICK_SLOP_PX);
    if (!hit) { note = 'Tap on her to place a point.'; draw(); return; }
    if (!current()) { if (pieces.length >= MAX_PIECES) return; pieces = [...pieces, newPiece('strip', pieceId(), 'Strip 1')]; selected = pieces.length - 1; point = -1; }
    insertPoint(hit.anchor);
    drag = { kind: 'draw', last: restAt(hit.anchor), added: true };
    draw();
  }
  /** A new point after the selected one (or at the end), and select it. */
  function insertPoint(anchor: SurfaceAnchor): void {
    const p = current()!;
    const at = point >= 0 && point < p.points.length - 1 ? point + 1 : p.points.length;
    const next = addPoint(p, newPoint(anchor, 0, false), at);
    if (next === p) { note = 'This piece is full.'; return; }
    pieces = replace(selected, next); point = at;
  }
  function pointerMove(x: number, y: number): void {
    if (!drag || !surface) return;
    const hit = surface.pick(x, y, PICK_SLOP_PX);
    if (!hit) return;
    const p = current();
    if (!p) return;
    if (drag.kind === 'handle') {
      pieces = replace(selected, movePoint(p, drag.index, hit.anchor));
      drag.moved = true;
    } else {
      const q = restAt(hit.anchor);
      if (q.distanceTo(drag.last) < DRAW_STEP_CM * units()) return;
      insertPoint(hit.anchor);
      drag.last.copy(q);
    }
  }
  function pointerUp(): void {
    if (!drag) return;
    const changed = drag.kind === 'handle' ? drag.moved : drag.added;
    drag = null;
    surface?.release();
    if (changed && pieces !== history.current) { history.push(pieces); touched(); }
    note = '';
    draw();
  }

  // ------------------------------------------------------------ on her, every frame
  const handles = new THREE.Group();
  handles.name = 'builderHandles';
  const handleGeometry = new THREE.SphereGeometry(1, 14, 10);
  const handleMeshes: THREE.Mesh[] = [];
  const handleColour = { plain: new THREE.Color(0xf4f1ea), first: new THREE.Color(0x6fd38a), chosen: new THREE.Color(GOLD) };
  const scratch = { p: new THREE.Vector3(), n: new THREE.Vector3(), w: new THREE.Vector3(), s: new THREE.Vector3() };
  const posBuf: THREE.Vector3[] = [], nrmBuf: THREE.Vector3[] = [];

  /** The anchors a piece runs through: its points, and between two that follow her skin the path along it. */
  function anchorsOf(p: StrapPiece, s: BodySurface): { anchor: SurfaceAnchor; lift: number }[] {
    const out: { anchor: SurfaceAnchor; lift: number }[] = [], pts = p.points.filter((x) => s.valid(x)), step = FOLLOW_STEP_CM * units();
    pts.forEach((a, i) => {
      out.push({ anchor: a, lift: a.lift });
      const b = i + 1 < pts.length ? pts[i + 1] : p.closed && pts.length > 2 ? pts[0] : null;
      if (!b || a.bridge || restAt(a).distanceTo(restAt(b, scratch.s)) <= FOLLOW_FROM_CM * units()) return;
      const path = s.pathBetween(a, b, step);
      path.forEach((c, k) => out.push({ anchor: c, lift: a.lift + ((b.lift - a.lift) * (k + 1)) / (path.length + 1) }));
    });
    return out;
  }
  function viewOf(p: StrapPiece, body: THREE.SkinnedMesh): PieceView {
    let v = views.get(p.id);
    if (!v) {
      const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
      v = { strap: new StrapMesh(material), material, key: '', anchors: [], look: '' };
      v.strap.mesh.name = `builtStrap:${p.id}`;
      views.set(p.id, v);
    }
    if (v.strap.mesh.parent !== body) body.add(v.strap.mesh);
    return v;
  }
  function frame(): void {
    // nothing built and the drawer shut: her surface is not even measured (its grid costs a moment to build)
    if (!pieces.length && !views.size && !(active && panel.open)) { handles.visible = false; return; }
    const body = hooks.body(), s = surfaceNow();
    if (!body || !s) return;
    const u = units(), live = new Set<string>();
    for (const p of pieces) {
      live.add(p.id);
      const v = viewOf(p, body);
      const key = `${p.closed}|${p.points.map((x) => `${x.tri},${x.bary.join(',')},${x.lift},${x.bridge ? 1 : 0}`).join(';')}`;
      if (key !== v.key) { v.key = key; v.anchors = anchorsOf(p, s); }
      dress(p, v);
      const n = v.anchors.length;
      while (posBuf.length < n) { posBuf.push(new THREE.Vector3()); nrmBuf.push(new THREE.Vector3()); }
      const lifts: number[] = new Array(n);
      for (let i = 0; i < n; i++) { s.evaluate(v.anchors[i].anchor, posBuf[i], nrmBuf[i]); lifts[i] = (v.anchors[i].lift * u) / 10; }
      const shape: StrapShape = {
        kind: p.kind, width: p.width * u, thickness: (p.thickness * u) / 10, clearance: (p.clearance * u) / 10, closed: p.closed && p.points.length > 2,
        spacing: SPACING_CM * u, uvLength: uvLengthOf(p) * u,
      };
      v.strap.update(posBuf.slice(0, n), nrmBuf.slice(0, n), lifts, shape);
    }
    for (const [id, v] of views) if (!live.has(id)) { v.strap.mesh.removeFromParent(); v.strap.dispose(); v.material.map?.dispose(); v.material.dispose(); views.delete(id); }
    placeHandles(body, s);
  }
  /** The handles of the selected piece, on top of everything and the same size on screen whatever the distance. */
  function placeHandles(body: THREE.SkinnedMesh, s: BodySurface): void {
    const p = current(), shown = active && panel.open && !!p;
    handles.visible = shown;
    if (!shown || !p) return;
    if (handles.parent !== body) body.add(handles);
    const { camera, height } = hooks.view(), u = units();
    const fov = (camera as THREE.PerspectiveCamera).isPerspectiveCamera ? (camera as THREE.PerspectiveCamera).getEffectiveFOV() : 50;
    body.getWorldScale(scratch.s);
    const bodyScale = scratch.s.x || 1;
    while (handleMeshes.length < p.points.length) {
      const m = new THREE.Mesh(handleGeometry, new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, depthWrite: false, transparent: true, opacity: 0.92 }));
      m.renderOrder = 1000; m.frustumCulled = false; handleMeshes.push(m); handles.add(m);
    }
    handleMeshes.forEach((m, i) => {
      const at = p.points[i];
      m.visible = i < p.points.length && s.valid(at);
      if (!m.visible) return;
      s.evaluate(at, scratch.p, scratch.n);
      // on the strap's top, so the handle sits where the strap is
      const off = ((p.clearance + at.lift + (p.kind === 'cord' ? p.width * 10 : p.thickness)) * u) / 10;
      m.position.copy(scratch.p).addScaledVector(scratch.n, off);
      scratch.w.copy(m.position).applyMatrix4(body.matrixWorld);
      const distance = scratch.w.distanceTo(camera.getWorldPosition(scratch.p));
      const worldPerPx = (2 * distance * Math.tan(THREE.MathUtils.degToRad(fov) / 2)) / Math.max(1, height);
      const r = ((i === point ? HANDLE_PX : i === 0 ? FIRST_PX : DOT_PX) * worldPerPx) / 2 / bodyScale;
      m.scale.setScalar(r);
      (m.material as THREE.MeshBasicMaterial).color.copy(i === point ? handleColour.chosen : i === 0 ? handleColour.first : handleColour.plain);
    });
  }

  // ------------------------------------------------------------ fabric on a strap
  /** Length along the strap of one repeat of its texture, centimetres. */
  function uvLengthOf(p: StrapPiece): number {
    if (!p.fabric) return 1;
    const fam = fabricFamily(p.fabric.family);
    // a trim strip is sixteen times as long as it is tall: laid with its height across the strap, it repeats every 16 widths
    return p.kind === 'strip' && p.edging ? p.width * 16 : fam.tileCm;
  }
  function dress(p: StrapPiece, v: PieceView): void {
    const look = p.fabric ? `${p.fabric.family}:${p.fabric.colour}:${p.kind === 'strip' && p.edging ? 'trim' : 'plain'}:${p.kind}:${p.width}` : 'plain-white';
    if (look === v.look) return;
    const m = v.material;
    if (!p.fabric) { v.look = look; m.map?.dispose(); m.map = null; m.color.set(0xffffff); m.roughness = 0.85; m.needsUpdate = true; return; }
    const which = p.kind === 'strip' && p.edging ? 'trim' : 'plain';
    const base = texture(p.fabric.family, p.fabric.colour, which);
    if (base === undefined) return; // still loading: tried again next frame
    v.look = look;
    m.map?.dispose();
    if (!base) { m.map = null; m.color.set(SWATCH_HEX[p.fabric.family][p.fabric.colour] ?? '#ffffff'); m.needsUpdate = true; return; }
    const map = base.clone();
    map.needsUpdate = true;
    // across the strap: a trim strip's full height; the plain knit at its own gauge (a cord: round its girth)
    const fam = fabricFamily(p.fabric.family), across = p.kind === 'cord' ? Math.PI * p.width : p.width;
    map.repeat.set(1, which === 'trim' ? 1 : across / fam.tileCm);
    m.map = map; m.color.set(0xffffff); m.roughness = fam.roughness; m.needsUpdate = true;
  }
  /** A swatch as a texture: a plain cell, or a trim colour's whole strip with its stitched edges. Undefined while loading. */
  function texture(family: FabricFamilyId, colour: number, which: 'plain' | 'trim'): THREE.Texture | null | undefined {
    const key = `${family}:${colour}:${which}`;
    if (textures.has(key)) return textures.get(key)!;
    if (loading.has(key)) return undefined;
    loading.add(key);
    const fam = fabricFamily(family), path = which === 'plain' ? fam.plain : fam.trim;
    if (!atlases.has(path)) atlases.set(path, hooks.loadImage(path));
    void atlases.get(path)!.then((image) => {
      loading.delete(key);
      if (disposed) return;
      if (!image) { textures.set(key, null); atlases.delete(path); return; }
      const layout: FabricLayout = which === 'plain' ? 'grid' : 'strips';
      const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d');
      if (!ctx) { textures.set(key, null); return; }
      if (layout === 'grid') {
        const r = swatchRect('grid', colour, image.width);
        canvas.width = r.w; canvas.height = r.h;
        ctx.drawImage(image, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
      } else {
        // the whole strip, stitched edges and all (`swatchRect` keeps only its middle band, for a garment's knit)
        const strip = image.height / 16, y = Math.round(Math.max(0, Math.min(15, colour)) * strip);
        canvas.width = image.width; canvas.height = Math.max(1, Math.round(strip));
        ctx.drawImage(image, 0, y, image.width, Math.round(strip), 0, 0, canvas.width, canvas.height);
      }
      const t = new THREE.CanvasTexture(canvas);
      t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = THREE.RepeatWrapping; t.wrapT = layout === 'grid' ? THREE.MirroredRepeatWrapping : THREE.ClampToEdgeWrapping;
      t.anisotropy = 8;
      textures.set(key, t);
      for (const v of views.values()) v.look = '';
    });
    return undefined;
  }

  // ------------------------------------------------------------ the drawer's own look
  function draw(): void {
    const p = current();
    summary.textContent = `BUILD · ${p ? `${p.name} · ${p.points.length} point${p.points.length === 1 ? '' : 's'}` : 'straps & cords (beta)'}`;
    pieceRow.replaceChildren(...pieces.map((x, i) => {
      const b = el('button', 'flex:none;min-height:44px;max-width:150px;padding:5px 10px;border-radius:9px;border:1px solid #ffffff30;background:#151b23;color:#e8e2d8;font:700 11px system-ui;white-space:nowrap;overflow:hidden;text-overflow:ellipsis');
      b.type = 'button'; b.dataset.action = BUILDER_ACTION.piece(x.id); b.textContent = `${x.kind === 'cord' ? 'CORD' : 'STRIP'} · ${x.name}`;
      const on = i === selected; b.style.background = on ? '#3a2c10' : '#151b23'; b.style.borderColor = on ? GOLD : '#ffffff30'; b.setAttribute('aria-pressed', String(on));
      b.addEventListener('click', (e) => { e.stopPropagation(); selected = i; point = Math.min(point, pieces[i].points.length - 1); draw(); });
      return b;
    }));
    for (const [m, b] of modeButtons) press(b, m === mode);
    for (const [t, b] of toolButtons) { press(b, t === tool); b.style.display = mode === 'edit' ? '' : 'none'; }
    tools.style.display = mode === 'edit' ? 'flex' : 'none';
    const hasPoint = !!p && point >= 0 && point < p.points.length;
    pointBox.style.display = hasPoint ? 'flex' : 'none';
    if (hasPoint) {
      const at = p!.points[point];
      pointLine.textContent = `Point ${point + 1} of ${p!.points.length} · lift ${at.lift} mm · ${at.bridge ? 'bridges' : 'follows her skin'} to the next`;
      press(bridgeButton, at.bridge);
    }
    shapeBox.style.display = p ? 'flex' : 'none';
    if (p) {
      width.input.value = String(p.width); width.label.textContent = `${p.kind === 'cord' ? 'THICKNESS (ACROSS)' : 'WIDTH'} · ${p.width.toFixed(1)} cm`;
      thickness.input.value = String(p.thickness); thickness.label.textContent = `THICKNESS · ${p.thickness.toFixed(1)} mm`;
      thickness.wrap.style.display = p.kind === 'strip' ? 'flex' : 'none';
      clearance.input.value = String(p.clearance); clearance.label.textContent = `CLEARANCE OFF HER SKIN · ${p.clearance.toFixed(1)} mm`;
      press(loopButton, p.closed); press(edgingButton, p.edging);
      edgingButton.style.display = p.kind === 'strip' ? '' : 'none';
      const fam = p.fabric?.family ?? null;
      for (const [id, b] of familyButtons) press(b, (id === 'none' && !fam) || id === fam);
      colours.style.display = fam ? 'grid' : 'none';
      colourButtons.forEach((b, k) => {
        b.style.background = SWATCH_HEX[fam ?? 'jersey'][k];
        b.style.borderColor = p.fabric && p.fabric.colour === k ? GOLD : 'transparent';
        b.setAttribute('aria-label', colourName(fam ?? 'jersey', k)); b.setAttribute('aria-pressed', String(!!p.fabric && p.fabric.colour === k));
      });
    }
    undoButton.disabled = !history.canUndo; redoButton.disabled = !history.canRedo;
    undoButton.style.opacity = history.canUndo ? '1' : '.4'; redoButton.style.opacity = history.canRedo ? '1' : '.4';
    removeButton.style.display = p ? '' : 'none';
    playButton.textContent = hooks.clock.paused() ? 'PLAY' : 'PAUSE';
    speedButtons.forEach((b, k) => press(b, hooks.clock.speed() === SPEEDS[k]));
    status.textContent = note || (mode === 'camera' ? 'CAMERA: one finger turns her, two zoom. Switch to EDIT POINTS to place or move points.'
      : !p ? 'Choose + STRIP or + CORD, then tap her to place points (or just tap her: a strip is started for you).'
        : tool === 'add' ? 'EDIT · ADD: tap her for a point after the gold one, or drag across her to draw a path. Drag a handle to move it. Two fingers turn and zoom.'
          : 'EDIT · MOVE: drag a handle along her skin; tap one to select it. Two fingers turn and zoom.');
  }

  draw();
  return {
    element: panel,
    editing,
    pointerDown,
    pointerMove,
    pointerUp,
    frame,
    built: () => (pieces.length ? { version: 1, base: hooks.base(), pieces } : null),
    load(built) {
      drag = null;
      if (built && built.pieces.length && built.base && built.base !== hooks.base()) {
        note = `These pieces were built on ${built.base}; she is ${hooks.base()} now, so they are not put on.`;
        draw();
        return false;
      }
      const s = surfaceNow();
      const clean = built ? sanitizeBuilt(built, s?.triangleCount) : null;
      pieces = clean ? clean.pieces : [];
      history.reset(pieces);
      selected = pieces.length ? 0 : -1; point = -1; note = '';
      draw();
      return true;
    },
    setActive(on) { if (on === active) return; active = on; drag = null; draw(); },
    dispose() {
      disposed = true;
      for (const v of views.values()) { v.strap.mesh.removeFromParent(); v.strap.dispose(); v.material.map?.dispose(); v.material.dispose(); }
      views.clear();
      handles.removeFromParent();
      handleGeometry.dispose();
      for (const m of handleMeshes) (m.material as THREE.Material).dispose();
      for (const t of textures.values()) t?.dispose();
      textures.clear();
    },
  };
}
