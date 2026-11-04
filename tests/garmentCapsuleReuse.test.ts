import { describe, expect, it } from 'vitest';
import { snapshotCapsules } from '../src/sarahlab/garment/capsules';
import type { Capsules } from '../src/sarahlab/clothSim';
const caps = (count:number):Capsules=>({count,a:new Float32Array(count*3),b:new Float32Array(count*3),radius:new Float32Array(count)});
describe('reused capsule snapshots',()=>{
  it('keeps the previous frame independent from the reused live sample',()=>{
    const live=caps(2);live.a[0]=3;
    const old=snapshotCapsules(live);
    live.a[0]=4;expect(old.a[0]).toBe(3);
    const next=snapshotCapsules(live,old);
    expect(next).toBe(old);expect(next.a).toBe(old.a);expect(next.a[0]).toBe(4);
    expect(next.a).not.toBe(live.a);
  });
  it('resizes when limbs or the stool appear, then reuses that size',()=>{
    const first=snapshotCapsules(caps(4));const seated=caps(7);
    const next=snapshotCapsules(seated,first);expect(next.count).toBe(7);expect(next.a.length).toBe(21);
    expect(snapshotCapsules(seated,next)).toBe(next);
  });
});
