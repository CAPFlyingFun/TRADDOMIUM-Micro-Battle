/**
 * THE NEW TEE'S CONTROLS (Stage 3), in the OUTFIT tab while the new tee is worn: Joshua's approved controls, with his
 * confirmed Stage 3 changes.
 *
 *   (status)       TAILORING THE NEW TEE… while the tee is re-tailored, otherwise nothing
 *   LENGTH & HEM   LENGTH and a chip for each of its stops, FRONT HEM, BACK HEM, HEM CURVE
 *   SLEEVES        SLEEVES and a chip for each of its stops
 *   NECKLINE       NECKLINE (its depth), NECK WIDTH, NECK SHAPE
 *   FIT            BELLY ROOM, BUST FIT, WAIST FIT, HIP FIT
 *   CONSTRUCTION   RAGLAN / SET-IN, GUSSET
 *   TEE DEFAULTS   every control back to the approved tee, in the construction she has on
 *
 * INSTANT controls cut the finished tee as a finger drags (length, the hems, the hem's curve, the sleeves, a neckline
 * deeper than the scoop, belly room); RE-TAILOR controls remake the pattern when the finger lets go (the neckline's
 * width and shape, the fits, the gusset, the construction, a neckline higher than the scoop), and while a finger drags
 * one its line ends "let go to tailor". The panel never decides which kind a control is: a slider reports every move
 * with `final` false and its let-go (its `change` event, or a gesture the browser takes away) with `final` true, a chip
 * or a button reports `final` true, and the room cuts or re-tailors. What it reports is always the room's settings with
 * only that control changed.
 *
 * Every slider is a LINE (a div with `data-field`) and, right after it, its range input, as the room's own `slider()`
 * builds them, so a probe finds one by `[data-field="..."] + input`. The settings are metres (the hems, the neckline,
 * the ease), shares 0..1 (hem curve, neck shape, belly room, gusset) or positions on her stops (length, sleeves); the
 * sliders are millimetres, percent and the positions. A line says what she wears: on her own landmarks once the tee is
 * tailored (`GarmentStops`), as a stop or a percentage before.
 *
 * `refresh()` shows the room's settings, and the room calls it often, so it never moves a slider a finger is on (a
 * pointer down on it, or the focus): that slider's line follows the slider instead. A room that keeps a re-tailor value
 * only once it is let go therefore never pulls the thumb back from under her finger.
 *
 * Laid out for the studio's inspector held upright (about 330-380 px wide): every slider fills the width and nothing is
 * wider, the chip rows wrap, every chip is at least 30 px tall. Colours are the room's `--sl-*` tokens, so it follows
 * LIGHT and DARK. Plain DOM: it reads the garment's constants, never the room or the cloth.
 */
import { HEM_CURVE_RISE } from './garment/cuts';
import { TEE_DEFAULTS } from './garment/draft';
import {
  CONSTRUCTION_DEFAULTS, GARMENT_DEFAULTS, GARMENT_RANGES, LENGTH_STOPS, NECK_DEPTH_CREW, NECK_DEPTH_MAX, SLEEVE_STOPS,
  clampGarmentSettings, nearestStop, stopValue, withConstruction,
  type Construction, type GarmentEase, type GarmentSettings, type GarmentStop, type GarmentStops,
} from './garment/settings';

/** What the panel reads and drives; it never imports the room or the garment. */
export interface GarmentPanelHooks {
  /** The settings as they stand (the panel shows them). */
  readonly settings: () => GarmentSettings;
  /**
   * A control moved: `final` false as a finger drags, true when it lets go or taps a button. The room cuts at once for an
   * instant setting and re-tailors on `final` for the others (`settings.ts` RETAILOR_KEYS).
   */
  readonly change: (next: GarmentSettings, final: boolean) => void;
  /** Her landmarks for the lines and presets (`cuts.ts` garmentStops), null until the tee is tailored. */
  readonly stops: () => GarmentStops | null;
  /** True while the tee is being re-tailored. */
  readonly tailoring: () => boolean;
}

/** `data-field` of each control's line (its input follows it), for a probe. */
export const GARMENT_PANEL_FIELD = Object.freeze({
  length: 'sarahlab-garment-length',
  frontHem: 'sarahlab-garment-front-hem',
  backHem: 'sarahlab-garment-back-hem',
  hemCurve: 'sarahlab-garment-hem-curve',
  sleeve: 'sarahlab-garment-sleeve',
  neckDepth: 'sarahlab-garment-neck-depth',
  neckWidth: 'sarahlab-garment-neck-width',
  neckCurve: 'sarahlab-garment-neck-curve',
  bellyRoom: 'sarahlab-garment-belly-room',
  bust: 'sarahlab-garment-bust',
  waist: 'sarahlab-garment-waist',
  hip: 'sarahlab-garment-hip',
  gusset: 'sarahlab-garment-gusset',
  status: 'sarahlab-garment-status',
});

/** `data-action` of each button, for a probe: `${lengthStop}<stop id>`, `${sleeveStop}<stop id>`, `${construction}<raglan|setIn>`. */
export const GARMENT_PANEL_ACTION = Object.freeze({
  lengthStop: 'sarahlab:garment:length:',
  sleeveStop: 'sarahlab:garment:sleeve:',
  construction: 'sarahlab:garment:construction:',
  defaults: 'sarahlab:garment:defaults',
});

/** The panel's `data-role`. */
export const GARMENT_PANEL_ROLE = 'sarahlab-garment-panel';
/** The status line while the tee is re-tailored. */
export const GARMENT_TAILORING_LINE = 'TAILORING THE NEW TEE…';
/** Ends a re-tailor control's line while a finger drags it. */
export const LET_GO_TO_TAILOR = ' · let go to tailor';
/** Ends NECKLINE's line while it is higher than the scoop (drafted there, so re-tailored) and no finger drags it. */
export const TAILORED_WHEN_LET_GO = ' · tailored when you let go';

// ------------------------------------------------------------------------------------------------ the lines

/** NECKLINE reads "scoop" this close to the approved scoop (`TEE_DEFAULTS.neckDrop`), metres. */
const SCOOP_WITHIN = 0.0025;
/** SLEEVES at these stops reads the name alone: they end at or above her shoulder point, so a length down her arm says nothing. */
const SLEEVE_BY_NAME: ReadonlySet<string> = new Set(['tank', 'cap']);
const FIT_NAMES: Readonly<Record<keyof GarmentEase, string>> = Object.freeze({ bust: 'BUST FIT', waist: 'WAIST FIT', hip: 'HIP FIT' });

/** Whole millimetres as centimetres, without the sign: 40 -> "4", 25 -> "2.5". */
function cm(mm: number): string {
  const a = Math.abs(mm);
  return a % 10 === 0 ? String(a / 10) : (a / 10).toFixed(1);
}

/** The stop exactly at slider position `pos`, or null between stops. */
function stopAt(pos: number, stops: readonly GarmentStop[]): GarmentStop | null {
  const s = nearestStop(pos, stops);
  return Math.abs(s.at - pos) < 1e-6 ? s : null;
}

/** LENGTH at slider position `pos`: the hem at her side seams against her hip once she is measured; a stop or how far along before. */
export function lengthLine(pos: number, stops: GarmentStops | null): string {
  const stop = stopAt(pos, LENGTH_STOPS);
  const h = stops ? stopValue(pos, LENGTH_STOPS, stops.lengthY) : NaN;
  if (!stops || !Number.isFinite(h) || !Number.isFinite(stops.hipY)) return `LENGTH · ${stop ? stop.label : `${Math.round(pos)}%`}`;
  const n = Math.round((stops.hipY - h) * 100);
  return `LENGTH · ${stop ? `${stop.label} · ` : ''}${n > 0 ? `${n} cm under her hip` : n < 0 ? `${-n} cm above her hip` : 'at her hip'}`;
}

/** FRONT HEM or BACK HEM at `m` metres: let down (+) or taken up (-) at the centre. */
export function hemLine(side: 'front' | 'back', m: number): string {
  const name = side === 'front' ? 'FRONT HEM' : 'BACK HEM', mm = Math.round(m * 1000);
  return mm === 0 ? `${name} · as cut` : `${name} · ${cm(mm)} cm ${mm > 0 ? 'longer' : 'shorter'} at the centre`;
}

/** HEM CURVE at `v` (0..1): level, or a shirttail whose sides rise `v` x HEM_CURVE_RISE. */
export function hemCurveLine(v: number): string {
  const mm = Math.round(v * HEM_CURVE_RISE * 1000);
  return mm > 0 ? `HEM CURVE · shirttail · sides up ${cm(mm)} cm` : 'HEM CURVE · level';
}

/**
 * SLEEVES at slider position `pos`: once she is measured, the stop and the sleeve's length from her shoulder point down
 * her arm (a tank and a cap by name), or between stops the length alone; before, the stop or how far along.
 */
export function sleeveLine(pos: number, stops: GarmentStops | null): string {
  const stop = stopAt(pos, SLEEVE_STOPS);
  const l = stops ? stopValue(pos, SLEEVE_STOPS, stops.sleeveLength) : NaN;
  if (!Number.isFinite(l)) return `SLEEVES · ${stop ? stop.label : `${Math.round(pos)}%`}`;
  if (stop) return SLEEVE_BY_NAME.has(stop.id) || l <= 0 ? `SLEEVES · ${stop.label}` : `SLEEVES · ${stop.label} · ${Math.round(l * 100)} cm`;
  return l > 0 ? `SLEEVES · ${Math.round(l * 100)} cm` : 'SLEEVES · ends above her shoulder';
}

/**
 * NECKLINE at `m` metres under her front neck point: a crew, the approved scoop, or how deep. Higher than the scoop it
 * is drafted rather than cut, so it is re-tailored when let go: the line says so, and "let go to tailor" while a finger
 * drags it there (`dragging`).
 */
export function neckDepthLine(m: number, dragging = false): string {
  const scoop = TEE_DEFAULTS.neckDrop, mm = Math.round(m * 1000);
  const what = m <= NECK_DEPTH_CREW + 1e-6 ? 'crew' : Math.abs(m - scoop) <= SCOOP_WITHIN + 1e-9 ? `scoop · ${cm(mm)} cm` : `${cm(mm)} cm deep`;
  return `NECKLINE · ${what}${m < scoop - 1e-9 ? (dragging ? LET_GO_TO_TAILOR : TAILORED_WHEN_LET_GO) : ''}`;
}

/** NECK WIDTH at `m` metres; null is the construction's own (CONSTRUCTION_DEFAULTS). */
export function neckWidthLine(m: number | null, construction: Construction): string {
  return `NECK WIDTH · ${cm(Math.round((m ?? CONSTRUCTION_DEFAULTS[construction].neckWidth) * 1000))} cm`;
}

/** NECK SHAPE at `v`: 0 a U, 1 a V. */
export function neckShapeLine(v: number): string {
  const p = Math.round(v * 100);
  return p >= 100 ? 'NECK SHAPE · V' : p > 0 ? `NECK SHAPE · ${p}% toward V` : 'NECK SHAPE · U';
}

/** BELLY ROOM at `v`: the front cut for her belly at this share of 100%. */
export function bellyRoomLine(v: number): string {
  const p = Math.round(v * 100);
  return p > 0 ? `BELLY ROOM · cut for her belly at ${p}%` : 'BELLY ROOM · none';
}

/** BUST, WAIST or HIP FIT at `m` metres of ease round her. */
export function fitLine(at: keyof GarmentEase, m: number): string {
  const mm = Math.round(m * 1000);
  return mm === 0 ? `${FIT_NAMES[at]} · no ease` : `${FIT_NAMES[at]} · ${mm > 0 ? '+' : '−'}${cm(mm)} cm ease`;
}

/** GUSSET at `v`: 0 none .. 1 the largest. */
export function gussetLine(v: number): string {
  const p = Math.round(v * 100);
  return p > 0 ? `GUSSET · ${p}%` : 'GUSSET · none';
}

// ------------------------------------------------------------------------------------------------ the sliders

type SliderKey = Exclude<keyof typeof GARMENT_PANEL_FIELD, 'status'>;

/** How a setting sits on its slider. */
interface Scale { readonly toSlider: (x: number) => number; readonly fromSlider: (v: number) => number }
/** Metres, on a slider in millimetres. */
const MM: Scale = { toSlider: (m) => m * 1000, fromSlider: (mm) => mm / 1000 };
/** A share 0..1, on a slider in percent. */
const PERCENT: Scale = { toSlider: (u) => u * 100, fromSlider: (p) => p / 100 };
/** A position on her stops, as it is. */
const POSITION: Scale = { toSlider: (p) => p, fromSlider: (p) => p };

interface SliderSpec {
  /** Its name for a screen reader (a sighted person reads its line). */
  readonly name: string;
  readonly scale: Scale;
  /** The setting's own range (GARMENT_RANGES); the slider's is this through `scale`. */
  readonly range: readonly [number, number];
  /** In slider units. */
  readonly step: number;
  /** The setting as she wears it, in its own units. */
  readonly get: (s: GarmentSettings, stops: GarmentStops | null) => number;
  /** The settings with this control at `x` (the panel clamps them). */
  readonly set: (s: GarmentSettings, x: number) => GarmentSettings;
  /** Its line at `x`; `dragging` while a finger drags it. */
  readonly line: (x: number, s: GarmentSettings, stops: GarmentStops | null, dragging: boolean) => string;
  /** A chip for each of these stops under it, `data-action` `${action}<stop id>`. */
  readonly presets?: { readonly stops: readonly GarmentStop[]; readonly action: string };
}

const R = GARMENT_RANGES;
/** A re-tailor control's line ends so while a finger drags it. */
const retailor = (dragging: boolean): string => (dragging ? LET_GO_TO_TAILOR : '');
const fit = (at: keyof GarmentEase, name: string): SliderSpec => ({
  name, scale: MM, range: R.ease, step: 5, get: (s) => s.ease[at], set: (s, x) => ({ ...s, ease: { ...s.ease, [at]: x } }),
  line: (x, _s, _stops, dragging) => fitLine(at, x) + retailor(dragging),
});

/** The deepest the neckline reaches, metres: her breasts' lower crease once she is measured (`cuts.ts` cuts no deeper), the record's limit before. */
function deepestNeck(stops: GarmentStops | null): number {
  const d = stops?.neckDeepest;
  return typeof d === 'number' && Number.isFinite(d) ? Math.min(NECK_DEPTH_MAX, Math.max(NECK_DEPTH_CREW, d)) : NECK_DEPTH_MAX;
}

const SLIDERS: Readonly<Record<SliderKey, SliderSpec>> = Object.freeze({
  length: {
    name: 'Length', scale: POSITION, range: R.length, step: 1, get: (s) => s.length, set: (s, x) => ({ ...s, length: x }),
    line: (x, _s, stops) => lengthLine(x, stops), presets: { stops: LENGTH_STOPS, action: GARMENT_PANEL_ACTION.lengthStop },
  },
  frontHem: { name: 'Front hem', scale: MM, range: R.frontHem, step: 5, get: (s) => s.frontHem, set: (s, x) => ({ ...s, frontHem: x }), line: (x) => hemLine('front', x) },
  backHem: { name: 'Back hem', scale: MM, range: R.backHem, step: 5, get: (s) => s.backHem, set: (s, x) => ({ ...s, backHem: x }), line: (x) => hemLine('back', x) },
  hemCurve: { name: 'Hem curve', scale: PERCENT, range: R.hemCurve, step: 1, get: (s) => s.hemCurve, set: (s, x) => ({ ...s, hemCurve: x }), line: (x) => hemCurveLine(x) },
  sleeve: {
    name: 'Sleeve length', scale: POSITION, range: R.sleeve, step: 1, get: (s) => s.sleeve, set: (s, x) => ({ ...s, sleeve: x }),
    line: (x, _s, stops) => sleeveLine(x, stops), presets: { stops: SLEEVE_STOPS, action: GARMENT_PANEL_ACTION.sleeveStop },
  },
  // as she wears it: no deeper than her crease, which is also where its slider ends
  neckDepth: {
    name: 'Neckline depth', scale: MM, range: R.neckDepth, step: 5, get: (s, stops) => Math.min(s.neckDepth, deepestNeck(stops)),
    set: (s, x) => ({ ...s, neckDepth: x }), line: (x, _s, _stops, dragging) => neckDepthLine(x, dragging),
  },
  neckWidth: {
    name: 'Neckline width', scale: MM, range: R.neckWidth, step: 5, get: (s) => s.neckWidth ?? CONSTRUCTION_DEFAULTS[s.construction].neckWidth,
    set: (s, x) => ({ ...s, neckWidth: x }), line: (x, s, _stops, dragging) => neckWidthLine(x, s.construction) + retailor(dragging),
  },
  neckCurve: {
    name: 'Neckline shape', scale: PERCENT, range: R.neckCurve, step: 1, get: (s) => s.neckCurve, set: (s, x) => ({ ...s, neckCurve: x }),
    line: (x, _s, _stops, dragging) => neckShapeLine(x) + retailor(dragging),
  },
  bellyRoom: { name: 'Belly room', scale: PERCENT, range: R.bellyRoom, step: 1, get: (s) => s.bellyRoom, set: (s, x) => ({ ...s, bellyRoom: x }), line: (x) => bellyRoomLine(x) },
  bust: fit('bust', 'Bust fit'),
  waist: fit('waist', 'Waist fit'),
  hip: fit('hip', 'Hip fit'),
  gusset: {
    name: 'Gusset', scale: PERCENT, range: R.gusset, step: 1, get: (s) => s.gusset, set: (s, x) => ({ ...s, gusset: x }),
    line: (x, _s, _stops, dragging) => gussetLine(x) + retailor(dragging),
  },
});

/** The panel's order, under its light headings. */
const GROUPS: readonly { readonly title: string; readonly items: readonly (SliderKey | 'construction')[] }[] = [
  { title: 'LENGTH & HEM', items: ['length', 'frontHem', 'backHem', 'hemCurve'] },
  { title: 'SLEEVES', items: ['sleeve'] },
  { title: 'NECKLINE', items: ['neckDepth', 'neckWidth', 'neckCurve'] },
  { title: 'FIT', items: ['bellyRoom', 'bust', 'waist', 'hip'] },
  { title: 'CONSTRUCTION', items: ['construction', 'gusset'] },
];
const CONSTRUCTIONS: readonly (readonly [Construction, string])[] = [['raglan', 'RAGLAN'], ['setIn', 'SET-IN']];

// ------------------------------------------------------------------------------------------------ the look
// The room's own controls (`SarahLabScene.ts` buildHud: slider(), and btn() at its smaller size) in the theme's tokens,
// held to a narrow column: a range input's own side margins would carry a 100% slider past it.
const BODY_CSS = 'display:flex;flex-direction:column;gap:8px;min-width:0';
const STATUS_CSS = 'padding:6px 9px;border-radius:9px;background:var(--sl-on-soft,#3a2c10);color:var(--sl-ink,#e8e2d8);font:700 11px system-ui,sans-serif;letter-spacing:.08em;overflow-wrap:anywhere';
const GROUP_CSS = 'display:flex;flex-direction:column;gap:2px;min-width:0;padding-top:8px;border-top:1px solid var(--sl-line,#ffffff1f)';
const HEAD_CSS = 'font:700 10px system-ui,sans-serif;letter-spacing:.12em;color:var(--sl-muted,#9aa0a8)';
const LINE_CSS = 'font-size:12px;letter-spacing:.05em;margin-top:4px;overflow-wrap:anywhere';
const INPUT_CSS = 'display:block;box-sizing:border-box;width:100%;margin:2px 0;accent-color:var(--sl-accent,#d4a853);height:28px';
const ROW_CSS = 'display:flex;flex-wrap:wrap;gap:6px;min-width:0;margin:2px 0';
const FOOT_CSS = `${ROW_CSS};padding-top:8px;border-top:1px solid var(--sl-line,#ffffff1f)`;
const CHIP_CSS = 'box-sizing:border-box;min-height:30px;max-width:100%;padding:7px 10px;border-radius:10px;border:1px solid var(--sl-btn-line,#ffffff30);background:var(--sl-btn,#151b23);color:var(--sl-ink,#e8e2d8);font:700 11px system-ui,sans-serif;letter-spacing:.05em;cursor:pointer';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, css: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  e.style.cssText = css;
  return e;
};

/** A chip shows whether it is the one chosen, as the room's own buttons do (its refresh's `lit`). */
function lit(b: HTMLButtonElement, on: boolean): void {
  const v = String(on);
  if (b.getAttribute('aria-pressed') === v) return;
  b.setAttribute('aria-pressed', v);
  b.style.background = on ? 'var(--sl-on,#806020)' : 'var(--sl-btn,#151b23)';
  b.style.borderColor = on ? 'var(--sl-accent,#d4a853)' : 'var(--sl-btn-line,#ffffff30)';
}

/** `v` on a range input's steps, as a browser holds it: the nearest step from `min` (the higher on a tie), never past the last step under `max`. */
function snap(v: number, min: number, max: number, step: number): number {
  if (!Number.isFinite(v)) return min;
  const top = min + Math.max(0, Math.floor((max - min) / step + 1e-9)) * step;
  return Math.min(top, Math.max(min, min + Math.round((v - min) / step) * step));
}

const pointerOf = (e: Event): number | undefined => (e as Partial<PointerEvent>).pointerId;
const stopEvent = (e: Event): void => e.stopPropagation();

interface Slider {
  readonly spec: SliderSpec;
  readonly line: HTMLDivElement;
  readonly input: HTMLInputElement;
  readonly min: number;
  /** Where the slider ends: NECKLINE's moves to her crease once she is measured. */
  max: number;
  readonly chips: readonly { readonly stop: GarmentStop; readonly button: HTMLButtonElement }[];
}

export class GarmentPanel {
  readonly element: HTMLElement;
  private readonly hooks: GarmentPanelHooks;
  private readonly status: HTMLDivElement;
  private readonly sliders = new Map<SliderKey, Slider>();
  private readonly byInput = new Map<HTMLInputElement, Slider>();
  private readonly constructions = new Map<Construction, HTMLButtonElement>();
  /** The sliders a finger is on, each with that finger's pointer id. */
  private readonly held = new Map<HTMLInputElement, number | undefined>();
  /** Sliders moved since they last reported `final`. */
  private readonly moved = new Set<HTMLInputElement>();
  /** The slider whose own event is being reported (the room may refresh from inside `change`). */
  private reporting: HTMLInputElement | null = null;
  private disposed = false;
  /** A finger lifts anywhere: it may have slid off the slider it held. */
  private readonly lifted = (e: Event): void => this.release(pointerOf(e), e.type === 'pointercancel');

  constructor(hooks: GarmentPanelHooks) {
    this.hooks = hooks;
    this.element = document.createElement('div');
    this.element.dataset.tab = 'outfit';
    this.element.dataset.role = GARMENT_PANEL_ROLE;
    // no display of its own: the room shows and hides it
    this.element.style.cssText = 'box-sizing:border-box;min-width:0;max-width:100%';
    const body = el('div', BODY_CSS);

    this.status = el('div', STATUS_CSS);
    this.status.dataset.field = GARMENT_PANEL_FIELD.status;
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');
    this.status.hidden = true;
    this.status.style.display = 'none';
    body.appendChild(this.status);

    for (const g of GROUPS) {
      const group = el('div', GROUP_CSS), head = el('div', HEAD_CSS);
      head.textContent = g.title;
      group.appendChild(head);
      for (const item of g.items) group.append(...(item === 'construction' ? [this.constructionRow()] : this.slider(item)));
      body.appendChild(group);
    }
    const foot = el('div', FOOT_CSS);
    foot.appendChild(this.button('TEE DEFAULTS', GARMENT_PANEL_ACTION.defaults, () => withConstruction(GARMENT_DEFAULTS, this.hooks.settings().construction), false));
    body.appendChild(foot);
    this.element.appendChild(body);

    // the room behind never hears it: no orbit from a drag on it, no shortcut from a key in it
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'wheel', 'keydown']) this.element.addEventListener(type, stopEvent);
    const doc = this.element.ownerDocument;
    doc.addEventListener('pointerup', this.lifted, true);
    doc.addEventListener('pointercancel', this.lifted, true);

    // the approved tee until the room's first refresh: the constructor asks the room nothing
    for (const c of this.sliders.values()) this.show(c, GARMENT_DEFAULTS, null, false);
    this.light(GARMENT_DEFAULTS.construction);
  }

  /** Show the settings, lines and state as they stand now (the room calls it from its own refresh). */
  refresh(): void {
    if (this.disposed) return;
    const s = this.hooks.settings(), stops = this.hooks.stops(), tailoring = this.hooks.tailoring();
    const status = tailoring ? GARMENT_TAILORING_LINE : '';
    if (this.status.textContent !== status) this.status.textContent = status;
    if (this.status.hidden === tailoring) { this.status.hidden = !tailoring; this.status.style.display = tailoring ? '' : 'none'; }
    // NECKLINE ends at her crease once she is measured; not under a finger, where a new end would move its thumb
    const neck = this.sliders.get('neckDepth')!, max = Math.round(MM.toSlider(deepestNeck(stops)));
    if (neck.max !== max && !this.underFinger(neck.input)) { neck.max = max; neck.input.max = String(max); }
    for (const c of this.sliders.values()) this.show(c, s, stops);
    this.light(s.construction);
  }

  dispose(): void {
    this.disposed = true;
    const doc = this.element.ownerDocument;
    doc.removeEventListener('pointerup', this.lifted, true);
    doc.removeEventListener('pointercancel', this.lifted, true);
    this.held.clear();
    this.moved.clear();
    this.element.remove();
  }

  /** A slider: its line, its input right after it, and its stops' chips under it. */
  private slider(key: SliderKey): HTMLElement[] {
    const spec = SLIDERS[key];
    const line = el('div', LINE_CSS);
    line.dataset.field = GARMENT_PANEL_FIELD[key];
    const input = el('input', INPUT_CSS);
    input.type = 'range';
    const min = Math.round(spec.scale.toSlider(spec.range[0])), max = Math.round(spec.scale.toSlider(spec.range[1]));
    input.min = String(min);
    input.max = String(max);
    input.step = String(spec.step);
    input.setAttribute('aria-label', spec.name);
    const presets = spec.presets;
    const chips = presets ? presets.stops.map((stop) => ({
      stop,
      button: this.button(stop.label.toUpperCase(), `${presets.action}${stop.id}`, () => {
        const s = this.hooks.settings();
        return clampGarmentSettings(spec.set(s, stop.at), s);
      }, true),
    })) : [];
    const c: Slider = { spec, line, input, min, max, chips };
    this.sliders.set(key, c);
    this.byInput.set(input, c);
    input.addEventListener('input', () => {
      if (this.disposed) return;
      this.moved.add(input);
      this.report(c, false);
    });
    input.addEventListener('change', () => {
      if (this.disposed) return;
      this.moved.delete(input);
      this.report(c, true);
    });
    input.addEventListener('pointerdown', (e) => {
      if (this.disposed) return;
      this.moved.delete(input);
      this.held.set(input, pointerOf(e));
    });
    input.addEventListener('pointerup', (e) => this.release(pointerOf(e), false));
    input.addEventListener('pointercancel', (e) => this.release(pointerOf(e), true));
    if (!chips.length) return [line, input];
    const row = el('div', ROW_CSS);
    row.append(...chips.map((x) => x.button));
    return [line, input, row];
  }

  /** RAGLAN and SET-IN, each through `withConstruction`. */
  private constructionRow(): HTMLElement {
    const row = el('div', ROW_CSS);
    for (const [c, label] of CONSTRUCTIONS) {
      const b = this.button(label, `${GARMENT_PANEL_ACTION.construction}${c}`, () => withConstruction(this.hooks.settings(), c), true);
      this.constructions.set(c, b);
      row.appendChild(b);
    }
    return row;
  }

  /** A chip (`toggle`: it shows whether it is the one chosen) or a button: a tap reports `next()`, final. */
  private button(label: string, action: string, next: () => GarmentSettings, toggle: boolean): HTMLButtonElement {
    const b = el('button', CHIP_CSS);
    b.type = 'button';
    b.textContent = label;
    b.dataset.action = action;
    if (toggle) b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.disposed) return;
      this.dropFocus();
      this.hooks.change(next(), true);
      this.refresh();
    });
    return b;
  }

  /** The room hears this slider where it stands, `final` or not, its own line first. */
  private report(c: Slider, final: boolean): void {
    const s = this.hooks.settings();
    this.show(c, s, this.hooks.stops(), true);
    const next = clampGarmentSettings(c.spec.set(s, c.spec.scale.fromSlider(Number(c.input.value))), s);
    this.reporting = c.input;
    try { this.hooks.change(next, final); } finally { this.reporting = null; }
  }

  /**
   * Finger `id` lifts from the slider it held -- or the browser takes the gesture away (`cancelled`: a scroll), which
   * sends no `change`, so where the finger left the slider is final. A lift waits for the `change` that follows it; until
   * then the thumb stays where the finger left it and only the hint goes.
   */
  private release(id: number | undefined, cancelled: boolean): void {
    if (this.disposed) return;
    for (const [input, holder] of [...this.held]) {
      if (holder !== id) continue;
      this.held.delete(input);
      const c = this.byInput.get(input)!;
      if (cancelled && this.moved.has(input)) { this.moved.delete(input); this.report(c, true); }
      else this.show(c, this.hooks.settings(), this.hooks.stops(), true);
    }
  }

  /**
   * One slider's input, line and chips: from the room's settings, or -- while a finger is on it (`own`) -- from the
   * slider itself, which is then never moved.
   */
  private show(c: Slider, s: GarmentSettings, stops: GarmentStops | null, own = this.underFinger(c.input)): void {
    let x: number;
    if (own) x = c.spec.scale.fromSlider(Number(c.input.value));
    else {
      x = c.spec.get(s, stops);
      const v = String(snap(c.spec.scale.toSlider(x), c.min, c.max, c.spec.step));
      if (c.input.value !== v) c.input.value = v;
    }
    const text = c.spec.line(x, s, stops, this.held.has(c.input) && this.moved.has(c.input));
    if (c.line.textContent !== text) {
      c.line.textContent = text;
      c.input.setAttribute('aria-valuetext', text);
    }
    for (const { stop, button } of c.chips) lit(button, Math.abs(x - stop.at) < 1e-6);
  }

  /** A finger is on it: a pointer down on it, the focus (a keyboard's arrows), or its own event being reported now. */
  private underFinger(input: HTMLInputElement): boolean {
    return this.held.has(input) || this.reporting === input || input.ownerDocument.activeElement === input;
  }

  /** A tap on the panel: a slider still focused from an earlier drag lets go of the focus, so it shows what the tap set. */
  private dropFocus(): void {
    const a = this.element.ownerDocument.activeElement;
    if (a instanceof HTMLInputElement && this.byInput.has(a) && !this.held.has(a)) a.blur();
  }

  private light(construction: Construction): void {
    for (const [c, b] of this.constructions) lit(b, c === construction);
  }
}
