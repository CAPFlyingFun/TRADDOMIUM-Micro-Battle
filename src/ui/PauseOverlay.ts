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
import type { StressReadout } from '../lab/stressTest';

/** The stress sheet's typed seam. The island owns the population; UI only commands and reads it. */
export interface PauseStressControls {
  readonly active: boolean;
  readonly running: boolean;
  readonly finished: boolean;
  readonly report: string;
  /** A placement or setup problem that should be spoken beside the report. */
  readonly error?: string;
  readonly readout: StressReadout;
  start(): void;
  stop(): void;
  runAgain(): void;
  exit(): void;
}

export interface PauseHooks {
  /** Read-only: the heading is decided by `canPauseWorld`. */
  readonly session: GameSession;
  /** After the overlay has hidden itself and requested `playing`. */
  onResume(): void;
  /** After the overlay has closed. The world ends the session and leaves. */
  onQuit(): void;
  /** Optional on real worlds; absent in UI-only and older world scenes. */
  readonly stress?: PauseStressControls | null;
}

/** The heading, decided by the one fact that makes it true or false. */
export function pauseWords(canPauseWorld: boolean): string {
  return canPauseWorld ? 'World paused' : 'Menu open — the world keeps running';
}

export class PauseOverlay {
  private readonly veil: HTMLElement;
  private readonly card: HTMLElement;
  private settings: SettingsPanel | null = null;
  private stressPanel: HTMLElement | null = null;
  private stressPhase: HTMLElement | null = null;
  private stressSummary: HTMLElement | null = null;
  private stressReport: HTMLPreElement | null = null;
  private stressCopyStatus: HTMLElement | null = null;
  private stressTimer: ReturnType<typeof setInterval> | null = null;
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
      ...(hooks.stress === undefined || hooks.stress === null || !hooks.session.canPauseWorld
        ? []
        : [actionRow(ACTION.islandStress, 'Island stress test', () => this.openStress())]),
      actionRow(ACTION.quit, 'Quit to menu', () => this.quit()),
    ]);
    if (hooks.stress !== undefined && hooks.stress !== null && hooks.session.canPauseWorld) {
      this.buildStressPanel(hooks.stress);
    }
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
    // A run belongs to this pause sheet. Resuming ordinary play must restore
    // ambient insects rather than leaving a hidden temporary population
    // alive behind the game.
    this.hooks.stress?.exit();
    this.close();
    this.ctx.app.requestState('playing');
  }

  dispose(): void {
    this.stopStressPolling();
    this.hooks.stress?.exit();
    this.settings?.dispose();
    this.settings = null;
    this.stressPanel?.remove();
    this.stressPanel = null;
    this.veil.remove();
    this.open = false;
  }

  private resume(): void {
    this.hide();
    this.hooks.onResume();
  }

  private quit(): void {
    this.hooks.stress?.exit();
    this.close();
    this.hooks.onQuit();
  }

  /** DOM only: no state request, so quitting can go paused → menu directly. */
  private close(): void {
    this.stopStressPolling();
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
    if (this.stressPanel) this.stressPanel.hidden = true;
  }

  private buildStressPanel(controls: PauseStressControls): void {
    const panel = titledPanel(this.veil, 'Island stress test', {
      subtitle: 'Seeded insects are placed on valid island ground within a 1 m circle around the camera.',
      wide: true,
    });
    panel.dataset.role = 'island-stress';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    const heading = panel.querySelector<HTMLElement>('.ui-title');
    if (heading !== null) {
      heading.id = 'island-stress-title';
      panel.setAttribute('aria-labelledby', heading.id);
    }
    panel.hidden = true;
    this.stressPanel = panel;
    this.stressPhase = this.ctx.uiLayer.ownerDocument.createElement('p');
    this.stressPhase.className = 'ui-note';
    this.stressPhase.dataset.role = 'stress-phase';
    this.stressPhase.setAttribute('aria-live', 'polite');
    panel.appendChild(this.stressPhase);
    this.stressSummary = this.ctx.uiLayer.ownerDocument.createElement('p');
    this.stressSummary.className = 'ui-subtitle';
    this.stressSummary.dataset.role = 'stress-summary';
    panel.appendChild(this.stressSummary);

    const actions = this.ctx.uiLayer.ownerDocument.createElement('div');
    actions.className = 'ui-actions ui-stress-actions';
    actions.append(
      actionRow(ACTION.stressStart, 'Start', () => {
        controls.start();
        this.refreshStress(controls);
      }, { primary: true }),
      actionRow(ACTION.stressStop, 'Stop & hold report', () => {
        controls.stop();
        this.refreshStress(controls);
      }),
      actionRow(ACTION.stressAgain, 'Run again', () => {
        controls.runAgain();
        this.refreshStress(controls);
      }),
      actionRow(ACTION.stressCopy, 'Copy report', () => void this.copyStressReport(controls)),
      actionRow(ACTION.stressExit, 'Exit', () => {
        controls.exit();
        this.showCard();
        this.stopStressPolling();
      }),
      actionRow(ACTION.back, 'Back', () => {
        controls.exit();
        this.showCard();
        this.stopStressPolling();
      }),
    );
    panel.appendChild(actions);

    this.stressReport = this.ctx.uiLayer.ownerDocument.createElement('pre');
    this.stressReport.className = 'ui-stress-report';
    this.stressReport.dataset.role = 'stress-report';
    this.stressReport.setAttribute('aria-live', 'polite');
    this.stressReport.textContent = 'No report yet. Start the seeded run when ready.';
    panel.appendChild(this.stressReport);
    this.stressCopyStatus = this.ctx.uiLayer.ownerDocument.createElement('p');
    this.stressCopyStatus.className = 'ui-subtitle';
    this.stressCopyStatus.dataset.role = 'stress-copy-status';
    this.stressCopyStatus.setAttribute('aria-live', 'polite');
    panel.appendChild(this.stressCopyStatus);
  }

  private openStress(): void {
    const controls = this.hooks.stress;
    if (controls === undefined || controls === null || this.stressPanel === null) return;
    this.card.hidden = true;
    this.settings?.dispose();
    this.settings = null;
    this.stressPanel.hidden = false;
    this.refreshStress(controls);
    this.stopStressPolling();
    this.stressTimer = setInterval(() => this.refreshStress(controls), 100);
  }

  private refreshStress(controls: PauseStressControls): void {
    const run = controls.readout;
    if (this.stressPhase !== null) {
      this.stressPhase.textContent = controls.active
        ? `${run.phase.toUpperCase()} · ${run.creatures} insects · ${run.fps > 0 ? run.fps.toFixed(1) : '—'} FPS`
        : 'Ready';
    }
    if (this.stressSummary !== null) {
      this.stressSummary.textContent = controls.error
        ? controls.error
        : controls.active
        ? run.phase === 'recovery'
          ? `Recovery: ${run.recoveryLeftS.toFixed(1)} s remaining`
          : 'Ambient insects are frozen while this seeded population is measured.'
        : 'The report is reproducible: the same seed and camera conditions are used every run.';
    }
    if (this.stressReport !== null && controls.report !== '') this.stressReport.textContent = controls.report;
    const button = (action: string): HTMLButtonElement | null =>
      this.stressPanel?.querySelector<HTMLButtonElement>(`[data-action="${action}"]`) ?? null;
    const running = controls.running;
    const active = controls.active;
    const finished = controls.finished;
    const start = button(ACTION.stressStart);
    const stop = button(ACTION.stressStop);
    const again = button(ACTION.stressAgain);
    const copy = button(ACTION.stressCopy);
    if (start) start.disabled = running || (active && finished);
    if (stop) stop.disabled = !running;
    if (again) again.disabled = running || !active;
    if (copy) copy.disabled = !finished || controls.report === '';
  }

  private async copyStressReport(controls: PauseStressControls): Promise<void> {
    const text = controls.report;
    if (text === '') return;
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else {
        const input = this.ctx.uiLayer.ownerDocument.createElement('textarea');
        input.value = text;
        input.setAttribute('readonly', '');
        input.style.position = 'fixed';
        input.style.opacity = '0';
        this.ctx.uiLayer.appendChild(input);
        input.select();
        this.ctx.uiLayer.ownerDocument.execCommand('copy');
        input.remove();
      }
      if (this.stressCopyStatus) this.stressCopyStatus.textContent = 'Report copied.';
    } catch {
      if (this.stressCopyStatus) this.stressCopyStatus.textContent = 'Copy failed; select the report text manually.';
    }
  }

  private stopStressPolling(): void {
    if (this.stressTimer !== null) clearInterval(this.stressTimer);
    this.stressTimer = null;
  }
}
