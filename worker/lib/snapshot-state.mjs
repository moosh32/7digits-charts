// Worker snapshot lifecycle.
// The worker cannot read data/scan-snapshot.json from disk; the file is served
// as a static asset (worker-assets/data/scan-snapshot.json) and fetched from
// the worker's own origin on cold start, then cached in memory.
// A KV value at 'snapshot:latest' (written by POST /api/snapshot/refresh)
// takes precedence over the asset. The asset is re-fetched in the background
// at most once per 6h; KV is re-checked on every cold load and each 6h cycle.
import { setSnapshotProvider } from '../../server/scans/snapshot-provider.mjs';

export const SNAPSHOT_REFRESH_MS = 6 * 60 * 60 * 1000;
export const SNAPSHOT_KV_KEY = 'snapshot:latest';

let memSnap = null;
let memSnapAt = 0;
let refreshInFlight = null;

setSnapshotProvider(() => memSnap);

async function fromKV(env) {
    try {
        const raw = await env.SEVEND_KV.get(SNAPSHOT_KV_KEY);
        if (!raw) return null;
        const snap = JSON.parse(raw);
        if (!snap || !snap.feats) return null;
        return snap;
    } catch {
        return null;
    }
}

async function fromAsset(env, origin) {
    const r = await env.ASSETS.fetch(new Request(new URL('/data/scan-snapshot.json', origin), {
        headers: { 'User-Agent': 'sevend-worker/1.0' },
    }));
    if (!r.ok) throw new Error(`snapshot asset ${r.status}`);
    const snap = await r.json();
    if (!snap || !snap.feats) throw new Error('snapshot asset malformed');
    return snap;
}

function adopt(snap) {
    memSnap = snap;
    memSnapAt = Date.now();
}

// (Re)load: KV first, then the static asset. Throws when neither works and
// there is no usable in-memory snapshot.
export async function loadSnapshot(env, origin) {
    if (env?.SEVEND_KV) {
        const kvSnap = await fromKV(env);
        if (kvSnap) { adopt(kvSnap); return memSnap; }
    }
    const assetSnap = await fromAsset(env, origin);
    adopt(assetSnap);
    return memSnap;
}

// Ensure a snapshot is available; on cold start this awaits the load, later it
// serves memory and refreshes stale data in the background (via ctx.waitUntil).
export async function ensureSnapshot(env, origin, ctx) {
    const stale = !memSnap || (Date.now() - memSnapAt > SNAPSHOT_REFRESH_MS);
    if (!memSnap) {
        await loadSnapshot(env, origin); // cold start: must have data
        return memSnap;
    }
    if (stale && ctx?.waitUntil && !refreshInFlight) {
        refreshInFlight = loadSnapshot(env, origin)
            .catch(() => null)
            .finally(() => { refreshInFlight = null; });
        ctx.waitUntil(refreshInFlight);
    }
    return memSnap;
}

// Called by POST /api/snapshot/refresh after a rebuild: persist to KV and memory.
export async function publishSnapshot(env, snap) {
    if (env?.SEVEND_KV) {
        await env.SEVEND_KV.put(SNAPSHOT_KV_KEY, JSON.stringify(snap));
    }
    adopt(snap);
    return snap;
}

export function snapshotStatus() {
    if (!memSnap) return { asOf: null, count: 0 };
    return { asOf: memSnap.asOf || null, count: Object.keys(memSnap.feats || {}).length };
}

// In-memory snapshot without triggering a load (for background refresh merging).
export function peekSnapshot() { return memSnap; }
