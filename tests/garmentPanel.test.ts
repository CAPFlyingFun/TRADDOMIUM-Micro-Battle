// @vitest-environment jsdom
/**
 * THE NEW TEE'S CONTROLS (src/sarahlab/garmentPanel.ts, Stage 3):
 * - every control is a line and, right after it, its slider (a probe finds it by `[data-field] + input`), grouped in
 *   the order the OUTFIT tab shows them, with the room's ranges and steps; LENGTH and SLEEVES carry a chip per stop;
 * - a slider reports each move with `final` false and its let-go with `final` true, in the settings' own units (metres,
 *   shares, positions) with only its own field changed; a gesture the browser takes away still ends final; chips and
 *   buttons report `final` true, the construction through withConstruction, TEE DEFAULTS keeping the construction;
 * - refresh() shows the room's settings and her stops, but never moves a slider a finger is on or the focus is in;
 * - the lines say what she wears, on her landmarks once she is measured, and a re-tailor control says "let go to
 *   tailor" while a finger drags it;
 * - it fits a narrow upright column, keeps the room's events off the room, and goes into OUTFIT whole.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GARMENT_PANEL_ACTION as A, GARMENT_PANEL_FIELD as F, GARMENT_PANEL_ROLE, GARMENT_TAILORING_LINE, GarmentPanel, bellyRoomLine, fitLine,
  gussetLine, hemCurveLine, hemLine, lengthLine, neckDepthLine, neckShapeLine, neckWidthLine, sleeveLine, type GarmentPanelHooks,
} from '../src/sarahlab/garmentPanel';
import { HEM_CURVE_RISE } from '../src/sarahlab/garment/cuts';
import { TEE_DEFAULTS } from '../src/sarahlab/garment/draft';
import {
  CONSTRUCTION_DEFAULTS, GARMENT_DEFAULTS as D, LENGTH_STOPS, NECK_DEPTH_CREW, SLEEVE_STOPS, withConstruction,
  type GarmentSettings, type GarmentStops,
} from '../src/sarahlab/garment/settings';
import { studioLayout } from '../src/sarahlab/studioLayout';

/**
 * A body's stops, metres, chosen so the lines come out round: her hip 89 cm up; LENGTH's hems from 11 cm above it (Crop)
 * to 39 cm under it (Knee); SLEEVES from 3 cm short of her shoulder point (Tank) to 58 cm down her arm (Wrist); her
 * crease 18 cm under her neck.
 */
const STOPS: GarmentStops = Object.freeze({
  lengthY: [1.0, 0.88, 0.8, 0.65, 0.5], sleeveLength: [-0.03, 0.06, 0.215, 0.385, 0.45, 0.58], hipY: 0.89, kneeY: 0.5, neckDeepest: 0.18,
});

const panels: GarmentPanel[] = [];
afterEach(() => { for (const p of panels.splice(0)) p.dispose(); document.body.replaceChildren(); });

/** The panel on fake hooks. `store`: a room that keeps every change it hears (by default it keeps nothing). */
function setup(opts: { settings?: GarmentSettings; stops?: GarmentStops | null; store?: boolean } = {}) {
  let settings = opts.settings ?? D, stops = opts.stops === undefined ? STOPS : opts.stops, tailoring = false;
  const change = vi.fn((next: GarmentSettings, _final: boolean) => { if (opts.store) settings = next; });
  const hooks: GarmentPanelHooks = { settings: () => settings, change, stops: () => stops, tailoring: () => tailoring };
  const panel = new GarmentPanel(hooks);
  panels.push(panel);
  document.body.appendChild(panel.element);
  panel.refresh();
  return {
    panel, root: panel.element, change,
    set: (patch: Partial<GarmentSettings>) => { settings = { ...settings, ...patch }; },
    setStops: (next: GarmentStops | null) => { stops = next; },
    setTailoring: (on: boolean) => { tailoring = on; },
  };
}
const line = (root: HTMLElement, field: string) => root.querySelector<HTMLElement>(`[data-field="${field}"]`)!;
const slider = (root: HTMLElement, field: string) => root.querySelector<HTMLInputElement>(`[data-field="${field}"] + input`)!;
const chip = (root: HTMLElement, action: string) => root.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!;
const slide = (input: HTMLInputElement, value: number, type: 'input' | 'change' = 'input') => {
  input.value = String(value);
  input.dispatchEvent(new Event(type, { bubbles: true }));
};
/** jsdom has no PointerEvent; the panel reads only the type and `pointerId`. */
const pointer = (target: EventTarget, type: 'pointerdown' | 'pointerup' | 'pointercancel', pointerId = 1) => {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'pointerId', { value: pointerId });
  target.dispatchEvent(e);
};
const SLIDER_FIELDS = Object.entries(F).filter(([k]) => k !== 'status') as [Exclude<keyof typeof F, 'status'>, string][];

describe('the controls', () => {
  it('belong to the OUTFIT tab, and the room shows and hides them', () => {
    const { root } = setup();
    expect(root.dataset.tab).toBe('outfit');
    expect(root.dataset.role).toBe(GARMENT_PANEL_ROLE);
    expect(GARMENT_PANEL_ROLE).toBe('sarahlab-garment-panel');
    expect(root.style.display).toBe('');
  });

  it('every control is a line and, right after it, its slider, with its range and step', () => {
    const { root } = setup();
    const ranges: Record<string, readonly [number, number, number]> = {
      [F.length]: [0, 100, 1], [F.frontHem]: [-80, 80, 5], [F.backHem]: [-80, 80, 5], [F.hemCurve]: [0, 100, 1], [F.sleeve]: [0, 100, 1],
      [F.neckDepth]: [10, 180, 5], // down to her crease
      [F.neckWidth]: [180, 300, 5], [F.neckCurve]: [0, 100, 1], [F.bellyRoom]: [0, 100, 1],
      [F.bust]: [-20, 100, 5], [F.waist]: [-20, 100, 5], [F.hip]: [-20, 100, 5], [F.gusset]: [0, 100, 1],
    };
    for (const [key, field] of SLIDER_FIELDS) {
      const l = line(root, field);
      expect(l.tagName, key).toBe('DIV');
      const input = l.nextElementSibling as HTMLInputElement;
      expect(input.tagName, key).toBe('INPUT');
      expect(input.type, key).toBe('range');
      expect(slider(root, field), key).toBe(input);
      expect([Number(input.min), Number(input.max), Number(input.step)], key).toEqual(ranges[field]);
      expect(input.getAttribute('aria-label'), key).toBeTruthy();
      expect(input.getAttribute('aria-valuetext'), key).toBe(l.textContent);
    }
    expect(root.querySelectorAll('input[type=range]')).toHaveLength(SLIDER_FIELDS.length);
    // the status line is a line with no slider
    expect(line(root, F.status).nextElementSibling?.tagName).not.toBe('INPUT');
  });

  it('are grouped under light headings: LENGTH & HEM, SLEEVES, NECKLINE, FIT, CONSTRUCTION, then TEE DEFAULTS', () => {
    const { root } = setup();
    const [status, ...rest] = [...root.firstElementChild!.children] as HTMLElement[];
    const foot = rest.pop()!;
    expect(status.dataset.field).toBe(F.status);
    expect(rest.map((g) => [g.firstElementChild!.textContent, [...g.querySelectorAll<HTMLElement>('[data-field]')].map((e) => e.dataset.field)])).toEqual([
      ['LENGTH & HEM', [F.length, F.frontHem, F.backHem, F.hemCurve]],
      ['SLEEVES', [F.sleeve]],
      ['NECKLINE', [F.neckDepth, F.neckWidth, F.neckCurve]],
      ['FIT', [F.bellyRoom, F.bust, F.waist, F.hip]],
      ['CONSTRUCTION', [F.gusset]],
    ]);
    // the construction's two chips, before its gusset
    const construction = [...rest[4].querySelectorAll('button')];
    expect(construction.map((b) => [b.dataset.action, b.textContent])).toEqual([[`${A.construction}raglan`, 'RAGLAN'], [`${A.construction}setIn`, 'SET-IN']]);
    expect(construction[0].compareDocumentPosition(line(root, F.gusset)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect([...foot.querySelectorAll('button')].map((b) => [b.dataset.action, b.textContent])).toEqual([[A.defaults, 'TEE DEFAULTS']]);
    expect(chip(root, A.defaults).hasAttribute('aria-pressed')).toBe(false); // an action, not a choice
  });

  it('LENGTH and SLEEVES have a chip for each stop under the slider, and every row of chips wraps', () => {
    const { root } = setup();
    for (const [field, stops, prefix] of [[F.length, LENGTH_STOPS, A.lengthStop], [F.sleeve, SLEEVE_STOPS, A.sleeveStop]] as const) {
      const row = slider(root, field).nextElementSibling as HTMLElement;
      expect([...row.children].map((b) => [(b as HTMLElement).dataset.action, b.textContent])).toEqual(stops.map((s) => [`${prefix}${s.id}`, s.label.toUpperCase()]));
    }
    const buttons = [...root.querySelectorAll<HTMLButtonElement>('button')];
    expect(buttons).toHaveLength(LENGTH_STOPS.length + SLEEVE_STOPS.length + 2 + 1);
    for (const b of buttons) {
      expect(b.type).toBe('button');
      expect(b.parentElement!.style.display, b.dataset.action).toBe('flex');
      expect(b.parentElement!.style.flexWrap, b.dataset.action).toBe('wrap');
    }
  });

  it('fits a narrow upright column: sliders fill its width with no side margins, chips are thumb-sized and never wider', () => {
    const { root } = setup();
    for (const i of root.querySelectorAll<HTMLInputElement>('input')) {
      expect(i.style.width).toBe('100%');
      expect(i.style.boxSizing).toBe('border-box');
      expect([i.style.marginLeft, i.style.marginRight]).toEqual(['0px', '0px']);
      expect(parseFloat(i.style.height)).toBeGreaterThanOrEqual(28);
    }
    for (const b of root.querySelectorAll<HTMLButtonElement>('button')) {
      expect(parseFloat(b.style.minHeight)).toBeGreaterThanOrEqual(28);
      expect(b.style.maxWidth).toBe('100%');
      expect(b.style.boxSizing).toBe('border-box');
    }
    for (const l of root.querySelectorAll<HTMLElement>('[data-field]')) expect(l.style.getPropertyValue('overflow-wrap')).toBe('anywhere');
  });

  it('open on the approved tee and ask the room nothing until its first refresh', () => {
    const settings = vi.fn(() => ({ ...D, length: 90 })), stops = vi.fn(() => STOPS), tailoring = vi.fn(() => false);
    const panel = new GarmentPanel({ settings, change: vi.fn(), stops, tailoring });
    panels.push(panel);
    expect([settings, stops, tailoring].map((f) => f.mock.calls.length)).toEqual([0, 0, 0]);
    expect(slider(panel.element, F.length).value).toBe('25');
    expect(line(panel.element, F.length).textContent).toBe('LENGTH · Standard');
    expect(chip(panel.element, `${A.construction}raglan`).getAttribute('aria-pressed')).toBe('true');
    panel.refresh();
    expect(slider(panel.element, F.length).value).toBe('90');
    expect(line(panel.element, F.length).textContent).toBe('LENGTH · 33 cm under her hip');
  });
});

describe('what the room hears', () => {
  it('a slider moving: the settings with only its own field changed, in the settings\' units, not final, and its line at once', () => {
    const moves: readonly [Exclude<keyof typeof F, 'status'>, number, Partial<GarmentSettings>, string][] = [
      ['length', 60, { length: 60 }, 'LENGTH · 15 cm under her hip'],
      ['frontHem', 25, { frontHem: 0.025 }, 'FRONT HEM · 2.5 cm longer at the centre'],
      ['backHem', -15, { backHem: -0.015 }, 'BACK HEM · 1.5 cm shorter at the centre'],
      ['hemCurve', 60, { hemCurve: 0.6 }, 'HEM CURVE · shirttail · sides up 4.8 cm'],
      ['sleeve', 80, { sleeve: 80 }, 'SLEEVES · Three-quarter · 45 cm'],
      ['neckDepth', 120, { neckDepth: 0.12 }, 'NECKLINE · 12 cm deep'],
      ['neckWidth', 240, { neckWidth: 0.24 }, 'NECK WIDTH · 24 cm'],
      ['neckCurve', 40, { neckCurve: 0.4 }, 'NECK SHAPE · 40% toward V'],
      ['bellyRoom', 60, { bellyRoom: 0.6 }, 'BELLY ROOM · cut for her belly at 60%'],
      ['bust', 40, { ease: { ...D.ease, bust: 0.04 } }, 'BUST FIT · +4 cm ease'],
      ['waist', -15, { ease: { ...D.ease, waist: -0.015 } }, 'WAIST FIT · −1.5 cm ease'],
      ['hip', 100, { ease: { ...D.ease, hip: 0.1 } }, 'HIP FIT · +10 cm ease'],
      ['gusset', 25, { gusset: 0.25 }, 'GUSSET · 25%'],
    ];
    expect(moves.map(([k]) => k)).toEqual(SLIDER_FIELDS.map(([k]) => k));
    const { root, change } = setup(); // a room that keeps nothing: every report is the defaults and one field
    for (const [key, value, patch, text] of moves) {
      slide(slider(root, F[key]), value);
      expect(change, key).toHaveBeenLastCalledWith({ ...D, ...patch }, false);
      expect(line(root, F[key]).textContent, key).toBe(text);
      expect(slider(root, F[key]).getAttribute('aria-valuetext'), key).toBe(text);
    }
    expect(change).toHaveBeenCalledTimes(moves.length);
  });

  it('letting go: final, from where the slider stands; the lift itself waits for the change event', () => {
    const { root, change } = setup();
    slide(slider(root, F.hemCurve), 30, 'change');
    expect(change).toHaveBeenLastCalledWith({ ...D, hemCurve: 0.3 }, true);
    const bust = slider(root, F.bust);
    pointer(bust, 'pointerdown');
    slide(bust, 20);
    expect(change).toHaveBeenLastCalledWith({ ...D, ease: { ...D.ease, bust: 0.02 } }, false);
    slide(bust, 35);
    pointer(bust, 'pointerup');
    expect(change).toHaveBeenCalledTimes(3);
    slide(bust, 35, 'change');
    expect(change).toHaveBeenLastCalledWith({ ...D, ease: { ...D.ease, bust: 0.035 } }, true);
    expect(change.mock.calls.map(([, final]) => final)).toEqual([true, false, false, true]);
  });

  it('a gesture the browser takes away (a scroll) ends final where the finger left it, and only if it moved', () => {
    const { root, change } = setup();
    const gusset = slider(root, F.gusset);
    pointer(gusset, 'pointerdown', 4);
    slide(gusset, 70);
    pointer(gusset, 'pointercancel', 4);
    expect(change.mock.calls.map(([, final]) => final)).toEqual([false, true]);
    expect(change).toHaveBeenLastCalledWith({ ...D, gusset: 0.7 }, true);
    pointer(gusset, 'pointerdown', 5);
    pointer(gusset, 'pointercancel', 5);
    expect(change).toHaveBeenCalledTimes(2);
  });

  it('a finger lifted somewhere else lets go of the slider it held; another finger lifting does not', () => {
    const { root, panel, set } = setup();
    const length = slider(root, F.length);
    pointer(length, 'pointerdown', 3);
    slide(length, 60);
    set({ length: 90 });
    pointer(document.body, 'pointerup', 8); // another finger
    panel.refresh();
    expect(length.value).toBe('60');
    pointer(document.body, 'pointerup', 3); // this one, off the slider
    panel.refresh();
    expect(length.value).toBe('90');
  });

  it('the stop chips set the exact stop, final', () => {
    const { root, change } = setup();
    for (const s of LENGTH_STOPS) {
      chip(root, `${A.lengthStop}${s.id}`).click();
      expect(change).toHaveBeenLastCalledWith({ ...D, length: s.at }, true);
    }
    for (const s of SLEEVE_STOPS) {
      chip(root, `${A.sleeveStop}${s.id}`).click();
      expect(change).toHaveBeenLastCalledWith({ ...D, sleeve: s.at }, true);
    }
    expect(change).toHaveBeenCalledTimes(LENGTH_STOPS.length + SLEEVE_STOPS.length);
  });

  it('the construction chips go through withConstruction: its own gusset and neckline, final', () => {
    const { root, change, set } = setup();
    chip(root, `${A.construction}setIn`).click();
    expect(change).toHaveBeenLastCalledWith(withConstruction(D, 'setIn'), true);
    expect(change.mock.lastCall![0]).toMatchObject({ construction: 'setIn', gusset: CONSTRUCTION_DEFAULTS.setIn.gusset, neckWidth: null });
    set({ construction: 'setIn', gusset: 0.3, neckWidth: 0.22, length: 70 });
    chip(root, `${A.construction}raglan`).click();
    expect(change).toHaveBeenLastCalledWith({ ...D, length: 70, construction: 'raglan', gusset: CONSTRUCTION_DEFAULTS.raglan.gusset, neckWidth: null }, true);
  });

  it('TEE DEFAULTS puts every control back and keeps the construction', () => {
    const custom: GarmentSettings = {
      ...withConstruction(D, 'setIn'), gusset: 0.4, neckWidth: 0.26, neckCurve: 1, length: 90, sleeve: 100, frontHem: 0.05, backHem: -0.02,
      hemCurve: 0.5, neckDepth: 0.15, bellyRoom: 1, ease: { bust: 0.06, waist: 0.08, hip: -0.01 },
    };
    const { root, change, set } = setup({ settings: custom });
    chip(root, A.defaults).click();
    expect(change).toHaveBeenLastCalledWith(withConstruction(D, 'setIn'), true);
    set({ construction: 'raglan' });
    chip(root, A.defaults).click();
    expect(change).toHaveBeenLastCalledWith(D, true);
  });
});

describe('refresh', () => {
  it('shows the room\'s settings and her stops: every slider, line and chip, and the neckline down to her crease', () => {
    const { root, panel, set, setStops } = setup({ stops: null });
    expect(line(root, F.length).textContent).toBe('LENGTH · Standard');
    expect(line(root, F.sleeve).textContent).toBe('SLEEVES · Short');
    expect(slider(root, F.neckDepth).max).toBe('300');
    set({
      length: 50, frontHem: -0.03, backHem: 0.08, hemCurve: 1, sleeve: 0, neckDepth: NECK_DEPTH_CREW, construction: 'setIn', gusset: 0,
      neckWidth: null, neckCurve: 1, bellyRoom: 0.6, ease: { bust: 0.02, waist: 0, hip: -0.02 },
    });
    setStops(STOPS);
    panel.refresh();
    expect(Object.fromEntries(SLIDER_FIELDS.map(([k, f]) => [k, [slider(root, f).value, line(root, f).textContent]]))).toEqual({
      length: ['50', 'LENGTH · Tunic · 9 cm under her hip'],
      frontHem: ['-30', 'FRONT HEM · 3 cm shorter at the centre'],
      backHem: ['80', 'BACK HEM · 8 cm longer at the centre'],
      hemCurve: ['100', 'HEM CURVE · shirttail · sides up 8 cm'],
      sleeve: ['0', 'SLEEVES · Tank'],
      neckDepth: ['10', 'NECKLINE · crew · tailored when you let go'],
      neckWidth: ['200', 'NECK WIDTH · 20 cm'], // a set-in's own
      neckCurve: ['100', 'NECK SHAPE · V'],
      bellyRoom: ['60', 'BELLY ROOM · cut for her belly at 60%'],
      bust: ['20', 'BUST FIT · +2 cm ease'],
      waist: ['0', 'WAIST FIT · no ease'],
      hip: ['-20', 'HIP FIT · −2 cm ease'],
      gusset: ['0', 'GUSSET · none'],
    });
    expect(slider(root, F.neckDepth).max).toBe('180');
    const pressed = (prefix: string, ids: readonly string[]) => ids.filter((id) => chip(root, `${prefix}${id}`).getAttribute('aria-pressed') === 'true');
    const lengthIds = LENGTH_STOPS.map((s) => s.id), sleeveIds = SLEEVE_STOPS.map((s) => s.id);
    expect(pressed(A.lengthStop, lengthIds)).toEqual(['tunic']);
    expect(pressed(A.sleeveStop, sleeveIds)).toEqual(['tank']);
    expect(pressed(A.construction, ['raglan', 'setIn'])).toEqual(['setIn']);
    // lit as the room's own buttons are
    const on = chip(root, `${A.construction}setIn`), off = chip(root, `${A.construction}raglan`);
    expect([on.style.background, on.style.borderColor]).toEqual(['var(--sl-on,#806020)', 'var(--sl-accent,#d4a853)']);
    expect([off.style.background, off.style.borderColor]).toEqual(['var(--sl-btn,#151b23)', 'var(--sl-btn-line,#ffffff30)']);
    // between stops no chip is lit
    set({ length: 52, sleeve: 50 });
    panel.refresh();
    expect([pressed(A.lengthStop, lengthIds), pressed(A.sleeveStop, sleeveIds)]).toEqual([[], []]);
    expect(line(root, F.sleeve).textContent).toBe('SLEEVES · 30 cm');
    // a neckline kept deeper than her crease shows as she wears it
    set({ neckDepth: 0.25 });
    panel.refresh();
    expect([slider(root, F.neckDepth).value, line(root, F.neckDepth).textContent]).toEqual(['180', 'NECKLINE · 18 cm deep']);
  });

  it('a slider shows the step nearest the setting', () => {
    const { root, panel, set } = setup();
    set({ frontHem: 0.0237, hemCurve: 0.574 });
    panel.refresh();
    expect([slider(root, F.frontHem).value, line(root, F.frontHem).textContent]).toEqual(['25', 'FRONT HEM · 2.4 cm longer at the centre']);
    expect(slider(root, F.hemCurve).value).toBe('57');
  });

  it('never moves a slider a finger is on: its line follows the finger until the room has the value', () => {
    const { root, panel, set, change } = setup();
    const length = slider(root, F.length);
    pointer(length, 'pointerdown');
    slide(length, 60);
    set({ length: 90, frontHem: 0.02 }); // the room is elsewhere
    panel.refresh();
    expect(length.value).toBe('60');
    expect(line(root, F.length).textContent).toBe('LENGTH · 15 cm under her hip');
    expect(slider(root, F.frontHem).value).toBe('20'); // every other slider follows the room
    // lifted, the thumb stays for the let-go's change event...
    pointer(length, 'pointerup');
    expect(length.value).toBe('60');
    slide(length, 60, 'change');
    expect(change).toHaveBeenLastCalledWith({ ...D, length: 60, frontHem: 0.02 }, true);
    // ...and then shows the room's
    panel.refresh();
    expect([length.value, line(root, F.length).textContent]).toEqual(['90', 'LENGTH · 33 cm under her hip']);
  });

  it('nor one whose own move the room refreshes from inside change()', () => {
    const { root, panel, change } = setup(); // a room that keeps nothing until it is let go...
    change.mockImplementation(() => panel.refresh()); // ...and refreshes the panel as it hears
    const width = slider(root, F.neckWidth);
    slide(width, 250);
    expect(change).toHaveBeenLastCalledWith({ ...D, neckWidth: 0.25 }, false);
    expect([width.value, line(root, F.neckWidth).textContent]).toEqual(['250', 'NECK WIDTH · 25 cm']);
  });

  it('nor a focused one (a keyboard\'s); a tap on the panel lets go of the focus, so the slider shows what the tap set', () => {
    const { root, panel, set } = setup({ store: true });
    const sleeve = slider(root, F.sleeve);
    sleeve.focus();
    slide(sleeve, 60);
    set({ sleeve: 20 });
    panel.refresh();
    expect(sleeve.value).toBe('60');
    chip(root, A.defaults).click();
    expect(document.activeElement).not.toBe(sleeve);
    expect([sleeve.value, line(root, F.sleeve).textContent]).toEqual([String(D.sleeve), 'SLEEVES · Short · 22 cm']);
  });

  it('moves the neckline\'s end with her crease, but not while a finger is on it', () => {
    const { root, panel, setStops } = setup({ stops: null });
    const neck = slider(root, F.neckDepth);
    expect([neck.min, neck.max]).toEqual(['10', '300']);
    pointer(neck, 'pointerdown');
    setStops(STOPS);
    panel.refresh();
    expect(neck.max).toBe('300');
    pointer(neck, 'pointerup');
    panel.refresh();
    expect(neck.max).toBe('180');
    setStops({ ...STOPS, neckDeepest: 0.1534 });
    panel.refresh();
    expect(neck.max).toBe('153');
    setStops(null);
    panel.refresh();
    expect(neck.max).toBe('300');
  });

  it('lights a stop\'s chip as the slider reaches it, before the room has it', () => {
    const { root } = setup();
    const length = slider(root, F.length), mini = chip(root, `${A.lengthStop}mini`), standard = chip(root, `${A.lengthStop}standard`);
    expect([standard, mini].map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
    pointer(length, 'pointerdown');
    slide(length, 75);
    expect([standard, mini].map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
    expect(line(root, F.length).textContent).toBe('LENGTH · Mini dress · 24 cm under her hip');
  });

  it('says TAILORING while the tee is re-tailored, and is empty and hidden otherwise', () => {
    const { root, panel, setTailoring } = setup();
    const status = line(root, F.status);
    expect([status.hidden, status.style.display, status.textContent]).toEqual([true, 'none', '']);
    setTailoring(true);
    panel.refresh();
    expect([status.hidden, status.style.display, status.textContent]).toEqual([false, '', 'TAILORING THE NEW TEE…']);
    expect(GARMENT_TAILORING_LINE).toBe('TAILORING THE NEW TEE…');
    setTailoring(false);
    panel.refresh();
    expect([status.hidden, status.style.display, status.textContent]).toEqual([true, 'none', '']);
  });
});

describe('"let go to tailor"', () => {
  it('ends a re-tailor control\'s line while a finger drags it, and goes when it lifts', () => {
    const { root } = setup();
    const cases = [
      [F.neckWidth, 240, 'NECK WIDTH · 18 cm', 'NECK WIDTH · 24 cm'], [F.neckCurve, 100, 'NECK SHAPE · U', 'NECK SHAPE · V'],
      [F.bust, 40, 'BUST FIT · no ease', 'BUST FIT · +4 cm ease'], [F.waist, -10, 'WAIST FIT · +4 cm ease', 'WAIST FIT · −1 cm ease'],
      [F.hip, 0, 'HIP FIT · +4 cm ease', 'HIP FIT · no ease'], [F.gusset, 0, 'GUSSET · 50%', 'GUSSET · none'],
    ] as const;
    for (const [field, value, before, after] of cases) {
      const input = slider(root, field);
      expect(line(root, field).textContent).toBe(before);
      pointer(input, 'pointerdown');
      expect(line(root, field).textContent).toBe(before); // a touch is not a drag
      slide(input, value);
      expect(line(root, field).textContent).toBe(`${after} · let go to tailor`);
      pointer(input, 'pointerup');
      expect(line(root, field).textContent).toBe(after);
    }
  });

  it('ends NECKLINE\'s only while it is higher than the scoop, where it is drafted', () => {
    const { root } = setup();
    const neck = slider(root, F.neckDepth), text = () => line(root, F.neckDepth).textContent;
    expect(text()).toBe('NECKLINE · scoop · 4 cm');
    pointer(neck, 'pointerdown');
    slide(neck, 25);
    expect(text()).toBe('NECKLINE · 2.5 cm deep · let go to tailor');
    slide(neck, 120);
    expect(text()).toBe('NECKLINE · 12 cm deep'); // deeper is a cut, as the finger drags
    slide(neck, 40);
    expect(text()).toBe('NECKLINE · scoop · 4 cm');
    slide(neck, 10);
    expect(text()).toBe('NECKLINE · crew · let go to tailor');
    pointer(neck, 'pointerup');
    expect(text()).toBe('NECKLINE · crew · tailored when you let go');
  });

  it('never ends an instant control\'s', () => {
    const { root } = setup();
    for (const [field, value] of [[F.length, 70], [F.frontHem, 30], [F.backHem, -30], [F.hemCurve, 40], [F.sleeve, 70], [F.bellyRoom, 50]] as const) {
      const input = slider(root, field);
      pointer(input, 'pointerdown');
      slide(input, value);
      expect(line(root, field).textContent, field).not.toContain('tailor');
      pointer(input, 'pointerup');
    }
  });
});

describe('the lines', () => {
  it('LENGTH: the hem against her hip once she is measured, with the stop\'s name at a stop', () => {
    expect(lengthLine(50, STOPS)).toBe('LENGTH · Tunic · 9 cm under her hip');
    expect(lengthLine(55, STOPS)).toBe('LENGTH · 12 cm under her hip');
    expect(lengthLine(25, STOPS)).toBe('LENGTH · Standard · 1 cm under her hip');
    expect(lengthLine(100, STOPS)).toBe('LENGTH · Knee dress · 39 cm under her hip');
    expect(lengthLine(0, STOPS)).toBe('LENGTH · Crop · 11 cm above her hip');
    expect(lengthLine(10, STOPS)).toBe('LENGTH · 6 cm above her hip');
    expect(lengthLine(23, STOPS)).toBe('LENGTH · at her hip');
  });

  it('LENGTH before she is measured: the stop, or how far along', () => {
    expect(lengthLine(25, null)).toBe('LENGTH · Standard');
    expect(lengthLine(75, null)).toBe('LENGTH · Mini dress');
    expect(lengthLine(40, null)).toBe('LENGTH · 40%');
    expect(lengthLine(40, { ...STOPS, lengthY: [] })).toBe('LENGTH · 40%'); // stops it cannot read are none
  });

  it('FRONT and BACK HEM: as cut, or longer or shorter at the centre', () => {
    expect(hemLine('front', 0)).toBe('FRONT HEM · as cut');
    expect(hemLine('back', 0)).toBe('BACK HEM · as cut');
    expect(hemLine('front', 0.025)).toBe('FRONT HEM · 2.5 cm longer at the centre');
    expect(hemLine('front', -0.015)).toBe('FRONT HEM · 1.5 cm shorter at the centre');
    expect(hemLine('back', 0.08)).toBe('BACK HEM · 8 cm longer at the centre');
    expect(hemLine('back', -0.08)).toBe('BACK HEM · 8 cm shorter at the centre');
    expect(hemLine('front', 0.0004)).toBe('FRONT HEM · as cut');
  });

  it('HEM CURVE: level, or a shirttail whose sides rise the curve\'s share of HEM_CURVE_RISE', () => {
    expect(hemCurveLine(0)).toBe('HEM CURVE · level');
    expect(hemCurveLine(0.6)).toBe('HEM CURVE · shirttail · sides up 4.8 cm');
    expect(hemCurveLine(1)).toBe(`HEM CURVE · shirttail · sides up ${Math.round(HEM_CURVE_RISE * 1000) / 10} cm`);
  });

  it('SLEEVES: the stop and its length down her arm once she is measured, a tank and a cap by name', () => {
    expect(sleeveLine(40, STOPS)).toBe('SLEEVES · Short · 22 cm');
    expect(sleeveLine(100, STOPS)).toBe('SLEEVES · Wrist · 58 cm');
    expect(sleeveLine(0, STOPS)).toBe('SLEEVES · Tank');
    expect(sleeveLine(20, STOPS)).toBe('SLEEVES · Cap');
    expect(sleeveLine(50, STOPS)).toBe('SLEEVES · 30 cm');
    expect(sleeveLine(5, STOPS)).toBe('SLEEVES · ends above her shoulder');
  });

  it('SLEEVES before she is measured: the stop, or how far along', () => {
    expect(sleeveLine(40, null)).toBe('SLEEVES · Short');
    expect(sleeveLine(80, null)).toBe('SLEEVES · Three-quarter');
    expect(sleeveLine(0, null)).toBe('SLEEVES · Tank');
    expect(sleeveLine(45, null)).toBe('SLEEVES · 45%');
  });

  it('NECKLINE: crew, the scoop, or how deep, and tailored when let go while higher than the scoop', () => {
    expect(TEE_DEFAULTS.neckDrop).toBe(0.04);
    expect(neckDepthLine(NECK_DEPTH_CREW)).toBe('NECKLINE · crew · tailored when you let go');
    expect(neckDepthLine(TEE_DEFAULTS.neckDrop)).toBe('NECKLINE · scoop · 4 cm');
    expect(neckDepthLine(0.042)).toBe('NECKLINE · scoop · 4.2 cm'); // within 2.5 mm, and deeper: a cut
    expect(neckDepthLine(0.039)).toBe('NECKLINE · scoop · 3.9 cm · tailored when you let go'); // higher, however little: drafted
    expect(neckDepthLine(0.045)).toBe('NECKLINE · 4.5 cm deep');
    expect(neckDepthLine(0.12)).toBe('NECKLINE · 12 cm deep');
    expect(neckDepthLine(0.025)).toBe('NECKLINE · 2.5 cm deep · tailored when you let go');
    // a finger dragging it: what letting go will do
    expect(neckDepthLine(0.025, true)).toBe('NECKLINE · 2.5 cm deep · let go to tailor');
    expect(neckDepthLine(0.12, true)).toBe('NECKLINE · 12 cm deep');
  });

  it('NECK WIDTH: a null width is the construction\'s own', () => {
    expect(neckWidthLine(null, 'raglan')).toBe('NECK WIDTH · 18 cm');
    expect(neckWidthLine(null, 'setIn')).toBe('NECK WIDTH · 20 cm');
    expect([CONSTRUCTION_DEFAULTS.raglan.neckWidth, CONSTRUCTION_DEFAULTS.setIn.neckWidth]).toEqual([0.18, 0.2]);
    expect(neckWidthLine(0.245, 'raglan')).toBe('NECK WIDTH · 24.5 cm');
    expect(neckWidthLine(0.3, 'setIn')).toBe('NECK WIDTH · 30 cm');
  });

  it('NECK SHAPE: a U, a V, or how far toward the V', () => {
    expect(neckShapeLine(0)).toBe('NECK SHAPE · U');
    expect(neckShapeLine(1)).toBe('NECK SHAPE · V');
    expect(neckShapeLine(0.4)).toBe('NECK SHAPE · 40% toward V');
  });

  it('BELLY ROOM: none, or the size her front is cut for', () => {
    expect(bellyRoomLine(0)).toBe('BELLY ROOM · none');
    expect(bellyRoomLine(0.6)).toBe('BELLY ROOM · cut for her belly at 60%');
    expect(bellyRoomLine(1)).toBe('BELLY ROOM · cut for her belly at 100%');
  });

  it('BUST, WAIST and HIP FIT: no ease, or the ease with its sign', () => {
    expect(fitLine('bust', 0)).toBe('BUST FIT · no ease');
    expect(fitLine('bust', 0.04)).toBe('BUST FIT · +4 cm ease');
    expect(fitLine('bust', -0.015)).toBe('BUST FIT · −1.5 cm ease');
    expect(fitLine('waist', 0.1)).toBe('WAIST FIT · +10 cm ease');
    expect(fitLine('hip', -0.02)).toBe('HIP FIT · −2 cm ease');
  });

  it('GUSSET: none, or its share', () => {
    expect(gussetLine(0)).toBe('GUSSET · none');
    expect(gussetLine(0.5)).toBe('GUSSET · 50%');
    expect(gussetLine(1)).toBe('GUSSET · 100%');
  });
});

describe('in the room', () => {
  it('keeps pointer, wheel, key and click events off the room behind it', () => {
    const { root } = setup();
    const behind = vi.fn();
    const types = ['pointerdown', 'pointermove', 'pointerup', 'wheel', 'keydown', 'click'];
    for (const t of types) document.body.addEventListener(t, behind);
    try {
      for (const target of [slider(root, F.length), line(root, F.bust), root]) {
        for (const t of types.slice(0, -1)) target.dispatchEvent(new Event(t, { bubbles: true }));
      }
      chip(root, `${A.lengthStop}tunic`).click();
      chip(root, A.defaults).click();
      expect(behind).not.toHaveBeenCalled();
    } finally {
      for (const t of types) document.body.removeEventListener(t, behind);
    }
  });

  it('the studio moves it into OUTFIT whole', () => {
    const { panel } = setup();
    const room = document.createElement('div');
    room.appendChild(panel.element);
    document.body.appendChild(room);
    const layout = studioLayout(room, { changed: () => undefined });
    expect(panel.element.parentElement).toBe(layout.section('outfit'));
    expect(panel.element.querySelectorAll('input[type=range]')).toHaveLength(SLIDER_FIELDS.length);
    layout.dispose();
  });

  it('dispose takes it away and stops listening', () => {
    const settings = vi.fn(() => D), change = vi.fn();
    const panel = new GarmentPanel({ settings, change, stops: () => STOPS, tailoring: () => false });
    document.body.appendChild(panel.element);
    const width = slider(panel.element, F.neckWidth);
    pointer(width, 'pointerdown', 9);
    slide(width, 260);
    expect(change).toHaveBeenCalledTimes(1);
    panel.dispose();
    expect(panel.element.isConnected).toBe(false);
    const asked = settings.mock.calls.length;
    panel.refresh();
    pointer(document, 'pointercancel', 9); // its gesture, after dispose: nothing to report
    slide(width, 270);
    chip(panel.element, A.defaults).click();
    expect(settings.mock.calls.length).toBe(asked);
    expect(change).toHaveBeenCalledTimes(1);
  });
});
