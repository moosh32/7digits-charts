// Express adapter for the frozen API contract (docs/api-contract.md).
// Mounts the NEW contract routes (custom scans, watchlists v2, tabs, snapshot
// refresh) on the existing express app, reusing the shared framework-free
// handlers in worker/lib/handlers.mjs — the same code the Cloudflare worker
// runs. Existing legacy routes in server.mjs are left untouched.
import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeStore } from '../worker/lib/store.mjs';
import { requireApiAuth } from '../worker/lib/auth.mjs';
import * as H from '../worker/lib/handlers.mjs';
import * as A from '../worker/lib/alerts.mjs';
import { getSnapshot, refreshSnapshot } from './scans/snapshot.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UNIVERSE = JSON.parse(fs.readFileSync(new URL('./universe.json', import.meta.url), 'utf8'));
const STORE_DIR = process.env.STORE_DIR || path.join(__dirname, '..', 'data', 'store');

const store = makeStore({ STORE_DIR });

const deps = {
    env: process.env,
    store,
    getSnapshot,
    snapshotStatus: () => {
        const s = getSnapshot();
        return { asOf: s?.asOf || null, count: s ? Object.keys(s.feats || {}).length : 0 };
    },
    universe: UNIVERSE,
    twelvedataKey: (process.env.TWELVEDATA_KEY || '').trim(),
    // Express runs the real rebuild synchronously (node has no worker CPU limits).
    startRefresh: async () => {
        const ok = await refreshSnapshot();
        const s = getSnapshot();
        return { ok, asOf: s?.asOf || null, count: s ? Object.keys(s.feats || {}).length : 0 };
    },
};

const router = Router();

// requireApiAuth expects a Fetch-style request; adapt express req.
const authMw = (req, res, next) => {
    const err = requireApiAuth(
        { headers: { get: (k) => req.headers[String(k).toLowerCase()] || null } },
        process.env,
    );
    if (err) return res.status(err.status).json(err.body);
    next();
};

const send = (res, r) => res.status(r.status).json(r.body);

// ----- custom scans: run is public, saved scans are protected -----
router.post('/api/scan/run', async (req, res) => send(res, H.hCustomScanRun(req.body, deps)));
router.get('/api/scans/custom', authMw, async (req, res) => send(res, await H.hCustomList(deps)));
router.post('/api/scans/custom', authMw, async (req, res) => send(res, await H.hCustomCreate(req.body, deps)));
router.put('/api/scans/custom/:id', authMw, async (req, res) => send(res, await H.hCustomUpdate(req.params.id, req.body, deps)));
router.delete('/api/scans/custom/:id', authMw, async (req, res) => send(res, await H.hCustomDelete(req.params.id, deps)));
router.post('/api/scans/custom/:id/run', authMw, async (req, res) => send(res, await H.hCustomRunSaved(req.params.id, req.body, deps)));

// ----- watchlists v2 (protected) -----
router.get('/api/watchlists', authMw, async (req, res) => send(res, await H.hWatchlistsGet(deps)));
router.post('/api/watchlists', authMw, async (req, res) => send(res, await H.hWatchlistsCreate(req.body, deps)));
router.put('/api/watchlists/:id', authMw, async (req, res) => send(res, await H.hWatchlistsUpdate(req.params.id, req.body, deps)));
router.delete('/api/watchlists/:id', authMw, async (req, res) => send(res, await H.hWatchlistsDelete(req.params.id, deps)));

// ----- tabs (protected) -----
router.get('/api/tabs', authMw, async (req, res) => send(res, await H.hTabsGet(deps)));
router.put('/api/tabs', authMw, async (req, res) => send(res, await H.hTabsPut(req.body, deps)));

// ----- EOD alerts (protected) -----
router.get('/api/alerts', authMw, async (req, res) => send(res, await A.hAlertsList(deps)));
router.post('/api/alerts', authMw, async (req, res) => send(res, await A.hAlertsCreate(req.body, deps)));
router.get('/api/alerts/history', authMw, async (req, res) => send(res, await A.hAlertsHistory(deps)));
router.delete('/api/alerts/history', authMw, async (req, res) => send(res, await A.hAlertsHistoryClear(deps)));
router.post('/api/alerts/evaluate', authMw, async (req, res) => send(res, await A.hAlertsEvaluate(req.body || {}, deps)));
router.put('/api/alerts/:id', authMw, async (req, res) => send(res, await A.hAlertsUpdate(req.params.id, req.body, deps)));
router.delete('/api/alerts/:id', authMw, async (req, res) => send(res, await A.hAlertsDelete(req.params.id, deps)));

// ----- snapshot refresh (protected) -----
router.post('/api/snapshot/refresh', authMw, async (req, res) => send(res, await H.hSnapshotRefresh(deps)));

export default router;
