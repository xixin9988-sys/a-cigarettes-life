import 'fake-indexeddb/auto';

// Global test polyfills for browser APIs used by main-thread modules.
if (typeof globalThis.structuredClone !== 'function') {
  // Node 17+ has structuredClone; guard for older runtimes.
  throw new Error('structuredClone is required for tests');
}
