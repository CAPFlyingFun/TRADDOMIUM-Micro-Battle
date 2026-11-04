/**
 * HOW FAR A HUMAN JOINT GOES — one master table for every human character (Joshua, 2026-11-04: "We need to set up
 * realistic max and min angles for each part of the body with a bone... which will work for all human characters as
 * one master stat... research for male and female since they are different").
 *
 * Each motion is the ACTIVE range a healthy adult reaches, in degrees from the joint's neutral (anatomical position:
 * standing, arms at the sides, palms forward; for the forearm, thumb up with the elbow bent), for a woman and for a man.
 * A posing system reads these as the walls a joint may not pass; it never keeps its own copy of a number here.
 *
 * TWO LEVELS (Joshua, 2026-11-04, choosing them over one: "Two levels"). ACTIVE is what a person moves a joint to by
 * herself, unloaded -- reaching, looking round, walking, anything she does. PASSIVE is how far the joint GIVES when it
 * is placed or loaded: held up by a bed, her weight on it, gravity on it -- a deep squat, her thighs let fall open in a
 * birth, her ankle under her in a lunge. Measured with the joint moved for the person, it runs further. Where a study
 * measured it, the passive wall is that study's mean plus two standard deviations -- the end of a healthy body's range,
 * so no body is held short of what a healthy one gives -- and never less than the active wall (two studies of different
 * people can disagree that way round; a joint does not). Where none did, passive is the active range.
 *
 * Every number is labelled (data/README.md):
 *   MEASURED          a published measurement, its source named in `source`
 *   BIOLOGICAL SHAPE  the sex difference's direction and rough size are published, the split is ours
 * Where a source reports no sex difference, the woman's and the man's numbers are the same.
 *
 * Pure: no three, no DOM (ARCHITECTURE §2.8).
 */

export type Sex = 'female' | 'male';

export type JointRangeSource = keyof typeof JOINT_RANGE_SOURCES;

export interface MotionRange {
  readonly female: number;
  readonly male: number;
  readonly source: JointRangeSource;
  readonly label: 'MEASURED' | 'BIOLOGICAL SHAPE';
  /** how far it gives placed or loaded (see TWO LEVELS), where a study measured it */
  readonly passive?: { readonly female: number; readonly male: number; readonly source: JointRangeSource; readonly label: 'MEASURED' };
}

/** ACTIVE: moved by the person; PASSIVE: placed or loaded (see TWO LEVELS). */
export type RangeLevel = 'active' | 'passive';

/** Where the numbers come from (read 2026-11-04). */
export const JOINT_RANGE_SOURCES = Object.freeze({
  /** Soucie JM et al., "Range of motion measurements: reference values and a database for comparison studies",
   * Haemophilia 17(3):500-507, 2011 -- the CDC Joint Range of Motion Study, healthy adults aged 20-44, by sex
   * (archive.cdc.gov/www_cdc_gov/ncbddd/jointrom). */
  CDC_2011: 'Soucie et al. 2011, CDC Joint Range of Motion Study (adults 20-44)',
  /** American Academy of Orthopaedic Surgeons normal values (Greene & Heckman 1994), as tabulated for clinicians. */
  AAOS: 'AAOS normal values (Greene & Heckman 1994)',
  /** Luttgens K, Hamilton N, Kinesiology (1997), Joint ROM table (as tabulated by WikEM). */
  LUTTGENS_1997: 'Luttgens & Hamilton 1997, Kinesiology',
  /** "Active range of motion of the shoulder: a cross-sectional study of 6635 subjects", JSES International 2023:
   * extension and horizontal abduction 5-10 degrees greater in women (ages 10-59), abduction greater in women, no sex
   * difference in flexion or internal or external rotation. */
  JSES_2023: 'Active ROM of the shoulder, 6635 subjects, JSES International 2023',
  /** Vaishnani HV et al., "A Study on Range of Movement of Wrist Joint", IJHSR 6(5), 2016: 400 adults 21-60, the
   * sexes within a few degrees of each other in every wrist motion, the differences not the same way in both hands. */
  VAISHNANI_2016: 'Vaishnani et al. 2016, wrist ROM in 400 adults',
  /** Eaton RG, normal values of the hand (eatonhand.com, "Range of motion"): the fingers' and thumb's joints. */
  EATON: 'Eaton, normal range of motion of the hand',
  /** Yoon PW, Kim HJ, Yoon JY, Moon J-K, Lee S, "Influence of acetabular dysplasia and associated radiological
   * indicators on hip joint motion in asymptomatic individuals", Journal of Hip Preservation Surgery 13(2), 2026
   * (online 2025): PASSIVE hip range by goniometer, 100 volunteers 18-50 (41 men, 59 women); the hips without dysplasia
   * (63 men's, 95 women's): flexion 110.71 ± 9.95 / 125.88 ± 8.17, abduction 41.03 ± 7.79 / 49.35 ± 8.44, adduction
   * 10.56 ± 4.03 / 14.18 ± 4.87, internal rotation 24.78 ± 7.83 / 38.96 ± 10.70, external rotation 39.78 ± 6.90 /
   * 42.89 ± 5.88 (men / women). */
  YOON_2025: 'Yoon et al. 2025, passive hip ROM, J Hip Preserv Surg',
  /** Howe L, Waldron M, North J, Bampouras T, "Within-session reliability for inter-limb asymmetries in ankle
   * dorsiflexion range of motion during the weight-bearing lunge test", Int J Sports Phys Ther 15(1):64-73, 2020: the
   * ankle bent under the body's weight, 36.5 ± 4.5 degrees (50 adults, 28 men and 22 women, not split by sex). */
  HOWE_2020: 'Howe et al. 2020, weight-bearing lunge test',
} as const);

const m = (female: number, male: number, source: JointRangeSource, label: MotionRange['label'] = 'MEASURED', passive?: MotionRange['passive']): MotionRange =>
  Object.freeze(passive ? { female, male, source, label, passive: Object.freeze({ ...passive, female: Math.max(female, passive.female), male: Math.max(male, passive.male) }) } : { female, male, source, label });
/** a passive wall from a study's mean and standard deviation for each sex: mean + 2 SD (TWO LEVELS) */
const p = (female: [number, number], male: [number, number], source: JointRangeSource): NonNullable<MotionRange['passive']> =>
  ({ female: +(female[0] + 2 * female[1]).toFixed(1), male: +(male[0] + 2 * male[1]).toFixed(1), source, label: 'MEASURED' });

/** THE TABLE: degrees each way from neutral, per joint and motion. */
export const JOINT_RANGE = Object.freeze({
  shoulder: Object.freeze({
    flexion: m(172.0, 168.8, 'CDC_2011'),
    /** AAOS 60; women 5-10 more (JSES 2023), split either side of it */
    extension: m(63, 57, 'JSES_2023', 'BIOLOGICAL SHAPE'),
    abduction: m(180, 180, 'AAOS'),
    /** across the body */
    adduction: m(50, 50, 'LUTTGENS_1997'),
    internalRotation: m(70, 70, 'AAOS'),
    externalRotation: m(90, 90, 'AAOS'),
  }),
  elbow: Object.freeze({
    flexion: m(150.0, 144.6, 'CDC_2011'),
    /** past straight */
    hyperextension: m(4.7, 0.8, 'CDC_2011'),
  }),
  forearm: Object.freeze({
    pronation: m(82.0, 76.9, 'CDC_2011'),
    supination: m(90.6, 85.0, 'CDC_2011'),
  }),
  wrist: Object.freeze({
    /** toward the palm; the sexes alike (Vaishnani 2016) */
    flexion: m(80, 80, 'AAOS'),
    /** toward the back of the hand */
    extension: m(70, 70, 'AAOS'),
    /** toward the thumb */
    radialDeviation: m(20, 20, 'AAOS'),
    /** toward the little finger */
    ulnarDeviation: m(30, 30, 'AAOS'),
  }),
  /** each finger's knuckle (MCP), middle (PIP) and end (DIP) joints */
  finger: Object.freeze({
    mcpFlexion: m(90, 90, 'AAOS'),
    mcpHyperextension: m(45, 45, 'AAOS'),
    mcpSpread: m(25, 25, 'AAOS'),
    pipFlexion: m(100, 100, 'AAOS'),
    dipFlexion: m(90, 90, 'AAOS'),
  }),
  thumb: Object.freeze({
    cmcAbduction: m(70, 70, 'AAOS'),
    cmcFlexion: m(15, 15, 'AAOS'),
    cmcExtension: m(20, 20, 'AAOS'),
    mcpFlexion: m(55, 55, 'EATON'),
    mcpHyperextension: m(10, 10, 'EATON'),
    ipFlexion: m(80, 80, 'EATON'),
    ipHyperextension: m(15, 15, 'EATON'),
  }),
  hip: Object.freeze({
    flexion: m(133.8, 130.4, 'CDC_2011', 'MEASURED', p([125.88, 8.17], [110.71, 9.95], 'YOON_2025')),
    extension: m(18.1, 17.4, 'CDC_2011'),
    abduction: m(40, 40, 'LUTTGENS_1997', 'MEASURED', p([49.35, 8.44], [41.03, 7.79], 'YOON_2025')),
    adduction: m(20, 20, 'LUTTGENS_1997', 'MEASURED', p([14.18, 4.87], [10.56, 4.03], 'YOON_2025')),
    internalRotation: m(40, 40, 'LUTTGENS_1997', 'MEASURED', p([38.96, 10.70], [24.78, 7.83], 'YOON_2025')),
    externalRotation: m(50, 50, 'LUTTGENS_1997', 'MEASURED', p([42.89, 5.88], [39.78, 6.90], 'YOON_2025')),
  }),
  knee: Object.freeze({
    flexion: m(141.9, 137.7, 'CDC_2011'),
    hyperextension: m(1.6, 1.0, 'CDC_2011'),
  }),
  ankle: Object.freeze({
    /** passive: under the body's weight (a lunge, a squat's ankle) */
    dorsiflexion: m(13.8, 12.7, 'CDC_2011', 'MEASURED', p([36.5, 4.5], [36.5, 4.5], 'HOWE_2020')),
    plantarflexion: m(62.1, 54.6, 'CDC_2011'),
  }),
  neck: Object.freeze({
    flexion: m(45, 45, 'AAOS'),
    extension: m(45, 45, 'AAOS'),
    lateralFlexion: m(45, 45, 'AAOS'),
    rotation: m(60, 60, 'AAOS'),
  }),
  /** the thoracic and lumbar spine together */
  back: Object.freeze({
    flexion: m(80, 80, 'AAOS'),
    extension: m(25, 25, 'AAOS'),
    lateralFlexion: m(35, 35, 'AAOS'),
    rotation: m(45, 45, 'AAOS'),
  }),
});

export type Joint = keyof typeof JOINT_RANGE;
export type Motion<J extends Joint> = keyof (typeof JOINT_RANGE)[J];

/** A motion's range for a sex, degrees: ACTIVE unless asked for PASSIVE (TWO LEVELS; passive is active where unmeasured). */
export function rangeDeg<J extends Joint>(joint: J, motion: Motion<J>, sex: Sex, level: RangeLevel = 'active'): number {
  const r = (JOINT_RANGE[joint] as Readonly<Record<string, MotionRange>>)[motion as string];
  if (!r) throw new Error(`jointRange: no motion "${String(motion)}" at the ${joint}`);
  return level === 'passive' && r.passive ? r.passive[sex] : r[sex];
}

/** The motions a live system reads -- each pinned by tests/jointRange.test.ts (as a registry's WIRED list). */
export const JOINT_RANGE_WIRED = Object.freeze([
  ['elbow', 'flexion'], ['elbow', 'hyperextension'],
  ['forearm', 'pronation'], ['forearm', 'supination'],
  ['wrist', 'flexion'], ['wrist', 'extension'], ['wrist', 'radialDeviation'], ['wrist', 'ulnarDeviation'],
  // (actor/jointLimits.ts, through the Sarah lab: her back, neck, hips, knees and ankles)
  ['back', 'flexion'], ['back', 'extension'], ['back', 'lateralFlexion'], ['back', 'rotation'],
  ['neck', 'flexion'], ['neck', 'extension'], ['neck', 'lateralFlexion'], ['neck', 'rotation'],
  ['hip', 'flexion'], ['hip', 'extension'], ['hip', 'abduction'], ['hip', 'adduction'], ['hip', 'internalRotation'], ['hip', 'externalRotation'],
  ['knee', 'flexion'], ['knee', 'hyperextension'],
  ['ankle', 'dorsiflexion'], ['ankle', 'plantarflexion'],
  // (sarahlab/sarahLabTool.ts FINGER_LIMITS_DEG, held inside these by tests/jointRange.test.ts)
  ['finger', 'mcpFlexion'], ['finger', 'pipFlexion'], ['finger', 'dipFlexion'],
  ['thumb', 'cmcAbduction'], ['thumb', 'mcpFlexion'], ['thumb', 'ipFlexion'],
] as const);
