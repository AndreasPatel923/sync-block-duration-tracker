# sync-block-duration-tracker

Measures wall-clock time spent inside synchronous function bodies by wrapping them with `performance.now` samples around each call.

```js
import { SyncBlockTracker } from 'sync-block-duration-tracker';

const tracker = new SyncBlockTracker(); // uses performance.now by default
const compute = tracker.wrap('heavy', (n) => {
  let total = 0;
  for (let i = 0; i < n; i++) total += i;
  return total;
});

compute(1000);
compute(1000);

const s = tracker.stats('heavy');
// { calls: 2, totalMs, lastMs, maxMs, minMs, avgMs }

console.log(`avg ${s.avgMs} ms across ${s.calls} calls`);
```

## Why

Ad-hoc timing with `performance.now` sprinkled through call sites is easy to get wrong: forgotten `finally` blocks lose measurements when the timed function throws, and multiple sites drift apart. `SyncBlockTracker` centralises the sample/record logic in one wrapper and aggregates per logical block name (`calls`, `totalMs`, `lastMs`, `maxMs`, `minMs`, `avgMs`).

The trade-off is that only *synchronous* execution is measured. If the wrapped function `await`s, schedules a `setTimeout`, or returns a promise, the wrapper records the time until the function *returns*, not until the asynchronous work settles. Attempting to attribute async gaps from a synchronous wrapper is unreliable — the timing of continuations depends on the microtask queue, not the call that scheduled them — so this library deliberately does not try. For async work, use a tool that hooks into the event loop.

## Awkward edge

The constructor takes an optional `now: () => number` so tests can inject a fake clock instead of sleeping and asserting against real wall-clock time. If you pass your own, make sure it returns a *monotonic* millisecond value (like `performance.now`), not a `Date.now()`-style epoch in seconds, or `maxMs`/`minMs` comparisons will still work but the units in `totalMs` will be surprising.

## Performance

The window keeps a bounded buffer, so `push` is constant time and memory does not
grow with the length of the stream. `peak` and `trough` are linear in the window
size, which is the trade that keeps `push` cheap.

## Limitations

Values are coerced to floats, so very large integers lose precision. If you need
exact integer aggregates over a window, this is the wrong tool.

## Contributing

Issues and pull requests are welcome. Please keep the dependency list empty —
that constraint is the point of the project, not an oversight.

