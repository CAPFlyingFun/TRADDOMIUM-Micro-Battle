/**
 * THE FABRIC EDITOR (Joshua, 2026-10-20), in the CLOTHES tab, in two modes that never touch each other:
 *
 * GARMENT FABRIC -- one of the garments she has on (shirt, leggings, bikini) takes a family and colour from his
 * pack, its edging follows (MATCH) or takes its own, and OPACITY and STITCH set how it reads. It stays real clothing
 * over her body; the skin material is not touched. ORIGINAL puts the garment's own material back.
 *
 * BODY PAINT -- "temporarily hide all clothing meshes so the body is fully visible while painting", three layers
 * painted onto her skin (`bodyPaint.ts`): FILL lays a garment's footprint at once, the BRUSH and ERASER add and take
 * away by hand, CLEAR empties the layer. Leaving paint mode (or folding the panel) brings her clothes straight back,
 * with the paint under them.
 *
 * Choices live for the session, as the custom upload's do; `exportConfig` gives them as an `OutfitConfig` for a preset
 * manager to keep. A family's atlas is fetched the first time it is chosen, at full resolution, and each swatch cut
 * from it once.
 */
import * as THREE from 'three';
import type { ShapeFields } from '../view/bodyShapeView';
import {
  DEFAULT_CHOICE, FABRIC_FAMILIES, OPACITY_RANGE, PAINT_LAYER_NAMES, STITCH_RANGE, SWATCH_HEX, bytesToBase64, colourName,
  fabricFamily, opacityOf, swatchRect, tileUnits, trimPick, type FabricChoice, type FabricFamilyId, type FabricLayout, type FabricMode,
  type FabricPick, type OutfitConfig, type PaintTool,
} from './fabricLibrary';
import { ensureRest, setDetailKeep, setFabricLayer, setRegionOverlay } from './fabricMaterial';
import { KEEP_PRESETS, type DetailKeep } from './bodyDetail';
import { DEFAULT_LAYER_DETAIL, DETAIL_MATERIALS, resolveDetail, type DetailMode, type LayerDetail } from './detailMaterials';
import { BRUSH_RANGE_CM, BodyPaint, PAINT_LAYER_COUNT, packLayer } from './bodyPaint';
import { BODY_REGIONS, REGION_GROUPS, groupOf, groupRegions, type BodyMap, type RegionSide } from './bodyRegions';
import { COVERAGE_DIALS, COVERAGE_TEMPLATES, TEMPLATE_GROUPS, coverage, dialValue, dialsFor, withDial, type CoverageParams } from './paintTemplates';

export const FABRIC_PANEL_ROLE = 'sarahlab-fabric';
export const FABRIC_ACTION = Object.freeze({
  mode: (m: FabricMode) => `sarahlab:fabric:mode:${m}`,
  family: (id: FabricFamilyId | 'original') => `sarahlab:fabric:family:${id}`,
  colour: (i: number) => `sarahlab:fabric:colour:${i}`,
  trimFamily: (id: FabricFamilyId) => `sarahlab:fabric:trim-family:${id}`,
  trimColour: (i: number) => `sarahlab:fabric:trim-colour:${i}`,
  match: 'sarahlab:fabric:match',
  tool: (t: PaintTool) => `sarahlab:fabric:tool:${t}`,
  fill: (id: string) => `sarahlab:fabric:fill:${id}`,
  region: (id: string) => `sarahlab:fabric:region:${id}`,
  side: (s: RegionSide) => `sarahlab:fabric:side:${s}`,
  showRegions: 'sarahlab:fabric:show-regions',
  template: (id: string) => `sarahlab:fabric:template:${id}`,
  mirror: 'sarahlab:fabric:mirror',
  undo: 'sarahlab:fabric:undo',
  detailPreset: (p: 'thin' | 'medium' | 'thick') => `sarahlab:fabric:detail:${p}`,
  detailMode: (m: DetailMode) => `sarahlab:fabric:detail-mode:${m}`,
  redo: 'sarahlab:fabric:redo',
  clear: 'sarahlab:fabric:clear',
});
export const FABRIC_FIELD = Object.freeze({ nippleKeep: 'fabric-nipple-keep', navelKeep: 'fabric-navel-keep', detailMaterial: 'fabric-detail-material', detailInfo: 'fabric-detail-info', garment: 'fabric-garment', layer: 'fabric-layer', stitch: 'fabric-stitch', opacity: 'fabric-opacity', brush: 'fabric-brush', status: 'fabric-status' });

export interface WornGarment { readonly name: string; readonly label: string; readonly trim: boolean }

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
  /** The room hides every garment while true. */
  painting(on: boolean): void;
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
}

export interface FabricPanel {
  readonly element: HTMLElement;
  /** Re-lay every choice on whatever materials she has now (a new shirt, a model switch); cheap when nothing changed. */
  sync(): void;
  /** Rebuild the garment list from what she wears. */
  refreshTargets(): void;
  readonly painting: boolean;
  /** The brush or eraser while painting, else null (a drag then orbits as usual). */
  tool(): 'brush' | 'erase' | 'region' | null;
  strokeStart(x: number, y: number): void;
  strokeMove(x: number, y: number): void;
  strokeEnd(): void;
  exportConfig(): OutfitConfig;
  /**
   * How far toward flat her navel's own `navelFlat` morph should go under paint: (1 - NAVEL DETAIL) times how much
   * paint covers her navel, so a bare or bikini navel is never touched. 0 with nothing painted there.
   */
  navelFlatten(): number;
  dispose(): void;
}

const BTN = 'min-height:40px;padding:6px 9px;border:1px solid #ffffff30;border-radius:8px;background:#151b23;color:#e8e2d8;font:600 11px system-ui';
const ON = '#806020', OFF = '#151b23';

export function fabricPanel(hooks: FabricHooks): FabricPanel {
  const garmentChoices = new Map<string, FabricChoice>();
  const paintChoices: FabricChoice[] = Array.from({ length: PAINT_LAYER_COUNT }, () => DEFAULT_CHOICE);
  const atlases = new Map<string, Promise<(CanvasImageSource & { width: number; height: number }) | null>>();
  const swatches = new Map<string, THREE.Texture>();
  let mode: FabricMode = 'garment', garment = '', layer = 0, tool: PaintTool = 'brush', brushCm: number = BRUSH_RANGE_CM.initial;
  let painting = false, disposed = false, stroking = false, side: RegionSide = 'both', showingRegions = false;
  let paint: BodyPaint | null = null;

  // ------------------------------------------------------------ the panel
  const panel = document.createElement('details');
  panel.dataset.role = FABRIC_PANEL_ROLE;
  panel.style.cssText = 'border-top:1px solid #ffffff25;padding-top:8px;touch-action:pan-y';
  const summary = document.createElement('summary');
  summary.style.cssText = 'cursor:pointer;padding:8px 0;font-size:12px';
  const content = document.createElement('div');
  content.style.cssText = 'display:flex;flex-direction:column;gap:8px;padding:6px 0';
  const heading = (text: string) => { const h = document.createElement('div'); h.textContent = text; h.style.cssText = 'font-size:11px;opacity:.75;margin-top:2px'; return h; };
  const row = () => { const r = document.createElement('div'); r.style.cssText = 'display:flex;gap:5px;flex-wrap:wrap'; return r; };
  const grid = () => { const g = document.createElement('div'); g.style.cssText = 'display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:5px'; return g; };
  const button = (label: string, action: string, onClick: () => void) => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.dataset.action = action; b.style.cssText = BTN;
    b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); }); return b;
  };
  const press = (b: HTMLButtonElement, on: boolean) => { b.setAttribute('aria-pressed', String(on)); b.style.background = on ? ON : OFF; };
  const selectBox = (field: string, label: string) => {
    const s = document.createElement('select'); s.dataset.field = field; s.setAttribute('aria-label', label);
    s.style.cssText = 'min-height:36px;font:12px system-ui'; return s;
  };
  const slider = (field: string, range: { min: number; max: number; step: number }, onInput: (v: number) => void) => {
    const label = document.createElement('label'); label.style.fontSize = '12px';
    const input = document.createElement('input'); input.type = 'range'; input.dataset.field = field;
    input.min = String(range.min); input.max = String(range.max); input.step = String(range.step);
    input.style.cssText = 'width:100%;accent-color:#d4a853';
    input.addEventListener('input', () => onInput(Number(input.value)));
    const wrap = document.createElement('div'); wrap.style.cssText = 'display:flex;flex-direction:column;gap:4px'; wrap.append(label, input);
    return { wrap, label, input };
  };
  const swatch = (action: string, onClick: () => void) => {
    const b = document.createElement('button'); b.type = 'button'; b.dataset.action = action;
    b.style.cssText = 'aspect-ratio:1;min-height:32px;border-radius:7px;border:2px solid transparent;padding:0';
    b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); }); return b;
  };

  const modes = row();
  const modeButtons = new Map<FabricMode, HTMLButtonElement>([
    ['garment', button('GARMENT FABRIC', FABRIC_ACTION.mode('garment'), () => setMode('garment'))],
    ['paint', button('BODY PAINT', FABRIC_ACTION.mode('paint'), () => setMode('paint'))],
  ]);
  modes.append(...modeButtons.values());

  // garment mode
  const garmentSelect = selectBox(FABRIC_FIELD.garment, 'Garment');
  garmentSelect.addEventListener('change', () => { garment = garmentSelect.value; draw(); });
  // paint mode
  const paintBox = document.createElement('div'); paintBox.style.cssText = 'display:flex;flex-direction:column;gap:8px';
  const layerSelect = selectBox(FABRIC_FIELD.layer, 'Paint layer');
  PAINT_LAYER_NAMES.forEach((n, i) => layerSelect.add(new Option(n, String(i))));
  layerSelect.addEventListener('change', () => { layer = Number(layerSelect.value); draw(); });
  const tools = row();
  const toolButtons = new Map<PaintTool, HTMLButtonElement>([
    ['brush', button('BRUSH', FABRIC_ACTION.tool('brush'), () => { tool = 'brush'; draw(); })],
    ['erase', button('ERASER', FABRIC_ACTION.tool('erase'), () => { tool = 'erase'; draw(); })],
    ['region', button('TAP A REGION', FABRIC_ACTION.tool('region'), () => { tool = 'region'; draw(); })],
    ['orbit', button('TURN HER', FABRIC_ACTION.tool('orbit'), () => { tool = 'orbit'; draw(); })],
  ]);
  tools.append(...toolButtons.values());
  const brush = slider(FABRIC_FIELD.brush, BRUSH_RANGE_CM, (v) => { brushCm = v; draw(); });
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
    const p = bodyPaint(), map = regionMap();
    if (!p || !map) return;
    const erase = tool === 'erase';
    p.checkpoint(layer);
    p.fillRegions(layer, map.region, groupRegions(g, side), erase);
    if (!erase) ensurePaintFabric(); else sync();
    draw();
  }));
  const showRegions = button('SHOW REGIONS', FABRIC_ACTION.showRegions, () => { showingRegions = !showingRegions; overlay(); draw(); });
  const showRow = row(); showRow.append(showRegions);
  // clothing coverage templates (paintTemplates.ts): a familiar garment's coverage, its edges then movable by dial
  const templateBox = document.createElement('div'); templateBox.style.cssText = 'display:flex;flex-direction:column;gap:6px';
  const templateButtons = new Map<string, HTMLButtonElement>();
  for (const groupName of TEMPLATE_GROUPS) {
    const r = row();
    for (const t of COVERAGE_TEMPLATES.filter((x) => x.group === groupName)) {
      const b = button(t.name.toUpperCase(), FABRIC_ACTION.template(t.id), () => applyTemplate(t.id, t.params));
      templateButtons.set(t.id, b); r.append(b);
    }
    templateBox.append(heading(groupName.toUpperCase()), r);
  }
  const dials = new Map(COVERAGE_DIALS.map((d) => [d.id, slider(`fabric-dial-${d.id}`, { min: d.min, max: d.max, step: 0.01 }, (v) => moveDial(d.id, v))]));
  const dialBox = document.createElement('div'); dialBox.style.cssText = 'display:flex;flex-direction:column;gap:6px';
  for (const d of dials.values()) dialBox.append(d.wrap);
  const edits = row();
  const undoButton = button('UNDO', FABRIC_ACTION.undo, () => { const l = bodyPaint()?.undo() ?? -1; if (l >= 0) { templates[l] = null; sync(); draw(); } });
  const redoButton = button('REDO', FABRIC_ACTION.redo, () => { const l = bodyPaint()?.redo() ?? -1; if (l >= 0) { sync(); draw(); } });
  edits.append(
    button('MIRROR L ↔ R', FABRIC_ACTION.mirror, () => { const p = bodyPaint(), map = regionMap(); if (p && map) { p.checkpoint(layer); p.mirror(layer, map.mirror); sync(); draw(); } }),
    undoButton, redoButton,
    button('RESET LAYER', FABRIC_ACTION.clear, () => { const p = bodyPaint(); if (p) { p.checkpoint(layer); p.clear(layer); templates[layer] = null; sync(); draw(); } }),
  );
  // detail through paint (Joshua, 2026-10-20): how much of her nipples and navel reads through painted fabric, per
  // layer. AUTO takes it from what the layer is made of (detailMaterials.ts); the presets and sliders OVERRIDE it
  const details: LayerDetail[] = Array.from({ length: PAINT_LAYER_COUNT }, () => DEFAULT_LAYER_DETAIL);
  const setDetail = (change: Partial<LayerDetail>) => { details[layer] = { ...details[layer], ...change }; sync(); draw(); };
  const detailModes = row();
  const detailModeButtons = new Map((['auto', 'override', 'off'] as const).map((m) => [m, button(m.toUpperCase(), FABRIC_ACTION.detailMode(m), () => {
    // OVERRIDE starts from what AUTO was showing, so switching does not jump
    setDetail(m === 'override' && details[layer].mode !== 'override' ? { mode: m, override: keepOf(layer) } : { mode: m });
  })]));
  detailModes.append(...detailModeButtons.values());
  const detailMaterialSelect = selectBox(FABRIC_FIELD.detailMaterial, 'Detail material');
  detailMaterialSelect.add(new Option('From the fabric and garment', ''));
  for (const m of DETAIL_MATERIALS) detailMaterialSelect.add(new Option(m.name, m.id));
  detailMaterialSelect.addEventListener('change', () => setDetail({ mode: 'auto', material: detailMaterialSelect.value || null }));
  const detailInfo = document.createElement('div'); detailInfo.dataset.field = FABRIC_FIELD.detailInfo; detailInfo.style.cssText = 'font-size:11px;opacity:.75;line-height:1.4';
  const presets = row();
  const presetButtons = new Map((['thin', 'medium', 'thick'] as const).map((k) => [k, button(`${k.toUpperCase()} FABRIC`, FABRIC_ACTION.detailPreset(k), () => setDetail({ mode: 'override', override: KEEP_PRESETS[k] }))]));
  presets.append(...presetButtons.values());
  const nippleKeep = slider(FABRIC_FIELD.nippleKeep, { min: 0, max: 1, step: 0.05 }, (v) => setDetail({ mode: 'override', override: { ...keepOf(layer), nipple: v } }));
  const navelKeep = slider(FABRIC_FIELD.navelKeep, { min: 0, max: 1, step: 0.05 }, (v) => setDetail({ mode: 'override', override: { ...keepOf(layer), navel: v } }));
  const detailBox = document.createElement('div'); detailBox.style.cssText = 'display:flex;flex-direction:column;gap:6px';
  detailBox.append(heading('DETAIL THROUGH PAINT · this layer · painted areas only'), detailModes, detailMaterialSelect, detailInfo, presets, nippleKeep.wrap, navelKeep.wrap);
  /** A layer's detail as it stands: its mode, its fabric's family and its template's construction. */
  const resolved = (i: number) => resolveDetail(details[i], paintChoices[i].fabric?.family ?? null, templates[i] ? COVERAGE_TEMPLATES.find((t) => t.id === templates[i]!.id)?.construction : undefined);
  const keepOf = (i: number): DetailKeep => resolved(i).keep;
  paintBox.append(layerSelect, heading('TOOL'), tools, brush.wrap, edits, detailBox,
    heading('BODY REGIONS · tap to paint, or clear with the eraser'), sides, regions, showRow,
    heading('CLOTHING TEMPLATES · then move the edges'), templateBox, dialBox);

  // the fabric itself, both modes
  const families = row(), colours = grid();
  const familyButtons = new Map<string, HTMLButtonElement>();
  familyButtons.set('original', button('ORIGINAL', FABRIC_ACTION.family('original'), () => set({ fabric: null })));
  for (const f of FABRIC_FAMILIES) familyButtons.set(f.id, button(f.name.toUpperCase(), FABRIC_ACTION.family(f.id), () => set({ fabric: { family: f.id, colour: current().fabric?.colour ?? 0 } })));
  families.append(...familyButtons.values());
  const colourButtons = Array.from({ length: 16 }, (_, i) => swatch(FABRIC_ACTION.colour(i), () => set({ fabric: { family: current().fabric?.family ?? 'jersey', colour: i } })));
  colours.append(...colourButtons);
  const trimBox = document.createElement('div'); trimBox.style.cssText = 'display:flex;flex-direction:column;gap:8px';
  const trimOwn = document.createElement('div'); trimOwn.style.cssText = 'display:flex;flex-direction:column;gap:8px';
  const match = button('MATCH', FABRIC_ACTION.match, () => { const c = current(); set({ match: !c.match, trim: c.trim ?? c.fabric }); });
  const trimFamilies = row(), trimColours = grid();
  const trimFamilyButtons = new Map<FabricFamilyId, HTMLButtonElement>();
  for (const f of FABRIC_FAMILIES) trimFamilyButtons.set(f.id, button(f.name.toUpperCase(), FABRIC_ACTION.trimFamily(f.id), () => set({ trim: { family: f.id, colour: current().trim?.colour ?? 0 } })));
  trimFamilies.append(...trimFamilyButtons.values());
  const trimColourButtons = Array.from({ length: 16 }, (_, i) => swatch(FABRIC_ACTION.trimColour(i), () => { const c = current(); set({ trim: { family: c.trim?.family ?? c.fabric?.family ?? 'jersey', colour: i } }); }));
  trimColours.append(...trimColourButtons);
  const matchRow = row(); matchRow.append(match);
  trimOwn.append(trimFamilies, trimColours);
  const trimNote = document.createElement('div'); trimNote.style.cssText = 'font-size:11px;opacity:.7;line-height:1.4';
  trimBox.append(heading('TRIM'), matchRow, trimOwn, trimNote);
  const opacity = slider(FABRIC_FIELD.opacity, OPACITY_RANGE, (v) => set({ opacity: v }));
  const stitch = slider(FABRIC_FIELD.stitch, STITCH_RANGE, (v) => set({ stitch: v }));
  const status = document.createElement('div');
  status.dataset.field = FABRIC_FIELD.status;
  status.setAttribute('aria-live', 'polite');
  status.style.cssText = 'font-size:11px;line-height:1.4;overflow-wrap:anywhere';

  content.append(modes, garmentSelect, paintBox, heading('FABRIC'), families, colours, trimBox, opacity.wrap, stitch.wrap, status);
  panel.append(summary, content);
  for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'wheel']) panel.addEventListener(ev, (e) => e.stopPropagation());
  panel.addEventListener('toggle', updatePainting);

  // ------------------------------------------------------------ state
  const current = (): FabricChoice => (mode === 'paint' ? paintChoices[layer] : garmentChoices.get(garment) ?? DEFAULT_CHOICE);
  function set(change: Partial<FabricChoice>): void {
    const next = { ...current(), ...change };
    if (mode === 'paint') paintChoices[layer] = next; else if (garment) garmentChoices.set(garment, next);
    draw(); void apply();
  }
  function setMode(next: FabricMode): void { mode = next; draw(); updatePainting(); void apply(); }
  function updatePainting(): void {
    const next = panel.open && mode === 'paint';
    if (next === painting) return;
    painting = next;
    if (!next) strokeEnd();
    overlay();
    hooks.painting(next);
  }
  /** A fill or a first stroke on a layer with no fabric chosen paints in its first swatch, so it shows. */
  function ensurePaintFabric(): void {
    if (!paintChoices[layer].fabric) { paintChoices[layer] = { ...paintChoices[layer], fabric: { family: 'athletic', colour: 0 } }; void apply(); }
    else sync();
  }
  /** Each layer's template, if its coverage came from one (dials move it until the layer is painted by hand). */
  const templates: ({ id: string; params: CoverageParams } | null)[] = Array.from({ length: PAINT_LAYER_COUNT }, () => null);
  function applyTemplate(id: string, params: CoverageParams): void {
    const p = bodyPaint(), map = regionMap();
    if (!p || !map) return;
    p.checkpoint(layer);
    templates[layer] = { id, params };
    p.setLayer(layer, coverage(map, params));
    ensurePaintFabric(); draw();
  }
  function moveDial(dial: (typeof COVERAGE_DIALS)[number]['id'], value: number): void {
    const t = templates[layer], p = bodyPaint(), map = regionMap();
    if (!t || !p || !map) return;
    templates[layer] = { id: t.id, params: withDial(t.params, dial, value) };
    p.setLayer(layer, coverage(map, templates[layer]!.params));
    sync(); draw();
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
  const wornTrim = () => !!hooks.worn().find((w) => w.name === garment)?.trim;

  function refreshTargets(): void {
    const worn = hooks.worn();
    garmentSelect.replaceChildren(...worn.map((w) => new Option(w.label, w.name)));
    if (!worn.some((w) => w.name === garment)) garment = worn[0]?.name ?? '';
    garmentSelect.value = garment;
    draw();
  }

  /** The editor's own look. */
  function draw(): void {
    const c = current(), fam = c.fabric?.family ?? null, tp = trimPick(c), paintMode = mode === 'paint';
    for (const [m, b] of modeButtons) press(b, m === mode);
    garmentSelect.style.display = paintMode ? 'none' : '';
    paintBox.style.display = paintMode ? 'flex' : 'none';
    for (const [t, b] of toolButtons) press(b, t === tool);
    for (const [k, b] of sideButtons) press(b, k === side);
    const d = details[layer], r = resolved(layer), keep = r.keep;
    for (const [m, b] of detailModeButtons) press(b, m === d.mode);
    for (const [k, b] of presetButtons) press(b, d.mode === 'override' && KEEP_PRESETS[k].nipple === keep.nipple && KEEP_PRESETS[k].navel === keep.navel);
    detailMaterialSelect.value = d.material ?? '';
    detailMaterialSelect.style.display = d.mode === 'auto' ? '' : 'none';
    detailInfo.textContent = d.mode === 'auto' ? `AUTO from ${r.material!.name.toLowerCase()} (thickness ${r.material!.thickness}, structure ${r.material!.structure}). Move a slider to override.`
      : d.mode === 'override' ? 'OVERRIDE: your values. AUTO returns to the fabric and garment.' : 'OFF: her detail is unchanged under this layer.';
    nippleKeep.label.textContent = `BREAST DETAIL THROUGH PAINT · ${Math.round(keep.nipple * 100)}%`; nippleKeep.input.value = String(keep.nipple);
    navelKeep.label.textContent = `NAVEL DETAIL THROUGH PAINT · ${Math.round(keep.navel * 100)}%`; navelKeep.input.value = String(keep.navel);
    const tpl = templates[layer], used = tpl ? dialsFor(tpl.params) : [];
    for (const [id, b] of templateButtons) press(b, tpl?.id === id);
    dialBox.style.display = tpl ? 'flex' : 'none';
    for (const [id, d] of dials) {
      d.wrap.style.display = used.includes(id) ? 'flex' : 'none';
      if (tpl) { const v = dialValue(tpl.params, id); d.input.value = String(v); d.label.textContent = `${COVERAGE_DIALS.find((x) => x.id === id)!.name} · ${v.toFixed(2)}`; }
    }
    undoButton.disabled = !paint?.canUndo; redoButton.disabled = !paint?.canRedo;
    undoButton.style.opacity = paint?.canUndo ? '1' : '.4'; redoButton.style.opacity = paint?.canRedo ? '1' : '.4';
    press(showRegions, showingRegions);
    brush.label.textContent = `BRUSH · ${brushCm.toFixed(1)} cm`; brush.input.value = String(brushCm);
    brush.wrap.style.display = tool === 'orbit' ? 'none' : 'flex';
    layerSelect.value = String(layer);
    familyButtons.get('original')!.textContent = paintMode ? 'NONE' : 'ORIGINAL';
    for (const [id, b] of familyButtons) press(b, (id === 'original' && !fam) || id === fam);
    const show = (pick: FabricPick | null, family: FabricFamilyId | null, buttons: HTMLButtonElement[]) => buttons.forEach((b, i) => {
      b.style.background = SWATCH_HEX[family ?? 'jersey'][i];
      b.style.opacity = family ? '1' : '.45';
      b.style.borderColor = pick && pick.colour === i && family ? '#d4a853' : 'transparent';
      b.setAttribute('aria-label', colourName(family ?? 'jersey', i));
      b.setAttribute('aria-pressed', String(!!pick && pick.colour === i));
    });
    show(c.fabric, fam, colourButtons);
    // trim: a garment with a separate edging only. The recovered shirts' edging is baked into their texture and
    // follows the shirt; separating it waits for the new tee (Joshua: don't risk their approved geometry for it)
    const isShirt = /^shirt/.test(garment);
    trimBox.style.display = !paintMode && fam && (wornTrim() || isShirt) ? 'flex' : 'none';
    matchRow.style.display = trimOwn.style.display = wornTrim() ? '' : 'none';
    if (!c.match) trimOwn.style.display = wornTrim() ? 'flex' : 'none'; else trimOwn.style.display = 'none';
    trimNote.textContent = isShirt && !wornTrim() ? "This shirt's edging is part of its own texture, so it takes the shirt's fabric. Separate trim comes with the new tee." : '';
    press(match, c.match);
    for (const [id, b] of trimFamilyButtons) press(b, tp?.family === id);
    show(tp, tp?.family ?? null, trimColourButtons);
    const op = opacityOf(c);
    opacity.wrap.style.display = stitch.wrap.style.display = fam ? 'flex' : 'none';
    opacity.label.textContent = `${paintMode ? 'COVER' : 'OPACITY'} · ${Math.round(op * 100)}%`; opacity.input.value = String(op);
    stitch.label.textContent = `STITCH · ${c.stitch.toFixed(2)}×`; stitch.input.value = String(c.stitch);
    const name = fam ? `${fabricFamily(fam).name} ${colourName(fam, c.fabric!.colour).toLowerCase()}` : paintMode ? 'none' : 'original';
    summary.textContent = `FABRIC · ${paintMode ? `${PAINT_LAYER_NAMES[layer].toLowerCase()} · ${name}` : name}`;
    const label = hooks.worn().find((w) => w.name === garment)?.label ?? 'No garment';
    status.textContent = paintMode
      ? `Her clothes are hidden while you paint. ${tool === 'orbit' ? 'Drag to turn her.' : tool === 'region' ? 'Tap her to fill the region you touch.' : `Drag on her to ${tool === 'brush' ? 'paint' : 'erase'}; two fingers turn and zoom.`}`
      : fam ? `${label} in ${name}.` : `${label} wears its own material.`;
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
      const side = Math.round(image.width / 4);
      canvas.width = canvas.height = side;
      for (let y = 0, k = 0; y < side; y += r.h, k++) {
        ctx2d.save();
        if (k % 2) { ctx2d.translate(0, 2 * y + r.h); ctx2d.scale(1, -1); }
        ctx2d.drawImage(image, r.x, r.y, side, r.h, 0, y, side, r.h);
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
    for (const c of [...garmentChoices.values(), ...paintChoices]) {
      if (c.fabric) wanted.push([c.fabric, 'plain']);
      const t = trimPick(c); if (t && c !== paintChoices[0] && c !== paintChoices[1] && c !== paintChoices[2]) wanted.push([t, 'trim']);
    }
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
        // a layer shows only once something is painted on it: an empty layer leaves her approved skin shader alone
        const l = p && p.has(i) ? layerFor(body, c, c.fabric, 'plain') : null;
        setFabricLayer(body, material, i, l, { layers: PAINT_LAYER_COUNT, masked: true, rest: hooks.rest(body) });
      }
    }
  }

  // ------------------------------------------------------------ strokes
  function strokeStart(x: number, y: number): void {
    const p = bodyPaint();
    if (!painting || tool === 'orbit' || !p) return;
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
      const touched = BODY_REGIONS[map.region[hit] - 1];
      p.checkpoint(layer);
      p.fillRegions(layer, map.region, side === 'both' && touched.side ? [map.region[hit]] : groupRegions(group, side), false);
      ensurePaintFabric(); draw();
      return;
    }
    p.checkpoint(layer);
    templates[layer] = null;
    stroking = true;
    strokeMove(x, y);
  }
  function strokeMove(x: number, y: number): void {
    const p = paint;
    if (!stroking || !p) return;
    const units = hooks.unitsPerCm(p.mesh);
    if (p.stroke(x, y, layer, brushCm * units, tool === 'erase') && tool === 'brush') ensurePaintFabric();
    else sync();
  }
  let lastFlatten = 0;
  function navelFlatten(): number {
    const p = paint, body = hooks.body();
    if (!p || p.mesh !== body || p.navelVertex < 0) return 0;
    // the layer over her navel that hides most of it decides, scaled by how much of that layer is there
    let most = 0;
    for (let i = 0; i < PAINT_LAYER_COUNT; i++) {
      if (!paintChoices[i].fabric || !p.has(i)) continue;
      most = Math.max(most, (1 - keepOf(i).navel) * Math.min(1, p.coverAt(p.navelVertex, [i]) * 1.4));
    }
    return most;
  }
  function strokeEnd(): void { if (stroking) { stroking = false; paint?.endStroke(); draw(); } }

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
    navelFlatten,
    dispose() {
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
