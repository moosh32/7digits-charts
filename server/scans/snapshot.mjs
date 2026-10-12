// Scans snapshot: node wrapper around the shared worker-compatible engine
// (worker/lib/scan-engine.mjs). Adds fs persistence + the refresh scheduler;
// the heavy lifting (fetching, feature math) lives in the shared modules so the
// Cloudflare worker can reuse it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setSnapshotProvider } from './snapshot-provider.mjs';
import {
    SNAP_VERSION, nasdaqDaily, fetchUniverse, fetchEtfUniverse,
    computeFeatures, buildSnapshot,
} from '../../worker/lib/scan-engine.mjs';

// Re-exported for scripts/merge-etfs.mjs and any other node consumers.
export { SNAP_VERSION, nasdaqDaily, fetchUniverse, fetchEtfUniverse, computeFeatures };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const SNAP_PATH = path.join(DATA_DIR, 'scan-snapshot.json');

// ---------- snapshot lifecycle ----------
let snapshot = null; // { asOf, feats: { sym: f }, etfFeats, spyPerf63 }
let refreshing = false;

export function getSnapshot() { return snapshot; }
setSnapshotProvider(getSnapshot);

function save() {
    try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(SNAP_PATH, JSON.stringify(snapshot));
    } catch (e) { console.error('scan snapshot save failed', e.message); }
}
function load() {
    try {
        if (fs.existsSync(SNAP_PATH)) {
            snapshot = JSON.parse(fs.readFileSync(SNAP_PATH, 'utf8'));
            console.log(`scan snapshot loaded: ${Object.keys(snapshot.feats).length} stocks + ${Object.keys(snapshot.etfFeats || {}).length} ETFs, asOf ${snapshot.asOf}`);
        }
    } catch (e) { console.error('scan snapshot load failed', e.message); }
}

export async function refreshSnapshot() {
    if (refreshing) return false;
    refreshing = true;
    try {
        snapshot = await buildSnapshot(snapshot, console.log);
        save();
        return true;
    } catch (e) {
        console.error('scan snapshot refresh failed:', e.message);
        return false;
    } finally {
        refreshing = false;
    }
}

export function startScanEngine() {
    load();
    if (!snapshot || snapshot.v !== SNAP_VERSION) {
        console.log(`scan snapshot v${snapshot?.v} != code v${SNAP_VERSION} — rebuilding…`);
        setTimeout(() => refreshSnapshot(), 5000);
    }
    setInterval(() => refreshSnapshot(), 4 * 60 * 60 * 1000);
}
