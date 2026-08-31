/**
 * THE WHOLE ISLAND, AND THE ONE PLACE SHE IS GOING NEXT.
 *
 * The minimap can say where she is standing. It cannot be used to
 * choose where to go: a hundred pixels of Kauaʻi is better than four
 * hundred metres to the pixel, so a waypoint tapped on it would land
 * half a kilometre from wherever the thumb actually came down. This is
 * the surface that can — the island filling the glass, panned and
 * zoomed, with room to point at a valley rather than at a coast.
 *
 * TWO PINS, AND THAT IS THE WHOLE DESIGN. A tap places a PREVIEW: a
 * hollow gold ring, a proposal, costing nothing and ordering nothing.
 * FLY HERE turns that preview into the ACTIVE mission, drawn as a
 * solid gold disc. Both can be on screen at once and they are drawn to
 * be told apart at a glance, because the failure this shape exists to
 * prevent is the one a player never sees coming: a thumb that slid
 * while panning, read as a tap, quietly re-ordering a queen across
 * fifty kilometres of ocean. A pan is not a tap here — the decision is
 * `mapView.isDrag` and nothing else — and a preview is never a mission
 * until a second, deliberate press says so.
 *
 * IT MOVES NOTHING. Nothing in this file imports flight, and nothing
 * here writes a position or a velocity. `confirm` hands the scene a
 * WorldPoint and the scene decides what to do with it; `clearMission`
 * says a player wants the current one dropped. The map is an opinion
 * about where to go, delivered to whoever owns the queen.
 *
 * NO ETA, DELIBERATELY. The Phase 1 trip estimator is a straight line
 * at a fixed speed, which is a fine input to an autonomy decision and a
 * lie when it is printed beside a map: a time next to a destination
 * reads as a flight plan, and this screen has no flight plan to show.
 * Range and bearing are things that are true right now, so those are
 * what the readout carries. The reference line is dashed and captioned
 * for the same reason — it is the direct line between two points, not a
 * route anybody intends to fly.
 *
 * THE READOUT STAYS HONEST IN THE FOG. Undiscovered ground can still be
 * tapped, because flying into the unknown is how exploration happens,
 * and range and bearing to an unknown place are perfectly true. What
 * the readout must NOT do is name the ground there — asking the
 * heightfield what a fogged cell is would hand back the survey the fog
 * exists to withhold, one tap at a time.
 *
 * ZOOM IS BUTTONS, NOT PINCH. There is no multi-touch anywhere in this
 * codebase and `index.html` disables native pinch twice over; adding
 * the first multi-pointer gesture handler to the game inside a map
 * screen would be a new input system smuggled in as a feature. So the
 * pointer here is strictly single — a second finger is ignored until
 * the first lifts — and zoom is [-] and [+], which also happen to be
 * the only zoom controls that work one-thumbed on a phone.
 *
 * AND THE DRAG THAT IS ALREADY IN FLIGHT. `LookDrag` is the game's only
 * global pointer surface: it binds to `#app` and never asks what was
 * under the finger, which is exactly what makes a drag on empty screen
 * turn the camera. The cost is that a full-screen panel opening OVER a
 * live drag inherits it — every move on this map would keep swinging
 * the world behind it. So the root swallows `pointerdown` and
 * `pointermove`, and it very deliberately does NOT swallow `pointerup`
 * or `pointercancel`: LookDrag clears its claimed pointer id on the
 * lift, and eating that lift strands the id forever, which kills the
 * camera for the rest of the run. Blocking moves fixes a swinging
 * camera; blocking lifts trades it for a dead one.
 */
import { bakeIsland } from './islandMap';
import { reliefIsland } from './islandRelief';

/**
 * The island to draw: the textured relief once it exists, the flat
 * chart until then.
 *
 * `warmRelief` is kicked off by the scene behind the loading screen and
 * resolves to null if the ground textures cannot be read, so this is
 * the one place that difference is dealt with. Both are the same size
 * in WORLD terms — a square of the whole 56 km map — so nothing else
 * has to know which one came back.
 */
function islandPicture(): HTMLCanvasElement {
  return reliefIsland() ?? bakeIsland();
}
import type { Discovery } from '../game/discovery';
import {
  HONEST_ZOOM, ZOOM_STEPS, initialView, isDrag, islandOrigin, islandPixels,
  panBy, recentre, screenToWorld, worldToScreen, zoomBy, zoomFactor,
  type MapMarks, type MapView, type Viewport,
} from './mapView';
import {
  apart, bearingFromHeading, bearingTo, cardinalOf, rangeWords, wrap360,
} from './compassMath';
import { world, type WorldPoint } from '../world/coords';

/** Map gold, unknown ink, and the affirmative green. See the palette. */
const GOLD = 'rgba(255, 216, 130, .85)';
const GOLD_EDGE = 'rgba(255, 216, 130, .7)';
const INK = 'rgba(9, 13, 20, .93)';
/** The same colour with nothing behind it — see the root's background. */
const SOLID_INK = 'rgb(9, 13, 20)';
const CARD = 'rgba(18, 14, 6, .72)';
const SHADOW = '0 0 0 2px rgba(0,0,0,.32), 0 3px 14px rgba(0,0,0,.42)';
const LIVE = 'rgb(110, 255, 150)';
const WARM = 'rgba(255, 236, 200, .92)';

/**
 * WHAT THE LINE UNDER THE READOUT IS, and the two are not the same
 * claim. A straight line between two points is a bearing and a
 * distance; a route is somewhere she has been planned to fly. Calling
 * the first one a route was the reason the caption was written; calling
 * the second one a direct line would be the same mistake reversed.
 */
const DIRECT = 'Direct line — not a planned route.';
const ROUTED = 'Planned route — around what she cannot fly over.';
const CHAINED = 'Tap to add a stop. The last one is the destination.';
/** The dark liner every marker carries, so gold survives gold sand. */
const LINER = '#0b1018';

/**
 * Nothing on this screen is smaller than this across.
 *
 * 44 px is the smallest thing a thumb hits reliably, and it is the
 * floor for the close button as much as for the zoom pair — an X that
 * needs a second attempt on a map covering the whole game is the sort
 * of small annoyance that gets described as "it froze".
 */
const TAP = 44;

export interface MapScreenHooks {
  /**
   * FLY HERE. The scene turns this into a MissionBrain order.
   *
   * A CHAIN, in tap order, with the LAST point the destination.
   * Everything before it is somewhere she goes on the way. It was a
   * single point until v0.0.141; a one-element array is exactly the
   * same order it always was.
   */
  readonly confirm: (chain: readonly WorldPoint[]) => void;
  /** CLEAR, when an active mission is being cancelled rather than a preview. */
  readonly clearMission: () => void;
  /** Opened / closed, so the scene can neutralise the player in multiplayer. */
  readonly onToggle: (open: boolean) => void;
}

/** Which pin CLEAR is about to act on — or neither. */
export type ClearTarget = 'preview' | 'mission' | 'none';

/**
 * What CLEAR will do if it is pressed right now.
 *
 * ONE BUTTON, TWO MEANINGS, and that is only safe because the order is
 * fixed and the label says which one is loaded. The preview always
 * wins: it is the thing the player just made, it is uncommitted, and
 * throwing it away costs one tap to redo. Letting the same press
 * cancel a live mission while a fresh ring sat on screen would be a
 * destructive action hiding behind a harmless one.
 */
export function clearTarget(
  draft: readonly WorldPoint[], primary: WorldPoint | null,
): ClearTarget {
  if (draft.length > 0) return 'preview';
  if (primary) return 'mission';
  return 'none';
}

/**
 * The words on CLEAR, so nobody has to guess which pin it takes.
 *
 * A button labelled only "CLEAR" beside two pins is a coin toss, and
 * the losing side of that toss cancels a mission the player wanted.
 */
export function clearWords(target: ClearTarget, drafted = 1): string {
  // ONE TAP UNDONE AT A TIME once there is a chain, because a route
  // built by five taps that four of them cannot undo is a route the
  // player has to start again to fix.
  if (target === 'preview') return drafted > 1 ? 'UNDO PIN' : 'CLEAR PIN';
  if (target === 'mission') return 'CANCEL MISSION';
  return 'CLEAR';
}

/**
 * Whether FLY HERE may be pressed.
 *
 * Only a preview arms it — never the active mission, or the button
 * would re-order what is already ordered, and never an empty map. The
 * finite check is not paranoia: the preview comes back from a screen
 * transform, and a viewport that has not been laid out yet can hand
 * back a NaN which would sail into `MissionBrain.order` and sit there
 * as a destination that can never be arrived at.
 */
export function canFly(draft: readonly WorldPoint[]): boolean {
  return draft.length > 0
    && draft.every((at) => Number.isFinite(at.wx) && Number.isFinite(at.wz));
}

/** A compass bearing as the readout prints it: `NE 041°`. */
export function degreeWords(bearing: number): string {
  if (!Number.isFinite(bearing)) return '—';
  // Rounded FIRST and then wrapped, or 359.7° prints as 360° — a
  // bearing that does not exist, one degree from the one that does.
  const whole = Math.round(wrap360(bearing)) % 360;
  return `${cardinalOf(whole)} ${String(whole).padStart(3, '0')}°`;
}

/** The three true things about a destination. No ETA — see the header. */
export interface Readout {
  /** Which pin this describes. */
  readonly label: string;
  /** Straight-line distance, in metres or kilometres. */
  readonly range: string;
  /** Compass bearing from her to it. */
  readonly bearing: string;
  /** How many waypoints the draft holds, when it holds more than one. */
  readonly stops: number;
}

/** What the sheet says when there is nowhere to say anything about. */
export const NOWHERE: Readout = {
  label: 'NO DESTINATION', range: '—', bearing: '—', stops: 0,
};

/**
 * The destination readout, from the two pins and where she stands.
 *
 * The preview outranks the mission for the same reason it outranks it
 * on CLEAR: it is what FLY HERE would act on, so it is what the numbers
 * beside FLY HERE must describe. Reading out the old mission while a
 * fresh ring sat on the map would mean the range shown and the range
 * about to be flown were different numbers.
 *
 * Range comes from `rangeWords` and the bearing from `bearingTo`, both
 * in compassMath, rather than from arithmetic written out again here.
 * Bearings are the part that can be wrong for weeks without anyone
 * noticing, and this repo has already paid 142 degrees once for a
 * conversion done in place.
 */
export function readout(
  from: WorldPoint | null,
  draft: readonly WorldPoint[],
  primary: WorldPoint | null,
): Readout {
  // THE LAST TAP IS THE DESTINATION. Joshua, 2026-08-31: "add more than
  // 1 waypoint as a tap/spline with the last point always the
  // destination." Everything before it is somewhere she goes on the
  // way, so the numbers beside FLY describe the END of the chain — that
  // is what the press commits her to arriving at.
  const stops = draft.length;
  const to = stops > 0 ? draft[stops - 1] : primary;
  if (!to) return NOWHERE;
  const label = stops > 0 ? 'PREVIEW' : 'MISSION';
  if (!from) return { label, range: '—', bearing: '—', stops };
  const gap = apart(from, to);
  if (!Number.isFinite(gap)) return { label, range: '—', bearing: '—', stops };
  return {
    label,
    range: rangeWords(gap),
    bearing: degreeWords(bearingTo(from, to)),
    stops,
  };
}

export class MapScreen {
  private readonly root: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly title: HTMLDivElement;
  /** The readout's first line — which pin the numbers describe. */
  private readonly destination: HTMLDivElement;
  private readonly figures: HTMLDivElement;
  private readonly caption: HTMLDivElement;
  private said = DIRECT;
  private readonly clear: HTMLButtonElement;
  private readonly fly: HTMLButtonElement;
  private readonly closer: HTMLButtonElement;
  private readonly wider: HTMLButtonElement;
  private readonly tighter: HTMLButtonElement;
  private readonly centring: HTMLButtonElement;
  private readonly detach: Array<() => void> = [];

  private shown = false;
  private view: MapView = initialView(world(0, 0));
  private marks: MapMarks | null = null;
  private known: Discovery | null = null;
  /**
   * THE CHAIN BEING BUILT, in the order it was tapped.
   *
   * It was a single `preview` point: one tap, one destination. Joshua,
   * 2026-08-31: "Ability to add more than 1 waypoint as a tap/spline
   * with the last point always the destination."
   *
   * So a tap APPENDS rather than replaces, and the last one is where
   * she is going; everything before it is somewhere she goes on the
   * way. Uncommitted until FLY — a chain of rings is still a thought.
   */
  private draft: WorldPoint[] = [];

  /** The single pointer this screen is following, if any. */
  private pointerId: number | null = null;
  private from = { x: 0, y: 0 };
  private last = { x: 0, y: 0 };
  private panned = false;

  /** The fog overlay, rebuilt only when the mask actually changes. */
  private fogSheet: HTMLCanvasElement | null = null;
  private fogOf: Discovery | null = null;
  private fogAt = -1;

  constructor(host: HTMLElement, private readonly hooks: MapScreenHooks) {
    this.root = document.createElement('div');
    this.root.dataset.ui = 'map-screen';
    Object.assign(this.root.style, {
      position: 'fixed',
      inset: '0',
      display: 'none',
      flexDirection: 'column',
      gap: '6px',
      // Above the settings gear at 45, below MainMenu and the rotate
      // gate at 50 — a map must not cover the "turn your phone" card.
      zIndex: '46',
      // OPAQUE, not the .93 ink the canvas uses. Seven per cent is
      // enough to read the HUD through: the probe frame had the vitals
      // card's gold border and the compass tape ghosting across the top
      // of the map, which looks like a rendering fault rather than a
      // deliberate veil. The gameplay HUD is not context here — this
      // screen answers a different question and wants the whole frame.
      background: SOLID_INK,
      color: WARM,
      font: '13px/1.4 system-ui, sans-serif',
      touchAction: 'none',
      // Or the safe-area padding lands OUTSIDE the fixed inset and the
      // column overflows the window by exactly the padding.
      boxSizing: 'border-box',
      padding: 'calc(6px + min(env(safe-area-inset-top), 12px)) '
        + 'calc(8px + min(env(safe-area-inset-right), 12px)) '
        + 'calc(6px + min(env(safe-area-inset-bottom), 12px)) '
        + 'calc(8px + min(env(safe-area-inset-left), 12px))',
    } as Partial<CSSStyleDeclaration>);

    // ---- header: X, title, and the view controls ----------------------
    const header = document.createElement('div');
    Object.assign(header.style, {
      flex: '0 0 auto',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
    } as Partial<CSSStyleDeclaration>);

    this.closer = this.button('✕', 'map-close', () => this.close());
    // The one control that must never be hunted for: it is the first
    // thing under the left thumb and it carries no other meaning.
    this.closer.style.fontSize = '18px';

    this.title = document.createElement('div');
    this.title.dataset.ui = 'map-title';
    this.title.textContent = 'MAP';
    Object.assign(this.title.style, {
      flex: '1 1 auto',
      minWidth: '0',
      font: '700 13px/1 system-ui, sans-serif',
      letterSpacing: '.22em',
      color: GOLD,
    } as Partial<CSSStyleDeclaration>);

    this.tighter = this.button('−', 'map-zoom-out', () => this.step(-1));
    this.wider = this.button('+', 'map-zoom-in', () => this.step(1));
    this.centring = this.button('◎', 'map-recentre', () => this.follow());
    this.centring.title = 'Centre on the queen';

    header.append(
      this.closer, this.title, this.tighter, this.wider, this.centring,
    );

    // ---- the map itself, taking everything left over ------------------
    const frame = document.createElement('div');
    Object.assign(frame.style, {
      flex: '1 1 auto',
      // Without this a flex child refuses to shrink below its content
      // and the bottom sheet is pushed off a 430-pixel-tall phone.
      minHeight: '0',
      position: 'relative',
      overflow: 'hidden',
      borderRadius: '12px',
      border: `2px solid ${GOLD_EDGE}`,
    } as Partial<CSSStyleDeclaration>);

    this.canvas = document.createElement('canvas');
    this.canvas.dataset.ui = 'map-canvas';
    Object.assign(this.canvas.style, {
      display: 'block',
      width: '100%',
      height: '100%',
      touchAction: 'none',
      cursor: 'crosshair',
    } as Partial<CSSStyleDeclaration>);
    frame.appendChild(this.canvas);

    // ---- bottom sheet: what is chosen, and what can be done with it ---
    const sheet = document.createElement('div');
    sheet.dataset.ui = 'map-sheet';
    Object.assign(sheet.style, {
      flex: '0 0 auto',
      display: 'flex',
      alignItems: 'stretch',
      gap: '10px',
      padding: '8px 10px',
      borderRadius: '12px',
      border: `2px solid ${GOLD_EDGE}`,
      background: CARD,
      boxShadow: SHADOW,
      boxSizing: 'border-box',
    } as Partial<CSSStyleDeclaration>);

    const left = document.createElement('div');
    Object.assign(left.style, {
      flex: '1 1 0',
      minWidth: '0',
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
    } as Partial<CSSStyleDeclaration>);

    const words = document.createElement('div');
    Object.assign(words.style, {
      flex: '1 1 auto',
      minWidth: '0',
    } as Partial<CSSStyleDeclaration>);

    this.destination = document.createElement('div');
    this.destination.dataset.ui = 'map-destination';
    Object.assign(this.destination.style, {
      font: '700 10px/1.2 system-ui, sans-serif',
      letterSpacing: '.18em',
      color: GOLD,
    } as Partial<CSSStyleDeclaration>);

    this.figures = document.createElement('div');
    Object.assign(this.figures.style, {
      marginTop: '3px',
      font: '600 15px/1.2 ui-monospace, monospace',
      color: WARM,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    } as Partial<CSSStyleDeclaration>);

    this.caption = document.createElement('div');
    // SAYS WHAT THE LINE IS. A line drawn between two points on a map
    // looks like a route unless it is called something else, and until
    // v0.0.140 this one never was: no altitude, no wind, no terrain,
    // nothing planned. Naming it was the price of being allowed to draw
    // it — and now that a planner exists, keeping the same words over a
    // line that IS a route would be the same lie in the other
    // direction. `caption` is written per frame, in `settle`.
    this.caption.textContent = DIRECT;
    Object.assign(this.caption.style, {
      marginTop: '2px',
      font: '10px/1.2 system-ui, sans-serif',
      color: 'rgba(255, 236, 200, .5)',
      visibility: 'hidden',
    } as Partial<CSSStyleDeclaration>);

    words.append(this.destination, this.figures, this.caption);

    this.clear = this.button('CLEAR', 'map-clear', () => this.wipe());
    this.fly = this.button('FLY HERE', 'fly-here', () => this.commit());
    // The two are wider than the square view controls; they carry
    // words rather than a glyph and they are the ones that commit.
    for (const wide of [this.clear, this.fly]) {
      wide.style.width = 'auto';
      wide.style.padding = '0 14px';
      wide.style.letterSpacing = '.1em';
    }
    this.fly.style.border = `2px solid ${LIVE}`;
    this.fly.style.background = 'rgba(110, 255, 150, .16)';
    this.fly.style.color = LIVE;

    left.append(words, this.clear, this.fly);

    // THE RIGHT HALF IS EMPTY ON PURPOSE. Phase 3's flight planner goes
    // here, and until it exists there is nothing in this space — no
    // placeholder, no greyed control, no label promising one. An
    // unavailable action must never look functional, and the cheapest
    // way to keep that promise is to ship no control at all.
    const spare = document.createElement('div');
    spare.dataset.ui = 'map-sheet-spare';
    Object.assign(spare.style, {
      flex: '1 1 0',
      minWidth: '0',
    } as Partial<CSSStyleDeclaration>);

    sheet.append(left, spare);

    this.root.append(header, frame, sheet);
    host.appendChild(this.root);

    // ---- listeners, every one of them on this screen's own elements ---
    //
    // THE HALF-SWALLOW, and it has to be exactly this half. LookDrag
    // binds `pointerdown`/`move`/`up`/`cancel` to `#app` and never
    // inspects `e.target`, so without this the camera swings behind the
    // map on every pan. Stopping down and move stops the swing. Stopping
    // UP would strand LookDrag's claimed `pointerId` — a drag already in
    // flight when this screen opened never gets its lift, `read()` keeps
    // reporting `active`, and no later pointer can ever be claimed
    // again. LookDrag.release() now exists for the in-flight case and
    // the scene should call it on open; this stays regardless, because
    // it is what keeps the camera still while the map is up.
    const swallow = (e: Event) => e.stopPropagation();
    this.listen(this.root, 'pointerdown', swallow);
    this.listen(this.root, 'pointermove', swallow);

    this.listen<PointerEvent>(this.canvas, 'pointerdown', (e) => this.grab(e));
    this.listen<PointerEvent>(this.canvas, 'pointermove', (e) => this.drag(e));
    this.listen<PointerEvent>(this.canvas, 'pointerup', (e) => this.lift(e));
    this.listen<PointerEvent>(this.canvas, 'pointercancel', (e) => this.drop(e));

    // An honest resting state before the scene has said anything: the
    // sheet is built saying it has no destination, because it has not.
    this.destination.textContent = NOWHERE.label;
    this.figures.textContent = `${NOWHERE.range}   ${NOWHERE.bearing}`;
    this.able(this.clear, false);
    this.able(this.fly, false);
    this.able(this.centring, false);
    this.able(this.tighter, false);
  }

  get isOpen(): boolean {
    return this.shown;
  }

  /**
   * Show the map, looking at her.
   *
   * Opens with no preview every time. A ring is an uncommitted thought;
   * carrying one across a close and a reopen would mean FLY HERE was
   * armed with a destination the player chose in a different minute and
   * may not still be looking at.
   */
  open(marks: MapMarks, known: Discovery): void {
    this.marks = marks;
    this.known = known;
    // Only the FIRST open resets the view and announces itself. A
    // second call on an already-open screen is a redraw, and taking it
    // as an opening would snap the player's pan back to her and tell
    // the scene to neutralise a player it already neutralised.
    if (!this.shown) {
      this.shown = true;
      this.draft = [];
      this.view = initialView(marks.at);
      this.root.style.display = 'flex';
      this.hooks.onToggle(true);
    }
    this.refresh();
  }

  close(): void {
    if (!this.shown) return;
    this.shown = false;
    this.draft = [];
    this.pointerId = null;
    this.panned = false;
    this.root.style.display = 'none';
    this.hooks.onToggle(false);
  }

  /**
   * Live position while open, so the queen marker tracks a running
   * world.
   *
   * In multiplayer the world does not stop for a map, so the marker
   * that says "you are here" has to keep being right. Driven by the
   * scene rather than by a timer of its own — a UI component that runs
   * its own loop keeps running after the screen it draws is gone.
   */
  update(marks: MapMarks, known: Discovery): void {
    this.marks = marks;
    this.known = known;
    if (this.shown) this.refresh();
  }

  dispose(): void {
    for (const off of this.detach) off();
    this.detach.length = 0;
    // No `onToggle(false)` on the way out: the scene tearing this down
    // is the scene that owns the hook, and calling back into something
    // mid-teardown is how a disposed screen resurrects a HUD.
    this.shown = false;
    this.root.remove();
  }

  // ---- controls -------------------------------------------------------

  private step(by: number): void {
    this.view = zoomBy(this.view, by);
    this.refresh();
  }

  private follow(): void {
    if (!this.marks) return;
    this.view = recentre(this.view, this.marks.at);
    this.refresh();
  }

  /**
   * FLY HERE — the only thing on this screen that orders anything.
   *
   * The preview becomes the pin. `marks.primary` is written locally as
   * well as handed to the scene, and only because the scene's answer
   * arrives on the NEXT `update()`: without it the readout blinks to NO
   * DESTINATION for a frame at the exact moment the player committed.
   * It is optimism with a one-frame lifetime — the next update is the
   * truth and overwrites it either way.
   */
  private commit(): void {
    if (!canFly(this.draft)) return;
    const chain = [...this.draft];
    this.hooks.confirm(chain);
    if (this.marks) {
      this.marks = { ...this.marks, primary: chain[chain.length - 1] };
    }
    this.draft = [];
    this.refresh();
  }

  /** CLEAR, acting on whichever pin its own label named. */
  private wipe(): void {
    const target = clearTarget(this.draft, this.marks?.primary ?? null);
    if (target === 'preview') {
      // The LAST tap, not all of them. A five-tap route that only
      // starting again can correct is a route nobody edits.
      this.draft.pop();
    } else if (target === 'mission') {
      this.hooks.clearMission();
      if (this.marks) this.marks = { ...this.marks, primary: null };
    }
    this.refresh();
  }

  // ---- the pointer ----------------------------------------------------

  private grab(e: PointerEvent): void {
    // ONE POINTER AT A TIME. A second finger is ignored rather than
    // interpreted — see the header on why there is no pinch here.
    if (this.pointerId !== null) return;
    this.pointerId = e.pointerId;
    this.from = { x: e.clientX, y: e.clientY };
    this.last = { x: e.clientX, y: e.clientY };
    this.panned = false;
    this.canvas.setPointerCapture(e.pointerId);
  }

  private drag(e: PointerEvent): void {
    if (e.pointerId !== this.pointerId) return;
    if (!this.panned) {
      if (!isDrag(e.clientX - this.from.x, e.clientY - this.from.y)) return;
      this.panned = true;
      // Start panning from where the slop ended, or the map jumps by
      // the twelve pixels it spent deciding.
      this.last = { x: e.clientX, y: e.clientY };
      return;
    }
    this.view = panBy(
      this.view, this.port(),
      e.clientX - this.last.x, e.clientY - this.last.y,
    );
    this.last = { x: e.clientX, y: e.clientY };
    this.paint();
  }

  /**
   * The lift, where a tap and a pan are told apart.
   *
   * `panned` is sticky rather than recomputed from the final distance:
   * a thumb that swept across the island and came back to where it
   * started has a delta of nothing, and reading that as a tap would
   * drop a waypoint under the finger at the end of a long pan — the
   * exact mis-order this screen is shaped to prevent.
   */
  private lift(e: PointerEvent): void {
    if (e.pointerId !== this.pointerId) return;
    const tapped = !this.panned
      && !isDrag(e.clientX - this.from.x, e.clientY - this.from.y);
    this.drop(e);
    if (!tapped) return;
    const box = this.canvas.getBoundingClientRect();
    // Fog is not a wall. Undiscovered ground is tappable, because
    // flying somewhere she has never been is the whole point of having
    // a discovery map at all.
    // APPEND. Each tap is another waypoint and the last is where she is
    // going — see `draft`.
    this.draft.push(screenToWorld(
      this.view, this.port(), e.clientX - box.left, e.clientY - box.top,
    ));
    this.refresh();
  }

  private drop(e: PointerEvent): void {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.panned = false;
    if (this.canvas.hasPointerCapture(e.pointerId)) {
      this.canvas.releasePointerCapture(e.pointerId);
    }
  }

  // ---- drawing --------------------------------------------------------

  private port(): Viewport {
    const box = this.canvas.getBoundingClientRect();
    return { width: box.width, height: box.height };
  }

  /** Text, button states, then the canvas. */
  private refresh(): void {
    const from = this.marks?.at ?? null;
    const primary = this.marks?.primary ?? null;
    const said = readout(from, this.draft, primary);
    this.destination.textContent = said.stops > 1
      // A chain is not one pin, and the label is the only place on the
      // sheet that can say so before it is flown.
      ? `PREVIEW · ${said.stops} STOPS` : said.label;
    this.figures.textContent = `${said.range}   ${said.bearing}`;
    this.caption.style.visibility =
      this.draft.length > 0 || primary ? 'visible' : 'hidden';

    const target = clearTarget(this.draft, primary);
    this.clear.textContent = clearWords(target, this.draft.length);
    this.able(this.clear, target !== 'none');
    this.able(this.fly, canFly(this.draft));
    this.able(this.tighter, this.view.zoom > 0);
    this.able(this.wider, this.view.zoom < ZOOM_STEPS.length - 1);
    this.able(this.centring, this.marks !== null);

    this.paint();
  }

  private paint(): void {
    const box = this.canvas.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) return;
    // Capped at 2: a three-times-density phone would be drawing nine
    // pixels per CSS pixel of full-screen canvas for no visible gain.
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const wide = Math.round(box.width * dpr);
    const tall = Math.round(box.height * dpr);
    if (this.canvas.width !== wide || this.canvas.height !== tall) {
      this.canvas.width = wide;
      this.canvas.height = tall;
    }
    const ink = this.canvas.getContext('2d');
    if (!ink) return;
    // Everything below is in CSS pixels, which is also what the pointer
    // speaks — one place where density is dealt with, and mapView never
    // hears about it.
    ink.setTransform(dpr, 0, 0, dpr, 0, 0);
    const port: Viewport = { width: box.width, height: box.height };

    // The unknown is the ground state, painted first and everywhere.
    ink.fillStyle = INK;
    ink.fillRect(0, 0, port.width, port.height);

    // No arithmetic here: mapView says how big the island is and where
    // its corner lands, and this draws it there.
    const size = islandPixels(this.view, port);
    const at = islandOrigin(this.view, port);
    // PAST THE PICTURE'S OWN RESOLUTION, STOP PRETENDING. The relief is
    // baked at 1024 px for 56 km, so deep in, a screen pixel is a
    // fraction of a source one and smoothing turns the island into
    // coloured fog that looks like detail. Nearest-neighbour reads as
    // the coarse survey it is — and the reason to be down there is the
    // route and the pin, not the ground.
    ink.imageSmoothingEnabled = zoomFactor(this.view) < HONEST_ZOOM;
    ink.drawImage(islandPicture(), at.x, at.y, size, size);
    const fog = this.fog();
    if (fog) ink.drawImage(fog, at.x, at.y, size, size);

    const marks = this.marks;
    const primary = marks?.primary ?? null;
    const focus = this.draft.length > 0
      ? this.draft[this.draft.length - 1] : primary;

    // A PLANNED ROUTE REPLACES THE REFERENCE LINE, because they are
    // different claims: the dashed line is "that way", and a route is
    // "this is the way I am going". Drawing both would be the map
    // arguing with itself.
    // A DRAFT CHAIN OUTRANKS BOTH. It is what FLY would commit her to,
    // so it is what the map has to be about — the same rule the readout
    // and CLEAR already follow.
    if (marks && this.draft.length > 0) {
      this.proposal(ink, port, marks.at, this.draft);
      this.say(this.draft.length > 1 ? CHAINED : DIRECT);
    } else if (marks?.route && marks.route.length > 1) {
      this.planned(ink, port, marks.at, marks.route);
      this.say(ROUTED);
    } else if (marks && focus) {
      this.reference(ink, port, marks.at, focus);
      this.say(DIRECT);
    }
    if (primary) this.active(ink, port, primary);
    if (marks) this.queen(ink, port, marks);
  }

  /**
   * The unknown, laid back over the island.
   *
   * The composite the minimap uses: the island is baked once and the
   * mask is drawn over it, rather than the island being re-baked per
   * discovery — repainting a 768-pixel relief every time a cell flipped
   * would be a terrain bake several times a second.
   *
   * Rebuilt only when the mask itself changes. `revision` alone is not
   * enough of a key, because a load and a fresh start are different
   * objects that can hold the same number, so the identity is checked
   * too.
   */
  private fog(): HTMLCanvasElement | null {
    const known = this.known;
    if (!known || known.size <= 0) return null;
    if (this.fogSheet && this.fogOf === known && this.fogAt === known.revision) {
      return this.fogSheet;
    }
    const sheet = this.fogSheet ?? document.createElement('canvas');
    // Assigning either dimension also clears the canvas, which is what
    // makes the seen cells transparent again on a rebuild.
    sheet.width = known.size;
    sheet.height = known.size;
    const ink = sheet.getContext('2d');
    if (!ink) return null;
    // FULLY OPAQUE, and the alpha is the whole point of this loop.
    //
    // It was 237 — the .93 of the panel's own INK, carried across by
    // hand — and 237 is not fog, it is a tint. Seven per cent of a
    // relief map is plenty to read a coastline by: the first probe
    // frame showed the entire shape of Kauaʻi, every ridge and every
    // valley, on a save that had been three per cent explored. That is
    // the surveyed island handed to a player who has not been there,
    // which is the one thing discovery exists to withhold (Trello card
    // 10). The minimap composites with `destination-in` and never had
    // the bug, so the two surfaces disagreed about what was known.
    const pixels = ink.createImageData(known.size, known.size);
    for (let i = 0; i < known.cells.length; i++) {
      if (known.cells[i] !== 0) continue;
      const px = i * 4;
      pixels.data[px] = 9;
      pixels.data[px + 1] = 13;
      pixels.data[px + 2] = 20;
      pixels.data[px + 3] = 255;
    }
    ink.putImageData(pixels, 0, 0);
    this.fogSheet = sheet;
    this.fogOf = known;
    this.fogAt = known.revision;
    return sheet;
  }

  /** The direct line. Dashed, and captioned in the sheet as direct. */
  private reference(
    ink: CanvasRenderingContext2D, port: Viewport,
    from: WorldPoint, to: WorldPoint,
  ): void {
    const a = worldToScreen(this.view, port, from);
    const b = worldToScreen(this.view, port, to);
    ink.save();
    // Dashes rather than a solid stroke, and never a curve: a curve is
    // a track somebody planned, and nobody planned this.
    ink.setLineDash([7, 7]);
    ink.lineWidth = 2;
    ink.strokeStyle = 'rgba(255, 216, 130, .42)';
    ink.beginPath();
    ink.moveTo(a.x, a.y);
    ink.lineTo(b.x, b.y);
    ink.stroke();
    ink.restore();
  }

  /** Write the caption only when it changes. */
  private say(words: string): void {
    if (this.said === words) return;
    this.said = words;
    this.caption.textContent = words;
  }

  /**
   * THE ROUTE, corner by corner.
   *
   * Solid, and the `reference` line above says why: dashes are for a
   * direction nobody planned. Somebody planned this one, so it is drawn
   * as a track, with a small mark at every corner the planner put in —
   * a bend with nothing at it looks like a mistake, and a player who
   * cannot see the corner cannot tell the detour from a wander.
   */
  private planned(
    ink: CanvasRenderingContext2D, port: Viewport,
    from: WorldPoint, legs: readonly WorldPoint[],
  ): void {
    const points = [from, ...legs].map((at) => worldToScreen(this.view, port, at));
    ink.save();
    ink.lineWidth = 2;
    ink.lineJoin = 'round';
    ink.strokeStyle = 'rgba(255, 216, 130, .62)';
    ink.beginPath();
    ink.moveTo(points[0].x, points[0].y);
    for (const p of points.slice(1)) ink.lineTo(p.x, p.y);
    ink.stroke();
    // The corners, but not the ends: she is one and the pin is the
    // other, and both already have their own mark.
    for (const p of points.slice(1, -1)) {
      ink.beginPath();
      ink.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ink.fillStyle = 'rgba(255, 216, 130, .62)';
      ink.fill();
    }
    ink.restore();
  }

  /** The ordered mission: a SOLID disc. */
  private active(
    ink: CanvasRenderingContext2D, port: Viewport, at: WorldPoint,
  ): void {
    const p = worldToScreen(this.view, port, at);
    ink.beginPath();
    ink.arc(p.x, p.y, 7, 0, Math.PI * 2);
    ink.fillStyle = GOLD;
    ink.fill();
    ink.lineWidth = 2;
    ink.strokeStyle = LINER;
    ink.stroke();
  }

  /**
   * The preview: a HOLLOW ring, and a wider one than the disc.
   *
   * Filled against hollow reads before either shape is identified, and
   * it reads at arm's length on a phone. Two gold dots of the same size
   * distinguished only by shade would be a colour puzzle, over terrain,
   * in sunlight.
   */
  private proposal(
    ink: CanvasRenderingContext2D, port: Viewport, from: WorldPoint,
    draft: readonly WorldPoint[],
  ): void {
    const points = draft.map((at) => worldToScreen(this.view, port, at));
    const her = worldToScreen(this.view, port, from);

    // THE ORDER SHE WOULD FLY THEM IN, dashed because none of it is
    // committed yet — the same language the reference line uses, for
    // the same reason. It becomes a solid track when the planner has
    // been through it.
    ink.save();
    ink.setLineDash([7, 7]);
    ink.lineWidth = 2;
    ink.lineJoin = 'round';
    ink.strokeStyle = 'rgba(255, 216, 130, .42)';
    ink.beginPath();
    ink.moveTo(her.x, her.y);
    for (const p of points) ink.lineTo(p.x, p.y);
    ink.stroke();
    ink.restore();

    points.forEach((p, i) => {
      // THE LAST ONE IS THE DESTINATION and the rest are stops on the
      // way, so the last one is drawn heavier. A chain whose end looks
      // like its middle is a chain nobody can read the direction of.
      const last = i === points.length - 1;
      const r = last ? 10 : 7;
      ink.beginPath();
      ink.arc(p.x, p.y, r + 2, 0, Math.PI * 2);
      ink.lineWidth = 1.5;
      ink.strokeStyle = 'rgba(11, 16, 24, .75)';
      ink.stroke();
      ink.beginPath();
      ink.arc(p.x, p.y, r, 0, Math.PI * 2);
      ink.lineWidth = last ? 3 : 2;
      ink.strokeStyle = GOLD;
      ink.stroke();
      // Numbered only when there is an order to read. One ring needs no
      // "1" on it.
      if (points.length > 1) {
        ink.font = '700 9px ui-monospace, monospace';
        ink.textAlign = 'center';
        ink.textBaseline = 'middle';
        ink.fillStyle = GOLD;
        ink.fillText(`${i + 1}`, p.x, p.y);
      }
    });
  }

  /** Her, pointing the way she is going. */
  private queen(
    ink: CanvasRenderingContext2D, port: Viewport, marks: MapMarks,
  ): void {
    const p = worldToScreen(this.view, port, marks.at);
    ink.save();
    ink.translate(p.x, p.y);
    // The arrow is authored pointing UP, and the repo's own converter
    // turns it. Heading 0 is SOUTH and north is −Z; open-coding that
    // conversion once cost this codebase 142 degrees.
    ink.rotate((bearingFromHeading(marks.heading) * Math.PI) / 180);
    ink.beginPath();
    ink.moveTo(0, -11);
    ink.lineTo(7, 8);
    ink.lineTo(0, 4);
    ink.lineTo(-7, 8);
    ink.closePath();
    ink.fillStyle = LIVE;
    ink.fill();
    ink.lineWidth = 1.6;
    ink.strokeStyle = LINER;
    ink.stroke();
    ink.restore();
  }

  // ---- plumbing -------------------------------------------------------

  private button(
    label: string, name: string, run: () => void,
  ): HTMLButtonElement {
    const el = document.createElement('button');
    el.type = 'button';
    el.dataset.ui = name;
    el.textContent = label;
    Object.assign(el.style, {
      appearance: 'none',
      flex: '0 0 auto',
      // Nothing on this screen is smaller than a thumb. See TAP.
      minWidth: `${TAP}px`,
      height: `${TAP}px`,
      padding: '0',
      borderRadius: '10px',
      border: `2px solid ${GOLD_EDGE}`,
      background: CARD,
      color: WARM,
      font: '700 12px/1 system-ui, sans-serif',
      cursor: 'pointer',
      touchAction: 'manipulation',
    } as Partial<CSSStyleDeclaration>);
    this.listen(el, 'click', run);
    return el;
  }

  /**
   * Live or not, and it must LOOK not.
   *
   * A dead control that still reads as pressable teaches the player
   * that the screen ignores them.
   */
  private able(el: HTMLButtonElement, live: boolean): void {
    el.disabled = !live;
    el.style.opacity = live ? '1' : '.3';
    el.style.cursor = live ? 'pointer' : 'default';
  }

  private listen<E extends Event>(
    target: EventTarget, type: string, handler: (e: E) => void,
  ): void {
    target.addEventListener(type, handler as EventListener);
    this.detach.push(
      () => target.removeEventListener(type, handler as EventListener),
    );
  }
}
