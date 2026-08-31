/**
 * THE LOOP — menu, map, world, death, back to the map.
 *
 * Small on purpose. It owns which screen is up and nothing else: the
 * menu knows nothing about the world, the map knows nothing about the
 * scene, and the scene knows nothing about either. Everything they pass
 * between them is a WorldPoint, so the loop never becomes the place
 * where a render position quietly turns into a save location.
 *
 * Not built here, deliberately, whatever the temptation: saving,
 * colonies, predators, weather. The rule after a colony exists is that
 * death hands control to another ant rather than ending the run, and
 * that rule needs a colony to be about. Today there is only the
 * pre-colony path — young queen dies, choose somewhere new.
 */
import { IslandScene } from '../scenes/IslandScene';
import { MainMenu } from './MainMenu';
import type { SessionMode } from '../game/session';
import { SpawnMap, type Chosen } from './SpawnMap';
import { LoadingScreen } from './LoadingScreen';
import { FIRST_LIGHT_JOB, LoadPlan, TERRAIN_JOB, WORK_WEIGHT } from './loadPlan';
import { planBands } from '../world/terrainMaterial';
import { planQueen } from '../ant/queenModel';
import { SettingsPanel } from './SettingsPanel';
import { latestSave, livedFor, type SoloSave } from '../game/save';
import { autoUpdate } from './updates';
import { DeathScreen } from './DeathScreen';
import type { HeightGrid } from '../world/kauai';
import { world } from '../world/coords';
import { chooseCandidate, readyRegions } from '../world/spawn';

export class GameFlow {
  private menu: MainMenu | null = null;
  private map: SpawnMap | null = null;
  private scene: IslandScene | null = null;
  private loading: LoadingScreen | null = null;
  private menuSettings: SettingsPanel | null = null;
  private death: DeathScreen | null = null;
  /** Where she started, so a restart can offer the same island again. */
  private lastStart: Chosen | null = null;
  /**
   * And which clock she started under.
   *
   * Death does not go back to the front door, it goes back to the map,
   * and the map has no mode control on it. Without this the player who
   * chose MULTIPLAYER would be quietly demoted to a frozen world by
   * the first thing that killed her.
   */
  private lastMode: SessionMode = 'solo';
  /** A dead queen's map, waiting for the next one. See died(). */
  private carried: string | undefined;

  constructor(
    private readonly host: HTMLElement,
    private readonly grid: HeightGrid,
  ) {
    this.toMenu();
    /**
     * TAKE A NEWER BUILD ON THE WAY IN.
     *
     * Here and nowhere else: the menu is the one moment where a reload
     * costs nothing, because there is no run to lose. Once she is
     * founding, an update is a button that says what it will cost.
     *
     * Not awaited. The menu is already on screen and playable; if there
     * is a newer build this replaces the page a moment later, and if
     * there is not, nothing happened. A menu that waited on the network
     * before it would respond would be a worse menu on every single
     * launch to fix a problem that happens on a few of them.
     */
    void autoUpdate();

    /**
     * WHAT THE PROBES DRIVE THE FLOW WITH.
     *
     * The menu-to-world path runs through a map the player picks a
     * region on by tapping the island, which a headless probe cannot
     * do without knowing where Līhuʻe is in screen pixels. `__island`
     * has been the scene's handle for a while; this is the same idea
     * one level up, and it exists so an acceptance test can say "start
     * a run" without also encoding the map's layout.
     */
    (window as unknown as Record<string, unknown>).__flow = {
      play: (mode?: SessionMode) => { void this.toFirstRegion(mode); },
      toMenu: () => this.toMenu(),
    };
  }

  /**
   * Straight into the world at the first region's first candidate.
   *
   * The mode is a parameter and not a constant because this is the
   * only way a headless probe can reach a running-world session at
   * all; it still defaults to the frozen one, so a probe written
   * before the split measures exactly what it measured yesterday.
   */
  private async toFirstRegion(mode: SessionMode = 'solo'): Promise<void> {
    const region = readyRegions().find((r) => r.candidates.length > 0);
    if (!region) return;
    const candidate = chooseCandidate(region, 0);
    if (!candidate) return;
    await this.spawn({ region, candidate }, null, mode);
  }

  toMenu(): void {
    this.clear();
    this.carried = undefined;
    // CONTINUE IS OFFERED ONLY IF THERE IS SOMETHING TO CONTINUE, and
    // the label says what it is rather than just that it exists — a
    // button that reads "CONTINUE" and drops you somewhere unexpected
    // is worse than one that reads "CONTINUE · LIHUE · 2h 14m".
    const found = latestSave(localStorage);
    // THE MODE ARRIVES WITH THE PRESS. Solo or Multiplayer applies to
    // both play buttons, so it is an argument to whichever one was
    // pushed rather than something the flow goes and asks the menu for
    // afterwards — there is no copy of it here to fall out of step
    // with the control the player is looking at.
    this.menu = new MainMenu(this.host, {
      resume: found
        ? { label: `${found.region.toUpperCase()} · ${livedFor(found.playedSeconds)}`,
          run: (mode) => { void this.spawn(null, found, mode); } }
        : null,
      newColony: (mode) => this.toMap(mode),
      settings: () => this.menuSettings?.reveal(),
    });
    // The same panel the game uses. A second copy would be a second
    // set of defaults to keep in step.
    this.menuSettings = new SettingsPanel(this.host);
  }

  /**
   * Longest the island will wait for its own loading screen to appear.
   *
   * Generous, because the wait is normally a frame or two and the only
   * thing that makes it long is a cold cache on a slow connection —
   * exactly when the screen is most worth having.
   */
  private static readonly REVEAL_LIMIT = 4000;

  /**
   * @param mode carried from whatever offered the map. Solo by default
   * so the dev routes and the pre-split callers keep freezing the
   * world exactly as they always have.
   */
  toMap(mode: SessionMode = 'solo'): void {
    this.clear();
    this.map = new SpawnMap(this.host, (chosen) => {
      void this.spawn(chosen, null, mode);
    });
  }

  /**
   * Put her down.
   *
   * The whole floating-origin story in four lines: take the GLOBAL
   * candidate, hand it to the scene, and let the scene seat the origin
   * and cut terrain around it. Nothing local survives this call.
   */
  async spawn(
    chosen: Chosen | null,
    resuming: SoloSave | null = null,
    mode: SessionMode = 'solo',
  ): Promise<void> {
    if (!chosen && !resuming) return;
    if (chosen) this.lastStart = chosen;
    this.lastMode = mode;
    this.clear();

    // THE VEIL GOES UP FIRST, before the scene exists. The scene starts
    // downloading the moment it is constructed and renders from its
    // very first frame — a frame in which the ground has no textures
    // yet and draws as a black void. Building it behind the screen is
    // the whole point; putting the screen up afterwards would show
    // exactly the frame it is meant to hide.
    const plan = new LoadPlan();
    planBands(plan);
    planQueen(plan);
    plan.add(TERRAIN_JOB, 'Cutting the terrain', WORK_WEIGHT);
    plan.add(FIRST_LIGHT_JOB, 'First light', WORK_WEIGHT);

    const where = chosen?.region.name ?? resuming?.region ?? 'Kauaʻi';
    const screen = new LoadingScreen(this.host, where);
    this.loading = screen;
    screen.follow(() => plan.read());

    // WAIT FOR THE SCREEN TO ACTUALLY BE ON SCREEN. Building the island
    // is a second or more of blocked main thread — terrain cut, context
    // made, shaders compiled — and it used to run in the same task that
    // put the veil up, so the browser had no chance to paint the veil
    // until all of it was done. What arrived first was whatever needed
    // no decoding: the bar and the captions, with the forest behind
    // them a second or two later.
    //
    // Capped, because a picture that never decodes must not mean a game
    // that never starts.
    await Promise.race([
      screen.shown,
      new Promise((go) => setTimeout(go, GameFlow.REVEAL_LIMIT)),
    ]);
    // Sent back to the map while that was happening.
    if (this.loading !== screen) return;

    // WHERE SHE STANDS COMES FROM THE SAVE when there is one, because
    // the scene is built around a start point and cuts its terrain
    // there. Putting her back afterwards would build one island and
    // then need another.
    const start = resuming
      ? {
        at: world(resuming.at.wx, resuming.at.wz),
        heading: resuming.at.heading,
      }
      : { at: chosen!.candidate.at, heading: chosen!.candidate.heading };

    const scene = new IslandScene(
      this.host, this.grid, start, () => this.died(), plan,
    );
    this.scene = scene;
    // The rest of the run — her meters, her wings, the world clock —
    // is state a constructor argument cannot carry.
    if (resuming) scene.resume(resuming);
    // A NEW BODY ON A KNOWN ISLAND. Only ever set by died(), and spent
    // the moment it is used so a later NEW COLONY starts blank.
    else if (this.carried) scene.inheritDiscovery(this.carried);
    this.carried = undefined;
    // AND WHICH CLOCK SHE RUNS UNDER. Solo stops the world behind a
    // menu or the map; Multiplayer stops only the player's hands. The
    // scene owns that because the scene owns the step — the flow just
    // carries the answer from the button that was pressed.
    scene.setMode(mode);
    scene.onLeave(() => this.toMenu());

    void scene.ready
      .then(async () => {
        // She may have been sent back to the map while the island was
        // still arriving; there is nothing to reveal in that case.
        if (this.scene !== scene) return;
        await screen.lift();
        if (this.loading === screen) this.loading = null;
      })
      .catch((why) => {
        console.warn('the island did not finish loading', why);
        screen.fail('The island failed to load.');
      });
  }

  /**
   * She died. The world stays up behind the screen — she is still lying
   * there, and clearing the scene under the player's feet the instant
   * it happens reads as a crash rather than as a death.
   */
  private died(): void {
    // WHAT SHE KNEW OUTLIVES HER. The scene wrote a parting save on the
    // way through kill(), so the freshest map of this run is in the
    // slot; hold it so the next queen starts with it. Only across a
    // DEATH — NEW COLONY from the front door is a deliberate fresh
    // start and gets a blank chart.
    this.carried = latestSave(localStorage)?.discovery;
    this.death?.dispose();
    this.death = new DeathScreen(this.host, () => this.toMap(this.lastMode));
  }

  /** Start again somewhere new — the pre-colony death path. */
  restart(): void {
    this.toMap(this.lastMode);
  }

  get startedAt(): Chosen | null {
    return this.lastStart;
  }

  private clear(): void {
    this.death?.dispose();
    this.death = null;
    this.loading?.dispose();
    this.loading = null;
    this.scene?.dispose();
    this.scene = null;
    this.map?.dispose();
    this.map = null;
    this.menu?.dispose();
    this.menu = null;
    this.menuSettings?.dispose();
    this.menuSettings = null;
  }

  dispose(): void {
    this.clear();
  }
}
