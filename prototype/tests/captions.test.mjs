import test from 'node:test';
import assert from 'node:assert/strict';
import {captionSegments,captionAt} from '../app/game/lib/captions.ts';
const text='It was almost eleven at night on a remote island somewhere in the Atlantic Ocean. The island stretched roughly fifty-six kilometers across, about thirty-five miles from one side to the other, but most of it remained undeveloped wilderness.';
test('short captions retain every word and cover one unchanged clip duration',()=>{
 const segments=captionSegments(text,26);
 assert.ok(segments.length>2);
 assert.deepEqual(segments.map(x=>x.text).join(' ').split(/\s+/),text.split(/\s+/));
 assert.ok(segments.every(x=>x.text.length<=110));
 assert.equal(segments[0].start,0);assert.equal(segments.at(-1).end,26);
 segments.slice(1).forEach((s,i)=>assert.equal(s.start,segments[i].end));
});
test('caption follows replay, seek and finished playhead without advancing audio',()=>{
 const segments=captionSegments(text,26);
 assert.equal(captionAt(segments,0),segments[0]);
 assert.equal(captionAt(segments,segments[1].start),segments[1]);
 assert.equal(captionAt(segments,26),segments.at(-1));
 assert.equal(captionAt(segments,0),segments[0]);
});
test('explicit timings are used only when they preserve the transcript and cover the clip',()=>{
 const cues=[{text:'First sentence.',start:0,end:2},{text:'Second sentence.',start:2,end:8}];
 assert.deepEqual(captionSegments('First sentence. Second sentence.',8,cues),cues);
 const fallback=captionSegments('First sentence. Second sentence.',8,[{text:'Missing words.',start:0,end:8}]);
 assert.equal(fallback.map(x=>x.text).join(' '),'First sentence. Second sentence.');
 assert.deepEqual(captionSegments('',0),[]);
 assert.ok(captionSegments('Waiting for metadata.',0)[0].end>0);
});
