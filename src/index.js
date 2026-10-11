import { SyncBlockTracker } from './core.js';

/**
 * Public entry point.
 * We re-export SyncBlockTracker so consumers import from 'sync-block-duration-tracker'
 * without knowing the internal module layout. Keeping a single named export keeps the
 * API surface small and stable.
 */
export { SyncBlockTracker };
