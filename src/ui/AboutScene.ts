/**
 * About: what the game is and, more usefully on a phone, which build this
 * is. Version, commit and build date come from the build stamp; the one
 * paragraph is the game as designed. No external links — nothing on this
 * screen should be able to leave the game.
 */
import { ACTION } from '../app/actions';
import type { AppScene, SceneContext, SceneFactory } from '../app/Scene';
import { BUILD_INFO, type BuildInfo } from './buildInfo';
import { GAME_TITLE } from './MainMenuScene';
import { goToScreen, SCREEN_ID } from './navigation';
import { actionRow, actionsRow, note, Screen, titledPanel } from './screen';

export interface AboutHooks {
  readonly build: BuildInfo;
  onBack(): void;
}

export const ABOUT_PARAGRAPH =
  `${GAME_TITLE} is a direct-control ant survival game for a phone held sideways: ` +
  'you are one ant in a persistent colony on a true-scale, surveyed Kauaʻi, and when an ant dies the colony goes on. ' +
  'This build is the v1 rebuild, put together from the foundation outward, so it grows one measured layer at a time.';

export class AboutScene extends Screen {
  readonly name = 'about';

  constructor(ctx: SceneContext, private readonly hooks: AboutHooks) {
    super(ctx, 'plain');
  }

  protected build(root: HTMLElement): void {
    const panel = titledPanel(root, 'About', { wide: true });
    const doc = root.ownerDocument;
    const facts = doc.createElement('dl');
    facts.className = 'ui-facts';
    for (const [term, value] of [
      ['Name', GAME_TITLE],
      ['Version', this.hooks.build.version],
      ['Commit', this.hooks.build.commit],
      ['Built', this.hooks.build.date],
    ] as const) {
      const dt = doc.createElement('dt');
      dt.textContent = term;
      const dd = doc.createElement('dd');
      dd.textContent = value;
      facts.append(dt, dd);
    }
    panel.appendChild(facts);
    note(panel, ABOUT_PARAGRAPH);
    actionsRow(panel, [actionRow(ACTION.back, 'Back', () => this.hooks.onBack(), { compact: true })]);
  }
}

export const createAboutScene: SceneFactory = (ctx: SceneContext): AppScene =>
  new AboutScene(ctx, { build: BUILD_INFO, onBack: () => goToScreen(ctx, SCREEN_ID.menu) });
