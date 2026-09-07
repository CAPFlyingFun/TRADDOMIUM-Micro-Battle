/**
 * The performance HUD: a DOM overlay in the scene's ui layer.
 *
 * Two readouts that must never be confused: FRAME (raw), the wall-clock
 * frame rate — mean and 95th-percentile low — and SIM dt, the step the
 * simulation actually took, which reads "paused" when it is 0. They are two
 * separate columns with their own headings because v0 showed one number and
 * it was the wrong one (§2.4). Beside them: the camera's position and speed,
 * and the LAYERS column, one checkbox per world layer so each layer's cost
 * can be measured alone on a real device (§9).
 *
 * Refreshes at HUD_HZ rather than every frame: a readout that changes sixty
 * times a second cannot be read, and the DOM write itself costs frame time
 * in the very scene that is measuring frame time. The refresh is timed by
 * RAW dt, because while the world is paused sim dt is 0 and a HUD timed by
 * it would freeze before it could say "paused".
 *
 * SESSION is the fifth column and it appears only when the owner offers a
 * `session()` hook. It is the HUD's one honest line about multiplayer, and
 * every word in it is measured rather than promised: `Connected` is a
 * welcomed client on an open socket and NOTHING more — not that online play
 * is finished, not that the other player can see you. It counts the other
 * players this world is actually drawing, and it names refused claims when
 * there are any, because a movement the authority would not allow is
 * otherwise invisible. In a solo session the line reads `Solo`.
 *
 * COLLAPSIBLE since 2026-09-07. Joshua, from the phone: "make the stat
 * sheet collapsible as it takes up most of the screen and hard to see
 * through it." Five columns at 932 x 430 are the top-left quarter of the
 * view, and the view is what he is trying to judge the frame rate
 * against. Folded, the sheet is ONE short row — `59.9 fps · low 52.6`, the
 * mean and the 95th-percentile low, the two numbers he reads first — with
 * a `+` in the corner; every column is hidden and NOT written to, because
 * the DOM writes were half of what folding it is for. The `–`/`+` flips
 * it, and so does a tap on the folded row. The choice is the owner's to
 * keep: `onCollapse` fires on the player's tap and never on the setter,
 * so setting it from a saved document cannot write the document back.
 * Unfolded, the sheet is exactly what it was — same lines, same
 * `data-field` names — because the probes read it by those.
 *
 * Talks to its owner through a typed hook object and reads plain summary
 * structs; it does not import FrameStats, the camera or anything of `net/`
 * (§2.7) — the link's state reaches it as six plain words it can print.
 * Imports the DOM only — testable under jsdom without three.
 */
import type { WorldLayerId } from '../world/WorldLoader';
import type { CameraReadout } from './FreeFlyCamera';
import type { FrameSummary } from './FrameStats';
import type { LayerToggle } from './layerToggles';
import { compassBearing } from '../world/coords';

/** DOM refreshes per second. */
export const HUD_HZ = 5;

export interface PerfReadout {
  readonly frame: FrameSummary;
  readonly camera: CameraReadout;
  /**
   * How far the camera is above the ground under it, world units, when
   * there is ground to ask. THE FOURTH NUMBER A SHOT NEEDS: x, y and z
   * put the camera back; this says whether it is standing in the grass
   * or thirty metres over it, which the y alone cannot — the terrain
   * streams in at 13.67 m and the survey's coarse guess of the ground is
   * routinely metres off. `probe:objects` reads it to stand the camera
   * where a player would.
   */
  readonly aboveGround?: number | null;
}

/**
 * What kind of session this world is running in, and — when it is a
 * networked one — how its link stands. Six plain words, not `net/`'s own
 * states: the HUD prints what it is told and never learns the protocol.
 *
 *   solo         no network at all; nothing was opened.
 *   idle         networked, but nothing has been opened yet.
 *   connecting   a handshake is in flight.
 *   connected    welcomed by the authority on an open socket.
 *   lost         it was up and the link went away.
 *   unreachable  the handshake did not complete.
 *   left         this end hung up deliberately.
 */
export type SessionLink = 'solo' | 'idle' | 'connecting' | 'connected' | 'lost' | 'unreachable' | 'left';

export interface SessionReadout {
  readonly link: SessionLink;
  /** OTHER players currently drawn. Zero in solo. */
  readonly others: number;
  /** Claims the authority answered with a different truth. Zero in solo. */
  readonly refusedClaims: number;
  /** Claim-to-acknowledgement, milliseconds; absent until one has been measured. */
  readonly roundTripMs?: number;
}

/**
 * WHAT THE SEA IS COSTING, as the HUD is told it.
 *
 * Joshua's second named suspect for v0's choppiness was that the work
 * "probably wasn't optimized the best between CPU, and GPU", and these
 * are the CPU half of the answer, on the device rather than in a probe.
 * Read against the frame rate above them: a sea costing a fraction of a
 * millisecond while the frame rate halves is a sea spending on the GPU,
 * and the texture rung is the lever.
 *
 * THE PEAK IS SHOWN, NOT JUST THE MEAN. The work is not spread evenly —
 * most frames are two uniform writes, and the frame a sheet re-anchors
 * is tens of thousands of heightfield reads. A mean of 0.1 ms with a
 * peak of 12 is not a smooth ocean; it is a smooth ocean with a hitch
 * in it, and a hitch is what "slightly choppy" describes.
 *
 * THE RUNG IS ON SCREEN because `?tier=` can name one the settings
 * cannot (ULTRA_LOW), and a testing override with no way to confirm it
 * took effect is a test of nothing.
 *
 * Plain numbers and a word: the HUD prints what it is told and never
 * learns what an OceanView is.
 */
export interface SeaReadout {
  /** Mean milliseconds a frame the ocean spends on the CPU. */
  readonly meanMs: number;
  /** The worst single frame in the window. */
  readonly peakMs: number;
  /**
   * The two rungs it was built at, as words — since 2026-09-05 these are
   * SEPARATE SETTINGS and either may be the one that explains a frame
   * rate, so printing one of them would be printing the wrong one half
   * the time.
   *
   * `detail` is how far the waves reach and how many ripple octaves run;
   * `tier` is the texture size and filtering. Null tex means the sea was
   * built without textures, which is a state to say rather than to guess
   * a word for.
   */
  readonly detail: string;
  readonly tier: string | null;
}

/**
 * What the island's fresh water is costing, and how much of it there is.
 *
 * THE WET-CELL COUNT IS THE POINT, not decoration. The solver's cost is
 * flat — it steps every cell whether or not there is water in it — so a
 * millisecond figure alone cannot tell "the water is expensive" from
 * "there is no water and it is expensive anyway". The count is how a
 * device pass says which, and it is what the baseflow rate has to be
 * tuned against.
 */
export interface FreshReadout {
  readonly meanMs: number;
  readonly peakMs: number;
  readonly wetCells: number;
  readonly cells: number;
}

/**
 * What the world's objects cost, and how many of them there are.
 *
 * THE COUNTS ARE THE MEASUREMENT (Joshua, 2026-09-06: "see relevant
 * object counts... object-density/performance probes"). A millisecond
 * figure alone cannot tell a lawn from a beach; the counts beside the
 * frame rate are how a device pass says what twenty-five thousand blades
 * cost, and what the budget should be. `cells` is resident cells with
 * the cells still queued after a plus, so a stall on arrival can be told
 * from a stall on the ground.
 */
export interface ObjectsReadout {
  readonly meanMs: number;
  readonly peakMs: number;
  readonly cells: number;
  readonly pending: number;
  readonly grass: number;
  readonly twig: number;
  readonly stone: number;
  readonly rock: number;
  readonly tree: number;
  /** The habitat under the camera, one word. */
  readonly habitat: string;
}

export interface PerfHudHooks {
  /** The rows to show. Re-read at every refresh so the checkboxes follow the model, not the clicks. */
  layers(): readonly LayerToggle[];
  /** The player toggled a checkbox. The owner decides what it means; the HUD re-reads `layers()`. */
  onLayerToggle(id: WorldLayerId, enabled: boolean): void;
  /**
   * How this world's session stands. Absent means the owner has nothing to
   * say about a session, and the column is not built at all — an empty
   * heading would be a claim of its own.
   */
  session?(): SessionReadout;
  /**
   * What the sea costs. Absent means this world has no ocean to ask and
   * the column is not built; null means it has one that is not built
   * YET, which is a different thing and reads as such.
   */
  sea?(): SeaReadout | null;
  /** The island's fresh water. Absent where a world has none. */
  fresh?(): FreshReadout | null;
  /** The world's objects — grass, twigs, stones, rocks, trees. Absent where a world has none. */
  objects?(): ObjectsReadout | null;
  /**
   * The player folded or unfolded the sheet. Fired by the corner button
   * and the folded row ONLY — never by the `collapsed` setter — so the
   * owner can persist the choice without persisting its own restore.
   */
  onCollapse?(collapsed: boolean): void;
}

export interface PerfHudOptions {
  /** Start folded: the saved choice, so the sheet does not open across the view on the way back in. */
  readonly collapsed?: boolean;
}

type Field = 'meanFps' | 'lowFps' | 'simDt' | 'cameraPosition' | 'cameraSpeed' | 'cameraFacing' | 'cameraAbove';

const GOLD = '#c9a94a';
const PARCHMENT = '#e8e2c8';

/**
 * The collapse toggle's side, in pixels. A THUMB target, not a mouse one:
 * the sheet is folded on a phone, and 28 px is the least a fingertip
 * reliably lands on.
 */
const COLLAPSE_BUTTON_PX = 28;
/** The toggle's inset from the panel's corner. */
const COLLAPSE_BUTTON_INSET = 6;

/**
 * How wide the SESSION column may get before its line wraps, in pixels.
 * Chosen so the whole HUD clears the PAUSE button at the 932 px design
 * canvas with the longest line the wire produces — see the comment where
 * it is used.
 */
const SESSION_MAX_WIDTH = 210;

/** One word per link state, and not a word more than is true. */
const LINK_WORDS: Readonly<Record<SessionLink, string>> = {
  solo: 'Solo',
  idle: 'Not connected',
  connecting: 'Connecting…',
  connected: 'Connected',
  lost: 'Connection lost',
  unreachable: 'Relay unreachable',
  left: 'Left the session',
};

/**
 * The one word for a link state, shared with the bot's panel
 * (`BotHud.ts`) so the two overlays in the same world can never describe
 * the same link with different words.
 */
export function linkWords(link: SessionLink): string {
  return LINK_WORDS[link];
}

/** Radians to a whole degree in 0..359, the same reading the bot's panel gives. */
function plural(count: number, one: string): string {
  return count === 1 ? `1 ${one}` : `${count} ${one}s`;
}

/**
 * The one line. In solo it is the one word. Networked, it says how the
 * link stands, how many other players this world is DRAWING — "last
 * seen" when the link is down, because what is on screen is then a
 * stale picture and saying otherwise would be the HUD promising
 * something the wire is not delivering — and what the authority has
 * refused, when it has refused anything.
 */
function sessionWords(readout: SessionReadout): string {
  const parts: string[] = [LINK_WORDS[readout.link]];
  if (readout.link === 'solo') return parts[0];
  if (readout.link === 'connected') {
    parts.push(readout.others === 0 ? 'no other players' : `${plural(readout.others, 'other player')}`);
    if (readout.roundTripMs !== undefined) parts.push(`claim→ack ${Math.round(readout.roundTripMs)} ms`);
  } else if (readout.others > 0) {
    parts.push(`${plural(readout.others, 'other player')} last seen`);
  }
  if (readout.refusedClaims > 0) parts.push(`${plural(readout.refusedClaims, 'claim')} refused`);
  return parts.join(' · ');
}

/**
 * The sea's three lines, or the honest absence of them.
 *
 * "not built yet" rather than zeros: an ocean that has not been
 * constructed has not cost nothing, it has not been asked, and 0.00 ms
 * would read as the former. Same rule as the layer rows.
 *
 * THEY GO IN THE FRAME COLUMN, and are kept to the width of the lines
 * already there, because a column of their own would not fit. The HUD is
 * a flex row and every column widens it: at the 932 px design canvas the
 * existing five already come within about 80 px of the PAUSE button, and
 * a sixth carrying "0.04 ms peak 12.3 95k verts medium" is 260 px on its
 * own. `scripts/probe-bot.mjs` fails on exactly that — it measures the
 * HUD against PAUSE in a room, which is the widest the HUD ever gets.
 * These belong here anyway: raw wall-clock milliseconds a frame is what
 * this column is for.
 */
function freshWords(fresh: FreshReadout | null): readonly [string, string] {
  if (fresh === null) return ['fresh    not built', ''];
  // The share is what a reader can act on: "2% wet" beside a peak says
  // the cost is the grid rather than the water.
  const share = fresh.cells === 0 ? 0 : (100 * fresh.wetCells) / fresh.cells;
  // SHORT ENOUGH NOT TO WIDEN A COLUMN. The first draft read
  // "fresh 10.41 ms pk 23.8" and "wet 24.1% of 256²", which pushed the
  // HUD to 907 px of a 932 px canvas and put it under PAUSE — caught by
  // `probe:bot`, which measures the overlap rather than trusting the eye.
  return [
    `fresh ${fresh.meanMs.toFixed(1)} ms`,
    `wet ${share.toFixed(1)}% ${Math.round(Math.sqrt(fresh.cells))}²`,
  ];
}

/**
 * The objects' five lines, each no wider than "95th low 30.0 fps": the
 * cost, the cells, and the counts by family. Two families to a line
 * where the words are short enough; the HUD's width is the scarcest
 * thing it has (`probe:bot` measures it against PAUSE).
 */
function objectWords(objects: ObjectsReadout | null): readonly [string, string, string, string, string] {
  if (objects === null) return ['veg      not built', '', '', '', ''];
  return [
    `veg ${objects.meanMs.toFixed(1)} pk ${objects.peakMs.toFixed(0)} ms`,
    `cells ${objects.cells}+${objects.pending} ${objects.habitat.slice(0, 5)}`,
    `grass ${objects.grass}`,
    `twig ${objects.twig} st ${objects.stone}`,
    `rock ${objects.rock} tree ${objects.tree}`,
  ];
}

function seaWords(sea: SeaReadout | null): readonly [string, string, string, string] {
  if (sea === null) return ['sea      not built', '', '', ''];
  return [
    `sea mean ${sea.meanMs.toFixed(2)} ms`,
    `sea peak ${sea.peakMs.toFixed(1)} ms`,
    // TWO SHORT LINES RATHER THAN ONE LONG ONE. Both rungs have to be
    // readable off a photograph — `probe:shot` takes them as arguments —
    // and a combined line would be the widest thing in the column at the
    // 932 px design canvas, which is where the HUD starts pushing PAUSE
    // off the screen. Neither of these is wider than the frame-rate line
    // already above them.
    `sea detail ${sea.detail}`,
    `sea tex ${sea.tier ?? 'none'}`,
  ];
}

export class PerfHud {
  private readonly root: HTMLElement;
  private readonly fields: Readonly<Record<Field, HTMLElement>>;
  /** Built only when the owner offers a `session()` hook; null otherwise. */
  private readonly sessionLine: HTMLElement | null;
  /** Built only when the owner offers a `sea()` hook; null otherwise. */
  private readonly seaLines: readonly [HTMLElement, HTMLElement, HTMLElement, HTMLElement] | null;
  /** Built only when the owner offers a `fresh()` hook; null otherwise. */
  private readonly freshLines: readonly [HTMLElement, HTMLElement] | null;
  private readonly objectLines: HTMLElement[] | null;
  private readonly boxes = new Map<WorldLayerId, HTMLInputElement>();
  /** Each layer row's wrapper and its text node, so the label can follow the model. */
  private readonly rows = new Map<string, { wrap: HTMLElement; text: Text }>();
  /** Every column, in order, so folding hides them together and unfolding shows them together. */
  private readonly columns: HTMLElement[] = [];
  /** The folded sheet's one row. Hidden while the columns show. */
  private readonly summary: HTMLElement;
  /** The `–`/`+` in the corner. */
  private readonly collapseButton: HTMLButtonElement;
  private isCollapsed = false;
  /** Infinity so the very first update() paints without waiting a refresh period. */
  private sinceRefresh = Infinity;

  constructor(
    uiLayer: HTMLElement,
    private readonly hooks: PerfHudHooks,
    options: PerfHudOptions = {},
  ) {
    const doc = uiLayer.ownerDocument;
    this.root = doc.createElement('div');
    this.root.dataset.role = 'perf-hud';
    // The right padding is the toggle's room: it sits in the corner OVER
    // the padding, out of the flex row, so it neither pushes a column nor
    // lands on the end of one. Cheaper than a sixth flex item by a gap —
    // `probe:bot` measures this box against PAUSE, and every pixel of
    // width is a pixel closer to it.
    const padRight = COLLAPSE_BUTTON_INSET + COLLAPSE_BUTTON_PX + 8;
    this.root.style.cssText =
      'position:absolute;top:8px;left:10px;display:flex;align-items:flex-start;gap:16px;' +
      `padding:8px ${padRight}px 8px 10px;background:rgba(6,9,12,0.72);color:${PARCHMENT};` +
      `font:12px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace;border:1px solid ${GOLD};border-radius:6px;`;

    const column = (heading: string): HTMLElement => {
      const col = doc.createElement('div');
      const head = doc.createElement('div');
      head.textContent = heading;
      head.style.cssText = `color:${GOLD};letter-spacing:0.06em;margin-bottom:2px;white-space:nowrap;`;
      col.appendChild(head);
      this.root.appendChild(col);
      this.columns.push(col);
      return col;
    };
    const line = (parent: HTMLElement, field: string): HTMLElement => {
      const el = doc.createElement('div');
      el.dataset.field = field;
      el.style.whiteSpace = 'nowrap';
      parent.appendChild(el);
      return el;
    };

    const frame = column('FRAME (raw)');
    const sim = column('SIM dt');
    const camera = column('CAMERA');
    this.fields = {
      meanFps: line(frame, 'mean-fps'),
      lowFps: line(frame, 'low-fps'),
      simDt: line(sim, 'sim-dt'),
      cameraPosition: line(camera, 'camera-position'),
      cameraSpeed: line(camera, 'camera-speed'),
      cameraFacing: line(camera, 'camera-facing'),
      cameraAbove: line(camera, 'camera-above'),
    };
    // UNDER THE FRAME RATE, in the FRAME column, and only where there is
    // a sea to ask about — see `seaWords` for why they are not a column
    // of their own. Built here rather than beside SESSION so they sit
    // directly under the number they have to be read against.
    this.seaLines = hooks.sea === undefined
      ? null
      : [line(frame, 'sea-mean'), line(frame, 'sea-peak'), line(frame, 'sea-detail'), line(frame, 'sea-tex')];
    // IN THE FRAME COLUMN, under the sea's lines, because that column is
    // already as wide as "95th low 50.0 fps" and these are shorter than
    // that. Putting them in SIM dt — whose only line is "100.0 ms" —
    // widened that column by nine characters and slid the HUD under
    // PAUSE at the design canvas.
    this.freshLines = hooks.fresh === undefined
      ? null
      : [line(frame, 'fresh-cost'), line(frame, 'fresh-wet')];
    // And the world's objects under those, for the same reason.
    this.objectLines = hooks.objects === undefined
      ? null
      : [line(frame, 'veg-cost'), line(frame, 'veg-cells'), line(frame, 'veg-grass'), line(frame, 'veg-clutter'), line(frame, 'veg-major')];
    // Before LAYERS, which is a column of rows rather than a readout and
    // reads best last.
    if (hooks.session === undefined) {
      this.sessionLine = null;
    } else {
      const col = column('SESSION');
      // THE ONE COLUMN THAT WRAPS. Every other readout is a fixed handful
      // of characters; this one grows with what the wire is doing —
      // `Connected · 1 other player · claim→ack 17 ms` is three times the
      // width of `Solo`. Left on one line it pushed the HUD 47 px under
      // the PAUSE button, which is pinned to the right edge, and the
      // LAYERS column's last word disappeared behind it. Wrapping costs
      // one line of a HUD that is already seven rows tall; clipping costs
      // a readout. `scripts/probe-bot.mjs` measures both, with another
      // player in the room, because that is when the line is longest.
      col.style.maxWidth = `${SESSION_MAX_WIDTH}px`;
      this.sessionLine = line(col, 'session');
      this.sessionLine.style.whiteSpace = 'normal';
    }
    this.buildLayerRows(column('LAYERS'));

    // THE FOLDED ROW. As tall as the toggle beside it, so the folded sheet
    // is one 28 px row and a fingertip on the numbers unfolds it as surely
    // as one on the `+`. Not a column: it is what shows INSTEAD of them.
    this.summary = doc.createElement('div');
    this.summary.dataset.field = 'summary';
    this.summary.style.cssText = `white-space:nowrap;line-height:${COLLAPSE_BUTTON_PX}px;cursor:pointer;user-select:none;`;
    this.summary.addEventListener('click', () => {
      if (this.isCollapsed) this.toggle();
    });
    this.root.appendChild(this.summary);

    // THE TOGGLE, in the panel's own idiom: gold on the same smoked glass,
    // in the top-right corner where the thumb that is not on the stick can
    // reach it without covering a number.
    this.collapseButton = doc.createElement('button');
    this.collapseButton.type = 'button';
    this.collapseButton.dataset.action = 'hud-collapse';
    this.collapseButton.style.cssText =
      `position:absolute;top:${COLLAPSE_BUTTON_INSET}px;right:${COLLAPSE_BUTTON_INSET}px;` +
      `width:${COLLAPSE_BUTTON_PX}px;height:${COLLAPSE_BUTTON_PX}px;` +
      `min-width:${COLLAPSE_BUTTON_PX}px;min-height:${COLLAPSE_BUTTON_PX}px;padding:0;` +
      `color:${GOLD};background:rgba(6,9,12,0.72);border:1px solid ${GOLD};border-radius:4px;` +
      'font:18px/1 ui-monospace,SFMono-Regular,Menlo,monospace;cursor:pointer;touch-action:manipulation;';
    this.collapseButton.addEventListener('click', () => this.toggle());
    this.root.appendChild(this.collapseButton);

    this.isCollapsed = options.collapsed ?? false;
    this.applyCollapsed();
    uiLayer.appendChild(this.root);
  }

  /** Call every frame with the WALL-CLOCK dt; the DOM is touched only HUD_HZ times a second. */
  update(readout: PerfReadout, rawDt: number): void {
    this.sinceRefresh += rawDt;
    if (this.sinceRefresh < 1 / HUD_HZ) return;
    this.sinceRefresh = 0;
    // A hidden HUD is not written to either: the point of hiding it is to take its cost out of the frame.
    if (this.root.hidden) return;
    // Folded, the sheet is one line and one DOM write; the columns are not touched.
    if (this.isCollapsed) this.renderSummary(readout);
    else this.render(readout);
  }

  /** The player's "Show frame rate" setting. Hidden, the HUD costs no DOM writes. */
  get hidden(): boolean {
    return this.root.hidden;
  }

  set hidden(value: boolean) {
    if (this.root.hidden === value) return;
    this.root.hidden = value;
    // Paint on the first frame it comes back rather than up to a refresh period later.
    if (!value) this.sinceRefresh = Infinity;
  }

  /**
   * The sheet folded to its one row. The owner sets it from the saved
   * choice; the player flips it from the corner, which is the one path
   * that reports back through `onCollapse`. `hidden` still overrides it:
   * a hidden sheet is written to in neither state.
   */
  get collapsed(): boolean {
    return this.isCollapsed;
  }

  set collapsed(value: boolean) {
    if (this.isCollapsed === value) return;
    this.isCollapsed = value;
    this.applyCollapsed();
    // Either way something just became visible that has not been written
    // since it was last on screen: paint it on the next update() rather
    // than up to a refresh period later, as `hidden` does when it lifts.
    this.sinceRefresh = Infinity;
  }

  dispose(): void {
    this.root.remove();
    this.boxes.clear();
    this.rows.clear();
  }

  /** A tap on the corner or on the folded row: flip, then tell the owner. The ONLY caller of the hook. */
  private toggle(): void {
    this.collapsed = !this.isCollapsed;
    this.hooks.onCollapse?.(this.isCollapsed);
  }

  /** The DOM half of `collapsed`: which of the two faces shows, and what the corner offers. */
  private applyCollapsed(): void {
    for (const col of this.columns) col.hidden = this.isCollapsed;
    this.summary.hidden = !this.isCollapsed;
    this.collapseButton.textContent = this.isCollapsed ? '+' : '–';
    this.collapseButton.setAttribute('aria-label', this.isCollapsed ? 'Expand stats' : 'Collapse stats');
  }

  /** The folded row: the mean and the 95th-percentile low, or the honest absence of them. */
  private renderSummary(readout: PerfReadout): void {
    const f = readout.frame;
    this.summary.textContent = f.frames === 0
      ? 'no frames yet'
      : `${f.meanFps.toFixed(1)} fps · low ${f.lowFps.toFixed(1)}`;
  }

  private buildLayerRows(parent: HTMLElement): void {
    const doc = parent.ownerDocument;
    const row = (id: string, label: string, checked: boolean, locked: boolean): HTMLInputElement => {
      const wrap = doc.createElement('label');
      // A locked-OFF row is a layer this build cannot show: dimmed as well as
      // disabled. A locked-ON row is the base world and reads at full strength.
      wrap.style.cssText = `display:block;white-space:nowrap;opacity:${locked && !checked ? 0.5 : 1};`;
      const box = doc.createElement('input');
      box.type = 'checkbox';
      box.dataset.action = `layer:${id}`;
      box.checked = checked;
      box.disabled = locked;
      box.style.cssText = 'margin:0 6px 0 0;vertical-align:middle;';
      wrap.appendChild(box);
      const text = doc.createTextNode(label);
      wrap.appendChild(text);
      parent.appendChild(wrap);
      this.rows.set(id, { wrap, text });
      return box;
    };

    // The empty world is what everything else is measured against: always on, never a choice.
    row('empty', 'empty — always on', true, true);
    for (const layer of this.hooks.layers()) {
      const box = row(layer.id, layer.built ? layer.id : `${layer.id} — not built`, layer.enabled, !layer.built);
      box.addEventListener('change', () => this.hooks.onLayerToggle(layer.id, box.checked));
      this.boxes.set(layer.id, box);
    }
  }

  private render(readout: PerfReadout): void {
    const f = readout.frame;
    const c = readout.camera;
    if (f.frames === 0) {
      this.fields.meanFps.textContent = 'mean     no frames yet';
      this.fields.lowFps.textContent = '95th low no frames yet';
    } else {
      this.fields.meanFps.textContent = `mean     ${f.meanFps.toFixed(1)} fps`;
      this.fields.lowFps.textContent = `95th low ${f.lowFps.toFixed(1)} fps`;
    }
    this.fields.simDt.textContent = f.simDt === 0 ? 'paused' : `${(f.simDt * 1000).toFixed(1)} ms`;
    this.fields.cameraPosition.textContent = `x ${c.x.toFixed(1)}  y ${c.y.toFixed(1)}  z ${c.z.toFixed(1)}`;
    this.fields.cameraSpeed.textContent = `speed ${c.speed.toFixed(0)} units/s`;
    // Degrees in the ACTOR's convention, so this line and a capsule's own
    // facing describe the same compass — see `FreeFlyCamera.headingOfYaw`.
    //
    // PITCH RIDES THE SAME LINE, in degrees, up positive. Both halves of
    // where the camera is looking, so a photograph of this HUD is a
    // reproducible pose and `npm run probe:shot` can take its arguments
    // straight off it without anyone guessing the tilt.
    this.fields.cameraFacing.textContent = `facing ${compassBearing(c.facing)}°  `
      + `pitch ${((c.pitch * 180) / Math.PI).toFixed(0)}°`;
    // "above —" when there is no ground to ask: an empty world has none,
    // and printing 0 m there would say the camera was standing on it.
    const above = readout.aboveGround;
    this.fields.cameraAbove.textContent = above === undefined || above === null
      ? 'above —'
      : `above ${(above / 100).toFixed(1)} m`;
    const session = this.hooks.session?.();
    if (this.sessionLine !== null && session !== undefined) this.sessionLine.textContent = sessionWords(session);
    if (this.seaLines !== null) {
      const words = seaWords(this.hooks.sea?.() ?? null);
      for (let i = 0; i < this.seaLines.length; i += 1) this.seaLines[i].textContent = words[i];
    }
    if (this.freshLines !== null) {
      const words = freshWords(this.hooks.fresh?.() ?? null);
      for (let i = 0; i < this.freshLines.length; i += 1) this.freshLines[i].textContent = words[i];
    }
    if (this.objectLines !== null) {
      const words = objectWords(this.hooks.objects?.() ?? null);
      for (let i = 0; i < this.objectLines.length; i += 1) this.objectLines[i].textContent = words[i];
    }
    // THE MODEL IS THE TRUTH, and that includes the WORDS. A click the
    // owner rejected snaps back here — and so does a row whose built-ness
    // was not known when the HUD was constructed. Whether TERRAIN is built
    // is not a fact about this build: it is whether the survey actually
    // downloaded, which is settled after this panel exists. Writing the
    // label once left the row reading "not built" over ground that was
    // plainly on the screen.
    for (const layer of this.hooks.layers()) {
      const box = this.boxes.get(layer.id);
      if (!box) continue;
      box.checked = layer.enabled;
      box.disabled = !layer.built;
      const row = this.rows.get(layer.id);
      if (row) {
        const label = layer.built ? layer.id : `${layer.id} — not built`;
        if (row.text.nodeValue !== label) row.text.nodeValue = label;
        row.wrap.style.opacity = !layer.built && !layer.enabled ? '0.5' : '1';
      }
    }
  }
}
