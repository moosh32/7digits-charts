// One-off / periodic: prepare worker-assets/ for the Cloudflare worker.
//  - copies data/scan-snapshot.json -> worker-assets/data/scan-snapshot.json
//  - copies server/universe.json   -> worker-assets/data/universe.json
//  - injects top-level spyPerf63 (needed for the rs63vsSpy custom-scan field)
//    by fetching SPY daily bars once, and bumps the snapshot version to
//    SNAP_VERSION so the express loader accepts it without a full rebuild.
// Run: node scripts/prepare-worker-assets.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SNAP_VERSION, nasdaqDaily } from '../worker/lib/scan-engine.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SRC_SNAP = path.join(ROOT, 'data', 'scan-snapshot.json');
const DST_DIR = path.join(ROOT, 'worker-assets', 'data');
const DST_SNAP = path.join(DST_DIR, 'scan-snapshot.json');
const DST_UNI = path.join(DST_DIR, 'universe.json');

fs.mkdirSync(DST_DIR, { recursive: true });

const snap = JSON.parse(fs.readFileSync(SRC_SNAP, 'utf8'));
console.log(`snapshot: ${Object.keys(snap.feats || {}).length} feats, v${snap.v}, spyPerf63=${snap.spyPerf63}`);

if (snap.spyPerf63 == null) {
    try {
        const { bars } = await nasdaqDaily('SPY');
        if (bars.length > 64) {
            const a = bars[bars.length - 1].close, b = bars[bars.length - 64].close;
            if (b > 0) {
                snap.spyPerf63 = (a / b - 1) * 100;
                console.log(`injected spyPerf63=${snap.spyPerf63.toFixed(2)}`);
            }
        }
    } catch (e) {
        console.warn('SPY fetch failed, leaving spyPerf63 unset:', e.message);
    }
}

if (snap.spyPerf63 != null) {
    snap.v = SNAP_VERSION;
    // write back so the express loader accepts it without triggering a rebuild
    fs.writeFileSync(SRC_SNAP, JSON.stringify(snap));
    console.log(`bumped ${SRC_SNAP} to v${SNAP_VERSION}`);
} else {
    console.warn('spyPerf63 unavailable — keeping version, rs63vsSpy will be null until a full rebuild');
}

fs.writeFileSync(DST_SNAP, JSON.stringify(snap));
console.log('wrote', DST_SNAP, `${(fs.statSync(DST_SNAP).size / 1048576).toFixed(1)}MB`);

fs.copyFileSync(path.join(ROOT, 'server', 'universe.json'), DST_UNI);
console.log('wrote', DST_UNI, `${(fs.statSync(DST_UNI).size / 1024).toFixed(0)}KB`);
