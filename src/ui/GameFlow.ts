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
import { SettingsPanel } from './SettingsPanel';
import { DeathScreen } from './DeathScreen';
import type { HeightGrid } from '../world/kauai';

export class GameFlow {
  private menu: MainMenu | null = null;
  private map: SpawnMap | null = null;
  private scene: IslandScene | null = null;
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
    this.scene = new IslandScene(
      this.host,
      this.grid,
      { at: chosen.candidate.at, heading: chosen.candidate.heading },
      () => this.died(),
    );
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
