/**
 * TWENTY-TWO PLACES ON KAUAʻI — the weather grid.
 *
 * The point of the whole system is that the island does NOT have one
 * weather. Kauaʻi is the wettest place on earth on one side of a ridge
 * and near-desert on the other: Mount Waiʻaleʻale takes about 9,500 mm
 * of rain a year and Kekaha, twenty-five kilometres downwind, takes
 * around 500. Asking Līhuʻe airport what the weather is and painting
 * the whole island with the answer would throw away the most
 * interesting fact about the place.
 *
 * So: real coordinates, spread around the compass and up the
 * mountain, deliberately including both ends of that gradient. The
 * provider is asked for all of them in ONE request.
 *
 * These are SAMPLE POINTS, not the spawn regions. They do not have to
 * line up — the field interpolates, so any spawn anywhere derives its
 * weather from whichever stations are nearest. Keeping the two lists
 * independent means retuning one never disturbs the other.
 *
 * Coordinates are the real island's, to about a hundred metres. They
 * are converted to global world positions ONCE, by `geoToWorld`, and
 * it is the world position that everything downstream uses.
 */
import { geoToWorld, type GeoPoint } from '../world/geo';
import type { WorldPoint } from '../world/coords';

export interface Station {
  readonly id: string;
  readonly name: string;
  readonly where: GeoPoint;
  /** GLOBAL, derived once. A station does not move when the origin does. */
  readonly at: WorldPoint;
}

interface StationSeed {
  readonly id: string;
  readonly name: string;
  readonly lat: number;
  readonly lon: number;
}

const SEEDS: readonly StationSeed[] = [
  // NORTH COAST — wet, cliff-shadowed, the postcard side.
  { id: 'haena', name: 'Hāʻena', lat: 22.220, lon: -159.565 },
  { id: 'hanalei', name: 'Hanalei', lat: 22.205, lon: -159.500 },
  { id: 'kilauea', name: 'Kīlauea Point', lat: 22.225, lon: -159.405 },

  // NORTHEAST / WINDWARD — where the trades hit land first.
  { id: 'anahola', name: 'Anahola', lat: 22.145, lon: -159.315 },
  { id: 'kapaa', name: 'Kapaʻa', lat: 22.085, lon: -159.320 },

  // EAST — the Coconut Coast and the island's one real town.
  { id: 'wailua', name: 'Wailua', lat: 22.045, lon: -159.340 },
  { id: 'lihue', name: 'Līhuʻe', lat: 21.976, lon: -159.339 },

  // SOUTHEAST.
  { id: 'nawiliwili', name: 'Nāwiliwili', lat: 21.955, lon: -159.355 },
  { id: 'koloa', name: 'Kōloa', lat: 21.905, lon: -159.470 },

  // SOUTH — the dry, sunny, leeward resort coast.
  { id: 'poipu', name: 'Poʻipū', lat: 21.877, lon: -159.455 },
  { id: 'kalaheo', name: 'Kalāheo', lat: 21.925, lon: -159.525 },

  // SOUTHWEST.
  { id: 'hanapepe', name: 'Hanapēpē', lat: 21.910, lon: -159.590 },
  { id: 'waimea', name: 'Waimea', lat: 21.957, lon: -159.668 },

  // WEST — the driest ground on the island.
  { id: 'kekaha', name: 'Kekaha', lat: 21.968, lon: -159.718 },
  { id: 'mana', name: 'Mānā', lat: 22.023, lon: -159.785 },

  // NORTHWEST — the dunes and the start of the Nā Pali cliffs.
  { id: 'polihale', name: 'Polihale', lat: 22.085, lon: -159.760 },
  { id: 'kalalau', name: 'Kalalau', lat: 22.170, lon: -159.650 },

  // INTERIOR AND MOUNTAIN — the other end of the rain gradient.
  { id: 'waimea-canyon', name: 'Waimea Canyon', lat: 22.075, lon: -159.665 },
  { id: 'kokee', name: 'Kōkeʻe', lat: 22.135, lon: -159.655 },
  { id: 'alakai', name: 'Alakaʻi Swamp', lat: 22.115, lon: -159.585 },
  { id: 'waialeale', name: 'Waiʻaleʻale', lat: 22.070, lon: -159.498 },
  { id: 'wahiawa', name: 'Wahiawa Plateau', lat: 21.960, lon: -159.470 },
];

export const STATIONS: readonly Station[] = SEEDS.map((seed) => {
  const where: GeoPoint = { lat: seed.lat, lon: seed.lon };
  return { id: seed.id, name: seed.name, where, at: geoToWorld(where) };
});

export const STATION_POINTS: readonly GeoPoint[] = STATIONS.map((s) => s.where);
