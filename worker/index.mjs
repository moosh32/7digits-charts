// 7D Charts — Cloudflare Worker entry point.
// Single `fetch` handler implementing the frozen API contract
// (docs/api-contract.md). Web APIs only: no express, no node: imports.
// Static assets (frontend build + data/scan-snapshot.json + data/universe.json)
// are served from the configured `assets` directory (see wrangler.example.toml).
import { makeStore } from './lib/store.mjs';
import { requireApiAuth } from './lib/auth.mjs';
import {
    ensureSnapshot, snapshotStatus, publishSnapshot, peekSnapshot,
} from './lib/snapshot-state.mjs';
import * as H from './lib/handlers.mjs';

const json = (body, status = 200) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json; charset=utf-8' },
    });

// ---------- symbol universe (own-origin asset, memory-cached) ----------
let universeCache = null;
let universeAt = 0;
const UNIVERSE_TTL = 24 * 60 * 60 * 1000;

async function getUniverse(origin) {
    if (universeCache && Date.now() - universeAt < UNIVERSE_TTL) return universeCache;
    try {
        const r = await fetch(new URL('/data/universe.json', origin).toString());
        if (!r.ok) throw new Error(`universe asset ${r.status}`);
        const j = await r.json();
        if (!Array.isArray(j)) throw new Error('universe asset malformed');
        universeCache = j;
        universeAt = Date.now();
    } catch {
        universeCache = universeCache || [];
    }
    return universeCache;
}

async function readJson(request) {
    try {
        return await request.json();
    } catch {
        return { __badJson: true };
    }
}

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const { pathname } = url;
        const method = request.method.toUpperCase();
        const origin = url.origin;

        if (!pathname.startsWith('/api/')) {
            return json({ error: 'not found' }, 404);
        }

        // Snapshot + universe are lazy: cold start loads them, later requests
        // reuse memory (background refresh at most every 6h).
        let deps;
        try {
            await ensureSnapshot(env, origin, ctx);
            deps = {
                env,
                store: makeStore(env),
                getSnapshot: peekSnapshot,
                snapshotStatus,
                universe: await getUniverse(origin),
                twelvedataKey: (env.TWELVEDATA_KEY || '').trim(),
                startRefresh: () => {
                    // A full rebuild (4,400+ symbols) exceeds worker CPU limits;
                    // run it best-effort in the background and persist to KV.
                    // The reliable rebuild path is the node target (express /
                    // scripts), whose output is published as the static asset.
                    ctx.waitUntil((async () => {
                        const { buildSnapshot } = await import('./lib/scan-engine.mjs');
                        const snap = await buildSnapshot(peekSnapshot(), () => {});
                        await publishSnapshot(env, snap);
                    })().catch((e) => console.error('worker snapshot refresh failed:', e.message)));
                    return { accepted: true };
                },
            };
        } catch (e) {
            return json({ error: 'snapshot unavailable', detail: String(e.message || e).slice(0, 120) }, 503);
        }

        const need = (fn) => {
            const authErr = requireApiAuth(request, env);
            if (authErr) return json(authErr.body, authErr.status);
            return fn();
        };
        const qp = (k) => url.searchParams.get(k);

        try {
            // ----- market data (public) -----
            if (method === 'GET' && pathname === '/api/health') return json(...toTuple(H.hHealth(deps)));
            if (method === 'GET' && pathname === '/api/bars')
                return json(...toTuple(await H.hBars({ symbol: qp('symbol'), timeframe: qp('timeframe') }, deps)));
            if (method === 'GET' && pathname === '/api/search')
                return json(...toTuple(H.hSearch({ q: qp('q'), limit: qp('limit') }, deps)));
            if (method === 'GET' && pathname === '/api/quote')
                return json(...toTuple(await H.hQuote({ symbol: qp('symbol') }, deps)));
            if (method === 'GET' && pathname === '/api/quotes')
                return json(...toTuple(await H.hQuotes({ symbols: qp('symbols') }, deps)));

            // ----- scans -----
            if (method === 'POST' && pathname === '/api/scan/run') {
                const body = await readJson(request);
                if (body.__badJson) return json({ error: 'bad json' }, 400);
                return json(...toTuple(H.hCustomScanRun(body, deps)));
            }
            if (method === 'GET' && pathname === '/api/scans') return json(...toTuple(H.hScansList(deps)));

            const prebuilt = pathname.match(/^\/api\/scan\/([^/]+)$/);
            if (method === 'GET' && prebuilt)
                return json(...toTuple(H.hPrebuiltScan(decodeURIComponent(prebuilt[1]))));

            // ----- custom scans (protected) -----
            if (pathname === '/api/scans/custom' && method === 'GET')
                return need(async () => json(...toTuple(await H.hCustomList(deps))));
            if (pathname === '/api/scans/custom' && method === 'POST')
                return need(async () => {
                    const body = await readJson(request);
                    if (body.__badJson) return json({ error: 'bad json' }, 400);
                    return json(...toTuple(await H.hCustomCreate(body, deps)));
                });
            const cus = pathname.match(/^\/api\/scans\/custom\/([^/]+)(\/run)?$/);
            if (cus && method === 'PUT' && !cus[2])
                return need(async () => {
                    const body = await readJson(request);
                    if (body.__badJson) return json({ error: 'bad json' }, 400);
                    return json(...toTuple(await H.hCustomUpdate(decodeURIComponent(cus[1]), body, deps)));
                });
            if (cus && method === 'DELETE' && !cus[2])
                return need(async () => json(...toTuple(await H.hCustomDelete(decodeURIComponent(cus[1]), deps))));
            if (cus && method === 'POST' && cus[2])
                return need(async () => {
                    const body = await readJson(request);
                    if (body.__badJson) return json({ error: 'bad json' }, 400);
                    return json(...toTuple(await H.hCustomRunSaved(decodeURIComponent(cus[1]), body, deps)));
                });

            // ----- watchlists v2 (protected) -----
            if (pathname === '/api/watchlists' && method === 'GET')
                return need(async () => json(...toTuple(await H.hWatchlistsGet(deps))));
            if (pathname === '/api/watchlists' && method === 'POST')
                return need(async () => {
                    const body = await readJson(request);
                    if (body.__badJson) return json({ error: 'bad json' }, 400);
                    return json(...toTuple(await H.hWatchlistsCreate(body, deps)));
                });
            const wl = pathname.match(/^\/api\/watchlists\/([^/]+)$/);
            if (wl && method === 'PUT')
                return need(async () => {
                    const body = await readJson(request);
                    if (body.__badJson) return json({ error: 'bad json' }, 400);
                    return json(...toTuple(await H.hWatchlistsUpdate(decodeURIComponent(wl[1]), body, deps)));
                });
            if (wl && method === 'DELETE')
                return need(async () => json(...toTuple(await H.hWatchlistsDelete(decodeURIComponent(wl[1]), deps))));

            // ----- tabs (protected) -----
            if (pathname === '/api/tabs' && method === 'GET')
                return need(async () => json(...toTuple(await H.hTabsGet(deps))));
            if (pathname === '/api/tabs' && method === 'PUT')
                return need(async () => {
                    const body = await readJson(request);
                    if (body.__badJson) return json({ error: 'bad json' }, 400);
                    return json(...toTuple(await H.hTabsPut(body, deps)));
                });

            // ----- breadth -----
            if (pathname === '/api/breadth' && method === 'GET')
                return json(...toTuple(await H.hBreadthGet({ exchange: qp('exchange') }, deps)));
            if (pathname === '/api/breadth' && method === 'POST')
                return need(async () => {
                    const body = await readJson(request);
                    if (body.__badJson) return json({ error: 'bad json' }, 400);
                    return json(...toTuple(await H.hBreadthPost(body, deps)));
                });

            // ----- snapshot refresh (protected) -----
            if (pathname === '/api/snapshot/refresh' && method === 'POST')
                return need(async () => json(...toTuple(await H.hSnapshotRefresh(deps))));

            return json({ error: 'not found' }, 404);
        } catch (e) {
            return json({ error: 'internal error', detail: String(e.message || e).slice(0, 120) }, 500);
        }
    },
};

// helper: {status, body} -> [body, status] for the json() responder
function toTuple(r) {
    return [r.body, r.status];
}
