import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SyncBlockTracker } from '../src/index.js';

/**
 * Builds a fake clock whose `now()` advances by a fixed amount on each call. We return a
 * mutable object so individual tests can tune the step mid-test if needed. The counter is
 * incremental, so a wrapped function that calls the clock once at entry and once at exit
 * produces a delta of exactly `step` per invocation — no real time, no flakiness.
 */
function fakeClock(initialStep = 5) {
  let t = 0;
  let step = initialStep;
  return {
    now: () => {
      t += step;
      return t;
    },
    setStep: (s) => { step = s; },
    reset: () => { t = 0; step = initialStep; },
    raw: () => t,
  };
}

test('wrap records elapsed time for a single call', () => {
  const clock = fakeClock(5);
  const t = new SyncBlockTracker(clock.now);
  const wrapped = t.wrap('compute', (x) => x * 2);
  const result = wrapped(21);
  assert.equal(result, 42);
  const s = t.stats('compute');
  assert.equal(s.calls, 1);
  // One entry + one exit => delta of 5.
  assert.equal(s.lastMs, 5);
  assert.equal(s.totalMs, 5);
  assert.equal(s.maxMs, 5);
  assert.equal(s.minMs, 5);
  assert.equal(s.avgMs, 5);
});

test('wrap aggregates across multiple calls', () => {
  const clock = fakeClock(10);
  const t = new SyncBlockTracker(clock.now);
  const wrapped = t.wrap('loop', (n) => n + 1);
  wrapped(0); // 10
  wrapped(1); // 10
  wrapped(2); // 10
  const s = t.stats('loop');
  assert.equal(s.calls, 3);
  assert.equal(s.totalMs, 30);
  assert.equal(s.avgMs, 10);
});

test('wrap tracks min and max distinct from last', () => {
  const clock = fakeClock(5);
  const t = new SyncBlockTracker(clock.now);
  const wrapped = t.wrap('varied', () => {});
  wrapped(); // step 5
  clock.setStep(2);
  wrapped(); // step 2
  clock.setStep(8);
  wrapped(); // step 8
  const s = t.stats('varied');
  assert.equal(s.minMs, 2);
  assert.equal(s.maxMs, 8);
  assert.equal(s.lastMs, 8);
  assert.equal(s.totalMs, 15);
});

test('wrap preserves return value of the wrapped function', () => {
  const clock = fakeClock(1);
  const t = new SyncBlockTracker(clock.now);
  const wrapped = t.wrap('echo', (v) => v);
  assert.equal(wrapped('hello'), 'hello');
  assert.deepEqual(wrapped({ a: 1 }), { a: 1 });
});

test('wrap preserves `this` binding through the wrapper', () => {
  const clock = fakeClock(1);
  const t = new SyncBlockTracker(clock.now);
  const obj = { base: 100, add(n) { return this.base + n; } };
  obj.add = t.wrap('method', obj.add);
  assert.equal(obj.add(5), 105);
});

test('wrap records duration even when the wrapped function throws', () => {
  const clock = fakeClock(7);
  const t = new SyncBlockTracker(clock.now);
  const boom = t.wrap('crash', () => { throw new Error('nope'); });
  assert.throws(() => boom(), /nope/);
  const s = t.stats('crash');
  assert.equal(s.calls, 1);
  assert.equal(s.totalMs, 7);
});

test('wrap distinguishes multiple independent block names', () => {
  const clock = fakeClock(3);
  const t = new SyncBlockTracker(clock.now);
  const a = t.wrap('alpha', () => 'a');
  const b = t.wrap('beta', () => 'b');
  a();
  b();
  b();
  assert.deepEqual(t.names(), ['alpha', 'beta']);
  assert.equal(t.stats('alpha').calls, 1);
  assert.equal(t.stats('beta').calls, 2);
  assert.equal(t.stats('beta').totalMs, 6);
});

test('stats returns null for an unobserved block', () => {
  const clock = fakeClock(1);
  const t = new SyncBlockTracker(clock.now);
  assert.equal(t.stats('never'), null);
});

test('names returns empty array before any wraps', () => {
  const clock = fakeClock(1);
  const t = new SyncBlockTracker(clock.now);
  assert.deepEqual(t.names(), []);
});

test('reset clears recorded measurements but the tracker remains usable', () => {
  const clock = fakeClock(4);
  const t = new SyncBlockTracker(clock.now);
  const wrapped = t.wrap('once', () => 1);
  wrapped();
  assert.equal(t.stats('once').calls, 1);
  t.reset();
  assert.deepEqual(t.names(), []);
  assert.equal(t.stats('once'), null);
  // Reusing after reset works and is recorded fresh.
  wrapped();
  assert.equal(t.stats('once').calls, 1);
});

test('wrap throws TypeError for empty blockName', () => {
  const clock = fakeClock(1);
  const t = new SyncBlockTracker(clock.now);
  assert.throws(() => t.wrap('', () => {}), /non-empty string/);
});

test('wrap throws TypeError when blockName is not a string', () => {
  const clock = fakeClock(1);
  const t = new SyncBlockTracker(clock.now);
  assert.throws(() => t.wrap(123, () => {}), /non-empty string/);
  assert.throws(() => t.wrap(undefined, () => {}), /non-empty string/);
});

test('wrap throws TypeError when fn is not a function', () => {
  const clock = fakeClock(1);
  const t = new SyncBlockTracker(clock.now);
  assert.throws(() => t.wrap('ok', null), /must be a function/);
  assert.throws(() => t.wrap('ok', 'notafn'), /must be a function/);
});

test('default clock is used when none is supplied', () => {
  // We don't assert on real wall-clock values; we only verify the constructor doesn't
  // throw and that wrap/stats work end-to-end with whatever clock the environment gives.
  const t = new SyncBlockTracker();
  const wrapped = t.wrap('default', (x) => x);
  assert.equal(wrapped(7), 7);
  const s = t.stats('default');
  assert.equal(s.calls, 1);
  // elapsed is a non-negative finite number; we don't compare to a literal.
  assert.ok(Number.isFinite(s.lastMs));
  assert.ok(s.lastMs >= 0);
});
