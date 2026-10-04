import source from '../data/scale.json';
export const WORLD_SCALE = source.scale;
export const HUMAN_MM = source.humanMm;
export const scaleItems = source.items;
export type ScaleItem = typeof scaleItems[number];
export const categories = ['All', 'Humans', 'Insects', 'Spiders', 'Animals', 'Plants', 'Palms', 'Terrain', 'Water', 'Objects'];
export const relativeMetres = (normalMm: number) => normalMm * WORLD_SCALE / 1000;
export const humanHeights = (normalMm: number) => normalMm / HUMAN_MM;
export const number = (n: number, digits = 2) => new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(n);
export function metric(mm: number) {
  return mm >= 1000000 ? `${number(mm/1000000)} km` : mm >= 1000 ? `${number(mm/1000)} m` : `${number(mm)} mm`;
}
