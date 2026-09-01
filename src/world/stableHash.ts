/**
 * A HASH THAT IS STABLE FOREVER, ON ANY DEVICE.
 *
 * The same integer mixing the terrain's own noise and the ground cover
 * use. Not `Math.random`, and not `fract(sin(x))` either: two players
 * standing in the same clearing must see the same clearing, and
 * `Math.sin` is not required to agree across JavaScript engines to the
 * last bit — a placement hashed through it can differ by one tree
 * between two phones. Integer arithmetic through `ToInt32` is exact
 * everywhere.
 *
 * ONE COPY, shared: the ground cover and the landmark trees hash the
 * same way, and anything that grows later should too.
 */
export function stableHash(x: number, z: number, salt: number): number {
  let h = (x | 0) * 374_761_393 + (z | 0) * 668_265_263 + salt * 1_442_695_041;
  h = (h ^ (h >>> 13)) * 1_274_126_177;
  return ((h ^ (h >>> 16)) >>> 0) / 4_294_967_296;
}
