import { describe, expect, it } from 'vitest';
import {
  LoadPlan, readableBytes, readableWait,
} from '../src/ui/loadPlan';

/** A plan on a clock the test drives, so nothing depends on real time. */
function planAt(): { plan: LoadPlan; tick: (seconds: number) => void } {
  let ms = 0;
  const plan = new LoadPlan(() => ms);
  return { plan, tick: (seconds) => { ms += seconds * 1000; } };
}

describe('reading a byte count', () => {
  it('speaks in the unit the number deserves', () => {
    expect(readableBytes(0)).toBe('0 B');
    expect(readableBytes(512)).toBe('512 B');
    expect(readableBytes(2048)).toBe('2 KB');
    expect(readableBytes(3_100_000)).toBe('3.0 MB');
  });

  it('says nothing rather than something wrong', () => {
    expect(readableBytes(NaN)).toBe('—');
    expect(readableBytes(-5)).toBe('—');
  });
});

describe('reading a wait', () => {
  it('rounds up, because a wait that ends early is a nice surprise', () => {
    expect(readableWait(0.4)).toBe('a moment');
    expect(readableWait(11.2)).toBe('12s');
    expect(readableWait(90)).toBe('1m 30s');
    expect(readableWait(120)).toBe('2m');
  });
});

describe('the load plan', () => {
  it('weighs jobs against each other, not each on its own', () => {
    const { plan } = planAt();
    plan.add('big', 'Big', 900, true);
    plan.add('small', 'Small', 100, true);
    plan.advance('small', 100);
    // The small one finishing is a tenth of the work, not half.
    expect(plan.read().fraction).toBeCloseTo(0.1, 6);
  });

  it('reports bytes only for the jobs that are downloads', () => {
    const { plan } = planAt();
    plan.add('file', 'File', 1000, true);
    plan.add('work', 'Work', 1000);
    plan.advance('file', 400);
    plan.advance('work', 900);
    const state = plan.read();
    expect(state.bytesDone).toBe(400);
    expect(state.bytesTotal).toBe(1000);
    // But the bar counts both.
    expect(state.fraction).toBeCloseTo(0.65, 6);
  });

  it('NEVER shows full while something is still running', () => {
    // The whole complaint: a bar that hits 100% and then sits there.
    const { plan } = planAt();
    plan.add('a', 'A', 1000, true);
    plan.add('slow', 'Slow', 1);
    plan.advance('a', 1000);
    plan.advance('slow', 1);
    const state = plan.read();
    expect(state.complete).toBe(false);
    expect(state.fraction).toBeLessThan(1);
  });

  it('shows full exactly when everything is finished', () => {
    const { plan } = planAt();
    plan.add('a', 'A', 1000, true);
    plan.add('b', 'B', 500);
    plan.finish('a');
    expect(plan.read().fraction).toBeLessThan(1);
    plan.finish('b');
    const state = plan.read();
    expect(state.complete).toBe(true);
    expect(state.fraction).toBe(1);
    expect(state.secondsLeft).toBe(0);
    expect(state.label).toBe('Ready');
  });

  it('names what is being waited on, in the order declared', () => {
    const { plan } = planAt();
    plan.add('a', 'Ground textures', 100, true);
    plan.add('b', 'The queen', 100, true);
    expect(plan.read().label).toBe('Ground textures');
    plan.finish('a');
    expect(plan.read().label).toBe('The queen');
  });

  it('takes the real size over the guess as soon as it lands', () => {
    const { plan } = planAt();
    plan.add('file', 'File', 450_000, true);
    plan.resize('file', 528_690);
    expect(plan.read().bytesTotal).toBe(528_690);
  });

  it('never lets a job run past its own weight', () => {
    // A download that overshoots a stale estimate would otherwise push
    // the bar backwards the moment another job's real total arrived.
    const { plan } = planAt();
    plan.add('file', 'File', 1000, true);
    plan.advance('file', 4000);
    expect(plan.read().bytesDone).toBe(1000);
    expect(plan.read().fraction).toBeLessThan(1);
  });

  it('never goes backwards on a late, smaller report', () => {
    const { plan } = planAt();
    plan.add('file', 'File', 1000, true);
    plan.advance('file', 600);
    plan.advance('file', 300);
    expect(plan.read().bytesDone).toBe(600);
  });

  it('says nothing about the time until it has watched for a moment', () => {
    // An estimate from the first frame of a download is handshake
    // latency, and it reads as four minutes before correcting itself.
    const { plan, tick } = planAt();
    plan.add('file', 'File', 1_000_000, true);
    tick(0.05);
    plan.advance('file', 200);
    expect(plan.read().secondsLeft).toBeNull();
  });

  it('estimates from the rate it has actually seen', () => {
    const { plan, tick } = planAt();
    plan.add('file', 'File', 1_000_000, true);
    // A megabyte at a steady 200 KB/s: five seconds, and after one of
    // them there should be about four left.
    for (let i = 1; i <= 10; i++) {
      tick(0.1);
      plan.advance('file', i * 20_000);
      plan.read();
    }
    const left = plan.read().secondsLeft;
    expect(left).not.toBeNull();
    expect(left as number).toBeGreaterThan(2.5);
    expect(left as number).toBeLessThan(6);
  });

  it('counts a finished job as finished however little it reported', () => {
    // The texture path can finish without a final byte callback.
    const { plan } = planAt();
    plan.add('file', 'File', 1000, true);
    plan.advance('file', 10);
    plan.finish('file');
    expect(plan.read().bytesDone).toBe(1000);
    expect(plan.read().complete).toBe(true);
  });

  it('ignores a job it has never heard of', () => {
    const { plan } = planAt();
    plan.add('a', 'A', 100, true);
    plan.advance('ghost', 50);
    plan.finish('ghost');
    plan.resize('ghost', 900);
    expect(plan.read().fraction).toBe(0);
    expect(plan.read().bytesTotal).toBe(100);
  });

  it('is not complete before anything has been declared', () => {
    const { plan } = planAt();
    expect(plan.read().complete).toBe(false);
    expect(plan.read().fraction).toBe(0);
  });

  it('survives a job declared with no weight at all', () => {
    const { plan } = planAt();
    plan.add('empty', 'Empty', 0, true);
    expect(Number.isFinite(plan.read().fraction)).toBe(true);
    plan.finish('empty');
    expect(plan.read().complete).toBe(true);
  });

  it('does not climb while a steady download runs — read at 60fps', () => {
    // THE REGRESSION. Bytes land in bursts, so at frame rate most reads
    // see nothing arrive. Averaging those zeroes in dragged the rate
    // down and the ETA CLIMBED from 12s to 19s across a download that
    // was running perfectly — the estimate got worse the longer you
    // watched. Polled hard, with arrivals every fifth frame.
    const { plan, tick } = planAt();
    const total = 5_000_000;
    plan.add('file', 'File', total, true);
    let got = 0;
    const readings: number[] = [];
    for (let frame = 1; frame <= 300; frame++) {
      tick(1 / 60);
      // 1 MB/s, delivered in one chunk every fifth frame.
      if (frame % 5 === 0) { got += 1_000_000 / 12; plan.advance('file', got); }
      const left = plan.read().secondsLeft;
      if (left !== null && frame > 60) readings.push(left);
    }
    expect(readings.length).toBeGreaterThan(100);
    // Five megabytes at one a second, a second in: about four left, and
    // falling the whole way rather than drifting up.
    expect(readings[0]).toBeGreaterThan(2);
    expect(readings[0]).toBeLessThan(6);
    expect(readings[readings.length - 1]).toBeLessThan(readings[0]);
    for (let i = 1; i < readings.length; i++) {
      // Allowed to wobble a little; never allowed to trend upward.
      expect(readings[i]).toBeLessThan(readings[0] + 0.75);
    }
  });

  it('does not count the wait before the download as slowness', () => {
    // THE REGRESSION. The loading screen now waits for its own picture
    // to decode before the island starts arriving, so a plan can sit
    // for seconds with nothing moving. Counting that idle stretch as
    // throughput made the estimate jump thirty seconds the WRONG WAY
    // and then settle — which is the one thing an estimate may not do.
    const { plan, tick } = planAt();
    plan.add('file', 'File', 4_000_000, true);
    // Two seconds of the screen getting itself ready.
    for (let i = 0; i < 120; i++) { tick(1 / 60); plan.read(); }
    expect(plan.read().secondsLeft).toBeNull();
    // Then a steady megabyte a second.
    let got = 0;
    const readings: number[] = [];
    for (let i = 0; i < 180; i++) {
      tick(1 / 60);
      got += 1_000_000 / 60;
      plan.advance('file', got);
      const left = plan.read().secondsLeft;
      if (left !== null) readings.push(left);
    }
    expect(readings.length).toBeGreaterThan(60);
    // Four megabytes at one a second: the first honest reading is about
    // three and a half left, and it only ever falls.
    expect(readings[0]).toBeLessThan(5);
    for (let i = 1; i < readings.length; i++) {
      expect(readings[i]).toBeLessThan(readings[0] + 0.5);
    }
  });

  it('reads the same however often it is asked', () => {
    // `read()` samples the rate, so calling it twice in one frame used
    // to feed the estimator a zero-length interval and poison it.
    const { plan, tick } = planAt();
    plan.add('file', 'File', 1_000_000, true);
    let got = 0;
    for (let i = 0; i < 40; i++) {
      tick(0.05);
      got += 25_000;
      plan.advance('file', got);
      plan.read();
    }
    const once = plan.read().secondsLeft;
    for (let i = 0; i < 20; i++) plan.read();
    expect(plan.read().secondsLeft).toBeCloseTo(once as number, 6);
  });

  it('says nothing at all while the download is stalled', () => {
    // A blank is a fair description of a stall. A number sliding
    // upwards forever is not.
    const { plan, tick } = planAt();
    plan.add('file', 'File', 1_000_000, true);
    let got = 0;
    for (let i = 0; i < 20; i++) { tick(0.1); got += 50_000; plan.advance('file', got); plan.read(); }
    expect(plan.read().secondsLeft).not.toBeNull();
    for (let i = 0; i < 60; i++) { tick(0.1); plan.read(); }
    expect(plan.read().secondsLeft).toBeNull();
  });

  it('is not thrown by a work job finishing all at once', () => {
    // The terrain job completing between two samples looked like a
    // colossal burst of throughput and collapsed the ETA to 2s.
    const { plan, tick } = planAt();
    plan.add('file', 'File', 4_000_000, true);
    plan.add('work', 'Work', 300_000);
    let got = 0;
    for (let i = 0; i < 20; i++) { tick(0.1); got += 100_000; plan.advance('file', got); plan.read(); }
    const before = plan.read().secondsLeft as number;
    plan.finish('work');
    tick(0.1);
    const after = plan.read().secondsLeft as number;
    expect(Math.abs(after - before)).toBeLessThan(1.5);
  });

  it('holds the estimate steady rather than jittering per frame', () => {
    // The rate is eased, so one slow frame in a steady download must
    // not double the number the player is reading.
    const { plan, tick } = planAt();
    plan.add('file', 'File', 1_000_000, true);
    let got = 0;
    for (let i = 0; i < 20; i++) {
      tick(0.1);
      got += 20_000;
      plan.advance('file', got);
      plan.read();
    }
    const before = plan.read().secondsLeft as number;
    tick(0.1);            // a frame where nothing arrived
    plan.read();
    const after = plan.read().secondsLeft as number;
    expect(Math.abs(after - before)).toBeLessThan(before * 0.6);
  });
});
