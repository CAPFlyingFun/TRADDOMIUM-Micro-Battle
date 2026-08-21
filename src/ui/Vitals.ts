/**
 * THE VITALS CLUSTER — top left, and honest about what it knows.
 *
 * Every meter here now reads a REAL number off the queen's stat table
 * rather than an em-dash placeholder: her health, food and water are
 * resolved from castes.ts at the live reference point, so the cluster
 * says what she actually has. What it does not do is pretend they are
 * in play. Nothing damages her, nothing feeds her and nothing dries her
 * out, so those three sit full and still — which is not a lie, it is
 * the true reading of a value that has no way to change yet.
 *
 * That is the project rule kept exactly: a bar may only MOVE if there
 * is a way to move it back. A full bar that never moves breaks no
 * promise. A falling one with no food in the world would.
 *
 * Stamina is the one that lives, so it is the one in amber, and the
 * others sit a shade back to say which meter to watch. Stamina reads in
 * SECONDS because that is the unit the reserve is stored in and the one
 * the player feels; the rest read in points, because points is what
 * they are.
 *
 * The colony row from the reference layout is CUT rather than dimmed.
 * Three empty numbers is clutter; it can arrive whole when there is a
 * colony behind it.
 */
import { SPRINT_SECONDS } from '../ant/stamina';

const GOLD = 'rgba(255, 226, 160, .9)';
const GOLD_DIM = 'rgba(255, 226, 160, .55)';
/** Real, and resting: a number that is true and has nowhere to go yet. */
const RESTING = 'rgba(255, 226, 160, .42)';
const FUEL = 'rgba(255, 196, 92, .95)';
const SPENT = 'rgba(255, 110, 90, .95)';

/** What the queen's stat table says she has, resolved for the live ant. */
export interface Reserves {
  readonly health: number;
  readonly food: number;
  readonly water: number;
}

interface Meter {
  readonly icon: HTMLElement;
  readonly fill: HTMLElement;
  readonly read: HTMLElement;
}

export class Vitals {
  private readonly panel: HTMLDivElement;
  private readonly stamina: Meter;
  private readonly grace: HTMLDivElement;
  private shown = '';
  private shownGrace = '';

  constructor(host: HTMLElement, reserves: Reserves, caste = 'Queen') {
    this.panel = document.createElement('div');
    this.panel.dataset.ui = 'vitals';
    this.style();

    const portrait = document.createElement('div');
    portrait.textContent = '🐜';
    Object.assign(portrait.style, {
      width: '46px',
      height: '46px',
      flex: '0 0 auto',
      borderRadius: '50%',
      border: '2px solid rgba(255, 216, 130, .7)',
      background: 'radial-gradient(circle at 38% 32%, #3a2617, #150d06 72%)',
      display: 'grid',
      placeItems: 'center',
      font: '22px/1 system-ui, sans-serif',
    } as Partial<CSSStyleDeclaration>);

    const stack = document.createElement('div');
    Object.assign(stack.style, {
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      gap: '5px',
    } as Partial<CSSStyleDeclaration>);

    const who = document.createElement('div');
    who.textContent = `Fire ant · ${caste}`;
    Object.assign(who.style, {
      font: '700 10px/1 "Chakra Petch", system-ui, sans-serif',
      letterSpacing: '.16em',
      textTransform: 'uppercase',
      color: GOLD_DIM,
      textShadow: '0 1px 3px rgba(0,0,0,.85)',
    } as Partial<CSSStyleDeclaration>);

    this.stamina = this.meter('⚡', 'stamina', null);
    stack.append(
      who,
      this.stamina.icon.parentElement!,
      this.meter('♥', 'health', reserves.health).icon.parentElement!,
      this.meter('🌾', 'food', reserves.food).icon.parentElement!,
      this.meter('💧', 'water', reserves.water).icon.parentElement!,
    );

    // The grace chip. Hidden unless it is running, because a control
    // or a state that is not doing anything should not be taking up
    // room in the corner of a phone.
    this.grace = document.createElement('div');
    this.grace.dataset.ui = 'grace';
    Object.assign(this.grace.style, {
      display: 'none',
      marginTop: '2px',
      padding: '3px 7px',
      borderRadius: '6px',
      alignSelf: 'flex-start',
      background: 'rgba(120, 190, 255, .16)',
      border: '1px solid rgba(150, 205, 255, .5)',
      color: 'rgba(190, 225, 255, .95)',
      font: '600 10px/1.3 "JetBrains Mono", ui-monospace, monospace',
      whiteSpace: 'nowrap',
    } as Partial<CSSStyleDeclaration>);
    stack.appendChild(this.grace);

    this.panel.append(portrait, stack);
    host.appendChild(this.panel);
  }

  /**
   * @param fraction the reserve, 0 to 1
   * @param spent whether she is too winded to be asked for another
   */
  show(fraction: number, spent: boolean): void {
    const left = Math.max(0, Math.min(1, fraction));
    const seconds = Math.round(left * SPRINT_SECONDS * 10) / 10;
    const state = `${seconds}|${spent}`;
    if (state === this.shown) return;
    this.shown = state;

    this.stamina.fill.style.width = `${left * 100}%`;
    this.stamina.fill.style.background = spent ? SPENT : FUEL;
    this.stamina.icon.style.color = spent ? SPENT : FUEL;
    this.stamina.read.style.color = spent ? SPENT : GOLD;
    this.stamina.read.textContent = `${seconds.toFixed(1)}s`;
  }

  /**
   * @param seconds how much grace is left, or null when it is over
   *
   * Says BOTH halves, always. "Safe" alone would read as a buff and
   * send her looking for a fight she cannot win — she has no weapon
   * either, and the chip has to say so in the same breath.
   */
  showGrace(seconds: number | null): void {
    const state = seconds === null ? '' : `${Math.ceil(seconds)}`;
    if (state === this.shownGrace) return;
    this.shownGrace = state;
    if (seconds === null) {
      this.grace.style.display = 'none';
      return;
    }
    const mins = Math.floor(seconds / 60);
    const secs = Math.ceil(seconds % 60);
    this.grace.style.display = 'block';
    this.grace.textContent = `🛡 SAFE · UNARMED  ${mins}:${String(secs % 60).padStart(2, '0')}`;
  }

  dispose(): void {
    this.panel.remove();
  }

  /**
   * @param held the stat's value, or null for the one meter that moves
   */
  private meter(glyph: string, name: string, held: number | null): Meter {
    const live = held === null;
    const row = document.createElement('div');
    row.dataset.meter = name;
    Object.assign(row.style, {
      display: 'grid',
      gridTemplateColumns: '13px 116px 40px',
      alignItems: 'center',
      gap: '7px',
    } as Partial<CSSStyleDeclaration>);

    const icon = document.createElement('span');
    icon.textContent = glyph;
    Object.assign(icon.style, {
      font: '11px/1 system-ui, sans-serif',
      textAlign: 'center',
      color: live ? FUEL : RESTING,
    } as Partial<CSSStyleDeclaration>);

    const track = document.createElement('div');
    Object.assign(track.style, {
      height: '7px',
      borderRadius: '4px',
      overflow: 'hidden',
      background: 'rgba(255, 226, 160, .10)',
      boxShadow: 'inset 0 0 0 1px rgba(255, 216, 130, .16)',
    } as Partial<CSSStyleDeclaration>);

    const fill = document.createElement('div');
    Object.assign(fill.style, {
      height: '100%',
      // Full either way: a fresh reserve, and three stats with nothing
      // in the world able to spend them.
      width: '100%',
      borderRadius: '4px',
      background: live ? FUEL : RESTING,
      transition: live ? 'width 180ms ease, background 180ms ease' : 'none',
    } as Partial<CSSStyleDeclaration>);
    track.appendChild(fill);

    const read = document.createElement('span');
    read.textContent = live ? `${SPRINT_SECONDS.toFixed(1)}s` : `${Math.round(held)}`;
    Object.assign(read.style, {
      font: '600 10px/1 "JetBrains Mono", ui-monospace, monospace',
      textAlign: 'right',
      fontVariantNumeric: 'tabular-nums',
      color: live ? GOLD : RESTING,
      textShadow: '0 1px 3px rgba(0,0,0,.85)',
    } as Partial<CSSStyleDeclaration>);

    row.append(icon, track, read);
    return { icon, fill, read };
  }

  private style(): void {
    Object.assign(this.panel.style, {
      position: 'fixed',
      top: 'calc(8px + min(env(safe-area-inset-top), 12px))',
      left: 'calc(10px + min(env(safe-area-inset-left), 14px))',
      display: 'flex',
      gap: '9px',
      alignItems: 'stretch',
      padding: '8px 11px 8px 8px',
      borderRadius: '13px',
      border: '2px solid rgba(255, 216, 130, .7)',
      background: 'rgba(18, 14, 6, .72)',
      boxShadow: '0 0 0 2px rgba(0,0,0,.32), 0 3px 14px rgba(0,0,0,.42)',
      color: GOLD,
      pointerEvents: 'none',
      userSelect: 'none',
      zIndex: '13',
    } as Partial<CSSStyleDeclaration>);
  }
}
