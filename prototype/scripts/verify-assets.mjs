import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = relative => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const audio = read('docs/chapter1-audio-source.json');
const provenance = read('docs/asset-provenance.json');
assert.equal(audio.revision, provenance.revision);
const inventory = [...Object.values(audio.files), ...Object.entries(provenance.files).map(([src, data]) => ({src, ...data}))];
for (const file of inventory) {
  assert.ok(file.src.startsWith('/') && !file.src.includes('..'));
  const bytes = fs.readFileSync(path.join(root, 'public', file.src.slice(1)));
  assert.equal(bytes.length, file.bytes, file.src);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), file.sha256, file.src);
}
const recordings = read('app/game/data/chapter1-audio.json');
const queues = read('app/game/data/lab-dialogue.json');
const cues = read('app/game/data/chapter1-cues.json');
const lines = Object.values(queues).flat();
assert.equal(lines.length, audio.segments);
assert.equal(Object.keys(recordings.lines).length, audio.segments);
lines.forEach((line, index) => {
  assert.equal(line.sourceIndex, index);
  const clip = recordings.lines[line.voiceKey];
  assert.equal(line.text, clip.sourceText);
  assert.equal(line.speaker, clip.speaker);
  assert.ok(inventory.some(x => x.src === clip.src));
});
assert.equal(new Set(cues.events.map(x => x.id)).size, cues.events.length, 'No duplicate legacy cue repairs');
for (const cue of cues.events) {
  assert.ok(cue.sourceIndex >= 0 && cue.sourceIndex < lines.length);
  assert.ok(recordings.effects[cue.asset], cue.id);
}
console.log(`Verified ${inventory.length} assets (${inventory.reduce((s,x)=>s+x.bytes,0)} bytes), ${lines.length} canonical lines and ${cues.events.length} unique one-shot cues.`);