/**
 * The Settings screen: the SettingsPanel on its own backdrop, reached from
 * the main menu. In the world the same panel is shown by the pause overlay
 * instead, without a scene swap.
 */
import type { AppScene, SceneContext, SceneFactory } from '../app/Scene';
import { goToScreen, SCREEN_ID } from './navigation';
import { Screen } from './screen';
import { SettingsPanel, type SettingsPanelHooks } from './SettingsPanel';
import { openSettings } from './settingsStore';

export type SettingsHooks = SettingsPanelHooks;

export class SettingsScene extends Screen {
  readonly name = 'settings';
  private panel: SettingsPanel | null = null;

  constructor(ctx: SceneContext, private readonly hooks: SettingsHooks) {
    super(ctx, 'plain');
  }

  protected build(root: HTMLElement): void {
    this.panel = new SettingsPanel(root, this.hooks);
  }

  override dispose(): void {
    this.panel?.dispose();
    this.panel = null;
    super.dispose();
  }
}

/** Wired entirely from the context: the store is the ui's own, and Back is the menu. */
export const createSettingsScene: SceneFactory = (ctx: SceneContext): AppScene =>
  new SettingsScene(ctx, {
    store: openSettings(ctx.storage),
    onBack: () => goToScreen(ctx, SCREEN_ID.menu),
  });
