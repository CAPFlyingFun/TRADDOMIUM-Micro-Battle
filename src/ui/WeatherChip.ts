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
  compass, describeWeather, fahrenheit, fallingNow, glyphFor, mph, mps,
} from '../weather/gameplay';
import { MAX_POWERED_SPEED } from '../ant/flight';
import { UNITS_PER_METRE } from '../world/kauai';

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
  /**
   * @param heading which way her nose points, world radians, or null on
   *   the ground. Only used to work out whether the wind is against
   *   her, which is the difference between a warning worth reading and
   *   a warning that is always on.
   */
  update(
    now: Conditions, source: WeatherSource, age: number,
    heading: number | null = null,
  ): void {
    const degrees = Math.round(fahrenheit(now.temperature));
    const wind = Math.round(mph(now.windSpeed));
    const falling = fallingNow(now);
    const line = `${glyphFor(now.code, falling)} ${degrees}°\n`
      + `${compass(now.windFrom)} ${wind}`;
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
      ['', describeWeather(now.code, falling)],
      ['Temp', `${degrees}°F`],
      ['Humidity', `${Math.round(now.humidity)}%`],
      // METRES PER SECOND FIRST, because that is the unit that means
      // something in the air: her top powered airspeed is 0.7 m/s, so
      // a 2.2 reading says at a glance that the sky is in charge today.
      // The mph stays alongside it for the forecast-reading half of the
      // brain.
      ['Wind', `${compass(now.windFrom)} ${mps(now.windSpeed).toFixed(1)} m/s `
        + `(${wind} mph)`],
      ['Gusts', `${mps(now.windGust).toFixed(1)} m/s `
        + `(${Math.round(mph(now.windGust))} mph)`],
      // PRECIPITATION, NOT RAIN. Drizzle is not rain, which is exactly
      // how the panel came to say DRIZZLE over "Rain: none".
      // `fallingNow` has already zeroed anything below the visible
      // threshold, so "none" here means genuinely nothing — and it can
      // never sit under a wet description, because the same threshold
      // decided both.
      ['Precip', falling === 0 ? 'none' : `${falling.toFixed(2)} mm/h`],
      ['Visibility', visibilityWords(now.visibility)],
      ['Source', SOURCE_WORDS[source]],
      ['Updated', agoWords(age)],
    ];

    const warning = windWarning(now, heading);
    if (warning) rows.push(['', warning]);
    const text = rows.map(([a, b]) => `${a}${b}`).join('|');
    if (text === this.shownPanel) return;
    this.shownPanel = text;

    this.panel.textContent = '';
    for (const [label, value] of rows) {
      const row = document.createElement('div');
      if (label === '') {
        row.textContent = value;
        const alarm = value.startsWith('⚠');
        row.style.cssText = 'font-weight:700;letter-spacing:.08em;'
          + `text-transform:uppercase;font-size:10px;color:${alarm ? '#ffb98a' : '#f0d99a'};`
          + (alarm ? 'margin-top:8px;line-height:1.35' : 'margin-bottom:4px');
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

/**
 * Whether the sky is about to have more say in where she goes than she
 * does — and only then.
 *
 * INFORMATION, NOT A GATE. Nothing here stops her taking off. A queen
 * launching into a wind that will carry her across the island is
 * making a decision, possibly a deliberate one, and the game's job is
 * to make sure she knows rather than to argue.
 *
 * Two thresholds, because they mean different things. Wind stronger
 * than she is means she cannot hold a course against it anywhere.
 * Wind stronger than she is ALONG HER NOSE means she cannot make
 * headway the way she is currently pointed, which is the more useful
 * warning and the reason her heading is passed in when there is one.
 */
export function windWarning(
  now: Conditions, heading: number | null,
): string | null {
  const windUnits = mps(now.windSpeed) * UNITS_PER_METRE;
  if (windUnits > MAX_POWERED_SPEED) return '⚠ Wind exceeds queen airspeed';
  if (heading !== null) {
    // How much of the wind is blowing straight back at her. The wind
    // travels toward (windFrom + 180); a component along her nose that
    // is negative is a headwind.
    const blowing = Math.PI - ((now.windFrom + 180) * Math.PI) / 180;
    const along = Math.cos(blowing - heading) * windUnits;
    if (-along > MAX_POWERED_SPEED) return '⚠ Headwind exceeds airspeed';
  }
  if (windUnits > MAX_POWERED_SPEED * 0.6) return '⚠ Strong wind — major drift';
  return null;
}
