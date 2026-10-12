// Snapshot provider registry — dependency-injection seam so that
// server/scans/definitions.mjs stays free of node: imports and can run inside
// a Cloudflare Worker. The express side registers its in-memory snapshot
// (server/scans/snapshot.mjs); the worker registers its own (memory + KV + asset).
let provider = null;

export function setSnapshotProvider(fn) { provider = fn; }
export function getSnapshot() { return provider ? provider() : null; }
