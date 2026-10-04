import test from 'node:test';
import assert from 'node:assert/strict';

import { VoiceTransport } from '../app/game/lib/voice-transport.ts';
function fixture() {
  let clock = 0;
  const starts = [], events = [], completed = [], pending = new Map();
  const backend = {
    now: () => clock,
    isReady: () => true,
    load: src => new Promise((resolve, reject) => pending.set(src, {resolve, reject})),
    start: (clip, offset, ended) => { const run={clip,offset,ended,stopped:false}; starts.push(run); return {stop:()=>{run.stopped=true;}}; },
  };
  const transport = new VoiceTransport(backend, state => events.push(state), key => completed.push(key));
  return {transport,starts,events,completed,pending,tick:seconds=>{clock+=seconds;}};
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('a completed clip advances its own line only once', async () => {
  const f=fixture(); f.transport.select('wake:1','warning.mp3');
  f.pending.get('warning.mp3')?.resolve({duration:4}); await settle();
  assert.equal(f.starts.length,1,'selection should start the available recording');
  f.starts[0].ended(); f.starts[0].ended();
  assert.deepEqual(f.completed,['wake:1']);
});
test('skipping while a clip loads cannot play or finish the old line later', async () => {
  const f=fixture(); f.transport.select('old','old.mp3'); f.transport.select('new','new.mp3');
  f.pending.get('old.mp3')?.resolve({duration:9}); f.pending.get('new.mp3')?.resolve({duration:2}); await settle();
  assert.equal(f.starts.length,1); assert.equal(f.starts[0].clip.duration,2);
  f.starts[0].ended(); assert.deepEqual(f.completed,['new']);
});
test('pause resumes from the same audio position without advancing', async () => {
  const f=fixture(); f.transport.select('line','line.mp3');
  f.pending.get('line.mp3')?.resolve({duration:8}); await settle();
  f.tick(2.5); f.transport.setPaused(true); f.tick(10);
  assert.deepEqual(f.completed,[]); assert.equal(f.starts[0]?.stopped,true);
  f.transport.setPaused(false); assert.equal(f.starts[1]?.offset,2.5);
  f.starts[0].ended(); assert.deepEqual(f.completed,[],'the stopped source must not advance');
  f.starts[1].ended(); assert.deepEqual(f.completed,['line']);
});
test('leaving a scene cancels the old recording and its completion', async () => {
  const f=fixture(); f.transport.select('line','line.mp3');
  f.pending.get('line.mp3')?.resolve({duration:8}); await settle();
  f.transport.stop(); assert.equal(f.starts[0]?.stopped,true);
  f.starts[0].ended(); assert.deepEqual(f.completed,[]);
});
test('a failed clip waits for retry or skip rather than silently advancing', async () => {
  const f=fixture(); f.transport.select('line','missing.mp3');
  f.pending.get('missing.mp3')?.reject(new Error('404')); await settle();
  assert.equal(f.events.at(-1)?.status,'error'); assert.deepEqual(f.completed,[]);
});
