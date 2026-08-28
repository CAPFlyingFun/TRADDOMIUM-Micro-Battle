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


const GOLD = 'rgba(255, 226, 160, .9)';
const GOLD_DIM = 'rgba(255, 226, 160, .55)';
/** Real, and resting: a number that is true and has nowhere to go yet. */
const RESTING = 'rgba(255, 226, 160, .42)';

/**
 * Below this the reserve is not meaningfully moving either way, in
 * fractions per second.
 *
 * IT HAS TO SIT UNDER THE SLOWEST REAL ACTIVITY. It was a thousandth
 * of a bar a second, on the reasoning that sixteen minutes to empty is
 * too slow to be worth a countdown — and then cruising was re-anchored
 * to the measured thirty minutes aloft, which is slower than that. A
 * queen in level flight was told she was FULL and given no countdown at
 * all. One ten-thousandth is nearly three hours to empty, which is
 * genuinely nothing happening.
 */
const IDLE_RATE = 0.0001;
const FUEL = 'rgba(255, 196, 92, .95)';
const SPENT = 'rgba(255, 110, 90, .95)';
/** The water bar's own blue, so a full reserve does not read as fuel. */
const WATER = 'rgba(120, 190, 255, .92)';

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

/** The protected chip's colours, so the warning can put them back. */
const SAFE_FILL = 'rgba(120, 190, 255, .16)';
const SAFE_EDGE = 'rgba(150, 205, 255, .5)';
const SAFE_TEXT = 'rgba(190, 225, 255, .95)';

const SVG = 'http://www.w3.org/2000/svg';
/** Radius of the air ring, inside the 46-pixel box its portrait uses. */
const AIR_R = 19.5;
const AIR_ROUND = 2 * Math.PI * AIR_R;
const AIR_FULL = 'rgba(150, 214, 255, .92)';
const AIR_LOW = '#ffb03a';
const AIR_BAD = '#ff8c42';
const AIR_OUT = '#ff5a4a';
/** The ring's colour stages, matching the veil's onset at 30%. */
const AIR_WARN_AT = 0.30;
const AIR_BAD_AT = 0.15;
/** How long a refilled ring lingers before it excuses itself, ms. */
const AIR_LINGER_MS = 1600;

export class Vitals {
  private readonly panel: HTMLDivElement;
  private readonly stamina: Meter;
  private readonly airRing: SVGCircleElement;
  private readonly airText: SVGTextElement;
  private shownAir = -1;
  private airShown = false;
  private airHideAt = 0;
  private readonly salt: HTMLDivElement;
  private shownSalt = '';

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

    // HER AIR, back under the portrait where it lived before — a ring
    // rather than a fourth bar, because it is the only meter about
    // WHERE SHE IS rather than what she has been doing, and because
    // three bars plus a fourth reads as a longer list. Full and dry it
    // sits back at a third opacity; underwater it is the only thing on
    // the card worth reading. It went out with the water there was to
    // drown in, and the water is back.
    this.airRing = document.createElementNS(SVG, 'circle');
    const gauge = document.createElementNS(SVG, 'svg');
    gauge.setAttribute('width', '46');
    gauge.setAttribute('height', '46');
    gauge.setAttribute('viewBox', '0 0 46 46');
    gauge.style.display = 'block';
    gauge.style.marginTop = '4px';
    const track = document.createElementNS(SVG, 'circle');
    for (const ring of [track, this.airRing]) {
      ring.setAttribute('cx', '23');
      ring.setAttribute('cy', '23');
      ring.setAttribute('r', String(AIR_R));
      ring.setAttribute('fill', 'none');
      ring.setAttribute('stroke-width', '3.5');
      ring.setAttribute('stroke-linecap', 'round');
      // Twelve o'clock, filling clockwise, which is where a gauge
      // reads from whatever it is measuring.
      ring.setAttribute('transform', 'rotate(-90 23 23)');
    }
    track.setAttribute('stroke', 'rgba(255, 216, 130, .18)');
    this.airRing.setAttribute('stroke', AIR_FULL);
    this.airRing.setAttribute('stroke-dasharray', String(AIR_ROUND));
    this.airRing.setAttribute('stroke-dashoffset', '0');
    this.airText = document.createElementNS(SVG, 'text');
    this.airText.setAttribute('x', '23');
    this.airText.setAttribute('y', '23');
    this.airText.setAttribute('text-anchor', 'middle');
    this.airText.setAttribute('dominant-baseline', 'central');
    this.airText.setAttribute('fill', AIR_FULL);
    this.airText.setAttribute(
      'style',
      'font: 700 11px/1 "JetBrains Mono", ui-monospace, monospace',
    );
    this.airText.textContent = '100%';
    gauge.append(track, this.airRing, this.airText);
    // CONTEXTUAL: born invisible; air() fades it in when breathing
    // becomes a thing worth watching, and out again after.
    gauge.style.opacity = '0';
    if (!document.getElementById('tmb-air-pulse')) {
      const pulse = document.createElement('style');
      pulse.id = 'tmb-air-pulse';
      pulse.textContent =
        '@keyframes tmb-air-pulse { 50% { opacity: .35; } }';
      document.head.appendChild(pulse);
    }

    const left = document.createElement('div');
    Object.assign(left.style, {
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      flex: '0 0 auto',
    } as Partial<CSSStyleDeclaration>);
    left.append(portrait, gauge);

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
    // AND THE WATER BAR IS LIVE AGAIN. It was a placeholder for three
    // versions, and the note here said exactly why: it had been fed by
    // a thirst that drinking refilled, the water it drank from was
    // gone, and a bar may only move if there is a way to move it back.
    // There is a bed with water in it now and she can stand in it, so
    // the drain and its refill arrive in the same change rather than a
    // build apart. Health and food are still held: nothing heals her
    // and nothing feeds her yet.
    this.water = this.meter('💧', 'water', null);
    // AND HEALTH IS LIVE NOW TOO. It sat resting for the same reason
    // thirst did — nothing in the world could touch it — and the sea
    // is the first thing that can (brine.ts). The reference is kept so
    // health() can move the bar the salt is draining.
    this.health = this.meter('♥', 'health', reserves.health);
    stack.append(
      who,
      this.stamina.icon.parentElement!,
      this.health.icon.parentElement!,
      this.meter('🌾', 'food', reserves.food).icon.parentElement!,
      this.water.icon.parentElement!,
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
      background: SAFE_FILL,
      border: `1px solid ${SAFE_EDGE}`,
      color: SAFE_TEXT,
      font: '600 10px/1.3 "JetBrains Mono", ui-monospace, monospace',
      whiteSpace: 'nowrap',
    } as Partial<CSSStyleDeclaration>);
    stack.appendChild(this.grace);

    // THE SEA AS A STATUS, NOT A METER. Salt exposure is the first of
    // a family (venom, cold, wet…) that would each have demanded a
    // bar; a transient chip and the health row tell the whole story
    // between them. 🌊 while she is in the sea and the grace holds;
    // ⚠ when the exposure starts costing blood.
    this.salt = document.createElement('div');
    this.salt.dataset.ui = 'salt';
    Object.assign(this.salt.style, {
      display: 'none',
      marginTop: '2px',
      padding: '3px 7px',
      borderRadius: '6px',
      alignSelf: 'flex-start',
      font: '600 10px/1.3 "JetBrains Mono", ui-monospace, monospace',
      whiteSpace: 'nowrap',
      transition: 'opacity 300ms ease',
    } as Partial<CSSStyleDeclaration>);
    stack.appendChild(this.salt);

    this.panel.append(left, stack);
    host.appendChild(this.panel);
  }

  /**
   * @param fraction the reserve, 0 to 1
   * @param spent whether she is too winded to be asked for another
   */
  /**
   * @param rate what the reserve is doing RIGHT NOW, fractions of a
   *   full bar per second. Positive spends, negative recovers.
   *
   * THE NUMBER IS TIME, NOT A SCORE. It used to be the fraction times
   * thirty, which is "how many seconds of GROUND SPRINTING this much
   * reserve is worth" — a fair answer to a question nobody was asking.
   * Joshua watched a real second pass and the readout drop by two
   * tenths, because he was cruising, and cruising is not sprinting.
   *
   * What it says now is how long the CURRENT activity can go on:
   * reserve divided by what that activity is costing. Sprint reads
   * thirty seconds from full, a hard climb fifty-five, a cruise five
   * and a half minutes — and the moment she changes what she is doing,
   * so does the number.
   *
   * A countdown is only honest while something is being spent. While
   * she is catching her breath it counts the other way, to full, and
   * when nothing is happening it says so rather than inventing a
   * deadline.
   */
  /**
   * TRIM THE CARD WHILE SHE IS FLYING.
   *
   * Not a redesign — the card is right and it stays exactly as it is
   * on the ground. But the flight instruments arrive on top of an
   * interface that was composed without them, and this panel owns the
   * whole upper left while they do. Scaled from its own top-left
   * corner so it stays anchored, and eased, so that the interface
   * visibly changes mode when the wings come out rather than
   * flickering between two layouts.
   *
   * A SCALE RATHER THAN A SECOND LAYOUT, deliberately: two layouts is
   * two things to keep right, and the one that is only ever seen in
   * flight is the one that would rot.
   */
  aloft(flying: boolean): void {
    if (flying === this.flying) return;
    this.flying = flying;
    this.panel.style.transformOrigin = 'left top';
    this.panel.style.transition = 'transform 260ms ease';
    this.panel.style.transform = flying ? 'scale(0.84)' : '';
  }

  private flying = false;
  private readonly water: Meter;
  private shownWater = '';
  private readonly health: Meter;
  private shownHealth = '';

  show(fraction: number, spent: boolean, rate: number): void {
    const left = Math.max(0, Math.min(1, fraction));
    const label = enduranceWords(left, rate);
    const state = `${label}|${spent}|${Math.round(left * 200)}`;
    if (state === this.shown) return;
    this.shown = state;

    this.stamina.fill.style.width = `${left * 100}%`;
    this.stamina.fill.style.background = spent ? SPENT : FUEL;
    this.stamina.icon.style.color = spent ? SPENT : FUEL;
    this.stamina.read.style.color = spent ? SPENT
      : rate > IDLE_RATE ? GOLD : RESTING;
    this.stamina.read.textContent = label;
  }


  /**
   * How much air she has, 0 to 1 — the ring under the portrait — and
   * whether her head is under.
   *
   * CONTEXTUAL NOW: on dry land the ring is simply not there. It
   * fades in when her head goes under or the reserve is anything
   * short of full, and when she surfaces and refills it lingers a
   * moment — long enough to read "that was close" — and excuses
   * itself. Its mere appearance means something is happening with
   * her breathing, which is a stronger signal than a number that
   * says 100% for an hour.
   */
  air(fraction: number, under: boolean): void {
    const shown = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
    const wants = under || shown < 100;
    if (wants) this.airHideAt = 0;
    else if (this.airShown && this.airHideAt === 0) {
      this.airHideAt = Date.now() + AIR_LINGER_MS;
    }
    const visible = wants || (this.airShown && Date.now() < this.airHideAt);
    if (visible !== this.airShown) {
      this.airShown = visible;
      const gauge = this.airRing.parentElement;
      if (gauge) {
        gauge.style.transition = 'opacity 400ms ease';
        gauge.style.opacity = visible ? '1' : '0';
      }
    }
    if (shown === this.shownAir) return;
    this.shownAir = shown;
    this.airText.textContent = `${shown}%`;
    this.airRing.setAttribute(
      'stroke-dashoffset', String(AIR_ROUND * (1 - shown / 100)),
    );
    // Blue while fine, gold from the veil's own 30%, orange from 15%,
    // out-red at zero — with a slow pulse, because a zero that sits
    // still reads as a broken gauge rather than an emergency.
    const tone = shown <= 0 ? AIR_OUT
      : shown < AIR_BAD_AT * 100 ? AIR_BAD
        : shown < AIR_WARN_AT * 100 ? AIR_LOW : AIR_FULL;
    this.airRing.setAttribute('stroke', tone);
    this.airText.setAttribute('fill', tone);
    this.airRing.style.animation = shown <= 0
      ? 'tmb-air-pulse 1.1s ease-in-out infinite' : '';
  }

  /**
   * WHAT SHE HAS LEFT TO LIVE ON, and whether something is taking it.
   *
   * @param stinging true while damage is actively landing — the row
   *   wears the spent red so the sea saying SALTWATER EXPOSURE and
   *   the card saying it are the same statement. Calm and merely
   *   below full it reads in the fuel tone: something happened, and
   *   it is over.
   */
  showHealth(fraction: number, points: number, stinging: boolean): void {
    const left = Math.max(0, Math.min(1, fraction));
    const state = `${Math.round(points)}|${stinging}|${Math.round(left * 200)}`;
    if (state === this.shownHealth) return;
    this.shownHealth = state;
    const tone = stinging ? SPENT : left < 1 ? FUEL : RESTING;
    this.health.fill.style.width = `${left * 100}%`;
    this.health.fill.style.background = tone;
    this.health.icon.style.color = tone;
    this.health.read.style.color = stinging ? SPENT : left < 1 ? GOLD : RESTING;
    this.health.read.textContent = `${Math.round(points)}`;
  }

  /**
   * The sea's status chip. 'in' while her body is in salt water and
   * the grace holds; 'burning' once exposure is costing blood; 'none'
   * hides it. See its construction for why a chip and not a meter.
   */
  saltStatus(state: 'none' | 'in' | 'burning'): void {
    if (state === this.shownSalt) return;
    this.shownSalt = state;
    if (state === 'none') {
      this.salt.style.display = 'none';
      return;
    }
    this.salt.style.display = '';
    if (state === 'in') {
      this.salt.textContent = '🌊 SALTWATER';
      this.salt.style.background = SAFE_FILL;
      this.salt.style.border = `1px solid ${SAFE_EDGE}`;
      this.salt.style.color = SAFE_TEXT;
    } else {
      this.salt.textContent = '⚠ SALT EXPOSURE';
      this.salt.style.background = 'rgba(255, 110, 90, .14)';
      this.salt.style.border = '1px solid rgba(255, 110, 90, .55)';
      this.salt.style.color = SPENT;
    }
  }

  /**
   * WHAT SHE HAS LEFT TO DRINK, and whether she is drinking it.
   *
   * Read as a count of seconds rather than a percentage, the same way
   * stamina is: "14.7s" tells her whether she can reach the next
   * stream and "23%" does not. The colour is the bar's own state and
   * not a warning level — blue while she is fine, the spent red once
   * the parched latch is set, and the fuel colour while she is
   * actually drinking so the act reads on the card as well as on the
   * button.
   */
  thirst(fraction: number, parched: boolean, drinking: boolean, drain: number): void {
    const left = Math.max(0, Math.min(1, fraction));
    const seconds = drain > 0 ? left / drain : Infinity;
    const label = drinking ? 'drinking'
      : !Number.isFinite(seconds) ? 'full'
      : seconds >= 120 ? `${Math.round(seconds / 60)}m`
      : `${seconds.toFixed(1)}s`;
    const state = `${label}|${parched}|${drinking}|${Math.round(left * 200)}`;
    if (state === this.shownWater) return;
    this.shownWater = state;
    const tone = drinking ? FUEL : parched ? SPENT : WATER;
    this.water.fill.style.width = `${left * 100}%`;
    this.water.fill.style.background = tone;
    this.water.icon.style.color = tone;
    this.water.read.style.color = parched ? SPENT : drinking ? GOLD : RESTING;
    this.water.read.textContent = label;
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
    this.grace.style.background = SAFE_FILL;
    this.grace.style.borderColor = SAFE_EDGE;
    this.grace.style.color = SAFE_TEXT;
    this.grace.textContent = `🛡 SAFE · UNARMED  ${mins}:${String(secs % 60).padStart(2, '0')}`;
  }

  /**
   * The moment it lapses, said out loud.
   *
   * Sliding silently from protected to ecosystem rules is the one thing
   * this chip must not do. It went from telling her she was safe to
   * telling her nothing, and a player who looked away for six seconds
   * would never learn which of those two worlds they were now in. The
   * warning wears the same chip in a different colour so the eye finds
   * it in the place it was already looking.
   */
  showGraceEnded(): void {
    if (this.shownGrace === 'ended') return;
    this.shownGrace = 'ended';
    this.grace.style.display = 'block';
    this.grace.style.background = 'rgba(255, 140, 90, .18)';
    this.grace.style.borderColor = 'rgba(255, 170, 110, .6)';
    this.grace.style.color = 'rgba(255, 205, 165, .96)';
    this.grace.textContent = '⚠️ PROTECTION ENDED';
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
    // The opening value, replaced on the first frame. FULL rather than
    // a number, because at rest there is no countdown to show.
    read.textContent = live ? 'FULL' : `${Math.round(held)}`;
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

/** m:ss for anything over a minute, seconds with a decimal below it. */
function clockWords(seconds: number): string {
  if (seconds >= 60) {
    const mins = Math.floor(seconds / 60);
    return `${mins}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  }
  return `${seconds.toFixed(1)}s`;
}

/** What the endurance readout says, given the reserve and the rate. */
export function enduranceWords(fraction: number, rate: number): string {
  const left = Math.max(0, Math.min(1, fraction));
  if (rate > IDLE_RATE) return clockWords(left / rate);
  if (left >= 0.999) return 'FULL';
  if (rate < -IDLE_RATE) return `FULL IN ${clockWords((1 - left) / -rate)}`;
  return 'READY';
}
