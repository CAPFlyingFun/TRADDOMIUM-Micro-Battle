import test from 'node:test';
import assert from 'node:assert/strict';
import {openingSegment} from '../app/game/lib/opening.ts';
import {freshSave} from '../app/game/lib/state.ts';

test('New Game opens with the date and island before the laboratory', () => {
  const save=freshSave();
  assert.equal(save.sceneId, 'alarm');
  assert.equal(openingSegment(save), 0);
  assert.equal(openingSegment({...save,line:1}), 1);
  assert.equal(openingSegment({...save,line:2}), null);
});
test('console queues never replay the cinematic introduction', () => {
  for(const queue of ['trace','lock','call','arrive','logs','request']) {
    assert.equal(openingSegment({queue,line:0}), null);
  }
});