/**
 * THE VITALS CLUSTER — top left, and honest about what it knows.
 *
 * The reference layout puts a portrait, four bars and a colony row up
 * here. Today the game can fill exactly ONE of them: stamina, which is
 * the sprint reserve and already real. Health has no damage and no
 * healing, food has no eating, water has no drinking, and there is no
 * colony to count workers or brood in.
 *
 * So the empty ones keep their place in the layout and sit visibly
 * ASLEEP — dim label, hollow track, an em-dash where a number goes.
 * That previews the shape without ever looking like it works, which is
 * the project rule: a bar may only move if there is a way to move it
 * back, and an unavailable thing must never look functional.
 *
 * The colony row is CUT rather than dimmed. Three dimmed empty numbers
 * is clutter; the row can arrive whole when there is a colony behind it.
 */
import { SPRINT_SECONDS } from '../ant/stamina';

const GOLD = 'rgba(255, 226, 160, .9)';
const GOLD_DIM = 'rgba(255, 226, 160, .55)';
/** Asleep: present, placed, and obviously not running. */
const DORMANT = 'rgba(255, 226, 160, .22)';
const FUEL = 'rgba(255, 196, 92, .95)';
const SPENT = 'rgba(255, 110, 90, .95)';

interface Meter {
  readonly icon: HTMLElement;
  readonly fill: HTMLElement;
  readonly read: HTMLElement;
}

export class Vitals {
  private readonly panel: HTMLDivElement;
  private readonly stamina: Meter;
  private shown = '';

  constructor(host: HTMLElement, caste = 'Queen') {
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

    this.stamina = this.meter('⚡', 'stamina', true);
    stack.append(
      who,
      this.stamina.icon.parentElement!,
      this.meter('♥', 'health', false).icon.parentElement!,
      this.meter('🌾', 'food', false).icon.parentElement!,
      this.meter('💧', 'water', false).icon.parentElement!,
    );

    this.panel.append(portrait, stack);
    host.appendChild(this.panel);
  }

  /**
   * @param fraction the reserve, 0 to 1
   * @param spent whether she is too winded to be asked for another
   */
  show(fraction: number, spent: boolean): void {
    // Seconds of sprint, not an invented point total: it is a number
    // the game can actually answer, and the one the player feels.
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

  dispose(): void {
    this.panel.remove();
  }

  private meter(glyph: string, name: string, live: boolean): Meter {
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
      color: live ? FUEL : DORMANT,
    } as Partial<CSSStyleDeclaration>);

    const track = document.createElement('div');
    Object.assign(track.style, {
      height: '7px',
      borderRadius: '4px',
      overflow: 'hidden',
      background: live ? 'rgba(255, 226, 160, .10)' : 'rgba(255, 226, 160, .05)',
      boxShadow: live
        ? 'inset 0 0 0 1px rgba(255, 216, 130, .16)'
        : 'inset 0 0 0 1px rgba(255, 216, 130, .10)',
    } as Partial<CSSStyleDeclaration>);

    const fill = document.createElement('div');
    Object.assign(fill.style, {
      height: '100%',
      width: live ? '100%' : '0',
      borderRadius: '4px',
      background: FUEL,
      transition: 'width 180ms ease, background 180ms ease',
    } as Partial<CSSStyleDeclaration>);
    track.appendChild(fill);

    const read = document.createElement('span');
    // An em-dash, not a zero: zero is a reading, and these are not
    // reading anything yet.
    read.textContent = live ? '0.0s' : '—';
    Object.assign(read.style, {
      font: '600 10px/1 "JetBrains Mono", ui-monospace, monospace',
      textAlign: 'right',
      fontVariantNumeric: 'tabular-nums',
      color: live ? GOLD : DORMANT,
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
