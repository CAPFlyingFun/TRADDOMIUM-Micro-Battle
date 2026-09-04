/**
 * The pause menu — an OVERLAY the world scene shows, never a scene swap:
 * the scene is the world, and swapping it would dispose the game.
 *
 * HONESTY. A true pause exists only when `session.canPauseWorld`. In solo
 * the heading says "World paused" and it is true, because `show()` puts
 * the app in the `paused` state and App's frame loop stops sim dt for a
 * pausable session. In multiplayer the same overlay says "Menu open — the
 * world keeps running", because a server's clock does not stop for one
 * player's menu (ARCHITECTURE §6). The words come from the session
 * object, so this file cannot say one thing while the loop does another.
 *
 * `show()` requests `paused` and `hide()` requests `playing`, so the world
 * scene does not have to remember to; it must already have requested
 * `playing` in its own `enter()` (loading → paused is not a legal step).
 *
 * SETTINGS opens the shared SettingsPanel inside the overlay; Back returns
 * to the pause card. QUIT closes the overlay without touching the state
 * and hands off to `onQuit` — the world ends the session and leaves
 * (`navigation.quitToMenu`).
 */
import { ACTION } from '../app/actions';
import type { SceneContext } from '../app/Scene';
import type { GameSession } from '../session/GameSession';
import { actionRow, buttonColumn, titledPanel } from './screen';
import { SettingsPanel } from './SettingsPanel';
import { openSettings } from './settingsStore';

export interface PauseHooks {
  /** Read-only: the heading is decided by `canPauseWorld`. */
  readonly session: GameSession;
  /** After the overlay has hidden itself and requested `playing`. */
  onResume(): void;
  /** After the overlay has closed. The world ends the session and leaves. */
  onQuit(): void;
}

/** The heading, decided by the one fact that makes it true or false. */
export function pauseWords(canPauseWorld: boolean): string {
  return canPauseWorld ? 'World paused' : 'Menu open — the world keeps running';
}

export class PauseOverlay {
  private readonly veil: HTMLElement;
  private readonly card: HTMLElement;
  private settings: SettingsPanel | null = null;
  private open = false;

  constructor(
    private readonly ctx: SceneContext,
    private readonly hooks: PauseHooks,
  ) {
    const doc = ctx.uiLayer.ownerDocument;
    this.veil = doc.createElement('div');
    this.veil.className = 'ui-overlay';
    this.veil.dataset.role = 'pause';
    this.veil.hidden = true;
    this.card = titledPanel(this.veil, pauseWords(hooks.session.canPauseWorld));
    buttonColumn(this.card, [
      actionRow(ACTION.resume, 'Resume', () => this.resume(), { primary: true }),
      actionRow(ACTION.settings, 'Settings', () => this.openSettings()),
      actionRow(ACTION.quit, 'Quit to menu', () => this.quit()),
    ]);
    ctx.uiLayer.appendChild(this.veil);
  }

  get isOpen(): boolean {
    return this.open;
  }

  show(): void {
    if (this.open) return;
    this.open = true;
    this.showCard();
    this.veil.hidden = false;
    this.ctx.app.requestState('paused');
  }

  /** Close and let the world run. Does not fire `onResume`; the RESUME button does. */
  hide(): void {
    if (!this.open) return;
    this.close();
    this.ctx.app.requestState('playing');
  }

  dispose(): void {
    this.settings?.dispose();
    this.settings = null;
    this.veil.remove();
    this.open = false;
  }

  private resume(): void {
    this.hide();
    this.hooks.onResume();
  }

  private quit(): void {
    this.close();
    this.hooks.onQuit();
  }

  /** DOM only: no state request, so quitting can go paused → menu directly. */
  private close(): void {
    this.open = false;
    this.veil.hidden = true;
    this.showCard();
  }

  private openSettings(): void {
    if (this.settings) return;
    this.card.hidden = true;
    this.settings = new SettingsPanel(this.veil, {
      store: openSettings(this.ctx.storage),
      onBack: () => this.showCard(),
    });
  }

  private showCard(): void {
    this.settings?.dispose();
    this.settings = null;
    this.card.hidden = false;
  }
}
