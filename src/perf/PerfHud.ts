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
 * THE ECOLOGY BLOCK (Phase 7, 2026-09-07) — the new plant families'
 * count, the three species, what they cost, the resource sites and the
 * terrain-edit seam — sits in the CAMERA column under the clock, not in
 * FRAME with the other counts. Not for width: every one of its lines is
 * kept to the FRAME column's widest (`95th low 52.6 fps`, seventeen
 * characters) and a test measures them. For HEIGHT. FRAME is fifteen
 * lines and a heading, and at the 932 x 430 canvas the sheet's bottom
 * edge already meets the stick's ring; seven more lines there would put
 * the ring under the sheet. The CAMERA column is five lines and is the
 * widest thing on the HUD already, so a line there widens nothing and,
 * until it outgrows FRAME, lengthens nothing — the same reasoning that
 * put the clock there. See `creatureWords`.
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
import { compassBearing, compassWord } from '../world/coords';

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
  /**
   * Drawn instances of the seven plant families the ecology pass added
   * (fern, reed, flower, leaf, shrub, broadleaf, coastal), together.
   * OPTIONAL, and absent is not zero: a readout with no plant count is
   * one from a world that has no plant families to count, and the line
   * is left empty rather than reading `plants 0` — which would say the
   * ground here is bare, a fact nobody measured.
   */
  readonly plants?: number;
  /** The habitat under the camera, one word. */
  readonly habitat: string;
}

/**
 * WHAT THE SKY IS DOING, as the HUD is told it — Phase 5's device-visible
 * line. The weather is read live from Open-Meteo, kept for three hours,
 * and only then falls back to the seeded model (CLAUDE.md, "The sky is
 * the island's, or it says so"), and THE SOURCE IS THE POINT of this
 * readout: a sky drawn from a simulation may not say it is the island's
 * weather, so the word beside the cloud figure is which of the three it
 * is, and a held `?sky=` reads `sim` however real it looks.
 *
 * THE CLOCK AND THE SUN ARE ON THE SAME LINE because `?hour=` holds the
 * one and the other is astronomy from it (`world/weather/solar.ts`), and
 * a photograph of noon that reads 14:32 is a photograph of the hold not
 * holding. Plain words and numbers: the HUD prints what it is told and
 * never learns what a `WeatherNow` is.
 */
export interface WeatherReadout {
  /** The sky's headline state, one word: clear, cloudy, rain… */
  readonly sky: string;
  /** Rainfall rate in millimetres an hour; zero when it is not raining. */
  readonly rainMmHr: number;
  /** Cloud cover, 0 clear to 1 overcast. */
  readonly cloud: number;
  /** Where the reading came from — printed as `live`, `cached` or `sim`. */
  readonly source: 'live' | 'cached' | 'simulated';
  /** The island's wall clock, `HH:MM`, Hawaii Standard Time. */
  readonly clock: string;
  /** The sun's geometric elevation in degrees; negative below the horizon. */
  readonly sunElevationDeg: number;
  /**
   * The shadow the rung asks for, as the configuration and never a claim
   * that one is on screen: `shadow 1024 · 8 m`, or `shadow off`. Absent
   * where a world has no shadow seam, and then no line is printed.
   */
  readonly shadow?: string;
}

/**
 * One species, as the HUD is told it: how many exist inside its reach,
 * how many of those are in the near and full tiers, and the rung's cap.
 * The line prints `resident of cap` — a cap is a MAXIMUM, never a quota
 * (`creatures/species.ts`), so a beach reading `worms 0 of 40` is a
 * beach doing what a beach does. The tier counts are carried so the
 * cost line has its explanation on the same readout (a hundred aphids
 * at the far tier cost almost nothing; ten at full cost every frame);
 * they are not printed yet, because the species line is at its width.
 */
export interface SpeciesReadout {
  /** Generated inside the species' reach, every tier. */
  readonly resident: number;
  /** Of those, inside the near distance: thinking and moving at the near rate. */
  readonly near: number;
  /** Of those, inside the full distance: thinking and moving every frame. */
  readonly full: number;
  /** The rung's cap for this species. */
  readonly cap: number;
}

/**
 * THE ISLAND'S ANIMALS, as the HUD is told them (Phase 7, the ecology
 * pass). Joshua asked for the diagnostics "in dev tools, not the normal
 * HUD", and this sheet is the dev tool. Three species, three lines, and
 * beside them what they cost split three ways — deciding, moving,
 * drawing — because the toggles exist so that a phone can say which of
 * the three is the expensive one.
 *
 * `resources` is null when the resources layer is OFF, and the line
 * reads `sites off`: the sites are not derived and the creatures are
 * not finding them, and a count of zero would say the island offers
 * nothing, which is a different claim.
 *
 * `ground` is the terrain-edit seam (`creatures/terrainEdit.ts`). The
 * local shared editor reports bores that changed soil. Unbuilt worlds and
 * remote rooms without terrain replication still report `ground edits off`.
 *
 * Plain numbers and words: the HUD prints what it is told and never
 * learns what a `CreatureSimulation` is.
 */
export interface CreaturesReadout {
  readonly worms: SpeciesReadout;
  readonly aphids: SpeciesReadout;
  readonly flies: SpeciesReadout;
  /** Milliseconds a frame spent deciding, moving and drawing, wall-clock, for the HUD — never fed back into the simulation. */
  readonly thinkMs: number;
  readonly moveMs: number;
  readonly drawMs: number;
  /** Rigs the renderer currently has posed. */
  readonly rigs: number;
  /** The resource layer's sites inside the bubble, and how many of them are water edges. Null when the layer is off. */
  readonly resources: { readonly sites: number; readonly waterEdges: number } | null;
  /** The terrain-edit seam: whether this build has one, and bores that actually changed soil. */
  readonly ground: { readonly built: boolean; readonly applied: number };
}

/**
 * THE FINDER, as the HUD is told it (Joshua, 2026-09-08: "I don't see
 * any worms in the game... can you make a simple 3D finder I can turn on
 * to find them better?").
 *
 * It is an INSTRUMENT and it says so: `on` is the switch's own state,
 * `pins` is how many markers were drawn last frame, and `nearest` is the
 * one the GO button would take the camera to — null when the simulation
 * is holding nothing, which on a beach or at sea is the honest answer
 * rather than a failure.
 *
 * `species` is a WORD, already chosen by the owner, for the same reason
 * every other line here is: this sheet prints what it is told and never
 * learns what a creature is.
 */
export interface FinderReadout {
  readonly on: boolean;
  readonly pins: number;
  readonly nearest: {
    /** `worm`, `aphid`, `fly` — the singular the line prints. */
    readonly species: string;
    readonly metres: number;
    /** Compass degrees, 0 = north (`world/coords.compassBearing`). */
    readonly bearing: number;
    /** Under the ground, where nothing can be drawn: the line says so. */
    readonly under: boolean;
  } | null;
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
   * The sky: what it is doing, where the reading came from, and what
   * o'clock the sun is standing at. Absent where a world has no weather
   * to ask; null means it has one that has not answered yet.
   */
  weather?(): WeatherReadout | null;
  /**
   * The island's animals, the resource sites and the terrain-edit seam.
   * Absent where a world has no creatures to ask — the scene without
   * them says nothing about them; null means the world has the hook
   * and nothing has been built yet, and the lines are left empty until
   * a built simulation produces a readout.
   */
  creatures?(): CreaturesReadout | null;
  /**
   * The creature finder. Absent where a world has no creatures to find,
   * which is what keeps the row and the line off the empty world's sheet
   * entirely rather than showing a switch that does nothing (§2.9).
   */
  finder?(): FinderReadout;
  /** The player flipped the finder's switch. */
  onFinderToggle?(on: boolean): void;
  /**
   * The player pressed GO. The owner takes the camera to whatever
   * `finder().nearest` names; the HUD neither knows where that is nor
   * what a camera is.
   */
  onFinderGo?(): void;
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

/**
 * The sheet's type size at the 932 px design canvas and above, in CSS
 * pixels — 10 where it was 12, because Joshua asked for the sheet
 * smaller across the board (2026-09-07: "if the size is 18 now, make it
 * 12"), and 10 px of monospace at a phone's three device pixels per CSS
 * pixel is still 30 physical pixels tall. Below the canvas it is
 * `SHEET_FONT_VW` of the viewport's width instead, so a narrower
 * viewport gets a proportionally smaller sheet — the same fraction of
 * the screen Safari shows, not the same number of pixels.
 */
export const SHEET_FONT_PX = 10;
/** `SHEET_FONT_PX` over the design canvas's width, as a vw: the sheet's size below 932 px. */
export const SHEET_FONT_VW = Number(((SHEET_FONT_PX * 100) / 932).toFixed(3));
/**
 * How much of the viewport's width the sheet may never take: PAUSE's box
 * (about 90 px at its 14 px system font), its 12 px inset, and a thumb's
 * worth of air. GAME TUNING, held by `probe:hud` at three phone widths.
 */
export const PAUSE_CLEARANCE_PX = 150;

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

/**
 * One word per weather source, and not a longer one than is true: the
 * seeded model says `sim`, never anything that could pass for the island.
 */
const SOURCE_WORDS: Readonly<Record<WeatherReadout['source'], string>> = {
  live: 'live',
  cached: 'cached',
  simulated: 'sim',
};

/**
 * The sky's two lines, or the honest absence of them.
 *
 * `sky clear 12% · live` — the sky word, the cloud cover as a whole
 * percent, and WHERE THE READING CAME FROM, which is the one word on
 * the sheet that keeps a simulated sky from being mistaken for Kauaʻi's.
 * `rain 0.0 mm/h · 14:32 · sun 61°` — the rate to one decimal, the
 * island's clock, and the sun's elevation as a whole degree, `sun −8°`
 * below the horizon (a proper minus sign, so it cannot be read as a
 * dash between two numbers). "sky —" when the world has a sky that has
 * not answered yet, for the same reason the sea says "not built".
 *
 * THE SKY AND THE RAIN IN THE FRAME COLUMN, under the objects' lines,
 * for the same reason the sea's are: a sixth column does not fit beside
 * PAUSE at the 932 px canvas — and NO WIDER than the column already is
 * (`95th low 52.6 fps`, seventeen characters). THE CLOCK, THE SUN AND
 * THE SOURCE WORD IN THE CAMERA COLUMN, under `above`, because they are
 * facts about where, when and from what the eye is looking, and because
 * that column's position line is the widest thing on the HUD already: a
 * line there widens nothing. The first cut put all of it on one FRAME
 * line and slid the whole panel 13 px under PAUSE; the second put the
 * source word on the sky line, three characters over, and `probe:bot`
 * — which measures the edge with a room's long SESSION line — found 7 px
 * of overlap (2026-09-07). The source word is still printed every frame;
 * it is the honesty rule, and it moved columns, not off the sheet.
 */
function weatherWords(weather: WeatherReadout | null): readonly [string, string, string] {
  if (weather === null) return ['sky —', '', ''];
  const cloud = Math.round(100 * Math.min(1, Math.max(0, weather.cloud)));
  const sun = Math.round(weather.sunElevationDeg);
  return [
    `sky ${weather.sky} ${cloud}%`,
    `rain ${weather.rainMmHr.toFixed(1)} mm/h`,
    `${weather.clock} · sun ${sun < 0 ? `−${-sun}` : `${sun}`}° · ${SOURCE_WORDS[weather.source]}`,
  ];
}

/**
 * The widest line the FRAME column prints — `95th low 52.6 fps` — and
 * the width every ecology line is held to, so the block could move to
 * FRAME without widening it. `tests/perfHudEcology.test.ts` measures
 * each line at the largest values the caps allow.
 */
const ECOLOGY_LINE_MAX = '95th low 52.6 fps'.length;

/**
 * A count that stays short however long the session runs: whole
 * numbers under ten thousand, then `12k`, then `1.2M`. The ground line
 * counts every bore a worm has ever made, and a phone left running
 * would otherwise grow the line a character an hour.
 */
function compact(n: number): string {
  const whole = Math.max(0, Math.round(n));
  if (whole < 10_000) return String(whole);
  const k = Math.round(whole / 1000);
  if (k < 1000) return `${k}k`;
  const m = whole / 1_000_000;
  return m < 10 ? `${m.toFixed(1)}M` : `${Math.round(m)}M`;
}

/** The plant families' one line, or the honest absence of one — see `ObjectsReadout.plants`. */
function plantsWords(objects: ObjectsReadout | null): string {
  if (objects === null || objects.plants === undefined) return '';
  return `plants ${compact(objects.plants)}`;
}

/** `worms 12 of 40`: the residents and the rung's cap, and never a word that reads as a target. */
function speciesWords(name: string, s: SpeciesReadout): string {
  return `${name} ${Math.max(0, Math.round(s.resident))} of ${Math.max(0, Math.round(s.cap))}`;
}

/**
 * `eco 0.4+0.3+0.2ms`: think, move and draw, to a tenth. Whole
 * milliseconds instead when the tenths would push the line past the
 * column's width — `eco 100+100+100ms` is the worst case and is
 * exactly seventeen — because a system costing over ten milliseconds
 * a frame is not being read to a tenth.
 */
function costWords(thinkMs: number, moveMs: number, drawMs: number): string {
  const parts = [thinkMs, moveMs, drawMs].map((ms) => Math.max(0, ms));
  const tenths = `eco ${parts.map((ms) => ms.toFixed(1)).join('+')}ms`;
  if (tenths.length <= ECOLOGY_LINE_MAX) return tenths;
  return `eco ${parts.map((ms) => ms.toFixed(0)).join('+')}ms`;
}

/**
 * The finder's one line, at `ECOLOGY_LINE_MAX` like the rest of the
 * block. Four states, and each is a fact rather than a hope:
 *
 *   find off             the switch is off; nothing is being looked for
 *   find nothing near    on, and the simulation is holding none — a
 *                        beach, the sea, or a rung whose caps are spent
 *   find worm 12m NE     the nearest, and which way to fly
 *   under worm 12m NE    the same, and the reason you cannot see it:
 *                        it is in the soil, which is where a worm
 *                        spends most of its life
 *
 * Only a burrower is ever `under`, so the widest this can print is
 * `under aphid 40m NE` — seventeen characters, the column's width, with
 * the longest species word and the longest reach in the table.
 */
export function finderWords(f: FinderReadout | null): string {
  if (f === null) return '';
  if (!f.on) return 'find off';
  if (f.nearest === null) return 'find nothing near';
  const n = f.nearest;
  const metres = `${Math.max(0, Math.round(n.metres))}m`;
  return `${n.under ? 'under' : 'find'} ${n.species} ${metres} ${compassWord(n.bearing)}`;
}

/**
 * The creatures' six lines, or the honest absence of them: all empty
 * while the hook has nothing built to report, because a species line
 * reading `worms 0 of 40` about a simulation that does not exist yet
 * would be a count nobody took. Each line is held to
 * `ECOLOGY_LINE_MAX`; the widest the caps allow is `aphids 300 of 300`
 * at ultra-high, and the cost line's worst case is handled in
 * `costWords`.
 */
function creatureWords(c: CreaturesReadout | null): readonly [string, string, string, string, string, string] {
  if (c === null) return ['', '', '', '', '', ''];
  return [
    speciesWords('worms', c.worms),
    speciesWords('aphids', c.aphids),
    speciesWords('flies', c.flies),
    costWords(c.thinkMs, c.moveMs, c.drawMs),
    // `sites off` is the layer's word, not a count: with the resources
    // layer switched off nothing is derived, and 0 would say the island
    // offers nothing.
    c.resources === null ? 'sites off' : `sites ${compact(c.resources.sites)} wet ${compact(c.resources.waterEdges)}`,
    // The seam's own `built`, never inferred from the count: v1 has no
    // terrain editor, the worm's bores go to a no-op, and the sheet
    // says so rather than printing how many times nothing happened.
    c.ground.built ? `ground edits ${compact(c.ground.applied)}` : 'ground edits off',
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
  /** Built only when the owner offers a `weather()` hook; null otherwise. Sky and rain in FRAME, the clock in CAMERA. */
  private readonly weatherLines: readonly [HTMLElement, HTMLElement, HTMLElement] | null;
  /** The finder's line, with the ecology block; built only when the owner offers the hook. */
  private readonly finderLine: HTMLElement | null;
  /** The finder's switch and its GO button, at the foot of LAYERS. Null together with the line. */
  private finderBox: HTMLInputElement | null = null;
  private finderGo: HTMLButtonElement | null = null;

  /** The shadow configuration, under the clock in CAMERA; built with the weather lines. */
  private readonly shadowLine: HTMLElement | null;
  /** The plant families' line: built with the `objects()` hook, in CAMERA with the ecology block. */
  private readonly plantsLine: HTMLElement | null;
  /** Built only when the owner offers a `creatures()` hook; null otherwise. In CAMERA — see the header. */
  private readonly creatureLines: readonly [HTMLElement, HTMLElement, HTMLElement, HTMLElement, HTMLElement, HTMLElement] | null;
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
    // THE SHEET SCALES WITH THE SCREEN IT IS ON (Joshua, from the phone,
    // 2026-09-07): opened from the home screen, the app's viewport is
    // narrower in CSS pixels than Safari's 932, and a sheet laid out in
    // fixed pixels ran under PAUSE and hid its own fold toggle beneath
    // it — "I can't minimize the large stat screen". So the font is a
    // fraction of the viewport's width, capped at `SHEET_FONT_PX` on the
    // design canvas and above, and every gap and pad is in `em` so the
    // whole sheet follows it; the fold toggle keeps its 28 px because a
    // fingertip does not scale. The width cap and the wrap are the belt
    // to those braces: on a screen too narrow for the columns, they wrap
    // beneath rather than run under PAUSE.
    this.root.style.cssText =
      'position:absolute;top:8px;left:10px;display:flex;flex-wrap:wrap;align-items:flex-start;gap:1.4em;' +
      `box-sizing:border-box;max-width:calc(100vw - ${PAUSE_CLEARANCE_PX}px);` +
      `padding:0.7em ${padRight}px 0.7em 0.9em;background:rgba(6,9,12,0.72);color:${PARCHMENT};` +
      `font:${SHEET_FONT_PX}px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace;` +
      `font-size:min(${SHEET_FONT_PX}px, ${SHEET_FONT_VW}vw);border:1px solid ${GOLD};border-radius:6px;`;

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
    // And the sky under those — see `weatherWords` for the three lines,
    // why they are not a column, and why the clock is the camera's.
    this.weatherLines = hooks.weather === undefined
      ? null
      : [line(frame, 'weather-sky'), line(frame, 'weather-rain'), line(camera, 'weather-clock')];
    this.shadowLine = hooks.weather === undefined ? null : line(camera, 'weather-shadow');
    // THE ECOLOGY BLOCK, IN CAMERA, under the clock — the plant count
    // first, with the objects' hook it comes from, then the creatures'
    // six. The FRAME column is already tall enough to meet the stick at
    // the design canvas (see the header); this column is five lines and
    // the widest on the sheet, so these cost it neither height nor width.
    this.plantsLine = hooks.objects === undefined ? null : line(camera, 'veg-plants');
    this.finderLine = hooks.finder === undefined ? null : line(camera, 'eco-find');
    this.creatureLines = hooks.creatures === undefined
      ? null
      : [
        line(camera, 'eco-worms'), line(camera, 'eco-aphids'), line(camera, 'eco-flies'),
        line(camera, 'eco-cost'), line(camera, 'eco-resources'), line(camera, 'eco-ground'),
      ];
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
      col.style.maxWidth = `${(SESSION_MAX_WIDTH / 12).toFixed(2)}em`;
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
    this.buildFinderRow(parent, row);
  }

  /**
   * THE FINDER'S SWITCH, at the foot of LAYERS but NOT a layer.
   *
   * A world layer is a piece of the island whose cost is being measured;
   * the finder is an instrument laid over it, and putting it in
   * `WORLD_LAYERS` would have made the plan's own list say the island
   * has a `finder` in it. So it sits under the layers, separated by a
   * rule, with the GO button beside it — a THUMB target at the same 28
   * pixels as the fold toggle, because this is used on a phone.
   */
  private buildFinderRow(
    parent: HTMLElement,
    row: (id: string, label: string, checked: boolean, locked: boolean) => HTMLInputElement,
  ): void {
    if (this.hooks.finder === undefined) return;
    const doc = parent.ownerDocument;
    const rule = doc.createElement('div');
    rule.style.cssText = `margin:5px 0 4px;border-top:1px solid ${GOLD};opacity:0.35;`;
    parent.appendChild(rule);

    const box = row('finder', 'finder', this.hooks.finder().on, false);
    box.dataset.action = 'finder';
    box.addEventListener('change', () => this.hooks.onFinderToggle?.(box.checked));
    this.finderBox = box;

    const go = doc.createElement('button');
    go.type = 'button';
    go.dataset.action = 'finder-go';
    // NOT "go to nearest": every press after the first goes to the next
    // animal, so the label has to be true of all of them.
    go.textContent = 'go to animal';
    go.style.cssText =
      `display:block;margin:4px 0 0;min-height:${COLLAPSE_BUTTON_PX}px;padding:0 10px;`
      + `color:${GOLD};background:rgba(6,9,12,0.72);border:1px solid ${GOLD};border-radius:4px;`
      + 'font:inherit;cursor:pointer;touch-action:manipulation;';
    go.addEventListener('click', () => this.hooks.onFinderGo?.());
    parent.appendChild(go);
    this.finderGo = go;
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
      // One read of the hook for the five FRAME lines and the plants line both.
      const objects = this.hooks.objects?.() ?? null;
      const words = objectWords(objects);
      for (let i = 0; i < this.objectLines.length; i += 1) this.objectLines[i].textContent = words[i];
      if (this.plantsLine !== null) this.plantsLine.textContent = plantsWords(objects);
    }
    if (this.weatherLines !== null) {
      const weather = this.hooks.weather?.() ?? null;
      const words = weatherWords(weather);
      for (let i = 0; i < this.weatherLines.length; i += 1) this.weatherLines[i].textContent = words[i];
      if (this.shadowLine !== null) this.shadowLine.textContent = weather?.shadow ?? '';
    }
    if (this.finderLine !== null) {
      const finder = this.hooks.finder?.() ?? null;
      this.finderLine.textContent = finderWords(finder);
      if (this.finderBox !== null && finder !== null) this.finderBox.checked = finder.on;
      // GO is DISABLED, visibly, when there is nothing to go to: an
      // unavailable action must never look functional (CLAUDE.md).
      if (this.finderGo !== null) {
        const ready = finder !== null && finder.on && finder.nearest !== null;
        this.finderGo.disabled = !ready;
        this.finderGo.style.opacity = ready ? '1' : '0.45';
      }
    }
    if (this.creatureLines !== null) {
      const words = creatureWords(this.hooks.creatures?.() ?? null);
      for (let i = 0; i < this.creatureLines.length; i += 1) this.creatureLines[i].textContent = words[i];
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
