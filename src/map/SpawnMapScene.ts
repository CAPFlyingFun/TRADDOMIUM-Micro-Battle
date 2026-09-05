/**
 * CHOOSE WHERE THE COLONY BEGINS.
 *
 * The whole island on one screen, thirty regions on it, and a panel that
 * says what you are about to walk into. You pick a REGION; the game picks
 * one of its hidden candidates, so restarts vary and nobody memorises a
 * coordinate.
 *
 * WHY IT EXISTS AT ALL. Joshua, 2026-09-05, from the device: "the spawn
 * location is not at the ocean 🌊 to see it… look how v0 did the spawn
 * points so we can do the same in v1, so I can choose my spawn location
 * and test different areas. Also, add the map to pick. 🗺️" The fixed
 * start was Waiʻaleʻale's summit plateau, 17.25 km from water, so the sea
 * that Phase 3 had just built could not be reached to look at.
 *
 * WHY IT IS IN map/ AND NOT ui/. It holds a Heightfield and a
 * SpawnSites, and `src/ui/` may import nothing from `world/` — screens
 * take typed hooks and never reach past them (ARCHITECTURE §2.7). It
 * still uses ui/'s `Screen` chrome, because the door this sits in should
 * look like every other door.
 *
 * MARKER PIXELS ARE PRESENTATION; THE CANDIDATE'S WorldPoint IS THE
 * TRUTH. The two never swap (coords.ts). A marker is placed from the
 * region's declared centre — which is where the region IS — while the
 * place you actually arrive is a searched candidate that may be a few
 * hundred metres from it, because the ground had a vote.
 *
 * AND IT HANDS BACK A WORLD FACT, NOT A CAMERA POSE. `onStart` gives the
 * wiring a region and a candidate; turning that into a yaw and a height
 * is the app layer's business, and a map that knew what camera yaw was
 * would be a map that had to be changed when the camera was.
 */
import type { AppScene, SceneContext, SceneFactory } from '../app/Scene';
import { ACTION } from '../app/actions';
import { UNITS_PER_METRE, decodeCoarse } from '../world/dem';
import { repairGrid } from '../world/demRepair';
import { Heightfield } from '../world/heightfield';
import { geoToWorld } from '../world/geo';
import {
  SpawnSites, chooseCandidate, type Environment, type ReadyRegion, type SpawnCandidate,
} from '../world/spawn';
import {
  Screen, actionRow, actionsRow, namedButton, note, titledPanel,
} from '../ui/screen';
import { MAP_SIZE, bakeIsland, worldToMap } from './islandMap';

/** The registry id. `ui/navigation.ts` names the same string; a test pins them equal. */
export const SPAWN_MAP_SCENE_ID = 'spawn-map';

/** Where the survey comes from — the same shape the world scene takes. */
export type SurveySource = (onBytes: (received: number, total: number | null) => void) => Promise<ArrayBuffer>;

export interface SpawnMapHooks {
  /**
   * The survey. ABSENT MEANS NO MAP, and the screen says so rather than
   * drawing an empty square: the same rule the world scene follows, and
   * the reason constructing this cannot reach the network.
   */
  readonly survey?: SurveySource;
  /** A place was chosen. The wiring starts a game there. */
  onStart(region: ReadyRegion, candidate: SpawnCandidate): void;
  /**
   * Begin without choosing, because there was nothing to choose FROM.
   *
   * THE MAP MUST NOT BE A DEAD END. It sits between the slot picker and
   * the world, so a build with no survey — or a phone whose download
   * failed — would otherwise be a screen with the game behind it and no
   * way through. This starts at whatever the world's own default is,
   * which is exactly what NEW GAME did before this screen existed.
   *
   * It appears ONLY when there is no map. With an island on the screen
   * it would be a second, vaguer way to do the thing the markers already
   * do properly.
   */
  onDefault(): void;
  onBack(): void;
  /** Which candidate to take, 0..1. Injected so a test is not at the mercy of a die. */
  roll?(): number;
}

const FACE: Readonly<Record<Environment, string>> = {
  coast: '🏖️', grass: '🌾', jungle: '🌿', foothill: '⛰️', mountain: '🏔️',
};

const CALLED: Readonly<Record<Environment, string>> = {
  coast: 'Coast', grass: 'Open lowland', jungle: 'Jungle',
  foothill: 'Foothills', mountain: 'Mountain',
};

/**
 * How big the island picture is drawn, in CSS pixels.
 *
 * The design canvas is 932 x 430 and the map has to sit beside a panel
 * that can be read, so it is sized off the SHORT side: 430 minus the
 * screen's own chrome. A square that fills the height leaves about half
 * the width for the panel, which is what the layout below assumes.
 */
const PICTURE = 300;

/** One to three stars, as a word and a glyph a screen reader can skip. */
const difficultyOf = (n: number): string => '★'.repeat(n) + '☆'.repeat(Math.max(0, 3 - n));

export class SpawnMapScene extends Screen {
  readonly name = SPAWN_MAP_SCENE_ID;

  private sites: SpawnSites | null = null;
  private chosen: ReadyRegion | null = null;
  private disposed = false;
  /** Set only when there is no map: START means "wherever the world starts". */
  private startsAnywhere = false;

  /** The parts that are filled in once the survey has arrived. */
  private picture: HTMLElement | null = null;
  private status: HTMLElement | null = null;
  private title: HTMLElement | null = null;
  private blurb: HTMLElement | null = null;
  private facts: HTMLElement | null = null;
  private start: HTMLButtonElement | null = null;
  private readonly markers = new Map<string, HTMLButtonElement>();

  constructor(ctx: SceneContext, private readonly hooks: SpawnMapHooks) {
    super(ctx, 'plain');
  }

  override async enter(): Promise<void> {
    // The chrome first, then the survey. Two megabytes is a wait, and a
    // screen that appears only once it has finished reads as a hang.
    await super.enter();
    void this.load();
  }

  override dispose(): void {
    this.disposed = true;
    super.dispose();
  }

  protected build(root: HTMLElement): void {
    const doc = root.ownerDocument;
    const panel = titledPanel(root, 'Where will you begin?', { wide: true });

    const columns = doc.createElement('div');
    columns.style.cssText = 'display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap;';
    panel.appendChild(columns);

    // ── the island ──
    this.picture = doc.createElement('div');
    this.picture.dataset.role = 'spawn-map';
    this.picture.style.cssText =
      `position:relative;width:${PICTURE}px;height:${PICTURE}px;flex:0 0 auto;`
      + 'border:1px solid #c9a94a;border-radius:6px;background:#0b1220;overflow:hidden;';
    columns.appendChild(this.picture);

    this.status = doc.createElement('p');
    this.status.dataset.role = 'spawn-status';
    this.status.style.cssText =
      'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;'
      + 'margin:0;padding:12px;text-align:center;color:#e8e2c8;font:13px system-ui,sans-serif;'
      // A CAPTION, NEVER A CONTROL. It covers the whole square, so left
      // interactive it would swallow taps meant for the markers under it
      // — which is exactly the state the screen is in when the picture
      // could not be painted but the regions are still pickable.
      + 'pointer-events:none;';
    this.status.textContent = 'Reading the survey…';
    this.picture.appendChild(this.status);

    // ── what you are about to walk into ──
    const side = doc.createElement('div');
    side.style.cssText = 'flex:1 1 260px;min-width:240px;';
    columns.appendChild(side);

    this.title = doc.createElement('h3');
    this.title.dataset.role = 'spawn-name';
    this.title.style.cssText = 'margin:0 0 2px;color:#c9a94a;font:16px system-ui,sans-serif;';
    this.title.textContent = 'Pick a place on the map';
    side.appendChild(this.title);

    this.facts = doc.createElement('p');
    this.facts.dataset.role = 'spawn-facts';
    this.facts.style.cssText = 'margin:0 0 6px;color:#e8e2c8;font:13px system-ui,sans-serif;opacity:0.85;';
    side.appendChild(this.facts);

    this.blurb = note(side, 'Thirty regions around the real island. The game picks a safe spot inside the one you choose, so no two starts are quite the same.');
    this.blurb.dataset.role = 'spawn-blurb';

    this.start = namedButton('spawn-start', 'Begin here', () => this.begin());
    this.start.disabled = true;
    actionsRow(side, [
      this.start,
      actionRow(ACTION.back, 'Back', () => this.hooks.onBack(), { compact: true }),
    ]);
  }

  /**
   * Fetch the survey, find the candidates, paint the island.
   *
   * Everything here can fail without taking the screen with it — a
   * download on a phone is not a promise — and a failure says so in the
   * square where the map would have been, with BACK still working.
   */
  private async load(): Promise<void> {
    if (this.hooks.survey === undefined) {
      this.noMap('This build ships no survey, so there is no island to choose from.');
      return;
    }
    try {
      const bytes = await this.hooks.survey((received, total) => {
        const pct = total === null || total <= 0 ? null : Math.round((100 * received) / total);
        this.say(pct === null ? 'Reading the survey…' : `Reading the survey… ${pct}%`);
      });
      if (this.disposed) return;
      const field = new Heightfield(repairGrid(decodeCoarse(bytes)).grid);
      this.sites = new SpawnSites(field);
      this.paint(field);
    } catch (error) {
      console.error('[spawn-map] the survey did not load', error);
      this.noMap('The survey did not load, so the map cannot be drawn.');
    }
  }

  private say(text: string): void {
    if (this.status !== null) this.status.textContent = text;
  }

  /**
   * No island to pick from — say why, and open the way through anyway.
   *
   * The button is enabled because it WORKS: it begins at the world's own
   * default. An honest caption is the whole of the difference between
   * this and the dishonest kind of fallback.
   */
  private noMap(why: string): void {
    this.say(why);
    if (this.title !== null) this.title.textContent = 'No map to choose from';
    if (this.facts !== null) this.facts.textContent = '';
    if (this.blurb !== null) {
      this.blurb.textContent = `${why} You can still begin — the game will start where it normally does.`;
    }
    if (this.start !== null) {
      this.start.textContent = 'Begin anyway';
      this.start.disabled = false;
      this.startsAnywhere = true;
    }
  }

  /** The island, then a marker for every region that has anywhere to stand. */
  private paint(field: Heightfield): void {
    const host = this.picture;
    const sites = this.sites;
    if (host === null || sites === null || this.disposed) return;

    const baked = bakeIsland(field, MAP_SIZE);
    if (baked === null) {
      // No 2D context. The markers are still placed and still work, so
      // the screen is usable without the picture — degraded, not broken.
      this.say('');
    } else {
      const shown = host.ownerDocument.createElement('canvas');
      shown.width = MAP_SIZE;
      shown.height = MAP_SIZE;
      shown.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
      shown.getContext('2d')?.drawImage(baked, 0, 0);
      host.appendChild(shown);
      this.status?.remove();
      this.status = null;
    }

    for (const region of sites.regions()) {
      if (region.candidates.length === 0) continue; // nothing to stand on: no pin
      const at = worldToMap(geoToWorld(region.around), MAP_SIZE);
      const pin = host.ownerDocument.createElement('button');
      pin.type = 'button';
      pin.dataset.action = `spawn:${region.id}`;
      pin.title = region.name;
      pin.setAttribute('aria-label', region.name);
      pin.textContent = FACE[region.environment];
      pin.style.cssText =
        'position:absolute;transform:translate(-50%,-50%);width:26px;height:26px;padding:0;'
        + `left:${(100 * at.x) / MAP_SIZE}%;top:${(100 * at.y) / MAP_SIZE}%;`
        + 'border:1px solid rgba(201,169,74,.85);border-radius:50%;background:rgba(9,13,20,.72);'
        + 'color:#e8e2c8;font:13px system-ui,sans-serif;line-height:1;cursor:pointer;';
      pin.addEventListener('click', () => this.select(region));
      host.appendChild(pin);
      this.markers.set(region.id, pin);
    }
  }

  private select(region: ReadyRegion): void {
    this.chosen = region;
    for (const [id, pin] of this.markers) {
      const on = id === region.id;
      pin.style.borderColor = on ? '#ffd882' : 'rgba(201,169,74,.85)';
      pin.style.background = on ? 'rgba(201,169,74,.35)' : 'rgba(9,13,20,.72)';
    }
    if (this.title !== null) this.title.textContent = region.name;
    if (this.facts !== null) {
      const high = Math.round(
        region.candidates.reduce((sum, c) => sum + c.ground, 0)
        / Math.max(1, region.candidates.length) / UNITS_PER_METRE,
      );
      this.facts.textContent =
        `${CALLED[region.environment]} · ${difficultyOf(region.difficulty)} · about ${high} m`;
    }
    if (this.blurb !== null) this.blurb.textContent = region.description;
    if (this.start !== null) this.start.disabled = false;
  }

  private begin(): void {
    if (this.startsAnywhere) {
      this.hooks.onDefault();
      return;
    }
    const region = this.chosen;
    if (region === null) return;
    const roll = this.hooks.roll?.() ?? Math.random();
    const candidate = chooseCandidate(region, roll);
    // A region with no candidates never got a marker, so this is
    // unreachable by clicking — but `chooseCandidate` may say null and a
    // start that silently did nothing would be the dishonest button.
    if (candidate === null) return;
    this.hooks.onStart(region, candidate);
  }
}

export const createSpawnMapScene = (hooks: (ctx: SceneContext) => SpawnMapHooks): SceneFactory =>
  (ctx: SceneContext): AppScene => new SpawnMapScene(ctx, hooks(ctx));
