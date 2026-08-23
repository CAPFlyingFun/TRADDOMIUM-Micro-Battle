import { MAX_POWERED_SPEED } from '../ant/flight';
import { WANDER_RATE } from '../ant/wander';
import { SOON, type FlightTelemetry } from '../ant/telemetry';
import { wrap360 } from './compassMath';

/**
 * THE INSTRUMENTS SHE FLIES ON.
 *
 * On the ground the HUD answers "how fast, how tired, which way". In
 * the air three more questions appear that nothing on screen could
 * answer: how high, going up or down, and what is the wind doing to me.
 * This is those three, and deliberately nothing else.
 *
 * WHAT IS NOT HERE IS THE DESIGN. Three mockups all wanted an airspeed
 * tape and a second compass; both are already on screen. The pace
 * column prints her speed and the compass strip along the top carries
 * her heading and will carry her markers, so a tape and an arc would be
 * the same two numbers twice, in the middle of a 430-pixel-tall phone
 * where she herself is. What flight genuinely adds to the speed readout
 * is that ground speed and AIRSPEED stop being the same thing once
 * there is wind — so the pace readout grows a second line rather than
 * growing a tape.
 *
 * THE HEADING REFERENCE IS NOT HERE. It was a little ant reticle above
 * her, and it was the wrong instrument in the wrong place: her nose is
 * a heading, and headings belong on the heading tape. It moved there as
 * a G1000-style turn trend, which says the thing the reticle never
 * could — not where she is pointing, but where this rate of turn is
 * about to put her.
 *
 * MINT, NOT GOLD. The rest of this game's interface is black and gold,
 * and so is the ground: at ant scale the world is soil and dry grass,
 * which is very nearly the colour of the HUD. Drawn in gold over it the
 * horizon line all but vanished — measured, over a real screenshot, not
 * guessed. A cool instrument layer over warm ground separates on hue
 * rather than on brightness, and reads as glass over the world where
 * the gold cards read as panels on top of it.
 */

/** The instrument colour, and its quieter form for scales and labels. */
const INK = '#a9f2c9';
const DIM = 'rgba(169, 242, 201, .58)';
const WARN = '#ffb03a';
const SHADOW = 'drop-shadow(0 1px 3px rgba(0, 0, 0, .92))';

/**
 * THE LADDER IS DRAWN ON THE WORLD, NOT ON HER.
 *
 * A cockpit HUD can put the horizon at the middle of the glass because
 * the pilot's eye and the aircraft point the same way. This camera does
 * not: it hangs behind and above her and looks DOWN, so a horizon bar
 * at screen centre sat a third of a screen below the real one and made
 * a liar of the instrument. The scene hands over where the horizon
 * actually is and how many pixels a degree is worth — it owns the
 * projection — and the ladder is hung off that.
 *
 * Which also settles the roll. The camera does not bank, so the horizon
 * does not tilt; SHE banks, so the reticle does. Rotating the world
 * around a fixed ant would have been the cockpit convention applied to
 * a chase view, which is to say backwards.
 */
const LADDER_W = 320;
const LADDER_H = 260;

/**
 * How far the horizon may wander before the ladder gives up, as a share
 * of the screen's half-height.
 *
 * Honest and useful are not the same thing. Hung off the true horizon
 * the ladder is correct at every camera angle, and at a steep one that
 * means it climbs into the compass strip and lies across the reticle
 * while telling you something you can already see out of the window.
 * Past this it fades; the instruments that cannot be seen out of the
 * window — height, sink, wind — stay.
 */
const LADDER_FADE_FROM = 0.42;
const LADDER_FADE_TO = 0.78;

/**
 * How much of the ladder to draw, given where the horizon has got to.
 *
 * @param horizon pixels below the middle of the screen
 * @param halfScreen half the viewport's height, in pixels
 */
export function ladderFade(horizon: number, halfScreen: number): number {
  const wander = Math.abs(horizon) / Math.max(1, halfScreen);
  const gone = (wander - LADDER_FADE_FROM) / (LADDER_FADE_TO - LADDER_FADE_FROM);
  return 1 - Math.min(1, Math.max(0, gone));
}

/** Height of the altitude tape, and the centimetres it spans each way. */
/**
 * How fast she has to be going vertically before the arrow appears.
 *
 * Comfortably above the air's own wander (see wander.ts), so a level
 * cruise shows a number that breathes and an arrow that does not.
 */
const VS_QUIET = WANDER_RATE * 1.5;

const TAPE_TALL = 200;
const TAPE_SPAN = 500;
/** How many tick elements the tape keeps. Enough to cover the span. */
const TICKS = 13;

/** The layout is drawn for this height and scaled from it. */
const DESIGN_TALL = 430;

/**
 * What the scene has already worked out on the HUD's behalf.
 *
 * Projection lives with the camera, not here: the scene owns three.js
 * and the floating origin, so it converts her global position to a
 * LOCAL one and projects that. Screen pixels arrive; no world
 * coordinate ever reaches this file, which is exactly the rule the
 * ground texture had to learn.
 */
export interface FlightView {
  /** Pixels below the middle of the screen, from the camera. */
  readonly horizon: number;
  readonly perDegree: number;
  /** Where her ground-relative velocity is carrying her. */
  readonly path: { readonly x: number; readonly y: number } | null;
  /** The predicted ground point: the look-ahead, or the terrain hit. */
  readonly target:
    | { readonly x: number; readonly y: number; readonly hit: boolean }
    | null;
  /** Her own position on screen, for the line out to the target. */
  readonly her: { readonly x: number; readonly y: number } | null;
}

/**
 * What to say about the wind, or nothing.
 *
 * The same thresholds the weather panel uses, against the wind AT HER
 * HEIGHT rather than the one the station reported — ten metres up is
 * not where she is, and a warning about air she is not in is noise.
 */
export function windCall(felt: number, along: number): string | null {
  // THE HEADWIND CHECK GOES FIRST, and the order is the whole point.
  // The component along her nose can never exceed the wind's own speed,
  // so asking "is the wind faster than she is" before "is the headwind
  // faster than she is" means the second question can never be reached
  // — the first has already answered. Put the other way round both are
  // reachable, and the sharper warning wins: air she cannot out-fly
  // matters much less when it is behind her.
  if (-along > MAX_POWERED_SPEED) return 'HEADWIND OVER AIRSPEED';
  if (felt > MAX_POWERED_SPEED) return 'WIND OVER AIRSPEED';
  if (felt > MAX_POWERED_SPEED * 0.6) return 'STRONG WIND';
  return null;
}

const svg = (tag: string): SVGElement =>
  document.createElementNS('http://www.w3.org/2000/svg', tag);

function set(el: Element, attrs: Record<string, string | number>): void {
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
}

export class FlightHud {
  private readonly root: HTMLDivElement;
  private readonly ladder: SVGElement;
  private readonly tapeTicks: { line: SVGElement; text: SVGElement }[] = [];
  private readonly tapeRead: SVGElement;
  private readonly mslRead: HTMLSpanElement;
  private readonly landRead: HTMLSpanElement;
  private readonly vs: HTMLSpanElement;
  private readonly vsArrow: HTMLSpanElement;
  private readonly windSpeed: HTMLSpanElement;
  private readonly windArrow: SVGElement;
  private readonly windCall: HTMLSpanElement;
  private readonly windStrip: HTMLDivElement;
  private readonly clusters: HTMLElement[] = [];
  private readonly watch: ResizeObserver;
  private up = false;
  private shownAlt = Number.NaN;
  private shownMsl = '';
  private shownLand = '';
  private shownVs = Number.NaN;
  private shownWind = Number.NaN;
  private shownCall = '';
  private shownTgt = '';
  private shownDrift = '';
  private readonly path: HTMLDivElement;
  private readonly target: HTMLDivElement;
  private readonly targetMark: SVGElement;
  private readonly trail: SVGSVGElement;
  private readonly trailLine: SVGElement;
  private readonly tgt: HTMLDivElement;
  private readonly drift: HTMLDivElement;

  constructor(host: HTMLElement) {
    this.root = document.createElement('div');
    this.root.dataset.ui = 'flight-hud';
    Object.assign(this.root.style, {
      position: 'fixed',
      inset: '0',
      // Instruments are for reading, never for pressing. Every control
      // on this screen lives underneath them.
      pointerEvents: 'none',
      // Under the gold cards and the compass, over the world.
      zIndex: '11',
      opacity: '0',
      transition: 'opacity 220ms ease',
      filter: SHADOW,
    } as Partial<CSSStyleDeclaration>);

    this.ladder = this.buildLadder();
    const centre = this.cluster('50%', '50%', 'translate(-50%, -50%)', 'center center');
    centre.appendChild(this.ladder);

    // THE FLIGHT-PATH VECTOR. Not the reticle: that is where her nose
    // is, this is where her velocity over the ground is taking her. In
    // still air the two sit almost on top of each other; in a crosswind
    // this one slides off to the side, which is the picture that
    // explains the whole wind model without a word of text.
    this.path = document.createElement('div');
    this.path.style.position = 'absolute';
    this.path.style.opacity = '0';
    this.path.appendChild(this.buildPathMark());
    this.root.appendChild(this.path);

    // Where the ground is coming up to meet her.
    this.target = document.createElement('div');
    this.target.style.position = 'absolute';
    this.target.style.opacity = '0';
    this.targetMark = this.buildTargetMark();
    this.target.appendChild(this.targetMark);
    this.root.appendChild(this.target);

    // The path between the two, drawn under both.
    this.trail = svg('svg') as SVGSVGElement;
    Object.assign(this.trail.style, {
      position: 'absolute', inset: '0', width: '100%', height: '100%',
      opacity: '0', transition: 'opacity 200ms ease',
    } as Partial<CSSStyleDeclaration>);
    this.trailLine = svg('line');
    set(this.trailLine, {
      stroke: INK, 'stroke-width': 1.2, 'stroke-dasharray': '4 6',
      'stroke-linecap': 'round',
    });
    this.trail.appendChild(this.trailLine);
    this.root.insertBefore(this.trail, this.root.firstChild);

    const { box, ticks, read } = this.buildTape();
    this.tapeTicks.push(...ticks);
    this.tapeRead = read;
    // INBOARD OF THE CLIMB AND DESCEND BUTTONS, not against the edge.
    // The right rail belongs to her thumb; a tape under it is a tape
    // she cannot read and a button she presses by accident.
    const right = this.cluster(null, '48%', 'translateY(-50%)', 'right center');
    right.style.right = 'calc(88px + min(env(safe-area-inset-right), 14px))';
    right.appendChild(box);

    // THREE ALTITUDES, because one cannot answer the question.
    //
    // The tape and its pointer are AGL — the ground directly beneath
    // her, which is what a radio altimeter reads and what stops her
    // hitting the thing she is over. MSL is her height over the sea,
    // which is the only one that does not jump when the ground does.
    // LND is her height above the ground she is ACTUALLY GOING TO LAND
    // ON, which is the one that governs a descent and the one Joshua's
    // worked example computes before anything else.
    this.mslRead = document.createElement('span');
    this.landRead = document.createElement('span');
    right.appendChild(this.railRow('MSL', this.mslRead));
    right.appendChild(this.railRow('LND', this.landRead));

    const under = document.createElement('div');
    Object.assign(under.style, {
      display: 'flex', alignItems: 'baseline', justifyContent: 'flex-end',
      gap: '6px', marginTop: '5px',
      font: '600 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace',
      letterSpacing: '0.16em', color: DIM,
    } as Partial<CSSStyleDeclaration>);
    this.vs = document.createElement('span');
    this.vs.style.color = INK;
    this.vs.style.fontSize = '13px';
    this.vs.style.fontWeight = '700';
    this.vsArrow = document.createElement('span');
    under.append(span('VS'), this.vs, span('cm/s'), this.vsArrow);
    right.appendChild(under);

    // ONE compact line for what is coming: the clearance she will have
    // at the look-ahead point, and how long until the ground arrives
    // when it is going to.
    this.tgt = document.createElement('div');
    Object.assign(this.tgt.style, {
      textAlign: 'right', marginTop: '3px',
      font: '600 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace',
      letterSpacing: '0.14em', color: DIM,
    } as Partial<CSSStyleDeclaration>);
    right.appendChild(this.tgt);

    this.windStrip = this.cluster('50%', null, 'translateX(-50%)', 'center bottom');
    this.windStrip.style.bottom = 'calc(16px + min(env(safe-area-inset-bottom), 14px))';
    Object.assign(this.windStrip.style, {
      display: 'flex', alignItems: 'center', gap: '9px',
      font: '600 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace',
      letterSpacing: '0.16em', color: DIM, whiteSpace: 'nowrap',
    } as Partial<CSSStyleDeclaration>);
    this.windArrow = this.buildWindArrow();
    this.windSpeed = document.createElement('span');
    this.windSpeed.style.color = INK;
    this.windSpeed.style.fontSize = '13px';
    this.windSpeed.style.fontWeight = '700';
    this.windCall = document.createElement('span');
    Object.assign(this.windCall.style, {
      color: WARN, fontWeight: '700', letterSpacing: '0.1em',
    } as Partial<CSSStyleDeclaration>);
    this.windStrip.append(
      span('WIND'), this.windArrow, this.windSpeed, span('cm/s'), this.windCall,
    );

    // THE GROUND LINE: where she is actually going, and how fast over
    // the island. The bottom half of the aviation pairing — the
    // compass carries her heading and airspeed, this carries her track
    // and ground speed, and the difference between the two is the
    // wind. Said as a pair they are readable; said as a bare AIR over
    // a bare GND, as they were, the two numbers differed for a reason
    // nothing on screen accounted for.
    //
    // The drift angle rides on the end, still hidden below a few
    // degrees — a permanent "0°" is a number nobody has ever read.
    //
    // DIRECTLY OVER THE WIND STRIP, and centred like it, because the
    // two are one sentence: ground is air plus wind. It used to sit out
    // at 152px on the left, where the short "→ 5° TRK 131°" already
    // ran behind the pace column; a line carrying a speed as well
    // would have buried it.
    this.drift = this.cluster('50%', null, 'translateX(-50%)', 'center bottom');
    this.drift.style.bottom = 'calc(42px + min(env(safe-area-inset-bottom), 14px))';
    Object.assign(this.drift.style, {
      font: '600 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace',
      letterSpacing: '0.10em', color: INK, whiteSpace: 'nowrap',
      opacity: '0', transition: 'opacity 200ms ease',
    } as Partial<CSSStyleDeclaration>);

    host.appendChild(this.root);
    this.watch = new ResizeObserver(() => this.fit());
    this.watch.observe(host);
    this.fit();
  }

  /**
   * Drawn for a 430-pixel-tall phone and scaled from there.
   *
   * Each cluster scales about its own anchor rather than the layer
   * scaling as a whole, so the tape stays against the right edge and
   * the wind strip stays on the bottom instead of drifting inward.
   */
  private fit(): void {
    const scale = Math.min(1.35, Math.max(0.78, window.innerHeight / DESIGN_TALL));
    this.scale = scale;
    for (const el of this.clusters) this.fitOne(el);
  }

  private fitOne(el: HTMLElement): void {
    const base = el.dataset.move ?? '';
    const spin = el.dataset.roll ?? '';
    el.style.transform = `${base} scale(${this.scale.toFixed(3)}) ${spin}`;
  }

  private scale = 1;

  private cluster(
    left: string | null, top: string | null, move: string, origin: string,
  ): HTMLDivElement {
    const el = document.createElement('div');
    el.style.position = 'absolute';
    if (left !== null) el.style.left = left;
    if (top !== null) el.style.top = top;
    el.dataset.move = move;
    el.style.transform = move;
    el.style.transformOrigin = origin;
    this.root.appendChild(el);
    this.clusters.push(el);
    return el;
  }

  /** Horizon and one rung either side of it. */
  private buildLadder(): SVGElement {
    const root = svg('svg');
    set(root, {
      width: LADDER_W, height: LADDER_H,
      viewBox: `0 0 ${LADDER_W} ${LADDER_H}`, fill: 'none', overflow: 'visible',
    });
    for (const deg of [10, 0, -10]) {
      const half = deg === 0 ? 130 : 38;
      const gap = deg === 0 ? 30 : 0;
      const parts: SVGElement[] = [];
      for (const side of [-1, 1]) {
        const bar = svg('line');
        set(bar, {
          x1: LADDER_W / 2 + side * gap, x2: LADDER_W / 2 + side * half,
          stroke: INK, 'stroke-width': 1.7, 'stroke-linecap': 'round',
        });
        // BELOW THE HORIZON IS DASHED, the way every attitude indicator
        // does it: at a glance, solid is sky and broken is ground.
        if (deg < 0) set(bar, { 'stroke-dasharray': '7 5' });
        root.appendChild(bar);
        parts.push(bar);
        if (deg !== 0) {
          const tick = svg('line');
          set(tick, {
            x1: LADDER_W / 2 + side * half, x2: LADDER_W / 2 + side * half,
            stroke: INK, 'stroke-width': 1.7,
          });
          root.appendChild(tick);
          parts.push(tick);
        }
      }
      let label: SVGElement | null = null;
      if (deg !== 0) {
        label = svg('text');
        set(label, {
          x: LADDER_W / 2 - half - 7, fill: DIM, 'font-size': 9,
          'text-anchor': 'end', 'font-family': 'ui-monospace, Menlo, monospace',
        });
        label.textContent = String(Math.abs(deg));
        root.appendChild(label);
      }
      this.rungs.push({ deg, parts, label });
    }
    return root;
  }

  /** Hang the rungs off wherever the horizon really is. */
  private hangLadder(horizon: number, perDegree: number): void {
    for (const rung of this.rungs) {
      const y = horizon - rung.deg * perDegree;
      const on = y > -LADDER_H && y < LADDER_H * 2;
      for (const part of rung.parts) {
        part.setAttribute('opacity', on ? '1' : '0');
        if (!on) continue;
        // A tick is the one with no length across; give it its drop.
        const flat = part.getAttribute('x1') === part.getAttribute('x2');
        set(part, {
          y1: y.toFixed(1),
          y2: flat ? (y + (rung.deg > 0 ? 5 : -5)).toFixed(1) : y.toFixed(1),
        });
      }
      if (rung.label) {
        rung.label.setAttribute('opacity', on ? '1' : '0');
        set(rung.label, { y: (y + 3.5).toFixed(1) });
      }
    }
  }

  private readonly rungs: { deg: number; parts: SVGElement[]; label: SVGElement | null }[] = [];

  /**
   * One labelled line on the right rail, sized to sit under the tape.
   *
   * The value is monospaced and the label is not merely decoration: with
   * three altitudes stacked, an unlabelled number is a number nobody can
   * use.
   */
  private railRow(label: string, value: HTMLSpanElement): HTMLDivElement {
    const row = document.createElement('div');
    Object.assign(row.style, {
      display: 'flex', alignItems: 'baseline', justifyContent: 'flex-end',
      gap: '6px', marginTop: '4px',
      font: '600 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace',
      letterSpacing: '0.16em', color: DIM,
    } as Partial<CSSStyleDeclaration>);
    value.style.color = INK;
    value.style.fontSize = '12px';
    value.style.fontWeight = '700';
    value.style.letterSpacing = '0.04em';
    row.append(span(label), value);
    return row;
  }

  private buildTape(): {
    box: SVGElement;
    ticks: { line: SVGElement; text: SVGElement }[];
    read: SVGElement;
  } {
    const w = 124;
    const spine = 62;
    const root = svg('svg');
    set(root, { width: w, height: TAPE_TALL, viewBox: `0 0 ${w} ${TAPE_TALL}`, fill: 'none' });
    const rail = svg('line');
    set(rail, {
      x1: spine, y1: 0, x2: spine, y2: TAPE_TALL, stroke: DIM, 'stroke-width': 1.4,
    });
    root.appendChild(rail);

    // WHICH ALTITUDE THIS TAPE IS. It was the only one on the screen and
    // needed no saying; beside a labelled MSL and a labelled LND, an
    // unlabelled tape is a third number nobody can name.
    const caption = svg('text');
    set(caption, {
      x: spine + 6, y: 11, fill: DIM, 'font-size': 9,
      'letter-spacing': 1.6,
      'font-family': 'ui-monospace, Menlo, monospace',
    });
    caption.textContent = 'AGL';
    root.appendChild(caption);

    const ticks: { line: SVGElement; text: SVGElement }[] = [];
    for (let i = 0; i < TICKS; i++) {
      const line = svg('line');
      set(line, { x1: spine, x2: spine + 6, y1: -20, y2: -20, stroke: DIM, 'stroke-width': 1.4 });
      const text = svg('text');
      set(text, {
        x: spine + 16, y: -20, fill: DIM, 'font-size': 10,
        'font-family': 'ui-monospace, Menlo, monospace',
      });
      root.append(line, text);
      ticks.push({ line, text });
    }

    // The reading, in a box pointing at the rail from the inboard side.
    const flag = svg('g');
    set(flag, { transform: `translate(${spine} ${TAPE_TALL / 2})` });
    const plate = svg('path');
    set(plate, {
      d: 'M0 0 L-8 -10 L-56 -10 L-56 10 L-8 10 Z',
      fill: 'rgba(8, 12, 8, .78)', stroke: INK, 'stroke-width': 1.6,
    });
    const read = svg('text');
    set(read, {
      x: -51, y: 5, fill: INK, 'font-size': 15, 'font-weight': 700,
      'font-family': 'ui-monospace, Menlo, monospace',
    });
    flag.append(plate, read);
    root.appendChild(flag);
    return { box: root, ticks, read };
  }

  /**
   * A circle with wings — the standard flight-path symbol, and it
   * happens to read as an ant seen from behind, which is convenient.
   */
  private buildPathMark(): SVGElement {
    const root = svg('svg');
    set(root, {
      width: 46, height: 22, viewBox: '0 0 46 22', fill: 'none',
      stroke: INK, 'stroke-width': 1.8, 'stroke-linecap': 'round',
    });
    const ring = svg('circle');
    set(ring, { cx: 23, cy: 11, r: 4.6 });
    const wings = svg('path');
    set(wings, { d: 'M18.4 11 L6 11 M27.6 11 L40 11 M23 6.4 L23 1.5' });
    root.append(ring, wings);
    return root;
  }

  /** Where the ground is going to be, if she carries on like this. */
  private buildTargetMark(): SVGElement {
    const root = svg('svg');
    set(root, {
      width: 30, height: 30, viewBox: '0 0 30 30', fill: 'none',
      stroke: INK, 'stroke-width': 1.7, 'stroke-linecap': 'round',
    });
    const ring = svg('circle');
    set(ring, { cx: 15, cy: 15, r: 7.5, 'stroke-dasharray': '3.6 3.2' });
    const cross = svg('path');
    set(cross, { d: 'M15 3.5 L15 8 M15 22 L15 26.5 M3.5 15 L8 15 M22 15 L26.5 15' });
    root.append(ring, cross);
    return root;
  }

  private buildWindArrow(): SVGElement {
    const root = svg('svg');
    set(root, { width: 22, height: 22, viewBox: '0 0 22 22', fill: 'none' });
    const shaft = svg('path');
    set(shaft, {
      d: 'M11 19 L11 4 M11 4 L7 9 M11 4 L15 9',
      stroke: INK, 'stroke-width': 1.8, 'stroke-linecap': 'round',
    });
    root.appendChild(shaft);
    return root;
  }

  /** Put the instruments where the telemetry says. */
  show(now: FlightTelemetry, aloft: boolean, view: FlightView): void {
    if (aloft !== this.up) {
      this.up = aloft;
      this.root.style.opacity = aloft ? '1' : '0';
    }
    if (!aloft) return;

    // The horizon goes where the horizon is; SHE banks, so the reticle
    // banks. The camera never does.
    this.hangLadder(LADDER_H / 2 + view.horizon, view.perDegree);
    this.ladder.style.opacity =
      ladderFade(view.horizon, window.innerHeight / 2).toFixed(2);

    // WHERE SHE IS ACTUALLY GOING, which is not where she is pointing.
    // Projected from her real ground-relative velocity, so a crosswind
    // slides it off her nose and a descent drops it below the horizon
    // — the one marker that tells her the wind is winning.
    this.place(this.path, view.path);
    this.place(this.target, view.target);
    if (view.target) {
      this.targetMark.setAttribute('stroke', view.target.hit ? WARN : INK);
    }
    this.drawTrail(view.her, view.target);

    const alt = Math.max(0, Math.round(now.shownAgl));
    if (alt !== this.shownAlt) {
      this.shownAlt = alt;
      this.tapeRead.textContent = readHeight(alt);
      const from = Math.floor((alt - TAPE_SPAN) / 100) * 100;
      for (let i = 0; i < TICKS; i++) {
        const cm = from + i * 100;
        const y = TAPE_TALL / 2 - ((cm - alt) / TAPE_SPAN) * (TAPE_TALL / 2);
        const { line, text } = this.tapeTicks[i];
        const off = cm < 0 || y < -2 || y > TAPE_TALL + 2;
        line.setAttribute('opacity', off ? '0' : '1');
        set(line, { y1: y.toFixed(1), y2: y.toFixed(1), x2: 62 + (cm % 200 === 0 ? 11 : 6) });
        const label = !off && cm % 200 === 0;
        text.setAttribute('opacity', label ? '1' : '0');
        if (label) {
          set(text, { y: (y + 3.5).toFixed(1) });
          // A BARE ZERO ON THE GROUND LINE. `readHeight` reports
          // millimetres down here, which is right for a live reading and
          // absurd for a tick: "0.0 mm" beside "2.0 m" reads as a unit
          // change rather than as the floor.
          text.textContent = cm === 0 ? '0' : readHeight(cm);
        }
      }
    }

    // MSL IS NOT SMOOTHED. Her height over the sea is a fact about her,
    // not a sample of anything, and it is the one readout where the
    // three-millimetre breathing of the air is honest rather than noise.
    const msl = readHeight(now.altitude);
    if (msl !== this.shownMsl) {
      this.shownMsl = msl;
      this.mslRead.textContent = msl;
    }
    const land = now.shownAtLanding === null
      ? '——' : readHeight(now.shownAtLanding);
    if (land !== this.shownLand) {
      this.shownLand = land;
      this.landRead.textContent = land;
    }

    const climb = Math.round(now.climbing * 10) / 10;
    if (climb !== this.shownVs) {
      this.shownVs = climb;
      this.vs.textContent = climb > 0 ? `+${climb.toFixed(1)}` : climb.toFixed(1);
      // DEADBAND ABOVE THE WANDER. The air moves her a quarter of a
      // centimetre a second even when she is holding a cruise, so a
      // threshold below that is an arrow that blinks on and off
      // forever and means nothing when it is on.
      this.vsArrow.textContent = climb > VS_QUIET ? '↑' : climb < -VS_QUIET ? '↓' : '';
    }

    // THE TOUCHDOWN ZONE, as a distance and a time — the two numbers
    // Joshua's worked example ends in, and the pair raw altitude cannot
    // give between them. A steady altitude flown at a rising ridge
    // reads as perfectly level right up until it does not.
    const line = touchdownCall(now.shownRange, now.shownWhen);
    if (line !== this.shownTgt) {
      this.shownTgt = line;
      this.tgt.textContent = line;
      this.tgt.style.color = now.shownWhen !== null && now.shownWhen < SOON
        ? WARN : DIM;
    }

    // DRIFT, only when there is any worth reporting. A permanent
    // "0°" is a number that has never once been read.
    const drift = Math.round(now.drift);
    const ground = `GND ${
      String(Math.round(wrap360(now.track)) % 360).padStart(3, '0')}° @ ${
      now.groundSpeed.toFixed(1)} cm/s${
      Math.abs(drift) >= 3 ? `  ${drift < 0 ? '←' : '→'} ${Math.abs(drift)}°` : ''}`;
    if (ground !== this.shownDrift) {
      this.shownDrift = ground;
      this.drift.textContent = ground;
    }
    this.drift.style.opacity = aloft ? '1' : '0';

    this.windStrip.style.opacity = now.wind.speed >= 0.05 ? '1' : '0';
    // Where the wind is pushing her, RELATIVE TO HER NOSE. Screen up is
    // the way she is pointing, so an arrow pointing up is a tailwind and
    // one pointing down is the wind she is fighting.
    set(this.windArrow, {
      style: `transform: rotate(${wrap360(now.wind.bearing - now.heading).toFixed(1)}deg)`,
    });

    // CENTIMETRES PER SECOND, NOT METRES — and this was a real bug
    // rather than a preference.
    //
    // The wind was printed in m/s to one decimal while everything it
    // explains — airspeed, ground speed — is in cm/s to one decimal.
    // Two orders of magnitude apart, so "0.0" covered any wind under
    // 5 cm/s, which is not a rounding error at this scale: it is more
    // than a body length a second. Worse, the wind she feels is scaled
    // by height (windProfile), and below about half a metre even a
    // full 25 km/h trade wind lands under that threshold. So the
    // ordinary case — flying low, in real weather — showed WIND 0.0
    // while ground speed and airspeed visibly disagreed, and nothing
    // on screen could account for the difference.
    //
    // Same unit, same precision, and the arithmetic closes: ground
    // speed is airspeed plus this, component by component.
    const felt = Math.round(now.wind.speed * 10) / 10;
    if (felt !== this.shownWind) {
      this.shownWind = felt;
      this.windSpeed.textContent = felt.toFixed(1);
    }
    // How much of it is straight back at her: a crosswind she can
    // crab into, a headwind she may simply not beat.
    const along = Math.cos(
      ((now.wind.bearing - now.heading) * Math.PI) / 180,
    ) * now.wind.speed;
    const call = windCall(now.wind.speed, along) ?? '';
    if (call !== this.shownCall) {
      this.shownCall = call;
      this.windCall.textContent = call ? `⚠ ${call}` : '';
    }
  }

  private place(el: HTMLElement, at: { x: number; y: number } | null): void {
    el.style.opacity = at ? '1' : '0';
    if (!at) return;
    el.style.transform =
      `translate(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px) translate(-50%, -50%)`;
  }

  /**
   * A thin line from under her out to where she is headed.
   *
   * A navigation aid and not a laser: faint, and gone the moment there
   * is nothing to point at.
   */
  private drawTrail(
    her: { x: number; y: number } | null,
    target: { x: number; y: number } | null,
  ): void {
    const on = Boolean(her && target);
    this.trail.style.opacity = on ? '0.5' : '0';
    if (!her || !target) return;
    set(this.trailLine, { x1: her.x, y1: her.y, x2: target.x, y2: target.y });
  }

  dispose(): void {
    this.watch.disconnect();
    this.root.remove();
  }
}

/**
 * A height a person can read.
 *
 * Centimetres while she is close enough for them to mean something,
 * metres once they stop: "1,240 cm" is a number, "12.4 m" is a height.
 */
/**
 * THE TOUCHDOWN LINE: how far ahead she meets the ground, and when.
 *
 * Em-dashes rather than a hidden row when there is no touchdown. A
 * readout that vanishes takes its label with it, and the player is left
 * to work out whether the instrument is saying "nothing ahead" or has
 * simply stopped working. Holding the label and blanking the value says
 * which — and it keeps the strip from reflowing every time a cruise
 * levels off.
 */
export function touchdownCall(
  range: number | null, when: number | null,
): string {
  if (range === null || when === null) return 'TGT ——';
  // Seconds while the number is small enough to count, minutes after
  // that: "560s" is a figure to be converted, "9.3m" is one to be read.
  const wait = when < 100 ? `${Math.round(when)}s` : `${(when / 60).toFixed(1)}m`;
  return `TGT ${readHeight(Math.max(0, range))} · ${wait}`;
}

export function readHeight(cm: number): string {
  const size = Math.abs(cm);
  // MILLIMETRES AT THE BOTTOM, because this is an ant's altimeter and
  // the bottom is where she lives. One world unit is a centimetre, so
  // rounding to whole centimetres made every height below one into
  // "0 cm" — the entire takeoff roll, the whole of a hover over a
  // pebble, and any clearance worth the name. Joshua wrote the mock in
  // millimetres for exactly that reason.
  if (size < 1) return `${(cm * 10).toFixed(1)} mm`;
  // Between there and a body length, the tenth is the news.
  if (size < 10) return `${cm.toFixed(1)} cm`;
  if (size < 100) return `${Math.round(cm)} cm`;
  // A tenth of a metre stays useful a long way up — the brief's own
  // example is 12.7 m — and only stops being a distinction she can act
  // on when she is high enough that the whole number is the news.
  if (size < 10_000) return `${(cm / 100).toFixed(1)} m`;
  return `${Math.round(cm / 100)} m`;
}

function span(text: string): HTMLSpanElement {
  const el = document.createElement('span');
  el.textContent = text;
  return el;
}
