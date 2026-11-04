/**
 * HER BABY'S BIRTH, AS A TIMELINE (Joshua, 2026-11-02: "semi-realistic, with natural progression, movements, and
 * positioning, but remember it's a game"; one baby first, RECLINE first; a faster birth or a realistic slower one).
 *
 * One clock, in seconds of the FAST pace (REALISTIC runs the same story `REALISTIC_STRETCH` times slower), and every
 * quantity of the birth a function of it -- nothing remembered, so any moment can be shown by asking for it:
 *
 *   LABOUR     contractions come in waves; with each, her cervix opens a step (1 to 10 cm); late in it her baby's head
 *              settles down into her pelvis, onto the top of her cervix (`engage`);
 *   PUSHING    with each contraction the head moves down her canal (`down`, 0 the top of her cervix .. 1 the head's middle
 *              at her opening) and slips back a little between them, turning as it goes so the back of its head comes
 *              round to her front (`turn`);
 *   CROWNING   the head's widest part at her opening, staying there between contractions now;
 *   BIRTH      the head out, a pause (`restitution`: nothing turns -- Joshua, 2026-11-02); a last push and the body follows;
 *   AFTER      her baby out, lifted onto her and resting; her womb settling. Its cord is cut a while after it is
 *              settled on her (`cutAfter`), or sooner with CUT CORD;
 *   AFTERBIRTH the placenta (Joshua, 2026-11-03: "comes on its own after the cut, a DELIVER PLACENTA button for sooner"):
 *              a few mild contractions; it peels off her womb's wall (`separate`), slides down her canal (`placentaDown`,
 *              0 its leading edge at the top of her cervix .. 1 at her opening .. 2 all of it out), into the bowl
 *              (`bowl`); her womb settles smaller again (`afterbirth`).
 *
 * The two buttons are MOMENTS on this clock (`BirthEvents`, FAST seconds): a cut or a placenta asked for sooner than its
 * own time. Dragged back before one, it has not happened yet (the scene forgets it); with none, each comes on its own.
 *
 * The shape of it is from how midwives describe labour (contractions every few minutes, about a minute long; the head
 * moving forward with each and back a little between until it crowns; the head turning as it passes her pelvis and back
 * once born) -- with every length GAME TUNING, much shorter than a real labour.
 */

export type BirthStage = 'labour' | 'pushing' | 'crowning' | 'birth' | 'after' | 'afterbirth';
export type BirthPace = 'fast' | 'realistic';

/** GAME TUNING: the FAST pace's seconds. */
export const BIRTH_TIMING = Object.freeze({
  /** labour: so many contractions, each `labourEvery` apart, `labourLong` of it the squeeze */
  labourCount: 5, labourEvery: 8, labourLong: 0.6,
  /** her cervix as labour starts (a share of ten centimetres) */
  cervixFrom: 0.1,
  /** her baby's head settling onto her cervix over the last `engageShare` of labour */
  engageShare: 0.45,
  /** pushing: so many contractions, each `pushEvery` apart, `pushLong` of it the push; the head slips back `slip` of a step
   * between them; by the end of pushing its middle is `pushReach` of the way to her opening (its front edge is there) */
  pushCount: 6, pushEvery: 7, pushLong: 0.6, slip: 0.35, pushReach: 0.82,
  /** crowning: so long, the head's middle eased the rest of the way to her opening, held there */
  crowning: 9,
  /** the head born over `headOut` seconds; a pause of `restitution` (no turn: the game turns it inside her); then the
   * body over `bodyOut` */
  headOut: 3, restitution: 3, bodyOut: 3,
  /** after: its first stretch as it is born (`firstStretch` seconds long), lifted onto her over `toHer`, settled on her
   * by `settle`; her opening easing back over `close` */
  firstStretch: 3.5, toHer: 4, settle: 10, close: 14,
  /** its cord cut on its own this long after it is settled on her (unless CUT CORD cuts it sooner) */
  cutAfter: 12,
  /** AFTERBIRTH: the placenta starts this long after the cut (unless DELIVER PLACENTA starts it sooner); so many mild
   * contractions (`placentaSqueeze` of a birth's), `placentaEvery` apart; it peels off her womb's wall over
   * `placentaSeparate`, comes down her canal over `placentaDown`, out of her over `placentaOut`, settles into the bowl
   * over `placentaBowl`, and her womb settles smaller over `placentaSettle` from when it is out */
  placentaAfterCut: 8, placentaContractions: 3, placentaEvery: 3.5, placentaLong: 0.6, placentaSqueeze: 0.55,
  placentaSeparate: 3, placentaDown: 4, placentaOut: 2, placentaBowl: 1.5, placentaSettle: 8,
});
/** REALISTIC is the same birth this many times slower. GAME TUNING. */
export const REALISTIC_STRETCH = 5;
/** How far the back of the baby's head turns, in degrees: from its place in her womb (its back to her front and LEFT,
 * 45 degrees) round to her side (90) as it comes down, all of it inside her: born facing her thigh, its shoulders one
 * above the other -- where a real birth's head turns to once it is out (restitution and external rotation, so its
 * shoulders come one under her pubic bone and one over her perineum), turned here before her opening instead (Joshua,
 * 2026-11-03: "either have it rotated before it gets to the opening, or not at all"; "to the sides with the shoulders
 * up/down"). It turns no more once out. */
export const TURN_DEG = Object.freeze({ inWomb: 45, born: 90 });

export interface BirthMoment {
  readonly stage: BirthStage;
  /** seconds since it began (at the pace it runs at) */
  readonly seconds: number;
  /** how hard she is contracting now (0 resting .. 1 the peak) */
  readonly contraction: number;
  /** her cervix (0 shut .. 1 ten centimetres) */
  readonly cervix: number;
  /** her baby's head taken from its place in her womb onto the top of her cervix (0 .. 1) */
  readonly engage: number;
  /** her baby's head down her canal: 0 its middle at the top of her cervix, 1 at her opening; past 1 out of her, in
   * lengths of the baby (2 all of it out) */
  readonly down: number;
  /** the back of its head turned round from her left (degrees: 45 as it lies in her womb, 0 to her front) */
  readonly turnDeg: number;
  /** the whole birth, 0 .. 1 */
  readonly progress: number;
  /** once it is out: lifted from where it was born onto her (0 .. 1) */
  readonly onHer: number;
  /** a newborn's stretch, arms and legs out of its curl (0 .. 1) */
  readonly stretch: number;
  /** after the birth, how far her opening has eased back (0 as the body is born .. 1 settled) */
  readonly closing: number;
  /** its cord cut (and when, FAST seconds; null not yet) */
  readonly cut: boolean;
  readonly cutAt: number | null;
  /** AFTERBIRTH: seconds since the placenta started (below 0, not yet); how far it has peeled off her womb's wall (0..1);
   * how far down (0 its leading edge at the top of her cervix .. 1 at her opening .. 2 all of it out); how far into the
   * bowl (0..1); how far her womb has settled after it (0..1) */
  readonly placentaFor: number;
  readonly separate: number;
  readonly placentaDown: number;
  readonly bowl: number;
  readonly afterbirth: number;
}

/** A cut or a placenta asked for sooner than its own time: the moment it was asked (FAST seconds), or null. */
export interface BirthEvents { readonly cutAt?: number | null; readonly placentaAt?: number | null }

const smooth = (a: number, b: number, v: number): number => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** Each part's start and the whole length, in FAST seconds -- the cut and the placenta at their own times, or at the
 * moments `events` asked for them (never a cut before its navel is out of her, never a placenta before the cut). */
export function birthPlan(events: BirthEvents = {}): { labour: number; pushing: number; crowning: number; birth: number; after: number; navelOut: number; cut: number; placenta: number; placentaOut: number; total: number } {
  const T = BIRTH_TIMING;
  const labour = 0, pushing = T.labourCount * T.labourEvery, crowning = pushing + T.pushCount * T.pushEvery;
  const birth = crowning + T.crowning, after = birth + T.headOut + T.restitution + T.bodyOut;
  // (its navel out of her: half way along its body, in the body's last push)
  const navelOut = birth + T.headOut + T.restitution + T.bodyOut * 0.5;
  const ownCut = after + 0.5 + T.toHer + T.cutAfter;
  const cut = events.cutAt !== null && events.cutAt !== undefined && Number.isFinite(events.cutAt) ? Math.min(ownCut, Math.max(navelOut, events.cutAt)) : ownCut;
  const ownPlacenta = cut + T.placentaAfterCut;
  const placenta = events.placentaAt !== null && events.placentaAt !== undefined && Number.isFinite(events.placentaAt) ? Math.min(ownPlacenta, Math.max(cut, events.placentaAt)) : ownPlacenta;
  const placentaOut = placenta + T.placentaSeparate + T.placentaDown + T.placentaOut;
  return { labour, pushing, crowning, birth, after, navelOut, cut, placenta, placentaOut, total: Math.max(after + T.settle, placentaOut + T.placentaSettle) };
}

/** A contraction's strength at `phase` (0..1 of its cycle): a rise and fall over the first `long` of it, then rest. */
export function squeeze(phase: number, long: number): number {
  if (phase >= long || phase < 0) return 0;
  return Math.sin((phase / long) * Math.PI) ** 1.5;
}

/** The birth at `seconds` since it began, at `pace` (and `events`: a cut or placenta asked for sooner, FAST seconds). */
export function birthAt(seconds: number, pace: BirthPace = 'fast', events: BirthEvents = {}): BirthMoment {
  const T = BIRTH_TIMING, P = birthPlan(events), stretch = pace === 'realistic' ? REALISTIC_STRETCH : 1;
  const real = Math.max(0, Number.isFinite(seconds) ? seconds : 0), t = real / stretch;
  let stage: BirthStage, contraction = 0, cervix = 1, engage = 1, down = 0, turnDeg: number = TURN_DEG.inWomb, onHer = 0, stretchK = 0, closing = 0;
  if (t < P.pushing) {
    stage = 'labour';
    const i = Math.floor(t / T.labourEvery), ph = (t - i * T.labourEvery) / T.labourEvery;
    contraction = squeeze(ph, T.labourLong);
    // her cervix a step with each contraction, rising through the squeeze and holding after it
    const stepOf = (1 - T.cervixFrom) / T.labourCount, during = smooth(0, T.labourLong, ph);
    cervix = T.cervixFrom + stepOf * (i + during);
    engage = smooth(P.pushing * (1 - T.engageShare), P.pushing, t);
  } else if (t < P.crowning) {
    stage = 'pushing';
    const u = t - P.pushing, i = Math.min(T.pushCount - 1, Math.floor(u / T.pushEvery)), ph = (u - i * T.pushEvery) / T.pushEvery;
    contraction = squeeze(ph, T.pushLong);
    const step = T.pushReach / T.pushCount, base = i * step, slip = T.slip * step;
    // forward through the push, from where the last slip left it, to the next step; back a little as it eases off
    const from = i === 0 ? 0 : base - slip, to = base + step;
    down = ph < T.pushLong ? from + (to - from) * smooth(0, T.pushLong, ph) : to - (i === T.pushCount - 1 ? 0 : slip) * smooth(T.pushLong, 1, ph);
  } else if (t < P.birth) {
    stage = 'crowning';
    const u = t - P.crowning, ph = (u % T.pushEvery) / T.pushEvery;
    contraction = squeeze(ph, T.pushLong);
    down = T.pushReach + (1 - T.pushReach) * smooth(0, T.crowning, u);
  } else if (t < P.after) {
    stage = 'birth';
    const u = t - P.birth;
    contraction = u < T.headOut ? squeeze(u / T.headOut, 1) : u > T.headOut + T.restitution ? squeeze((u - T.headOut - T.restitution) / T.bodyOut, 1) : 0;
    // the head out (its middle past her opening by a third of the baby), held while it turns, then the rest of it
    down = u < T.headOut + T.restitution ? 1 + 0.35 * smooth(0, T.headOut, u) : 1.35 + 0.65 * smooth(T.headOut + T.restitution, T.headOut + T.restitution + T.bodyOut, u);
  } else {
    stage = t < P.placenta ? 'after' : 'afterbirth';
    down = 2;
    const u = t - P.after;
    // lifted onto her; a stretch as it meets the air, and smaller ones as it settles
    onHer = smooth(0.5, 0.5 + T.toHer, u);
    stretchK = u < T.firstStretch ? Math.sin((u / T.firstStretch) * Math.PI) : 0.25 * Math.max(0, Math.sin(((u - T.firstStretch) / 3) * Math.PI)) * (1 - smooth(T.settle - 2, T.settle, u));
    closing = smooth(0, T.close, u);
  }
  // the turn: round to her front as the head comes down her pelvis, all of it done before it reaches her opening; none
  // once it is out (2026-11-02, Joshua: "the baby is rotating halfway out of her body... either have it rotated before it
  // gets to the opening, or not at all as it looks weird"): the pause after the head is a pause, nothing turning
  if (stage === 'pushing' || stage === 'crowning') turnDeg = TURN_DEG.inWomb + (TURN_DEG.born - TURN_DEG.inWomb) * smooth(0.2, 0.75, down);
  else if (stage === 'birth' || stage === 'after' || stage === 'afterbirth') turnDeg = TURN_DEG.born;
  // THE AFTERBIRTH: mild contractions; the placenta peels off her womb's wall, comes down her canal and out of her, and
  // settles into the bowl; her womb settles smaller after it
  const v = t - P.placenta;
  let separate = 0, placentaDown = 0, bowl = 0, afterbirth = 0;
  if (v >= 0) {
    if (v < T.placentaContractions * T.placentaEvery) contraction = Math.max(contraction, T.placentaSqueeze * squeeze((v % T.placentaEvery) / T.placentaEvery, T.placentaLong));
    const down0 = T.placentaSeparate, out0 = down0 + T.placentaDown, bowl0 = out0 + T.placentaOut;
    separate = smooth(0, T.placentaSeparate, v);
    placentaDown = v < out0 ? smooth(down0, out0, v) : 1 + smooth(out0, bowl0, v);
    bowl = smooth(bowl0, bowl0 + T.placentaBowl, v);
    afterbirth = smooth(bowl0 - T.placentaOut * 0.5, bowl0 + T.placentaSettle, v);
  }
  const cut = t >= P.cut;
  return { stage, seconds: real, contraction: clamp01(contraction), cervix: clamp01(cervix), engage: clamp01(engage), down, turnDeg, progress: clamp01(t / P.total), onHer, stretch: clamp01(stretchK), closing,
    cut, cutAt: cut ? P.cut : null, placentaFor: v, separate, placentaDown, bowl, afterbirth };
}

/** The birth's whole length in seconds at `pace`. */
export const birthLength = (pace: BirthPace = 'fast'): number => birthPlan().total * (pace === 'realistic' ? REALISTIC_STRETCH : 1);

/** Her cervix as a gameplay reading (Joshua, 2026-11-02: "a stat that says like 'Open 2.7cm - not yet'"). */
export function cervixLine(cervix: number): string {
  const cm = Math.max(0, Math.min(10, cervix * 10));
  return `Cervix ${cm.toFixed(1)} cm · ${cm >= 9.95 ? 'ready to push' : cm >= 8 ? 'nearly' : 'not yet'}`;
}

/** The line shown for it: where the birth is, her cervix, and her opening (`openCm`, as drawn) when given. */
export function birthLine(m: BirthMoment | null, openCm?: number): string {
  if (!m) return 'BIRTH · not started';
  const name: Record<BirthStage, string> = { labour: 'labour', pushing: 'pushing', crowning: 'crowning', birth: 'birth', after: 'born', afterbirth: 'afterbirth' };
  const squeezing = m.contraction > 0.15 ? ' · contraction' : '';
  const open = openCm !== undefined ? ` · Opening ${openCm.toFixed(1)} cm` : '';
  return `BIRTH · ${name[m.stage]}${squeezing} · ${cervixLine(m.cervix)}${open}`;
}
