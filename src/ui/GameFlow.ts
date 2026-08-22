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
import { SpawnMap, type Chosen } from './SpawnMap';
import { LoadingScreen } from './LoadingScreen';
import { FIRST_LIGHT_JOB, LoadPlan, TERRAIN_JOB, WORK_WEIGHT } from './loadPlan';
import { planBands } from '../world/terrainMaterial';
import { planQueen } from '../ant/queenModel';
import { SettingsPanel } from './SettingsPanel';
import { DeathScreen } from './DeathScreen';
import type { HeightGrid } from '../world/kauai';

export class GameFlow {
  private menu: MainMenu | null = null;
  private map: SpawnMap | null = null;
  private scene: IslandScene | null = null;
  private loading: LoadingScreen | null = null;
  private menuSettings: SettingsPanel | null = null;
  private death: DeathScreen | null = null;
  /** Where she started, so a restart can offer the same island again. */
  private lastStart: Chosen | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly grid: HeightGrid,
  ) {
    this.toMenu();
  }

  toMenu(): void {
    this.clear();
    this.menu = new MainMenu(this.host, {
      newColony: () => this.toMap(),
      settings: () => this.menuSettings?.reveal(),
    });
    // The same panel the game uses. A second copy would be a second
    // set of defaults to keep in step.
    this.menuSettings = new SettingsPanel(this.host);
  }

  toMap(): void {
    this.clear();
    this.map = new SpawnMap(this.host, (chosen) => this.spawn(chosen));
  }

  /**
   * Put her down.
   *
   * The whole floating-origin story in four lines: take the GLOBAL
   * candidate, hand it to the scene, and let the scene seat the origin
   * and cut terrain around it. Nothing local survives this call.
   */
  spawn(chosen: Chosen): void {
    this.lastStart = chosen;
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

    const screen = new LoadingScreen(this.host, chosen.region.name);
    this.loading = screen;
    screen.follow(() => plan.read());

    const scene = new IslandScene(
      this.host,
      this.grid,
      { at: chosen.candidate.at, heading: chosen.candidate.heading },
      () => this.died(),
      plan,
    );
    this.scene = scene;

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
    this.death?.dispose();
    this.death = new DeathScreen(this.host, () => this.toMap());
  }

  /** Start again somewhere new — the pre-colony death path. */
  restart(): void {
    this.toMap();
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
