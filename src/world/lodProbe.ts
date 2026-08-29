/**
 * THE MASTER LOD'S DEBUG SURFACE — inspection, not behaviour.
 *
 * Everything here READS the core (lod.ts) and the world, and returns
 * plain numbers a person or a probe can judge. Nothing here is called
 * by production rendering, and nothing here may grow a lever that
 * gameplay depends on — the force hooks it exposes are the core's own
 * dev pins, surfaced.
 *
 * THE FLYING CASE IS THE POINT. The report always carries `below`:
 * the ground point directly under the queen, its TRUE 3D distance and
 * its MICRO fraction — so "at 166 m up the ground under me is 166 m
 * away and earns 0.00 of the detail budget" is one glance at the
 * overlay or one `__island.lod()` in a console, not an argument.
 *
 * Metres in the report, world units in the engine — this is a surface
 * for human eyes, and Joshua thinks in metres.
 */
import {
  anchor, anchorSpeed, detailDial, detailFraction, detailRadius,
  distanceTo, forcedState, type LodProfile, profilesSnapshot,
  registerProfile, tierAt,
} from './lod';
import { CELLS, groundHeight } from './heightfield';
import { UNITS_PER_METRE } from './kauai';
import { CHUNK_SPAN } from './coords';
import { MIDDLE_REACH, TRANSITION_REACH } from './TerrainStream';
import { HD_REACH } from './kauaiHd';
import { COVER_FADE } from './GroundCover';

const M = UNITS_PER_METRE;

/**
 * DESCRIBE THE SYSTEMS THAT EXIST, so the registry has something true
 * in it before any consumer registers itself. These are COVERAGE
 * ladders read off the owners' own exported constants — planar
 * windows described for the debug view, not spherical conversions
 * (see docs/LOD_ARCHITECTURE.md: coverage stays planar on purpose).
 * When a system becomes a real consumer in a later stage, it registers
 * itself and this description is simply overwritten by the same name.
 *
 * Idempotent: registering a name replaces it, so the scene may call
 * this on every build.
 */
export function describeKnownSystems(): void {
  registerProfile({
    name: 'terrain-tiers',
    cls: 'coverage',
    tiers: [
      { name: 'cells', upTo: ((CELLS - 1) / 2) * CHUNK_SPAN },
      { name: 'transition', upTo: TRANSITION_REACH },
      { name: 'middle', upTo: MIDDLE_REACH },
      { name: 'backdrop', upTo: Infinity },
    ],
  });
  registerProfile({
    name: 'hd-tiles',
    cls: 'coverage',
    tiers: [
      { name: 'fine', upTo: HD_REACH },
      { name: 'coarse-grid', upTo: Infinity },
    ],
  });
  registerProfile({
    name: 'ground-cover',
    cls: 'coverage', // becomes a MICRO consumer in Stage 3
    tiers: [
      { name: 'grown', upTo: COVER_FADE },
      { name: 'bare', upTo: Infinity },
    ],
  });
}

/** One profile, read at a distance — the report's common row. */
export interface ProfileRead {
  readonly name: string;
  readonly cls: LodProfile['cls'];
  readonly tier: string;
  readonly index: number;
  readonly fade: number;
}

/** Every registered profile evaluated at a 3D distance (world units). */
function readProfiles(dist: number): ProfileRead[] {
  return profilesSnapshot().map((p) => {
    const read = tierAt(p, dist);
    return {
      name: p.name, cls: p.cls,
      tier: read.tier.name, index: read.index,
      fade: Number(read.fade.toFixed(3)),
    };
  });
}

/**
 * A world point, inspected: its true 3D distance from the queen, the
 * MICRO fraction that distance earns, and where it sits on every
 * registered ladder. Coordinates are WORLD units; the answer is
 * metres, because it is for reading.
 */
export function lodAt(wx: number, wy: number, wz: number): {
  distanceM: number; microFraction: number; profiles: ProfileRead[];
} {
  const dist = distanceTo(wx, wy, wz);
  return {
    distanceM: Number((dist / M).toFixed(2)),
    microFraction: Number(detailFraction(dist).toFixed(3)),
    profiles: readProfiles(dist),
  };
}

/** The whole state of the master, one call. */
export function lodReport(): {
  dialPercent: number;
  radiusM: number;
  anchor: { wx: number; wy: number; wz: number };
  speedMps: number;
  below: {
    groundY: number; distanceM: number; microFraction: number;
    /** Distance to the sea surface (y = 0) under her — only over water. */
    seaM?: number;
  };
  forced: { micro: number | null; tiers: Record<string, number> };
  profiles: ProfileRead[];
} {
  const at = anchor();
  const groundY = groundHeight(at.wx, at.wz);
  const down = distanceTo(at.wx, groundY, at.wz);
  const below: ReturnType<typeof lodReport>['below'] = {
    groundY: Number(groundY.toFixed(1)),
    distanceM: Number((down / M).toFixed(2)),
    microFraction: Number(detailFraction(down).toFixed(3)),
  };
  if (groundY < 0) {
    below.seaM = Number((distanceTo(at.wx, 0, at.wz) / M).toFixed(2));
  }
  return {
    dialPercent: Math.round(detailDial() * 100),
    radiusM: Number((detailRadius() / M).toFixed(2)),
    anchor: at,
    speedMps: Number((anchorSpeed() / M).toFixed(3)),
    below,
    forced: forcedState(),
    profiles: readProfiles(down),
  };
}

/**
 * The overlay's one line, composed here so the compass stays a
 * renderer of strings. Compact on purpose — it shares a corner with
 * the position fix:
 *
 *   LOD 200% r20m ↓166.30m µ0.00
 *
 * ↓ is the true 3D distance to the ground straight under her, µ the
 * micro fraction that distance earns. FORCED is appended whenever a
 * dev pin is in — a frame judged with a hand on the scale must say so.
 */
export function lodLine(): string {
  const r = lodReport();
  const forced = r.forced.micro !== null
    || Object.keys(r.forced.tiers).length > 0;
  return `LOD ${r.dialPercent}% r${r.radiusM}m `
    + `↓${r.below.distanceM.toFixed(2)}m `
    + `µ${r.below.microFraction.toFixed(2)}${forced ? ' FORCED' : ''}`;
}
