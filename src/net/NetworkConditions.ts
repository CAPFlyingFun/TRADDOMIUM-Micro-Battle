/**
 * HOW BAD THE WIRE IS, as three dials.
 *
 * The loopback transport applies these to every message, so the
 * replication stack is proved against a network that is late, uneven
 * and lossy before any real relay exists — a stack that only works on a
 * perfect in-process wire has proved nothing. The three numbers are the
 * three that separately break a naive design: latency (a move is seen
 * late), jitter (two moves arrive bunched, so a per-message speed check
 * mis-fires), loss (a state that never arrived must still converge).
 *
 * MUTABLE ON PURPOSE. Both ends of a loopback pair read the same
 * object, so a test turns a dial mid-run and both directions feel it
 * from the next send. Nothing outside a test rig should hold one.
 *
 * Pure: no timer, no randomness of its own — the draws come in.
 */
export interface NetworkConditions {
  /** One-way delay every message pays, milliseconds. */
  latencyMs: number;
  /** Extra one-way delay drawn uniformly in [0, jitterMs) per message. Never reorders. */
  jitterMs: number;
  /** 0..1: the chance a message is lost outright. A hang-up is never lost. */
  dropRate: number;
}

/** A fresh perfect wire. A function, not a constant: the object is mutable and must not be shared by accident. */
export function perfectConditions(): NetworkConditions {
  return { latencyMs: 0, jitterMs: 0, dropRate: 0 };
}

/** A finite number inside its range, else `fallback`: a negative latency or a 130 % loss rate is a typo, not a network. */
function dial(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(0, value));
}

/** Conditions from partial input, every dial clamped to its range. */
export function networkConditions(partial: Partial<NetworkConditions>): NetworkConditions {
  return {
    latencyMs: dial(partial.latencyMs, 0, Number.POSITIVE_INFINITY),
    jitterMs: dial(partial.jitterMs, 0, Number.POSITIVE_INFINITY),
    dropRate: dial(partial.dropRate, 0, 1),
  };
}

/**
 * Milliseconds one message waits. Draws from `random` only when jitter
 * is set, so a jitter-free wire never consumes randomness and a test's
 * drop sequence does not shift when it turns jitter off.
 */
export function delayFor(conditions: NetworkConditions, random: () => number): number {
  const latency = dial(conditions.latencyMs, 0, Number.POSITIVE_INFINITY);
  const jitter = dial(conditions.jitterMs, 0, Number.POSITIVE_INFINITY);
  return latency + (jitter > 0 ? random() * jitter : 0);
}

/** True when this message is lost. Draws only when loss is possible, for the same reason as `delayFor`. */
export function loses(conditions: NetworkConditions, random: () => number): boolean {
  const rate = dial(conditions.dropRate, 0, 1);
  return rate > 0 && random() < rate;
}
