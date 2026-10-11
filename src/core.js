/**
 * SyncBlockTracker measures wall-clock time spent inside synchronous function bodies.
 *
 * The key design decision: the clock is injected via the constructor, not imported from
 * the environment. Tests therefore never sleep or assert on real time. Production callers
 * pass `performance.now` (or any () => number function returning a millisecond value);
 * tests pass a controlled counter and reason about deltas.
 *
 * Another deliberate decision: wrap() measures only the synchronous portion of execution
 * it observes. If a wrapped function is entered (a call recorded), then later awaited or
 * called again, only the time between each entry and its matching exit is summed. We do
 * NOT attempt to attribute async gaps; a wrapper that tried to honour both sync and async
 * semantics ends up doing neither well. The README states this limitation plainly.
 */
export class SyncBlockTracker {
  /**
   * @param {() => number} now - Returns a monotonic millisecond timestamp. Injected so
   *   tests are deterministic. Defaults to performance.now when omitted; the default is
   *   applied here rather than in the field initializer so a truthy user-supplied
   *   function is never accidentally shadowed by the global.
   */
  constructor(now = undefined) {
    // We don't call performance.now directly; the indirection lets tests supply a fake.
    this._now = now ?? (typeof performance !== 'undefined' ? performance.now.bind(performance) : Date.now);
    /** @type {Map<string, {calls: number, totalMs: number, lastMs: number, maxMs: number, minMs: number}>} */
    this._blocks = new Map();
  }

  /**
   * Wraps a synchronous function. Each call to the returned function runs the original
   * between clock samples and records the elapsed duration.
   *
   * We intentionally close over `this` and the block name at wrap-time, so the returned
   * function carries no hidden state of its own and can be passed around freely.
   *
   * @param {string} blockName - Logical name under which measurements are aggregated.
   * @param {(...args: any[]) => any} fn - The synchronous function to instrument.
   * @returns {(...args: any[]) => any} A wrapper with identical call signature.
   * @throws {TypeError} If blockName is not a non-empty string or fn is not a function.
   */
  wrap(blockName, fn) {
    if (typeof blockName !== 'string' || blockName.length === 0) {
      throw new TypeError('blockName must be a non-empty string');
    }
    if (typeof fn !== 'function') {
      throw new TypeError('fn must be a function');
    }
    const now = this._now;
    const self = this;
    return function wrapped(...args) {
      const start = now();
      try {
        return fn.apply(this, args);
      } finally {
        // `finally` is the whole reason this wrapper is safe: an exception thrown by fn
        // still produces a measurement, and we don't swallow the exception.
        const end = now();
        self._record(blockName, end - start);
      }
    };
  }

  /**
   * Internal: aggregate a sample for a block. Kept private-ish (underscore) so the
   * external contract is just `wrap`, `stats`, `reset`, and `names`.
   *
   * We compute min/max by comparison rather than via Math.min/Math.max on a stored array
   * because we don't want to keep per-call history in memory — a long-running process
   * would grow unbounded.
   * @param {string} blockName
   * @param {number} elapsedMs
   */
  _record(blockName, elapsedMs) {
    let block = this._blocks.get(blockName);
    if (block === undefined) {
      // First observation of this block. Initialize so min/max comparisons have a
      // sensible baseline rather than NaN from an empty aggregate.
      block = {
        calls: 0,
        totalMs: 0,
        lastMs: 0,
        maxMs: -Infinity,
        minMs: Infinity,
      };
      this._blocks.set(blockName, block);
    }
    block.calls += 1;
    block.lastMs = elapsedMs;
    block.totalMs += elapsedMs;
    if (elapsedMs > block.maxMs) block.maxMs = elapsedMs;
    if (elapsedMs < block.minMs) block.minMs = elapsedMs;
  }

  /**
   * Returns aggregated stats for a block, or null if never observed.
   *
   * `avgMs` is derived from total/calls. We return -Infinity/Infinity for max/min
   * only for never-observed blocks, but since we return null in that case the caller
   * won't see them. For observed blocks with zero elapsed time the numbers are real 0s.
   *
   * @param {string} blockName
   * @returns {{calls:number, totalMs:number, lastMs:number, maxMs:number, minMs:number, avgMs:number} | null}
   */
  stats(blockName) {
    const block = this._blocks.get(blockName);
    if (block === undefined) return null;
    return {
      calls: block.calls,
      totalMs: block.totalMs,
      lastMs: block.lastMs,
      maxMs: block.maxMs,
      minMs: block.minMs,
      avgMs: block.calls > 0 ? block.totalMs / block.calls : 0,
    };
  }

  /**
   * @returns {string[]} Block names in insertion order. We rely on Map iteration order,
   *   which is specified and stable, so `reset`-then-`wrap`-again yields a predictable
   *   listing for tests.
   */
  names() {
    return [...this._blocks.keys()];
  }

  /**
   * Clears all recorded measurements. The tracker instance remains usable.
   */
  reset() {
    this._blocks.clear();
  }
}
