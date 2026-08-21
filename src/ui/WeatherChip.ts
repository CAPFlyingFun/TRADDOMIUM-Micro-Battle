/**
 * THE WEATHER, IN THE CORNER, SMALL.
 *
 * The design rule for this HUD is that it is CONTEXTUAL and not an
 * inventory, and weather is the easiest thing in the game to get wrong
 * on that count: it has a dozen numbers and every one of them is
 * mildly interesting. A permanent weather station bolted to the corner
 * of a 932 x 430 landscape phone would eat the view to tell her
 * something she can mostly SEE by looking at the sky.
 *
 * So: two lines of the two facts that matter — what it is doing and
 * what the wind is — and a tap for the rest. The panel is the place for
 * humidity and visibility and where the numbers came from.
 *
 * IT SAYS WHERE IT GOT THEM. Live, cached or simulated, in words, every
 * time the panel opens. A game that quietly shows made-up weather while
 * implying it is Kauaʻi's is lying to the player, and the fallbacks
 * exist precisely so that failure is survivable — not so that it is
 * invisible.
 *
 * Imperial units, because that is what Joshua reads a forecast in.
 */
import type { Conditions, WeatherSource } from '../weather/conditions';
import {
  compass, describe, fahrenheit, glyph, mph,
} from '../weather/gameplay';

const SOURCE_WORDS: Record<WeatherSource, string> = {
  live: 'Live Kauaʻi',
  cached: 'Last known Kauaʻi',
  simulated: 'Simulated',
};

export class WeatherChip {
  private readonly chip: HTMLButtonElement;
  private readonly panel: HTMLDivElement;
  private open = false;
  private shownChip = '';
  private shownPanel = '';

  constructor(host: HTMLElement) {
    this.chip = document.createElement('button');
    this.chip.type = 'button';
    this.chip.dataset.ui = 'weather-chip';
    this.chip.setAttribute('aria-label', 'weather');
    Object.assign(this.chip.style, {
      position: 'fixed',
      top: 'calc(8px + min(env(safe-area-inset-top), 12px))',
      // Clear of the settings gear, which owns the actual corner.
      right: 'calc(56px + min(env(safe-area-inset-right), 14px))',
      appearance: 'none',
      padding: '5px 9px',
      borderRadius: '8px',
      border: '1px solid rgba(226, 194, 122, .28)',
      background: 'rgba(14, 12, 10, .58)',
      color: '#e8dcc0',
      font: '600 11px/1.25 "JetBrains Mono", ui-monospace, monospace',
      letterSpacing: '.04em',
      textAlign: 'right',
      cursor: 'pointer',
      touchAction: 'manipulation',
      backdropFilter: 'blur(3px)',
      zIndex: '14',
    } as Partial<CSSStyleDeclaration>);
    this.chip.addEventListener('click', () => this.toggle());

    this.panel = document.createElement('div');
    this.panel.dataset.ui = 'weather-panel';
    Object.assign(this.panel.style, {
      position: 'fixed',
      top: 'calc(48px + min(env(safe-area-inset-top), 12px))',
      right: 'calc(56px + min(env(safe-area-inset-right), 14px))',
      minWidth: '178px',
      padding: '10px 12px',
      borderRadius: '10px',
      border: '1px solid rgba(226, 194, 122, .3)',
      background: 'rgba(12, 10, 9, .9)',
      color: '#e8dcc0',
      font: '500 11px/1.65 "JetBrains Mono", ui-monospace, monospace',
      letterSpacing: '.03em',
      backdropFilter: 'blur(6px)',
      display: 'none',
      zIndex: '15',
    } as Partial<CSSStyleDeclaration>);

    host.append(this.chip, this.panel);
  }

  private toggle(): void {
    this.open = !this.open;
    this.panel.style.display = this.open ? 'block' : 'none';
  }

  /**
   * @param age how old the readings are, in seconds.
   *
   * Writes to the DOM only when the TEXT changes. Weather eases
   * continuously, so without this every frame would rewrite two nodes
   * to say what they already said.
   */
  update(now: Conditions, source: WeatherSource, age: number): void {
    const degrees = Math.round(fahrenheit(now.temperature));
    const wind = Math.round(mph(now.windSpeed));
    const line = `${glyph(now.code)} ${degrees}°\n${compass(now.windFrom)} ${wind}`;
    if (line !== this.shownChip) {
      this.shownChip = line;
      this.chip.textContent = '';
      const [top, bottom] = line.split('\n');
      const first = document.createElement('div');
      first.textContent = top;
      const second = document.createElement('div');
      second.textContent = bottom;
      second.style.opacity = '.72';
      second.style.fontSize = '9px';
      this.chip.append(first, second);
    }

    if (!this.open) return;

    const rows: Array<[string, string]> = [
      ['', describe(now.code)],
      ['Temp', `${degrees}°F`],
      ['Humidity', `${Math.round(now.humidity)}%`],
      ['Wind', `${compass(now.windFrom)} ${wind} mph`],
      ['Gusts', `${Math.round(mph(now.windGust))} mph`],
      ['Rain', now.rain < 0.05 ? 'none' : `${now.rain.toFixed(1)} mm/h`],
      ['Visibility', visibilityWords(now.visibility)],
      ['Source', SOURCE_WORDS[source]],
      ['Updated', agoWords(age)],
    ];
    const text = rows.map(([a, b]) => `${a}${b}`).join('|');
    if (text === this.shownPanel) return;
    this.shownPanel = text;

    this.panel.textContent = '';
    for (const [label, value] of rows) {
      const row = document.createElement('div');
      if (label === '') {
        row.textContent = value;
        row.style.cssText = 'font-weight:700;letter-spacing:.08em;'
          + 'text-transform:uppercase;font-size:10px;color:#f0d99a;'
          + 'margin-bottom:4px';
      } else {
        row.style.cssText = 'display:flex;justify-content:space-between;gap:14px';
        const key = document.createElement('span');
        key.textContent = label;
        key.style.opacity = '.6';
        const val = document.createElement('span');
        val.textContent = value;
        row.append(key, val);
      }
      this.panel.appendChild(row);
    }
  }

  dispose(): void {
    this.chip.remove();
    this.panel.remove();
  }
}

function visibilityWords(metres: number): string {
  if (metres >= 1000) return `${(metres / 1000).toFixed(metres >= 10_000 ? 0 : 1)} km`;
  return `${Math.round(metres)} m`;
}

function agoWords(seconds: number): string {
  if (seconds < 90) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return `${hours} h ago`;
}
