/**
 * THE PAUSE MENU — and in Solo, pause means pause.
 *
 * SESSION_ARCHITECTURE.md draws the line this file exists to hold:
 * opening the menu in Solo stops the world, and opening it in
 * Multiplayer stops nothing but the player's hands. There is no
 * Multiplayer yet, so this is the Solo half — but it takes the halt as
 * a parameter rather than assuming it, so the day a server owns the
 * clock this panel does not have to be rewritten to stop lying.
 *
 * IT REPLACES THE SETTINGS COG rather than joining it. A separate
 * pause button would be one more thing on a HUD that was already
 * called busy, and the cog was already the "I want out of the game for
 * a moment" gesture — it just used to be a gesture that left the world
 * running while you read it.
 */
const GOLD = 'rgba(255, 210, 110, .92)';
const GOLD_FAINT = 'rgba(214, 178, 96, .5)';

export interface PauseChoice {
  readonly resume: () => void;
  readonly save: () => void;
  readonly settings: () => void;
  readonly quit: () => void;
}

export class PauseMenu {
  private readonly veil: HTMLDivElement;
  private readonly card: HTMLDivElement;
  private readonly note: HTMLDivElement;
  private open = false;

  constructor(host: HTMLElement, private readonly choose: PauseChoice) {
    this.veil = document.createElement('div');
    this.veil.dataset.ui = 'pause';
    Object.assign(this.veil.style, {
      position: 'fixed',
      inset: '0',
      display: 'none',
      alignItems: 'center',
      justifyContent: 'center',
      // Dark enough to say "stopped", clear enough that she is still
      // visible behind it — a pause that hides the world reads as a
      // scene change rather than as a held breath.
      background: 'rgba(10, 8, 5, .62)',
      backdropFilter: 'blur(2px)',
      zIndex: '40',
      touchAction: 'none',
    } as Partial<CSSStyleDeclaration>);

    this.card = document.createElement('div');
    Object.assign(this.card.style, {
      minWidth: '236px',
      padding: '16px 18px 14px',
      borderRadius: '14px',
      border: `1px solid ${GOLD_FAINT}`,
      background: 'linear-gradient(180deg, rgba(38,30,20,.96), rgba(22,17,11,.96))',
      boxShadow: '0 18px 48px rgba(0,0,0,.6)',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
    } as Partial<CSSStyleDeclaration>);

    const title = document.createElement('div');
    title.textContent = 'PAUSED';
    Object.assign(title.style, {
      textAlign: 'center',
      font: '700 13px/1 "Chakra Petch", system-ui, sans-serif',
      letterSpacing: '.22em',
      color: GOLD,
      marginBottom: '2px',
    } as Partial<CSSStyleDeclaration>);
    this.card.appendChild(title);

    this.note = document.createElement('div');
    Object.assign(this.note.style, {
      textAlign: 'center',
      font: '600 9px/1.4 "JetBrains Mono", ui-monospace, monospace',
      letterSpacing: '.06em',
      color: 'rgba(226, 205, 160, .62)',
      marginBottom: '6px',
      minHeight: '12px',
    } as Partial<CSSStyleDeclaration>);
    this.card.appendChild(this.note);

    this.card.append(
      this.button('RESUME', 'pause-resume', () => this.hide(), true),
      this.button('SAVE', 'pause-save', () => {
        this.choose.save();
        this.say('Saved.');
      }),
      this.button('SETTINGS', 'pause-settings', () => this.choose.settings()),
      this.button('QUIT TO MENU', 'pause-quit', () => {
        // SAVES ON THE WAY OUT, always. Leaving is the one moment a
        // player is guaranteed not to come back to fix it, and losing
        // an hour to a deliberate exit is the worst version of this
        // whole feature going wrong.
        this.choose.save();
        this.choose.quit();
      }),
    );

    this.veil.appendChild(this.card);
    host.appendChild(this.veil);

    // A tap on the darkness is a resume. Not on the card, which would
    // dismiss the menu every time a button was missed.
    this.veil.addEventListener('pointerdown', (e) => {
      if (e.target === this.veil) this.hide();
    });
  }

  get showing(): boolean {
    return this.open;
  }

  show(): void {
    if (this.open) return;
    this.open = true;
    this.veil.style.display = 'flex';
    this.say('The world is stopped.');
  }

  hide(): void {
    if (!this.open) return;
    this.open = false;
    this.veil.style.display = 'none';
    this.choose.resume();
  }

  /** A line under the title — what just happened, or what is true. */
  say(words: string): void {
    this.note.textContent = words;
  }

  dispose(): void {
    this.veil.remove();
  }

  private button(
    label: string, name: string, run: () => void, lead = false,
  ): HTMLButtonElement {
    const el = document.createElement('button');
    el.type = 'button';
    el.dataset.ui = name;
    el.textContent = label;
    Object.assign(el.style, {
      appearance: 'none',
      cursor: 'pointer',
      padding: '10px 14px',
      borderRadius: '9px',
      border: `1px solid ${lead ? GOLD : GOLD_FAINT}`,
      background: lead ? 'rgba(255, 210, 110, .16)' : 'rgba(255, 226, 160, .05)',
      color: lead ? GOLD : 'rgba(238, 220, 178, .88)',
      font: '700 11px/1 "Chakra Petch", system-ui, sans-serif',
      letterSpacing: '.14em',
      touchAction: 'manipulation',
    } as Partial<CSSStyleDeclaration>);
    el.addEventListener('click', run);
    return el;
  }
}
