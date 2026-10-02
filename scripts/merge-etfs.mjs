// One-off: merge ETF features into data/scan-snapshot.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchEtfUniverse, nasdaqDaily, computeFeatures } from '../server/scans/snapshot.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SNAP = path.join(__dirname, '..', 'data', 'scan-snapshot.json');

const snap = JSON.parse(fs.readFileSync(SNAP, 'utf8'));
const etfUni = (await fetchEtfUniverse()).filter((u) => !snap.feats[u.s]);
console.log('ETFs to fetch:', etfUni.length, new Date().toISOString());

const etfFeats = {};
let done = 0, i = 0;
const CONC = 20;
const workers = Array.from({ length: CONC }, async () => {
    while (i < etfUni.length) {
        const u = etfUni[i++];
        try {
            const { bars } = await nasdaqDaily(u.s, true);
            const n = ++done;
            if (n % 500 === 0) console.log(`${n}/${etfUni.length}`, new Date().toISOString());
            if (!bars.length) continue;
            const f = computeFeatures(u.s, u.n, bars, { etf: true });
            if (f) etfFeats[f.s] = f;
        } catch { /* skip */ }
    }
});
await Promise.all(workers);
snap.etfFeats = etfFeats;
snap.asOf = new Date().toISOString();
fs.writeFileSync(SNAP, JSON.stringify(snap));
console.log('ETFs saved:', Object.keys(etfFeats).length, new Date().toISOString());
