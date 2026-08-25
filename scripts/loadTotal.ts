/** What the loading screen declares, before and after the headers land. */
import { statSync } from 'node:fs';
import { LoadPlan, readableBytes, TERRAIN_JOB, FIRST_LIGHT_JOB, WORK_WEIGHT } from '../src/ui/loadPlan';
import { BAND_FILES } from '../src/world/terrainMaterial';

// planBands/planQueen/planRipple, without importing three.js.
import { assetBytes } from '../src/ui/assetSizes';
const plan = new LoadPlan(() => 0);
for (const name of BAND_FILES) {
  plan.add(`band:${name}`, 'Ground textures', assetBytes(`kauai-tex/${name}.jpg`)!, true);
}
plan.add('queen', 'The queen', assetBytes('models/queen-winged.glb')!, true);
plan.add('ripple', 'The water', assetBytes('water-normal.png')!, true);
plan.add(TERRAIN_JOB, 'Cutting the terrain', WORK_WEIGHT);
plan.add(FIRST_LIGHT_JOB, 'First light', WORK_WEIGHT);
const guessed = plan.read().bytesTotal;

for (const name of BAND_FILES) {
  plan.resize(`band:${name}`, statSync(`public/kauai-tex/${name}.jpg`).size);
}
plan.resize('queen', statSync('public/models/queen-winged.glb').size);
plan.resize('ripple', statSync('public/water-normal.png').size);
const real = plan.read().bytesTotal;

console.log(`declared at the start  ${guessed} B  -> "${readableBytes(guessed)}"`);
console.log(`once the headers land  ${real} B  -> "${readableBytes(real)}"`);
console.log(`drift                  ${(real - guessed)} B`);
console.log('');
// And what the OLD guesses would have declared, for the record.
const OLD = BAND_FILES.length * 445_000 + 2_070_000;
console.log(`the old guess declared ${OLD} B  -> "${readableBytes(OLD)}"`);
