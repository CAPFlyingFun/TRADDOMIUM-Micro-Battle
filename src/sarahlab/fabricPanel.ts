/**
 * THE OUTFIT EDITOR (Joshua, 2026-10-20, reorganised 2026-10-22), in the CLOTHES tab.
 *
 * "I'd like the editor to distinguish clearly between editing an existing outfit... and painting directly onto the
 * body", and, held upright, "the 3D character to remain the main focus... a compact editor drawer". So it works in the
 * order a person thinks:
 *
 *   SELECT -- what she has on, as PIECES: each painted layer named by what its template makes (TOP, BOTTOM, ONE-PIECE,
 *             LEGWEAR, or PAINT when painted by hand), each modelled garment by its kind, and NEW PIECE for an empty
 *             layer. The default outfit's tee is TOP and its leggings BOTTOM, both editable like any other piece.
 *   DESIGN -- only what applies to that piece: its STYLE (a coverage template, `paintTemplates.ts`) and the edges it
 *             offers (neckline, sleeves, waistband, hem, length), its fabric family, colour, cover and stitch; a
 *             garment's trim. ISOLATE shows the piece on its own.
 *   PAINT  -- the brush, eraser, regions, mirror, undo and redo on one paint layer. Painting shows her body: every
 *             garment mesh, every OTHER paint layer, the shirt's drape and the cleavage bridge are hidden (THIS LAYER);
 *             ALL PAINT shows the other layers again, CLEAR BODY hides this one too. Nothing is deleted: leaving PAINT
 *             (or folding the editor, or another tab) puts every piece back as it was.
 *   SAVE   -- the room's outfit operations (`outfitPanel.ts`, handed in by the room).
 *
 * BREAST and NAVEL DETAIL through the clothes are one setting for the whole outfit, each AUTO (every piece's own fabric
 * and construction decides, `detailMaterials.ts`) or MANUAL, with its own RESET TO AUTO (Joshua, 2026-10-22). The same
 * setting is shown here and in the BODY tab (`detailControl`), so the two can never disagree.
 *
 * The garment and paint engines underneath are unchanged: a family's atlas is fetched the first time it is chosen, each
 * swatch cut from it once; paint lives in `bodyPaint.ts`, its shader in `fabricMaterial.ts`.
 */
import * as THREE from 'three';
import type { ShapeFields } from '../view/bodyShapeView';
import {
  DEFAULT_CHOICE, FABRIC_FAMILIES, OPACITY_RANGE, STITCH_RANGE, SWATCH_HEX, base64ToBytes, bytesToBase64, colourName,
  fabricFamily, opacityOf, swatchRect, tileUnits, trimPick, type FabricChoice, type FabricFamilyId, type FabricLayout,
  type FabricPick, type OutfitConfig, type PaintTool,
} from './fabricLibrary';
import { ensureRest, setDetailKeep, setFabricLayer, setHang, setRegionOverlay, setUnder } from './fabricMaterial';
import type { DetailKeep } from './bodyDetail';
import { DEFAULT_LAYER_DETAIL, resolveDetail, type LayerDetail, type ResolvedDetail } from './detailMaterials';
import { BRUSH_RANGE_CM, BodyPaint, PAINT_LAYER_COUNT, packLayer } from './bodyPaint';
import { BODY_REGIONS, REGION_GROUPS, groupOf, groupRegions, type BodyMap, type RegionSide } from './bodyRegions';
import { CleavageBridge } from './cleavageBridge';
import { TunicDrape } from './tunicDrape';
import { AUTO_DETAIL, type DetailOverride, type SavedClothes } from './characterSaves';
import {
  COVERAGE_DIALS, COVERAGE_TEMPLATES, DEFAULT_SHIRT_LENGTH, PIECE_KIND_NAMES, TEMPLATE_GROUPS, coverage, dialValue, dialsFor, pieceKind, shirtHem,
  withDial, type CoverageParams, type PieceKind,
} from './paintTemplates';

export const FABRIC_PANEL_ROLE = 'sarahlab-fabric';
export type EditorSpace = 'design' | 'paint' | 'save';
export type PaintView = 'layer' | 'all' | 'clear';
export const FABRIC_ACTION = Object.freeze({
  /** A piece: `layer:<i>`, `garment:<name>`, or `new`. */
  piece: (id: string) => `sarahlab:fabric:piece:${id}`,
  space: (s: EditorSpace) => `sarahlab:fabric:space:${s}`,
  view: (v: PaintView) => `sarahlab:fabric:view:${v}`,
  isolate: 'sarahlab:fabric:isolate',
  family: (id: FabricFamilyId | 'original') => `sarahlab:fabric:family:${id}`,
  colour: (i: number) => `sarahlab:fabric:colour:${i}`,
  trimFamily: (id: FabricFamilyId) => `sarahlab:fabric:trim-family:${id}`,
  trimColour: (i: number) => `sarahlab:fabric:trim-colour:${i}`,
  match: 'sarahlab:fabric:match',
  tool: (t: PaintTool) => `sarahlab:fabric:tool:${t}`,
  region: (id: string) => `sarahlab:fabric:region:${id}`,
  side: (s: RegionSide) => `sarahlab:fabric:side:${s}`,
  showRegions: 'sarahlab:fabric:show-regions',
  mirror: 'sarahlab:fabric:mirror',
  undo: 'sarahlab:fabric:undo',
  redo: 'sarahlab:fabric:redo',
  clear: 'sarahlab:fabric:clear',
  remove: 'sarahlab:fabric:remove',
  /** RESET TO AUTO for one detail. */
  detailAuto: (which: 'nipple' | 'navel') => `sarahlab:fabric:detail-auto:${which}`,
});
export const FABRIC_FIELD = Object.freeze({
  nippleKeep: 'fabric-nipple-keep', navelKeep: 'fabric-navel-keep', detailInfo: 'fabric-detail-info',
  style: 'fabric-style', stitch: 'fabric-stitch', opacity: 'fabric-opacity', brush: 'fabric-brush', status: 'fabric-status', pieces: 'fabric-pieces',
});

export interface WornGarment { readonly name: string; readonly label: string; readonly trim: boolean }

type Target = { readonly kind: 'layer'; readonly index: number } | { readonly kind: 'garment'; readonly name: string };
/** A thing she has on that the editor can select. */
export interface Piece {
  readonly id: string;
  readonly kind: PieceKind | 'paint' | 'set' | 'garment' | 'new';
  /** TOP, BOTTOM... */
  readonly title: string;
  /** Its style or garment name. */
  readonly name: string;
  readonly target: Target;
}

export interface FabricHooks {
  meshes(): readonly THREE.SkinnedMesh[];
  /** Her skin: the mesh carrying `_cloth_cover`, or null before she is in. */
  body(): THREE.SkinnedMesh | null;
  /** What she has on now, by material name. */
  worn(): readonly WornGarment[];
  rest(mesh: THREE.Mesh): ShapeFields | null;
  /** How many of the mesh's own units make one centimetre on her. */
  unitsPerCm(mesh: THREE.Mesh): number;
  /** An atlas, decoded, or null if it could not be fetched. */
  loadImage(path: string): Promise<(CanvasImageSource & { width: number; height: number }) | null>;
  /**
   * Which modelled garments the room draws: all of them, none (while painting her body), or only the one named (a
   * garment ISOLATED in DESIGN). The room applies her look again after it.
   */
  garmentsShown(which: 'all' | 'none' | string): void;
  /** The camera and the canvas size in CSS pixels, for a brush stroke. */
  view(): { camera: THREE.Camera; width: number; height: number };
  /** Which model and outfit, for an exported config. */
  describe(): { base: string; outfit: string };
  /** Her body mapped for painting (`bodyRegions.ts`), or null when she cannot be mapped. */
  regions(): BodyMap | null;
  /** The vertex her navel morph moves most, if she has one: where her navel is. */
  navelHint(): number | undefined;
  /** Her shape needs applying again (the navel's softening under paint changed). */
  reshape(): void;
  /** The SAVE workspace's contents (the room's outfit operations), if the room has them. */
  saveSection?(): HTMLElement | null;
  /** Her clothes changed (a fabric, a style, a stroke, the detail): the room's SAVE status follows. */
  changed?(): void;
}

export interface FabricPanel {
  readonly element: HTMLElement;
  /** Re-lay every choice on whatever materials she has now (a new shirt, a model switch); cheap when nothing changed. */
  sync(): void;
  /** Rebuild the pieces from what she wears. */
  refreshTargets(): void;
  /** True while her body is being painted (BODY PAINT, with the editor showing). */
  readonly painting: boolean;
  /** The brush or eraser while painting, else null (a drag then orbits as usual). */
  tool(): 'brush' | 'erase' | 'region' | null;
  strokeStart(x: number, y: number): void;
  strokeMove(x: number, y: number): void;
  strokeEnd(): void;
  exportConfig(): OutfitConfig;
  /**
   * Put on a painted outfit: each of its layers a coverage template in a fabric swatch, bottom first. Layers a previous
   * painted outfit filled and this one does not are cleared; layers painted by hand are left alone unless this outfit
   * needs them. Null takes a painted outfit off. Its detail goes back to AUTO. False if her body is not ready yet.
   */
  wearOutfit(layers: readonly { readonly template: string; readonly fabric: FabricPick }[] | null): boolean;
  /** Every paint layer and garment fabric off (a blank NEW OUTFIT); the detail back to AUTO. */
  clearAll(): boolean;
  /**
   * How far toward flat her navel's own `navelFlat` morph should go under paint: (1 - NAVEL DETAIL) times how much
   * paint covers her navel, so a bare or bikini navel is never touched. 0 with nothing painted there.
   */
  navelFlatten(): number;
  /** The cleavage bridge and the drape: re-laid once a frame, and again after her shape changes. */
  frame(): void;
  reshaped(): void;
  /** A painted shirt's LENGTH, 0 just above her crotch to 1 just above her knee (Joshua, 2026-10-22). */
  setShirtLength(length: number): void;
  shirtLength(): number;
  /** Whether she has a painted shirt on that SHIRT LENGTH moves. */
  wearsShirt(): boolean;
  /** Her clothes as a save holds them (`characterSaves.ts`), but for the outfit's name, which the room knows. */
  clothes(): Omit<SavedClothes, 'outfit'>;
  /** Put saved clothes on: every paint layer as saved (an empty one cleared), the garments' fabrics, length, detail. */
  putOnClothes(saved: Omit<SavedClothes, 'outfit'>): boolean;
  /** The pieces as the SELECT row lists them, and the one selected. */
  pieces(): readonly Piece[];
  selected(): string;
  select(id: string): void;
  setSpace(space: EditorSpace): void;
  space(): EditorSpace;
  /**
   * Whether the editor is on screen (held upright, the CLOTHES tab may be folded away). Off, nothing is hidden and
   * nothing is painted: her outfit is whole again.
   */
  setActive(on: boolean): void;
  /** The shared BREAST and NAVEL DETAIL as saved, and a way to set either (null: AUTO). */
  detail(): DetailOverride;
  setDetail(which: 'nipple' | 'navel', value: number | null): void;
  /** Another view of the same BREAST and NAVEL DETAIL controls, for the BODY tab. */
  detailControl(): HTMLElement;
  dispose(): void;
}

const BTN = 'min-height:40px;padding:6px 9px;border:1px solid #ffffff30;border-radius:8px;background:#151b23;color:#e8e2d8;font:600 11px system-ui';
const ON = '#806020', OFF = '#151b23';
const GOLD = '#d4a853';

/** What kind of piece a modelled garment is, by its material name. */
function garmentKind(name: string): Piece['kind'] {
  if (/^shirt/.test(name)) return 'top';
  if (/^leggings/.test(name)) return 'bottom';
  if (name === 'swimsuit') return 'onePiece';
  if (name === 'bikini') return 'set';
  return 'garment';
}
const KIND_TITLE: Readonly<Record<Piece['kind'], string>> = { ...PIECE_KIND_NAMES, paint: 'PAINT', set: 'SET', garment: 'GARMENT', new: '+ NEW PIECE' };
/** SELECT lists tops first, then one-pieces, bottoms, legwear, hand paint, then garments. */
const KIND_ORDER: readonly Piece['kind'][] = ['top', 'onePiece', 'set', 'bottom', 'legwear', 'paint', 'garment', 'new'];

export function fabricPanel(hooks: FabricHooks): FabricPanel {
  const garmentChoices = new Map<string, FabricChoice>();
  const paintChoices: FabricChoice[] = Array.from({ length: PAINT_LAYER_COUNT }, () => DEFAULT_CHOICE);
  const atlases = new Map<string, Promise<(CanvasImageSource & { width: number; height: number }) | null>>();
  const swatches = new Map<string, THREE.Texture>();
  let target: Target = { kind: 'layer', index: 0 };
  let space: EditorSpace = 'design', paintView: PaintView = 'layer', isolated = false, active = true;
  let tool: PaintTool = 'brush', brushCm: number = BRUSH_RANGE_CM.initial;
  let painting = false, disposed = false, stroking = false, side: RegionSide = 'both', showingRegions = false;
  let paint: BodyPaint | null = null;
  let override: DetailOverride = AUTO_DETAIL;
  /** Each layer's template, if its coverage came from one (dials move it until the layer is painted by hand). */
  const templates: ({ id: string; params: CoverageParams } | null)[] = Array.from({ length: PAINT_LAYER_COUNT }, () => null);
  /** Each layer's own detail (AUTO from its fabric unless an older save set OVERRIDE or OFF on it). */
  const details: LayerDetail[] = Array.from({ length: PAINT_LAYER_COUNT }, () => DEFAULT_LAYER_DETAIL);
  const layer = () => (target.kind === 'layer' ? target.index : -1);

  // ------------------------------------------------------------ building blocks
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, css = '') => { const e = document.createElement(tag); if (css) e.style.cssText = css; return e; };
  const heading = (text: string) => { const h = el('div', 'font-size:11px;opacity:.75;margin-top:2px;letter-spacing:.06em'); h.textContent = text; return h; };
  const row = () => el('div', 'display:flex;gap:5px;flex-wrap:wrap');
  const grid = () => el('div', 'display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:5px');
  const button = (label: string, action: string, onClick: () => void) => {
    const b = el('button', BTN); b.type = 'button'; b.textContent = label; b.dataset.action = action;
    b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); }); return b;
  };
  const press = (b: HTMLButtonElement, on: boolean) => { b.setAttribute('aria-pressed', String(on)); b.style.background = on ? ON : OFF; };
  const slider = (field: string, range: { min: number; max: number; step: number }, onInput: (v: number) => void) => {
    const label = el('label', 'font-size:12px');
    const input = el('input', `width:100%;accent-color:${GOLD}`); input.type = 'range'; input.dataset.field = field;
    input.min = String(range.min); input.max = String(range.max); input.step = String(range.step);
    input.addEventListener('input', () => onInput(Number(input.value)));
    const wrap = el('div', 'display:flex;flex-direction:column;gap:4px'); wrap.append(label, input);
    return { wrap, label, input };
  };
  const swatch = (action: string, onClick: () => void) => {
    const b = el('button', 'aspect-ratio:1;min-height:32px;border-radius:7px;border:2px solid transparent;padding:0'); b.type = 'button'; b.dataset.action = action;
    b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); }); return b;
  };
  /** A button that asks once: the first tap arms it for a few seconds, the second does it. */
  const twoTap = (label: string, armed: string, action: string, onConfirm: () => void) => {
    const reset = () => { b.dataset.armed = ''; b.textContent = label; b.style.borderColor = '#ffffff30'; };
    const b = button(label, action, () => {
      if (b.dataset.armed === '1') { reset(); onConfirm(); return; }
      b.dataset.armed = '1'; b.textContent = armed; b.style.borderColor = '#d46a53';
      setTimeout(() => { if (b.dataset.armed === '1') reset(); }, 3000);
    });
    return b;
  };

  // ------------------------------------------------------------ the drawer
  const panel = el('details', 'border-top:1px solid #ffffff25;padding-top:8px;touch-action:pan-y');
  panel.dataset.role = FABRIC_PANEL_ROLE;
  const summary = el('summary', 'cursor:pointer;padding:8px 0;font:700 12px system-ui;letter-spacing:.06em');
  const content = el('div', 'display:flex;flex-direction:column;gap:8px;padding:4px 0');

  // SELECT: one row of pieces, scrolling sideways on a narrow screen rather than growing
  const pieceRow = el('div', 'display:flex;gap:6px;overflow-x:auto;padding-bottom:4px;scrollbar-width:thin;touch-action:pan-x');
  pieceRow.dataset.field = FABRIC_FIELD.pieces;
  const pieceButtons = new Map<string, HTMLButtonElement>();

  // the workspaces
  const spaces = el('div', 'display:grid;grid-template-columns:repeat(3,1fr);gap:4px;background:#0b0f14;border-radius:10px;padding:3px');
  const spaceButtons = new Map<EditorSpace, HTMLButtonElement>((['design', 'paint', 'save'] as const).map((s) => {
    const b = button(s === 'paint' ? 'BODY PAINT' : s.toUpperCase(), FABRIC_ACTION.space(s), () => setSpace(s));
    b.style.minHeight = '36px'; b.style.border = '0'; return [s, b];
  }));
  spaces.append(...spaceButtons.values());

  // the showing: DESIGN's isolate, PAINT's three views
  const isolateButton = button('ISOLATE', FABRIC_ACTION.isolate, () => { isolated = !isolated; updateView(); draw(); });
  const viewButtons = new Map<PaintView, HTMLButtonElement>([
    ['layer', button('THIS LAYER', FABRIC_ACTION.view('layer'), () => { paintView = 'layer'; updateView(); draw(); })],
    ['all', button('ALL PAINT', FABRIC_ACTION.view('all'), () => { paintView = 'all'; updateView(); draw(); })],
    ['clear', button('CLEAR BODY', FABRIC_ACTION.view('clear'), () => { paintView = 'clear'; updateView(); draw(); })],
  ]);
  const showRow = row(); showRow.append(isolateButton, ...viewButtons.values());

  // ---- DESIGN
  const designBox = el('div', 'display:flex;flex-direction:column;gap:8px');
  const styleSelect = el('select', 'min-height:38px;font:600 13px system-ui;width:100%');
  styleSelect.dataset.field = FABRIC_FIELD.style; styleSelect.setAttribute('aria-label', 'Style');
  styleSelect.add(new Option('Choose a style…', ''));
  for (const g of TEMPLATE_GROUPS) {
    const og = document.createElement('optgroup'); og.label = g;
    for (const t of COVERAGE_TEMPLATES.filter((x) => x.group === g)) og.appendChild(new Option(t.name, t.id));
    styleSelect.appendChild(og);
  }
  styleSelect.addEventListener('change', () => { const t = COVERAGE_TEMPLATES.find((x) => x.id === styleSelect.value); if (t) applyTemplate(t.id, t.params); });
  const dials = new Map(COVERAGE_DIALS.map((d) => [d.id, slider(`fabric-dial-${d.id}`, { min: d.min, max: d.max, step: 0.01 }, (v) => moveDial(d.id, v))]));
  const dialBox = el('div', 'display:flex;flex-direction:column;gap:6px');
  for (const d of dials.values()) dialBox.append(d.wrap);
  const styleBox = el('div', 'display:flex;flex-direction:column;gap:6px'); styleBox.append(heading('STYLE'), styleSelect, dialBox);
  const families = row(), colours = grid();
  const familyButtons = new Map<string, HTMLButtonElement>();
  familyButtons.set('original', button('ORIGINAL', FABRIC_ACTION.family('original'), () => set({ fabric: null })));
  for (const f of FABRIC_FAMILIES) familyButtons.set(f.id, button(f.name.toUpperCase(), FABRIC_ACTION.family(f.id), () => set({ fabric: { family: f.id, colour: current().fabric?.colour ?? 0 } })));
  families.append(...familyButtons.values());
  const colourButtons = Array.from({ length: 16 }, (_, i) => swatch(FABRIC_ACTION.colour(i), () => set({ fabric: { family: current().fabric?.family ?? 'jersey', colour: i } })));
  colours.append(...colourButtons);
  const trimBox = el('div', 'display:flex;flex-direction:column;gap:8px');
  const trimOwn = el('div', 'display:flex;flex-direction:column;gap:8px');
  const match = button('MATCH', FABRIC_ACTION.match, () => { const c = current(); set({ match: !c.match, trim: c.trim ?? c.fabric }); });
  const trimFamilies = row(), trimColours = grid();
  const trimFamilyButtons = new Map<FabricFamilyId, HTMLButtonElement>();
  for (const f of FABRIC_FAMILIES) trimFamilyButtons.set(f.id, button(f.name.toUpperCase(), FABRIC_ACTION.trimFamily(f.id), () => set({ trim: { family: f.id, colour: current().trim?.colour ?? 0 } })));
  trimFamilies.append(...trimFamilyButtons.values());
  const trimColourButtons = Array.from({ length: 16 }, (_, i) => swatch(FABRIC_ACTION.trimColour(i), () => { const c = current(); set({ trim: { family: c.trim?.family ?? c.fabric?.family ?? 'jersey', colour: i } }); }));
  trimColours.append(...trimColourButtons);
  const matchRow = row(); matchRow.append(match);
  trimOwn.append(trimFamilies, trimColours);
  const trimNote = el('div', 'font-size:11px;opacity:.7;line-height:1.4');
  trimBox.append(heading('TRIM'), matchRow, trimOwn, trimNote);
  const opacity = slider(FABRIC_FIELD.opacity, OPACITY_RANGE, (v) => set({ opacity: v }));
  const stitch = slider(FABRIC_FIELD.stitch, STITCH_RANGE, (v) => set({ stitch: v }));
  const removeRow = row();
  removeRow.append(twoTap('REMOVE PIECE', 'REMOVE? TAP AGAIN', FABRIC_ACTION.remove, () => {
    const p = bodyPaint(), i = layer();
    if (!p || i < 0) return;
    p.checkpoint(i); p.clear(i); templates[i] = null; paintChoices[i] = DEFAULT_CHOICE; details[i] = DEFAULT_LAYER_DETAIL;
    sync(); refreshTargets(); touched();
  }));
  const fabricHeading = heading('FABRIC');
  designBox.append(styleBox, fabricHeading, families, colours, trimBox, opacity.wrap, stitch.wrap, removeRow);

  // ---- PAINT
  const paintBox = el('div', 'display:flex;flex-direction:column;gap:8px');
  const tools = row();
  const toolButtons = new Map<PaintTool, HTMLButtonElement>([
    ['brush', button('BRUSH', FABRIC_ACTION.tool('brush'), () => { tool = 'brush'; draw(); })],
    ['erase', button('ERASER', FABRIC_ACTION.tool('erase'), () => { tool = 'erase'; draw(); })],
    ['region', button('FILL REGION', FABRIC_ACTION.tool('region'), () => { tool = 'region'; draw(); })],
    ['orbit', button('TURN HER', FABRIC_ACTION.tool('orbit'), () => { tool = 'orbit'; draw(); })],
  ]);
  tools.append(...toolButtons.values());
  const brush = slider(FABRIC_FIELD.brush, BRUSH_RANGE_CM, (v) => { brushCm = v; draw(); });
  const edits = row();
  const undoButton = button('UNDO', FABRIC_ACTION.undo, () => { const l = bodyPaint()?.undo() ?? -1; if (l >= 0) { templates[l] = null; sync(); refreshTargets(); touched(); } });
  const redoButton = button('REDO', FABRIC_ACTION.redo, () => { const l = bodyPaint()?.redo() ?? -1; if (l >= 0) { sync(); refreshTargets(); touched(); } });
  edits.append(
    button('MIRROR L ↔ R', FABRIC_ACTION.mirror, () => { const p = bodyPaint(), map = regionMap(), i = layer(); if (p && map && i >= 0) { p.checkpoint(i); p.mirror(i, map.mirror); sync(); draw(); touched(); } }),
    undoButton, redoButton,
    twoTap('CLEAR LAYER', 'CLEAR? TAP AGAIN', FABRIC_ACTION.clear, () => { const p = bodyPaint(), i = layer(); if (p && i >= 0) { p.checkpoint(i); p.clear(i); templates[i] = null; sync(); refreshTargets(); touched(); } }),
  );
  // body regions: tap one to paint it whole with the BRUSH, or clear it with the ERASER (Joshua, 2026-10-20)
  const sides = row();
  const sideButtons = new Map<RegionSide, HTMLButtonElement>([
    ['both', button('BOTH SIDES', FABRIC_ACTION.side('both'), () => { side = 'both'; draw(); })],
    ['L', button('HER LEFT', FABRIC_ACTION.side('L'), () => { side = 'L'; draw(); })],
    ['R', button('HER RIGHT', FABRIC_ACTION.side('R'), () => { side = 'R'; draw(); })],
  ]);
  sides.append(...sideButtons.values());
  const regions = row();
  for (const g of REGION_GROUPS) regions.append(button(g.name, FABRIC_ACTION.region(g.id), () => {
    const p = bodyPaint(), map = regionMap(), i = layer();
    if (!p || !map || i < 0) return;
    const erase = tool === 'erase';
    p.checkpoint(i);
    p.fillRegions(i, map.region, groupRegions(g, side), erase);
    templates[i] = null;
    if (!erase) ensurePaintFabric(); else sync();
    refreshTargets(); touched();
  }));
  const showRegions = button('SHOW REGIONS', FABRIC_ACTION.showRegions, () => { showingRegions = !showingRegions; overlay(); draw(); });
  const regionsBox = el('details', 'border-top:1px solid #ffffff18;padding-top:4px');
  const regionsHead = el('summary', 'cursor:pointer;font-size:11px;opacity:.8;padding:4px 0'); regionsHead.textContent = 'REGIONS · tap to fill or clear a whole region';
  const regionsShow = row(); regionsShow.append(showRegions);
  regionsBox.append(regionsHead, sides, regions, regionsShow);
  paintBox.append(heading('TOOL'), tools, brush.wrap, edits, regionsBox);

  // ---- SAVE (the room's)
  const saveBox = el('div', 'display:flex;flex-direction:column;gap:8px');

  // ---- DETAIL, shared with the BODY tab
  const detailViews: { draw(): void }[] = [];
  const detailFold = el('details', 'border-top:1px solid #ffffff18;padding-top:4px');
  const detailHead = el('summary', 'cursor:pointer;font-size:11px;opacity:.8;padding:4px 0'); detailHead.textContent = 'BREAST & NAVEL DETAIL THROUGH CLOTHES';

  const status = el('div', 'font-size:11px;line-height:1.4;overflow-wrap:anywhere;opacity:.85');
  status.dataset.field = FABRIC_FIELD.status;
  status.setAttribute('aria-live', 'polite');

  content.append(pieceRow, spaces, showRow, designBox, paintBox, saveBox, detailFold, status);
  panel.append(summary, content);
  for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'wheel']) panel.addEventListener(ev, (e) => e.stopPropagation());
  panel.addEventListener('toggle', () => { updateView(); draw(); });

  // ------------------------------------------------------------ the detail controls (one setting, many views)
  function detailControl(): HTMLElement {
    const box = el('div', 'display:flex;flex-direction:column;gap:6px');
    const info = el('div', 'font-size:10px;opacity:.7;line-height:1.35');
    info.dataset.field = FABRIC_FIELD.detailInfo;
    const one = (which: 'nipple' | 'navel', title: string, field: string) => {
      const s = slider(field, { min: 0, max: 1, step: 0.05 }, (v) => setDetailValue(which, v));
      const reset = button('RESET TO AUTO', FABRIC_ACTION.detailAuto(which), () => setDetailValue(which, null));
      reset.style.minHeight = '30px'; reset.style.padding = '3px 8px'; reset.style.fontSize = '10px';
      const head = el('div', 'display:flex;justify-content:space-between;align-items:center;gap:6px');
      head.append(s.label, reset);
      const wrap = el('div', 'display:flex;flex-direction:column;gap:2px'); wrap.append(head, s.input);
      return { wrap, draw() {
        const manual = override[which];
        const auto = autoDetail(which);
        const value = manual ?? auto?.keep ?? null;
        s.label.textContent = `${title} · ${manual !== null ? 'MANUAL' : 'AUTO'} ${value === null ? '—' : `${Math.round(value * 100)}%`}`;
        s.input.value = String(value ?? 0.5);
        reset.style.display = manual !== null ? '' : 'none';
      } };
    };
    const nip = one('nipple', 'BREAST DETAIL', FABRIC_FIELD.nippleKeep), nav = one('navel', 'NAVEL DETAIL', FABRIC_FIELD.navelKeep);
    box.append(nip.wrap, nav.wrap, info);
    detailViews.push({ draw() {
      nip.draw(); nav.draw();
      const parts = (['nipple', 'navel'] as const).map((w) => {
        const a = autoDetail(w), word = w === 'nipple' ? 'Breast' : 'Navel';
        if (override[w] !== null) return `${word}: your value, on every piece over it.`;
        return a ? `${word}: AUTO from the ${a.piece.toLowerCase()} (${a.material}).` : `${word}: AUTO; nothing painted over it now.`;
      });
      info.textContent = `${parts.join(' ')} Bare skin is never changed.`;
    } });
    for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'wheel']) box.addEventListener(ev, (e) => e.stopPropagation());
    return box;
  }
  function setDetailValue(which: 'nipple' | 'navel', value: number | null): void {
    override = { ...override, [which]: value === null ? null : Math.max(0, Math.min(1, value)) };
    sync(); drawDetail(); touched();
  }
  const drawDetail = () => { for (const v of detailViews) v.draw(); };
  detailFold.append(detailHead, detailControl());

  /** A layer's own detail: its mode, its fabric's family and its template's construction. */
  const resolved = (i: number): ResolvedDetail => resolveDetail(details[i], paintChoices[i].fabric?.family ?? null, templates[i] ? COVERAGE_TEMPLATES.find((t) => t.id === templates[i]!.id)?.construction : undefined);
  /** What a layer keeps: the outfit's MANUAL values where set, else the layer's own. */
  const keepOf = (i: number): DetailKeep => { const own = resolved(i).keep; return { nipple: override.nipple ?? own.nipple, navel: override.navel ?? own.navel }; };
  /** AUTO's value for a detail: of the pieces shown over it, the one that hides most, as the shader decides. */
  function autoDetail(which: 'nipple' | 'navel'): { keep: number; piece: string; material: string } | null {
    const p = paint;
    if (!p) return null;
    const at = (which === 'navel' ? [p.navelVertex] : p.nippleVertices).filter((v) => v >= 0);
    if (!at.length) return null;
    let best: { keep: number; piece: string; material: string } | null = null, most = -1;
    for (let i = 0; i < PAINT_LAYER_COUNT; i++) {
      if (!p.has(i) || !paintChoices[i].fabric || !layerShown(i)) continue;
      const c = Math.max(...at.map((v) => Math.min(1, p.coverAt(v, [i]) * 1.4)));
      if (c < 0.2) continue;
      const r = resolved(i), keep = r.keep[which], hide = c * (1 - keep);
      if (hide > most) { most = hide; best = { keep, piece: titleOf(i), material: r.material?.name.toLowerCase() ?? (details[i].mode === 'off' ? 'detail off on it' : 'set on it') }; }
    }
    return best;
  }

  // ------------------------------------------------------------ state
  const current = (): FabricChoice => (target.kind === 'layer' ? paintChoices[target.index] : garmentChoices.get(target.name) ?? DEFAULT_CHOICE);
  function set(change: Partial<FabricChoice>): void {
    const next = { ...current(), ...change };
    if (target.kind === 'layer') paintChoices[target.index] = next; else garmentChoices.set(target.name, next);
    draw(); void apply(); touched();
  }
  let notify = false;
  /** Tell the room, once per burst of changes. */
  function touched(): void {
    if (notify || !hooks.changed) return;
    notify = true;
    queueMicrotask(() => { notify = false; if (!disposed) hooks.changed?.(); });
  }
  function setSpace(next: EditorSpace): void {
    // painting is on a paint layer: from a garment, BODY PAINT takes the first painted layer, or an empty one
    if (next === 'paint' && target.kind !== 'layer') {
      const first = pieces().find((p) => p.target.kind === 'layer');
      if (first) target = first.target;
    }
    space = next; updateView(); draw(); void apply();
  }
  const editing = () => panel.open && active;
  /** Whether paint layer `i` is drawn now. Hidden only while the editor shows it hidden; its paint is kept. */
  function layerShown(i: number): boolean {
    if (!editing()) return true;
    if (space === 'paint') return paintView === 'all' || (paintView === 'layer' && layer() === i);
    if (space === 'design' && isolated) return layer() === i;
    return true;
  }
  function garmentView(): 'all' | 'none' | string {
    if (!editing()) return 'all';
    if (space === 'paint') return 'none';
    if (space === 'design' && isolated) return target.kind === 'garment' ? target.name : 'none';
    return 'all';
  }
  let shownGarments: 'all' | 'none' | string = 'all';
  function updateView(): void {
    const next = editing() && space === 'paint' && target.kind === 'layer';
    if (next !== painting) { painting = next; if (!next) strokeEnd(); overlay(); }
    const g = garmentView();
    if (g !== shownGarments) { shownGarments = g; hooks.garmentsShown(g); } else sync();
  }
  /** A fill or a first stroke on a layer with no fabric chosen paints in its first swatch, so it shows. */
  function ensurePaintFabric(): void {
    const i = layer();
    if (i < 0) return;
    if (!paintChoices[i].fabric) { paintChoices[i] = { ...paintChoices[i], fabric: { family: 'jersey', colour: 0 } }; void apply(); }
    else sync();
  }
  function applyTemplate(id: string, params: CoverageParams): void {
    const p = bodyPaint(), map = regionMap(), i = layer();
    if (!p || !map || i < 0) return;
    p.checkpoint(i);
    // a shirt keeps the length chosen for shirts
    const withLength = params.length !== null ? withDial(params, 'length', shirtLength) : params;
    templates[i] = { id, params: withLength };
    p.setLayer(i, coverage(map, withLength));
    ensurePaintFabric(); refreshTargets(); touched();
  }
  function moveDial(dial: (typeof COVERAGE_DIALS)[number]['id'], value: number): void {
    const i = layer(), t = i >= 0 ? templates[i] : null, p = bodyPaint(), map = regionMap();
    if (!t || !p || !map) return;
    if (dial === 'length') shirtLength = value;
    templates[i] = { id: t.id, params: withDial(t.params, dial, value) };
    p.setLayer(i, coverage(map, templates[i]!.params));
    sync(); draw(); touched();
  }

  let regionCache: { mesh: THREE.Mesh; map: BodyMap | null } | null = null;
  function regionMap(): BodyMap | null {
    const body = hooks.body();
    if (!body) return null;
    if (regionCache?.mesh !== body) regionCache = { mesh: body, map: hooks.regions() };
    return regionCache.map;
  }
  /** The SHOW REGIONS tint: on only while painting with it switched on. */
  function overlay(): void {
    const p = bodyPaint();
    if (!p) return;
    const on = painting && showingRegions && !!regionMap();
    if (on) p.showRegions(regionMap()!.region, BODY_REGIONS.map((r) => r.tint));
    const material = Array.isArray(p.mesh.material) ? p.mesh.material[0] : p.mesh.material;
    setRegionOverlay(p.mesh, material, on, { layers: PAINT_LAYER_COUNT, rest: hooks.rest(p.mesh) });
  }
  function bodyPaint(): BodyPaint | null {
    const body = hooks.body();
    if (!body) return null;
    if (paint?.mesh !== body) paint = new BodyPaint(body);
    return paint;
  }
  const garmentName = () => (target.kind === 'garment' ? target.name : '');
  const wornTrim = () => !!hooks.worn().find((w) => w.name === garmentName())?.trim;

  // ------------------------------------------------------------ pieces
  function kindOf(i: number): Piece['kind'] | null {
    const t = templates[i];
    if (t) return pieceKind(t.id) ?? 'paint';
    return paint && paint.has(i) ? 'paint' : null;
  }
  function titleOf(i: number): string { const k = kindOf(i); return k ? KIND_TITLE[k] : `LAYER ${i + 1}`; }
  function fabricName(c: FabricChoice): string { return c.fabric ? `${fabricFamily(c.fabric.family).name} ${colourName(c.fabric.family, c.fabric.colour).toLowerCase()}` : ''; }
  function pieces(): Piece[] {
    const out: Piece[] = [];
    for (let i = 0; i < PAINT_LAYER_COUNT; i++) {
      const k = kindOf(i);
      if (!k) continue;
      const t = templates[i], name = t ? COVERAGE_TEMPLATES.find((x) => x.id === t.id)?.name ?? t.id : 'Hand painted';
      out.push({ id: `layer:${i}`, kind: k, title: KIND_TITLE[k], name, target: { kind: 'layer', index: i } });
    }
    for (const w of hooks.worn()) out.push({ id: `garment:${w.name}`, kind: garmentKind(w.name), title: KIND_TITLE[garmentKind(w.name)], name: w.label, target: { kind: 'garment', name: w.name } });
    out.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
    // an empty layer to start a new piece in (the lowest free one)
    for (let i = 0; i < PAINT_LAYER_COUNT; i++) if (!kindOf(i)) { out.push({ id: 'new', kind: 'new', title: KIND_TITLE.new, name: `paint layer ${i + 1} of ${PAINT_LAYER_COUNT}`, target: { kind: 'layer', index: i } }); break; }
    return out;
  }
  const idOf = (t: Target) => (t.kind === 'layer' ? (kindOf(t.index) ? `layer:${t.index}` : 'new') : `garment:${t.name}`);
  function select(id: string): void {
    const p = pieces().find((x) => x.id === id);
    if (!p) return;
    target = p.target;
    if (target.kind === 'garment' && space === 'paint') space = 'design';
    updateView(); draw();
  }
  /** Rebuild the SELECT row from what she wears; a selection that no longer exists moves to the first piece. */
  function refreshTargets(): void {
    const list = pieces();
    const gone = target.kind === 'garment' && !hooks.worn().some((w) => w.name === garmentName());
    // an empty layer stays selected only as the NEW PIECE being started
    const emptied = target.kind === 'layer' && !kindOf(target.index) && list.find((x) => x.id === 'new')?.target.kind === 'layer' && (list.find((x) => x.id === 'new')!.target as { index: number }).index !== target.index;
    if (gone || emptied) target = list[0]?.target ?? { kind: 'layer', index: 0 };
    pieceButtons.clear();
    pieceRow.replaceChildren(...list.map((p) => {
      const b = el('button', 'flex:none;display:flex;flex-direction:column;align-items:flex-start;gap:1px;min-height:44px;max-width:160px;padding:5px 10px;border-radius:9px;border:1px solid #ffffff30;background:#151b23;color:#e8e2d8;text-align:left');
      b.type = 'button'; b.dataset.action = FABRIC_ACTION.piece(p.id);
      const t = el('span', 'font:800 12px system-ui;letter-spacing:.06em'); t.textContent = p.title;
      const n = el('span', 'font:500 10px system-ui;opacity:.8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:140px'); n.textContent = p.name;
      b.append(t, n);
      b.addEventListener('click', (e) => { e.stopPropagation(); select(p.id); });
      pieceButtons.set(p.id, b);
      return b;
    }));
    updateView(); draw();
  }

  // ------------------------------------------------------------ the editor's own look
  function draw(): void {
    const c = current(), fam = c.fabric?.family ?? null, tp = trimPick(c), onLayer = target.kind === 'layer', i = layer();
    const selectedId = idOf(target);
    for (const [id, b] of pieceButtons) {
      const on = id === selectedId;
      b.style.background = on ? '#3a2c10' : '#151b23'; b.style.borderColor = on ? GOLD : '#ffffff30'; b.setAttribute('aria-pressed', String(on));
    }
    for (const [s, b] of spaceButtons) press(b, s === space);
    designBox.style.display = space === 'design' ? 'flex' : 'none';
    paintBox.style.display = space === 'paint' ? 'flex' : 'none';
    saveBox.style.display = space === 'save' ? 'flex' : 'none';
    if (space === 'save' && !saveBox.childElementCount) {
      const section = hooks.saveSection?.() ?? null;
      if (section) saveBox.append(section); else saveBox.append(heading('Saving outfits is not available here.'));
    }
    detailFold.style.display = space === 'save' ? 'none' : '';
    showRow.style.display = space === 'save' ? 'none' : 'flex';
    isolateButton.style.display = space === 'design' ? '' : 'none';
    press(isolateButton, isolated);
    isolateButton.textContent = isolated ? 'SHOW ALL' : `ISOLATE ${selectedId === 'new' ? 'PIECE' : onLayer ? titleOf(i) : 'GARMENT'}`;
    for (const [v, b] of viewButtons) { b.style.display = space === 'paint' ? '' : 'none'; press(b, v === paintView); }
    // STYLE: a paint layer's template, grouped as the library groups them
    styleBox.style.display = onLayer ? 'flex' : 'none';
    if (onLayer) {
      const tpl = templates[i];
      styleSelect.value = tpl?.id ?? '';
      styleSelect.options[0].text = kindOf(i) ? 'Hand painted (choose a style to replace it)' : 'Choose a style…';
      const used = tpl ? dialsFor(tpl.params) : [];
      dialBox.style.display = tpl ? 'flex' : 'none';
      for (const [id, d] of dials) {
        d.wrap.style.display = used.includes(id) ? 'flex' : 'none';
        if (tpl) { const v = dialValue(tpl.params, id); d.input.value = String(v); d.label.textContent = `${COVERAGE_DIALS.find((x) => x.id === id)!.name} · ${v.toFixed(2)}`; }
      }
    }
    removeRow.style.display = onLayer && kindOf(i) ? 'flex' : 'none';
    const fabricShown = !onLayer || !!kindOf(i);
    fabricHeading.style.display = families.style.display = fabricShown ? '' : 'none';
    families.style.display = fabricShown ? 'flex' : 'none';
    colours.style.display = fabricShown ? 'grid' : 'none';
    familyButtons.get('original')!.textContent = onLayer ? 'NONE' : 'ORIGINAL';
    for (const [id, b] of familyButtons) press(b, (id === 'original' && !fam) || id === fam);
    const show = (pick: FabricPick | null, family: FabricFamilyId | null, buttons: HTMLButtonElement[]) => buttons.forEach((b, k) => {
      b.style.background = SWATCH_HEX[family ?? 'jersey'][k];
      b.style.opacity = family ? '1' : '.45';
      b.style.borderColor = pick && pick.colour === k && family ? GOLD : 'transparent';
      b.setAttribute('aria-label', colourName(family ?? 'jersey', k));
      b.setAttribute('aria-pressed', String(!!pick && pick.colour === k));
    });
    show(c.fabric, fam, colourButtons);
    // trim: a garment with a separate edging only. The recovered shirts' edging is baked into their texture and
    // follows the shirt (Joshua: don't risk their approved geometry for it)
    const isShirt = /^shirt/.test(garmentName());
    trimBox.style.display = !onLayer && fam && (wornTrim() || isShirt) ? 'flex' : 'none';
    matchRow.style.display = wornTrim() ? '' : 'none';
    trimOwn.style.display = wornTrim() && !c.match ? 'flex' : 'none';
    trimNote.textContent = isShirt && !wornTrim() ? "This shirt's edging is part of its own texture, so it takes the shirt's fabric." : '';
    press(match, c.match);
    for (const [id, b] of trimFamilyButtons) press(b, tp?.family === id);
    show(tp, tp?.family ?? null, trimColourButtons);
    const op = opacityOf(c);
    opacity.wrap.style.display = stitch.wrap.style.display = fam && fabricShown ? 'flex' : 'none';
    opacity.label.textContent = `${onLayer ? 'COVER' : 'OPACITY'} · ${Math.round(op * 100)}%`; opacity.input.value = String(op);
    stitch.label.textContent = `STITCH · ${c.stitch.toFixed(2)}×`; stitch.input.value = String(c.stitch);
    // BODY PAINT
    for (const [t, b] of toolButtons) press(b, t === tool);
    for (const [k, b] of sideButtons) press(b, k === side);
    undoButton.disabled = !paint?.canUndo; redoButton.disabled = !paint?.canRedo;
    undoButton.style.opacity = paint?.canUndo ? '1' : '.4'; redoButton.style.opacity = paint?.canRedo ? '1' : '.4';
    press(showRegions, showingRegions);
    brush.label.textContent = `BRUSH · ${brushCm.toFixed(1)} cm`; brush.input.value = String(brushCm);
    brush.wrap.style.display = tool === 'orbit' || tool === 'region' ? 'none' : 'flex';
    // the summary names what is being edited, so a folded drawer still says it
    const piece = pieces().find((p) => p.id === selectedId);
    const name = fabricName(c);
    summary.textContent = `EDIT OUTFIT · ${piece ? `${piece.title}${piece.kind === 'new' ? '' : ` · ${piece.name}`}` : '—'}${name && piece?.kind !== 'new' ? ` · ${name}` : ''}`;
    const layerWord = i >= 0 ? titleOf(i).toLowerCase() : 'paint';
    status.textContent = space === 'paint'
      ? `${paintView === 'layer' ? `Only the ${layerWord} layer shows; her other clothes come back when you leave BODY PAINT.` : paintView === 'all' ? 'Every paint layer shows; modelled garments stay hidden while you paint.' : 'Her body is clear: you paint the selected layer without seeing it.'} ${tool === 'orbit' ? 'Drag to turn her.' : tool === 'region' ? 'Tap her to fill the region you touch.' : `Drag on her to ${tool === 'brush' ? 'paint' : 'erase'}; two fingers turn and zoom.`}`
      : space === 'save' ? ''
        : selectedId === 'new' ? 'Choose a style for the new piece, or switch to BODY PAINT to paint it by hand.'
          : onLayer ? `${piece?.title ?? 'This piece'} in ${name || 'no fabric yet'}.` : fam ? `${piece?.name ?? 'This garment'} in ${name}.` : `${piece?.name ?? 'This garment'} wears its own material.`;
    drawDetail();
  }

  // ------------------------------------------------------------ swatches
  const swatchKey = (pick: FabricPick, which: 'plain' | 'trim') => `${which === 'plain' ? fabricFamily(pick.family).plain : fabricFamily(pick.family).trim}#${pick.colour}`;
  /** A swatch as a tiling texture, cut from its atlas once, at the atlas's own resolution and proportions. */
  async function swatchTexture(pick: FabricPick, which: 'plain' | 'trim'): Promise<THREE.Texture | null> {
    const fam = fabricFamily(pick.family), path = which === 'plain' ? fam.plain : fam.trim;
    const layout: FabricLayout = which === 'plain' ? 'grid' : 'strips';
    const key = swatchKey(pick, which), have = swatches.get(key);
    if (have) return have;
    if (!atlases.has(path)) atlases.set(path, hooks.loadImage(path));
    const image = await atlases.get(path)!;
    if (!image || disposed) { atlases.delete(path); return null; }
    const r = swatchRect(layout, pick.colour, image.width);
    const canvas = document.createElement('canvas'), ctx2d = canvas.getContext('2d');
    if (!ctx2d) return null;
    if (layout === 'grid') {
      canvas.width = r.w; canvas.height = r.h;
      ctx2d.drawImage(image, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    } else {
      // a strip's knit band, stacked (mirrored every other time) into a square: the same gauge both ways, unstretched
      const sideLength = Math.round(image.width / 4);
      canvas.width = canvas.height = sideLength;
      for (let y = 0, k = 0; y < sideLength; y += r.h, k++) {
        ctx2d.save();
        if (k % 2) { ctx2d.translate(0, 2 * y + r.h); ctx2d.scale(1, -1); }
        ctx2d.drawImage(image, r.x, r.y, sideLength, r.h, 0, y, sideLength, r.h);
        ctx2d.restore();
      }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.MirroredRepeatWrapping;
    texture.anisotropy = 8;
    swatches.set(key, texture);
    return texture;
  }

  let applying = 0;
  async function apply(): Promise<void> {
    const id = ++applying;
    const wanted: [FabricPick, 'plain' | 'trim'][] = [];
    for (const c of garmentChoices.values()) { if (c.fabric) wanted.push([c.fabric, 'plain']); const t = trimPick(c); if (t) wanted.push([t, 'trim']); }
    for (const c of paintChoices) if (c.fabric) wanted.push([c.fabric, 'plain']);
    const pending = wanted.filter(([p, w]) => !swatches.has(swatchKey(p, w)));
    if (pending.length) {
      status.textContent = 'Loading fabric…';
      const got = await Promise.all(pending.map(([p, w]) => swatchTexture(p, w)));
      if (disposed || id !== applying) return;
      draw();
      if (got.some((t) => !t)) status.textContent = 'That fabric could not be downloaded. Check your connection, then pick it again.';
    }
    sync();
  }

  const cached = (pick: FabricPick | null, which: 'plain' | 'trim') => (pick ? swatches.get(swatchKey(pick, which)) ?? null : null);
  function layerFor(mesh: THREE.Mesh, c: FabricChoice, pick: FabricPick | null, which: 'plain' | 'trim') {
    const texture = cached(pick, which);
    if (!pick || !texture) return null;
    const fam = fabricFamily(pick.family);
    return { texture, tile: tileUnits(fam, c.stitch, hooks.unitsPerCm(mesh)), opacity: opacityOf(c), roughness: fam.roughness };
  }

  function sync(): void {
    if (disposed) return;
    const body = hooks.body();
    for (const mesh of hooks.meshes()) {
      if (mesh === body) continue;
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        const isTrim = material.name.endsWith('Trim'), owner = isTrim ? material.name.slice(0, -4) : material.name;
        const c = garmentChoices.get(owner);
        const l = c ? layerFor(mesh, c, isTrim ? trimPick(c) : c.fabric, isTrim ? 'trim' : 'plain') : null;
        setFabricLayer(mesh, material, 0, l, { layers: 1, masked: false, rest: hooks.rest(mesh) });
      }
    }
    if (body) {
      const material = Array.isArray(body.material) ? body.material[0] : body.material;
      const p = paint?.mesh === body ? paint : null;
      // the softening needs her detail stored and her map; it acts only where paint is, so an unpainted body is untouched
      if (p && [0, 1, 2].some((i) => p.has(i))) {
        const map = regionMap();
        if (map) { ensureRest(body.geometry as THREE.BufferGeometry, hooks.rest(body)); p.prepareDetail(map, hooks.navelHint()); }
        setDetailKeep(body, material, details.map((_, i) => keepOf(i)), { layers: PAINT_LAYER_COUNT, rest: hooks.rest(body) });
      }
      // the navel's own flattening morph follows the paint over it (the scene re-shapes her when it changes)
      const flatten = navelFlatten();
      if (Math.abs(flatten - lastFlatten) > 1e-3) { lastFlatten = flatten; queueMicrotask(() => hooks.reshape()); }
      for (let i = 0; i < PAINT_LAYER_COUNT; i++) {
        const c = paintChoices[i];
        // a layer shows once something is painted on it and while the editor is not hiding it: an empty or hidden
        // layer leaves her approved skin shader alone (its paint is kept)
        const l = p && p.has(i) && layerShown(i) ? layerFor(body, c, c.fabric, 'plain') : null;
        setFabricLayer(body, material, i, l, { layers: PAINT_LAYER_COUNT, masked: true, rest: hooks.rest(body) });
      }
      dressBridge(body, p);
      dressDrape(body, p);
    }
  }
  /**
   * The drape goes on with the topmost painted shirt (a template with a LENGTH) that is shown, in its fabric, down to
   * its hem; with none, or while she is being painted, it comes off.
   */
  let drape: TunicDrape | null = null;
  let shirtLength = DEFAULT_SHIRT_LENGTH;
  /** The paint layer the drape is the shirt of, and the drape fit its "hangs clear" values were last laid from. */
  let drapeLayer = -1, hangLaid = '';
  const bodyMaterial = (body: THREE.Mesh) => (Array.isArray(body.material) ? body.material[0] : body.material);
  /** The drape's "hangs clear of her" values onto her skin, whenever it has been fitted again (or taken off). */
  function layHang(): void {
    const body = hooks.body();
    if (!body) return;
    const key = drape && drapeLayer >= 0 ? `${drapeLayer}:${drape.hangVersion}` : '';
    if (key === hangLaid) return;
    hangLaid = key;
    setHang(body, bodyMaterial(body), key ? drapeLayer : -1, key ? drape!.hang : null, { layers: PAINT_LAYER_COUNT, rest: hooks.rest(body) });
  }
  function unhang(): void { drapeLayer = -1; }
  function dressDrape(body: THREE.Mesh, p: BodyPaint | null): void {
    let top = -1;
    for (let i = PAINT_LAYER_COUNT - 1; i >= 0 && top < 0; i--) {
      if (p && p.has(i) && layerShown(i) && paintChoices[i].fabric && templates[i] && templates[i]!.params.length !== null) top = i;
    }
    const map = regionMap();
    if (top < 0 || painting || !p || !map || !(body as THREE.SkinnedMesh).isSkinnedMesh) { drape?.wear(null); unhang(); layHang(); return; }
    drapeLayer = top;
    if (drape && drape.mesh.parent !== body) { drape.dispose(); drape = null; }
    if (!drape) drape = new TunicDrape(body as THREE.SkinnedMesh, map, shirtHem(map, 1));
    const c = paintChoices[top];
    drape.wear(shirtHem(map, templates[top]!.params.length!));
    setFabricLayer(drape.mesh, drape.mesh.material as THREE.Material, 0, layerFor(body, c, c.fabric, 'plain'), { layers: 1, masked: false, rest: null });
    drape.feathered();
  }
  function setShirtLength(length: number): void {
    shirtLength = Math.max(0, Math.min(1, length));
    const p = bodyPaint(), map = regionMap();
    if (!p || !map) return;
    for (let i = 0; i < PAINT_LAYER_COUNT; i++) {
      const t = templates[i];
      if (!t || t.params.length === null || t.params.length === shirtLength) continue;
      templates[i] = { id: t.id, params: withDial(t.params, 'length', shirtLength) };
      p.setLayer(i, coverage(map, templates[i]!.params));
    }
    sync(); draw(); touched();
  }
  /**
   * The cleavage bridge goes on with the topmost painted top (a template with an upper part) that is shown, in its
   * fabric, cut to its neckline; with no painted top shown, or while she is being painted, it comes off.
   */
  let bridge: CleavageBridge | null = null;
  /** The paint layer the bridge is the top of, and the bridge's "behind it" values last laid on her skin. */
  let bridgeLayer = -1, underLaid = '';
  /** The skin behind the bridge loses its top's paint (only the outside layer is the shirt), whenever that changes. */
  function layUnder(): void {
    const body = hooks.body();
    if (!body) return;
    const key = bridge && bridgeLayer >= 0 && bridge.mesh.visible ? `${bridgeLayer}:${bridge.underVersion}` : '';
    if (key === underLaid) return;
    underLaid = key;
    setUnder(body, bodyMaterial(body), key ? bridgeLayer : -1, key ? bridge!.under : null, { layers: PAINT_LAYER_COUNT, rest: hooks.rest(body) });
  }
  function dressBridge(body: THREE.Mesh, p: BodyPaint | null): void {
    let top = -1;
    for (let i = PAINT_LAYER_COUNT - 1; i >= 0 && top < 0; i--) {
      if (p && p.has(i) && layerShown(i) && paintChoices[i].fabric && templates[i] && templates[i]!.params.hemFront !== null && templates[i]!.params.topFront === null) top = i;
    }
    if (top < 0 || painting || !p || !(body as THREE.SkinnedMesh).isSkinnedMesh) { bridge?.wear(null); bridgeLayer = -1; layUnder(); return; }
    const map = regionMap();
    if (!map) return;
    if (bridge && bridge.mesh.parent !== body) { bridge.dispose(); bridge = null; }
    if (!bridge) bridge = new CleavageBridge(body as THREE.SkinnedMesh, map);
    bridgeLayer = top;
    const c = paintChoices[top], under = top;
    bridge.wear({ params: templates[top]!.params, covered: (v) => p.coverAt(v, [under]) });
    setFabricLayer(bridge.mesh, bridge.mesh.material as THREE.Material, 0, layerFor(body, c, c.fabric, 'plain'), { layers: 1, masked: false, rest: null });
    bridge.feathered();
  }

  // ------------------------------------------------------------ strokes
  function strokeStart(x: number, y: number): void {
    const p = bodyPaint(), i = layer();
    if (!painting || tool === 'orbit' || !p || i < 0) return;
    // her rest surface (fabricRest) is what a brush radius is measured on; make sure it exists before the first dab
    ensureRest(p.mesh.geometry as THREE.BufferGeometry, hooks.rest(p.mesh));
    const v = hooks.view();
    p.beginStroke(v.camera, v.width, v.height);
    if (tool === 'region') {
      // a tap selects the region under the finger (the one nearest the camera), on that side only
      const map = regionMap(), hit = p.pick(x, y);
      p.endStroke();
      const group = map && hit >= 0 ? groupOf(map.region[hit]) : null;
      if (!map || !group) return;
      const touchedRegion = BODY_REGIONS[map.region[hit] - 1];
      p.checkpoint(i);
      p.fillRegions(i, map.region, side === 'both' && touchedRegion.side ? [map.region[hit]] : groupRegions(group, side), false);
      templates[i] = null;
      ensurePaintFabric(); refreshTargets(); touched();
      return;
    }
    p.checkpoint(i);
    templates[i] = null;
    stroking = true;
    strokeMove(x, y);
  }
  function strokeMove(x: number, y: number): void {
    const p = paint, i = layer();
    if (!stroking || !p || i < 0) return;
    const units = hooks.unitsPerCm(p.mesh);
    if (p.stroke(x, y, i, brushCm * units, tool === 'erase') && tool === 'brush') ensurePaintFabric();
    else sync();
  }
  let lastFlatten = 0;
  function navelFlatten(): number {
    const p = paint, body = hooks.body();
    if (!p || p.mesh !== body || p.navelVertex < 0) return 0;
    // the layer over her navel that hides most of it decides, scaled by how much of that layer is there
    let most = 0;
    for (let i = 0; i < PAINT_LAYER_COUNT; i++) {
      if (!paintChoices[i].fabric || !p.has(i) || !layerShown(i)) continue;
      most = Math.max(most, (1 - keepOf(i).navel) * Math.min(1, p.coverAt(p.navelVertex, [i]) * 1.4));
    }
    return most;
  }
  function strokeEnd(): void { if (stroking) { stroking = false; paint?.endStroke(); refreshTargets(); touched(); } }

  // which layers the last painted outfit filled (so taking it off clears them and nothing painted by hand)
  const outfitLayers: boolean[] = Array.from({ length: PAINT_LAYER_COUNT }, () => false);
  function wearOutfit(layers: readonly { readonly template: string; readonly fabric: FabricPick }[] | null): boolean {
    const p = bodyPaint(), map = regionMap();
    if (!p || !map) return false;
    for (let i = 0; i < PAINT_LAYER_COUNT; i++) {
      const want = layers?.[i], t = want ? COVERAGE_TEMPLATES.find((x) => x.id === want.template) : undefined;
      if (want && t) {
        const params = t.params.length !== null ? withDial(t.params, 'length', shirtLength) : t.params;
        templates[i] = { id: t.id, params };
        p.setLayer(i, coverage(map, params));
        paintChoices[i] = { ...DEFAULT_CHOICE, fabric: want.fabric };
        details[i] = DEFAULT_LAYER_DETAIL;
        outfitLayers[i] = true;
      } else if (outfitLayers[i]) {
        p.clear(i); templates[i] = null; paintChoices[i] = DEFAULT_CHOICE; details[i] = DEFAULT_LAYER_DETAIL;
        outfitLayers[i] = false;
      }
    }
    override = AUTO_DETAIL;
    void apply(); refreshTargets(); selectFirst();
    return true;
  }
  /** After an outfit goes on, its first piece (her top, usually) is the one selected. */
  function selectFirst(): void { const first = pieces()[0]; if (first && space !== 'paint') { target = first.target; updateView(); draw(); } }
  function clearAll(): boolean {
    const p = bodyPaint();
    if (!p) return false;
    for (let i = 0; i < PAINT_LAYER_COUNT; i++) { p.clear(i); templates[i] = null; paintChoices[i] = DEFAULT_CHOICE; details[i] = DEFAULT_LAYER_DETAIL; outfitLayers[i] = false; }
    garmentChoices.clear();
    override = AUTO_DETAIL;
    void apply(); refreshTargets(); selectFirst(); touched();
    return true;
  }

  function clothes(): Omit<SavedClothes, 'outfit'> {
    const p = paint;
    return {
      shirtLength,
      garments: Object.fromEntries(garmentChoices),
      layers: paintChoices.map((choice, i) => {
        if (!p || !p.has(i)) return null;
        const t = templates[i];
        return { choice, detail: details[i], template: t ? { id: t.id, params: t.params } : null, mask: t ? '' : bytesToBase64(packLayer(p.weights, i)) };
      }),
      detail: override,
    };
  }
  function putOnClothes(saved: Omit<SavedClothes, 'outfit'>): boolean {
    const p = bodyPaint(), map = regionMap();
    if (!p || !map) return false;
    shirtLength = Math.max(0, Math.min(1, saved.shirtLength));
    for (let i = 0; i < PAINT_LAYER_COUNT; i++) {
      const l = saved.layers[i] ?? null;
      if (l) {
        templates[i] = l.template ? { id: l.template.id, params: l.template.params } : null;
        p.setLayer(i, l.template ? coverage(map, l.template.params) : Float32Array.from(base64ToBytes(l.mask), (b) => b / 255));
        paintChoices[i] = l.choice;
        details[i] = l.detail;
        outfitLayers[i] = true;
      } else if (p.has(i) || templates[i]) {
        p.clear(i); templates[i] = null; paintChoices[i] = DEFAULT_CHOICE; details[i] = DEFAULT_LAYER_DETAIL; outfitLayers[i] = false;
      }
    }
    garmentChoices.clear();
    for (const [k, v] of Object.entries(saved.garments)) garmentChoices.set(k, v);
    override = saved.detail ?? AUTO_DETAIL;
    void apply(); refreshTargets(); selectFirst();
    return true;
  }

  function exportConfig(): OutfitConfig {
    const d = hooks.describe();
    return {
      version: 1, base: d.base, outfit: d.outfit,
      garments: Object.fromEntries(garmentChoices),
      paint: paintChoices.map((choice, i) => ({ choice, detail: details[i], template: templates[i], mask: paint && paint.has(i) ? bytesToBase64(packLayer(paint.weights, i)) : '' })),
    };
  }

  refreshTargets();
  return {
    element: panel,
    sync,
    refreshTargets,
    get painting() { return painting; },
    tool: () => (painting && tool !== 'orbit' ? tool : null),
    strokeStart, strokeMove, strokeEnd,
    exportConfig,
    wearOutfit,
    clearAll,
    navelFlatten,
    frame() { bridge?.update(); drape?.update(); layHang(); layUnder(); },
    reshaped() { bridge?.reshape(); drape?.reshape(); },
    setShirtLength,
    shirtLength: () => shirtLength,
    clothes,
    putOnClothes,
    pieces,
    selected: () => idOf(target),
    select,
    setSpace,
    space: () => space,
    setActive(on) { if (on === active) return; active = on; updateView(); draw(); },
    detail: () => override,
    setDetail: setDetailValue,
    detailControl() { const e = detailControl(); drawDetail(); return e; },
    wearsShirt: () => !!paint && templates.some((t, i) => !!t && t.params.length !== null && paint!.has(i) && !!paintChoices[i].fabric),
    dispose() {
      bridge?.dispose(); bridge = null;
      drape?.dispose(); drape = null;
      garmentChoices.clear();
      paintChoices.fill(DEFAULT_CHOICE);
      if (paint) for (let i = 0; i < PAINT_LAYER_COUNT; i++) paint.clear(i);
      try { sync(); } catch { /* her meshes may already be released */ }
      disposed = true;
      for (const t of swatches.values()) t.dispose();
      swatches.clear();
    },
  };
}
