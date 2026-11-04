/**
 * HOW FAR A HUMAN JOINT GOES — one master table for every human character (Joshua, 2026-11-04: "We need to set up
 * realistic max and min angles for each part of the body with a bone... which will work for all human characters as
 * one master stat... research for male and female since they are different").
 *
 * Each motion is the ACTIVE range a healthy adult reaches, in degrees from the joint's neutral (anatomical position:
 * standing, arms at the sides, palms forward; for the forearm, thumb up with the elbow bent), for a woman and for a man.
 * A posing system reads these as the walls a joint may not pass; it never keeps its own copy of a number here.
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
}

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
} as const);

const m = (female: number, male: number, source: JointRangeSource, label: MotionRange['label'] = 'MEASURED'): MotionRange => Object.freeze({ female, male, source, label });

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
    flexion: m(133.8, 130.4, 'CDC_2011'),
    extension: m(18.1, 17.4, 'CDC_2011'),
    abduction: m(40, 40, 'LUTTGENS_1997'),
    adduction: m(20, 20, 'LUTTGENS_1997'),
    internalRotation: m(40, 40, 'LUTTGENS_1997'),
    externalRotation: m(50, 50, 'LUTTGENS_1997'),
  }),
  knee: Object.freeze({
    flexion: m(141.9, 137.7, 'CDC_2011'),
    hyperextension: m(1.6, 1.0, 'CDC_2011'),
  }),
  ankle: Object.freeze({
    dorsiflexion: m(13.8, 12.7, 'CDC_2011'),
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

/** A motion's range for a sex, degrees. */
export function rangeDeg<J extends Joint>(joint: J, motion: Motion<J>, sex: Sex): number {
  const r = (JOINT_RANGE[joint] as Readonly<Record<string, MotionRange>>)[motion as string];
  if (!r) throw new Error(`jointRange: no motion "${String(motion)}" at the ${joint}`);
  return r[sex];
}

/** The motions a live system reads -- each pinned by tests/jointRange.test.ts (as a registry's WIRED list). */
export const JOINT_RANGE_WIRED = Object.freeze([
  ['elbow', 'flexion'], ['elbow', 'hyperextension'],
  ['forearm', 'pronation'], ['forearm', 'supination'],
  ['wrist', 'flexion'], ['wrist', 'extension'], ['wrist', 'radialDeviation'], ['wrist', 'ulnarDeviation'],
] as const);
