import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const json = file => JSON.parse(fs.readFileSync(new URL('../app/game/data/'+file, import.meta.url), 'utf8'));
const queues = json('lab-dialogue.json'), cues = json('chapter1-cues.json'), audio = json('chapter1-audio.json');
const lines = Object.values(queues).flat();
test('revised Sarah arrival text and staging move together', () => {
  assert.equal(lines.length, 182);
  assert.match(lines[cues.staging.approach].text, /^Sarah Bennett walked straight in,/);
  assert.match(lines[cues.staging.closeDistance].text, /^Sarah closed the distance/);
  assert.equal(lines[cues.staging.pointMonitor].text, 'Jack pointed toward the monitor.');
  assert.ok(cues.staging.approach < cues.staging.closeDistance && cues.staging.closeDistance < cues.staging.pointMonitor);
  for (const index of [cues.staging.approach,cues.staging.closeDistance,cues.staging.pointMonitor]) {
    assert.equal(audio.lines[lines[index].voiceKey].sourceText, lines[index].text);
  }
});
test('current chair cues occur once each, not duplicated or retired', () => {
  for (const id of ['ch01-120-second-chair','ch01-121-jack-makes-room','ch01-130-sarah-types','ch01-131-sarah-history','ch01-132-sarah-digs']) {
    assert.equal(cues.events.filter(x => x.id === id).length, 1, id);
  }
  assert.equal(new Set(cues.events.map(x => x.id)).size, cues.events.length);
});