import { MAX_POWERED_SPEED } from '../ant/flight';
import { UNITS_PER_METRE } from '../world/kauai';

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
const TAPE_TALL = 200;
const TAPE_SPAN = 500;
/** How many tick elements the tape keeps. Enough to cover the span. */
const TICKS = 13;

/** The layout is drawn for this height and scaled from it. */
const DESIGN_TALL = 430;

export interface FlightReading {
  readonly aloft: boolean;
  /** Above the ground, in world units — centimetres. */
  readonly height: number;
  /** Vertical speed, cm/s. Positive is up. */
  readonly climbing: number;
  /** Radians. */
  readonly roll: number;
  readonly pitch: number;
  /** Through the air, cm/s. */
  readonly airspeed: number;
  /** Over the ground, cm/s — airspeed plus whatever the wind is doing. */
  readonly ground: number;
  /**
   * The wind AS SHE FEELS IT, which is not what the station reported:
   * it is scaled by how high she is and it breathes. Null before the
   * weather has landed.
   */
  readonly wind: {
    /** Units per second, at her height. */
    readonly speed: number;
    /** Where it is pushing her, radians, in the same frame as her heading. */
    readonly heading: number;
  } | null;
  /** Her own heading, radians, so the wind can be drawn relative to it. */
  readonly heading: number;
  /**
   * Where the true horizon is, in pixels below the middle of the
   * screen, and what one degree of it is worth. From the camera, not
   * from her — see the note on the ladder.
   */
  readonly horizon: number;
  readonly perDegree: number;
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
  private readonly mark: HTMLDivElement;
  private readonly tapeTicks: { line: SVGElement; text: SVGElement }[] = [];
  private readonly tapeRead: SVGElement;
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
  private shownVs = Number.NaN;
  private shownWind = Number.NaN;
  private shownCall = '';

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

    this.mark = this.cluster('50%', '31%', 'translate(-50%, -50%)', 'center center');
    this.mark.appendChild(this.buildQueenMark());

    const { box, ticks, read } = this.buildTape();
    this.tapeTicks.push(...ticks);
    this.tapeRead = read;
    // INBOARD OF THE CLIMB AND DESCEND BUTTONS, not against the edge.
    // The right rail belongs to her thumb; a tape under it is a tape
    // she cannot read and a button she presses by accident.
    const right = this.cluster(null, '48%', 'translateY(-50%)', 'right center');
    right.style.right = 'calc(88px + min(env(safe-area-inset-right), 14px))';
    right.appendChild(box);

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
      span('WIND'), this.windArrow, this.windSpeed, span('m/s'), this.windCall,
    );

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
   * HER OWN SILHOUETTE AS THE FIXED REFERENCE.
   *
   * A fighter's boresight is a W and a dot. Hers is an ant, which costs
   * nothing to draw and makes the instrument belong to this game. It
   * sits ABOVE the model rather than over it: dead centre the two
   * silhouettes fought each other and neither read.
   */
  private buildQueenMark(): SVGElement {
    const root = svg('svg');
    set(root, {
      width: 72, height: 40, viewBox: '0 0 72 40', fill: 'none',
      stroke: INK, 'stroke-width': 1.9, 'stroke-linecap': 'round',
    });
    const draw = (tag: string, attrs: Record<string, string | number>) => {
      const el = svg(tag);
      set(el, attrs);
      root.appendChild(el);
    };
    draw('path', { d: 'M4 15 L22 20 M68 15 L50 20' });
    draw('path', { d: 'M30 9 L24 2 M42 9 L48 2' });
    draw('ellipse', { cx: 36, cy: 12.5, rx: 5.2, ry: 4.4 });
    draw('ellipse', { cx: 36, cy: 21, rx: 4.4, ry: 5 });
    draw('ellipse', { cx: 36, cy: 31.5, rx: 6, ry: 7 });
    return root;
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

  /** Put the instruments where the reading says. */
  show(now: FlightReading): void {
    if (now.aloft !== this.up) {
      this.up = now.aloft;
      this.root.style.opacity = now.aloft ? '1' : '0';
    }
    if (!now.aloft) return;

    // The horizon goes where the horizon is; SHE banks, so the reticle
    // banks. The camera never does.
    this.hangLadder(LADDER_H / 2 + now.horizon, now.perDegree);
    this.ladder.style.opacity =
      ladderFade(now.horizon, window.innerHeight / 2).toFixed(2);
    this.mark.dataset.roll = `rotate(${((-now.roll * 180) / Math.PI).toFixed(2)}deg)`;
    this.fitOne(this.mark);

    const alt = Math.max(0, Math.round(now.height));
    if (alt !== this.shownAlt) {
      this.shownAlt = alt;
      this.tapeRead.textContent = String(alt);
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
          text.textContent = String(cm);
        }
      }
    }

    const climb = Math.round(now.climbing * 10) / 10;
    if (climb !== this.shownVs) {
      this.shownVs = climb;
      this.vs.textContent = climb > 0 ? `+${climb.toFixed(1)}` : climb.toFixed(1);
      this.vsArrow.textContent = climb > 0.15 ? '↑' : climb < -0.15 ? '↓' : '';
    }

    this.windStrip.style.opacity = now.wind ? '1' : '0';
    if (!now.wind) return;
    // Where the wind is pushing her, RELATIVE TO HER NOSE. Screen up is
    // the way she is pointing, so an arrow pointing up is a tailwind and
    // one pointing down is the wind she is fighting.
    const relative = ((now.wind.heading - now.heading) * 180) / Math.PI;
    set(this.windArrow, { style: `transform: rotate(${(relative + 180).toFixed(1)}deg)` });

    const felt = Math.round((now.wind.speed / UNITS_PER_METRE) * 10) / 10;
    if (felt !== this.shownWind) {
      this.shownWind = felt;
      this.windSpeed.textContent = felt.toFixed(1);
    }
    const along = Math.cos(now.wind.heading - now.heading) * now.wind.speed;
    const call = windCall(now.wind.speed, along) ?? '';
    if (call !== this.shownCall) {
      this.shownCall = call;
      this.windCall.textContent = call ? `⚠ ${call}` : '';
    }
  }

  dispose(): void {
    this.watch.disconnect();
    this.root.remove();
  }
}

function span(text: string): HTMLSpanElement {
  const el = document.createElement('span');
  el.textContent = text;
  return el;
}
