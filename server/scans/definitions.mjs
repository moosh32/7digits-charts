// Scanner definitions: pure predicates over precomputed features.
// Criteria are taken verbatim from the sources researched 2026-10-01:
//  Q = Qullamaggie (TC2000 scans, 2017 + 2026 flag video)
//  S = Stokbee/Pradeep Bonde (EP9M article, 4% indicator, TraderLion interview)
//  R = Israel's own #סורקים channel (36 scanners, exact criteria)
//  setups = the 7-DIGITS Discord setup channels + lessons
import { getSnapshot } from './snapshot.mjs';

const M = 1_000_000;
const money = (v) => v >= 1e9 ? (v / 1e9).toFixed(1) + 'B' : v >= M ? (v / M).toFixed(1) + 'M' : Math.round(v / 1000) + 'K';
const pct = (v) => v == null ? '—' : v.toFixed(1) + '%';
const dvol = (f) => `$${money(f.dvol20)}`;
const has = (...vs) => vs.every((v) => v != null);

// Each scanner: id, name (Hebrew), groups, desc (Hebrew criteria), approx,
// sort ('chg'|'relVol'|'dvol'|custom field), run(f) -> { pass, detail, sort }
const SCANNERS = [
    // ---------------- QULLAMAGGIE ----------------
    {
        id: 'q-adr', name: 'ADR לדגלים', groups: ['qullamaggie'],
        desc: 'מחזור דולרי ממוצע $15M+, תנודתיות חודשית 5%+. יקום המניות שמהן קולמאגי מחפש דגלים.',
        run(f) {
            if (!has(f.mvol)) return null;
            return {
                pass: f.dvol20 >= 15 * M && f.mvol >= 5,
                detail: `${dvol(f)} · תנודתיות חודשית ${pct(f.mvol)}`,
                sort: f.dvol20,
            };
        },
    },
    {
        id: 'q-trend', name: 'Trend Intensity', groups: ['qullamaggie'],
        desc: 'EMA7 מעל 5% מ־EMA60 (קולמאגי המקורי: 8% מעל EMA65). מניות בעלות מומנטום חזק ביותר.',
        run(f) {
            if (!has(f.ema7, f.ema60)) return null;
            const ti = (f.ema7 / f.ema60 - 1) * 100;
            return { pass: ti >= 5, detail: `EMA7 מעל EMA60 ב־${ti.toFixed(1)}%`, sort: ti };
        },
    },
    {
        id: 'q-g1', name: 'Gainers חודש (+25%)', groups: ['qullamaggie'],
        desc: 'ביצועי חודש +25% ומעלה, מחזור דולרי $15M+.',
        run(f) {
            if (!has(f.perf21)) return null;
            return { pass: f.perf21 >= 25 && f.dvol20 >= 15 * M, detail: `חודש ${pct(f.perf21)} · ${dvol(f)}`, sort: f.perf21 };
        },
    },
    {
        id: 'q-g3', name: 'Gainers 3 חודשים (+25%)', groups: ['qullamaggie'],
        desc: 'ביצועי 3 חודשים +25% ומעלה, מחזור דולרי $15M+.',
        run(f) {
            if (!has(f.perf63)) return null;
            return { pass: f.perf63 >= 25 && f.dvol20 >= 15 * M, detail: `3 חודשים ${pct(f.perf63)} · ${dvol(f)}`, sort: f.perf63 };
        },
    },
    {
        id: 'q-g6', name: 'Gainers 6 חודשים (+25%)', groups: ['qullamaggie'],
        desc: 'ביצועי 6 חודשים +25% ומעלה, מחזור דולרי $15M+.',
        run(f) {
            if (!has(f.perf126)) return null;
            return { pass: f.perf126 >= 25 && f.dvol20 >= 15 * M, detail: `6 חודשים ${pct(f.perf126)} · ${dvol(f)}`, sort: f.perf126 };
        },
    },
    {
        id: 'q-g12', name: 'Gainers שנה (+50%)', groups: ['qullamaggie'],
        desc: 'הגיינריות הגדולות של השנה: +50% ומעלה ב־12 חודשים.',
        run(f) {
            if (!has(f.perf252)) return null;
            return { pass: f.perf252 >= 50, detail: `שנה ${pct(f.perf252)}`, sort: f.perf252 };
        },
    },
    {
        id: 'q-breakout', name: 'Breakout היום', groups: ['qullamaggie'],
        desc: 'שינוי יומי 4%+, תנודתיות חודשית 5%+, +25% ב־6 חודשים, מחזור דולרי $15M+.',
        run(f) {
            if (!has(f.mvol, f.perf126)) return null;
            return {
                pass: f.chg >= 4 && f.mvol >= 5 && f.perf126 >= 25 && f.dvol20 >= 15 * M,
                detail: `היום ${pct(f.chg)} · 6 חודשים ${pct(f.perf126)} · נפח יחסי ${f.relVol.toFixed(1)}`,
                sort: f.relVol,
            };
        },
    },
    // ---------------- STOKBEE ----------------
    {
        id: 'sb-ep9m', name: 'EP 9 Million', groups: ['stokbee'],
        desc: 'הסריקה היחידה של סטוקבי ל־EP: נפח מניות 8.9M+ ומחיר $3+. טביעת רגל מוסדית.',
        run(f) {
            return { pass: f.vol >= 8_900_000 && f.price >= 3, detail: `נפח ${(f.vol / M).toFixed(1)}M מניות · מחיר $${f.price.toFixed(2)}`, sort: f.vol };
        },
    },
    {
        id: 'sb-4pct', name: '4% BO (לונג)', groups: ['stokbee'],
        desc: 'שינוי יומי מעל 4%, נפח היום גבוה מאתמול, נפח 100K+.',
        run(f) {
            if (!has(f.avgV20)) return null;
            return {
                pass: f.chg > 4 && f.vol > f.volPrev && f.vol > 100_000,
                detail: `היום ${pct(f.chg)} · נפח יחסי ${f.relVol.toFixed(1)}`,
                sort: f.relVol,
            };
        },
    },
    {
        id: 'sb-4pct-bear', name: '4% BO (שורט)', groups: ['stokbee'],
        desc: 'גרסת השורט: שינוי יומי מתחת ל־4%-, נפח היום גבוה מאתמול, נפח 100K+.',
        run(f) {
            if (!has(f.avgV20)) return null;
            return {
                pass: f.chg < -4 && f.vol > f.volPrev && f.vol > 100_000,
                detail: `היום ${pct(f.chg)} · נפח יחסי ${f.relVol.toFixed(1)}`,
                sort: f.chg,
            };
        },
    },
    {
        id: 'sb-momburst', name: 'Momentum Burst', groups: ['stokbee'],
        desc: 'רגל ראשונה של 15%+ ב־5 ימים, נרות צמודים, נסגר ליד השיא. ההחזקה: 3–5 ימים.',
        approx: 'ה"נרות צמודים" של סטוקבי הם שיפוט ויזואלי — מקורב כטווח 10 ימים מתון וסגירה ליד השיא.',
        run(f) {
            if (!has(f.perf5, f.hi5)) return null;
            return {
                pass: f.perf5 >= 15 && f.range10 <= 18 && f.price >= f.hi5 * 0.95,
                detail: `5 ימים ${pct(f.perf5)} · טווח 10j ${pct(f.range10)}`,
                sort: f.perf5,
            };
        },
    },
    {
        id: 'sb-anticipation', name: 'Anticipation', groups: ['stokbee'],
        desc: 'עליה של 15%+ ב־3 חודשים ואז התכנסות 1–3 שבועות עם ייבוש נפח (מתחת ל־60% מהממוצע).',
        approx: 'חלון ההתכנסות וה"מהלך הראשון" של סטוקבי הם שיפוט ויזואלי — מקורב כטווח 10 ימים מתון + נפח יבש.',
        run(f) {
            if (!has(f.perf63, f.avgV15, f.avgV60)) return null;
            return {
                pass: f.perf63 >= 15 && f.range10 <= 10 && f.avgV15 <= 0.6 * f.avgV60,
                detail: `3 חודשים ${pct(f.perf63)} · טווח 10j ${pct(f.range10)} · נפח ${Math.round(f.avgV15 / f.avgV60 * 100)}% מהממוצע`,
                sort: f.perf63,
            };
        },
    },
    // ---------------- SETUPS ----------------
    {
        id: 'ep', name: 'EP — Episodic Pivot', groups: ['setups', 'qullamaggie'],
        desc: 'גאפ 10%+, נפח יחסי 2+, מחיר מעל $10, נפח ממוצע 500K+. הסטאפ של קולמאגי ושל הדיסקורד.',
        run(f) {
            if (!has(f.avgV20)) return null;
            return {
                pass: f.gap >= 10 && f.relVol >= 2 && f.price > 10 && f.avgV20 > 500_000,
                detail: `גאפ ${pct(f.gap)} · נפח יחסי ${f.relVol.toFixed(1)}`,
                sort: f.relVol,
            };
        },
    },
    {
        id: 'parabolic-long', name: 'פרבוליק לונג', groups: ['setups'],
        desc: 'התרחבות פרבולית: +40% בחודש על נפח מוסדי. האות לקצר — רק אחרי הקלימקס.',
        approx: 'לערוץ אין כלל מספרי ללונג; הקריטריון הוא הרחבה של הגדרת השורט של החדר (#29).',
        run(f) {
            if (!has(f.perf21)) return null;
            return {
                pass: f.perf21 >= 40 && f.dvol20 >= 10 * M,
                detail: `חודש ${pct(f.perf21)} · ${dvol(f)}`,
                sort: f.perf21,
            };
        },
    },
    {
        id: 'parabolic-short', name: 'פרבוליק שורט (#29)', groups: ['setups'],
        desc: 'מחיר 50%+ מעל ממוצע 20 (הגדרת חדר #סורקים 29). מניות קלימקס להיפוך.',
        run(f) {
            if (!has(f.sma20)) return null;
            const ext = (f.price / f.sma20 - 1) * 100;
            return {
                pass: ext >= 50,
                detail: `${ext.toFixed(0)}% מעל SMA20 · ימים ירוקים רצופים: ${f.upDays}`,
                sort: ext,
            };
        },
    },
    {
        id: 'undercut-rally', name: 'אנדרקט וראלי', groups: ['setups'],
        desc: 'שבירה מתחת לשפל 20 הימים ואז חזרה מעליו — מלכודת שורט שהתהפכה.',
        approx: 'קירוב יומי של המבנה: שבירת שפל 20 הימים (למעט 5 הימים האחרונים) וסגירה מעליו.',
        run(f) {
            if (!has(f.loPrev, f.lo5)) return null;
            return {
                pass: f.lo5 < f.loPrev && f.price > f.loPrev,
                detail: `שברה שפל ${f.loPrev.toFixed(2)} וחזרה מעליו`,
                sort: (f.price / f.loPrev - 1) * 100,
            };
        },
    },
    {
        id: 'ipo-base', name: 'IPO Base', groups: ['setups'],
        desc: 'הנפקה בתוך 2 שנות מסחר, בתוך 15% מהשיא ההיסטורי, מחזור דולרי $5M+.',
        approx: 'גיל ההנפקה מקורב מאורך היסטוריית הנתונים; מבנה הבסיס דורש שיפוט גרף.',
        run(f) {
            return {
                pass: f.bars <= 500 && f.price >= f.hiAll * 0.85 && f.dvol20 >= 5 * M,
                detail: `בתוך ${Math.round((1 - f.price / f.hiAll) * 100)}% מהשיא · ${dvol(f)}`,
                sort: f.price / f.hiAll,
            };
        },
    },
    {
        id: 'flat-base', name: 'בסיס שטוח', groups: ['setups'],
        desc: 'עליה 25%+ ב־6 חודשים, טווח 30 יום מתון 15% ומטה, שפלים עולים, נסגר ליד שיא 30 הימים.',
        approx: 'קירוב כמותי של "בסיס שטוח עם שפלים עולים" לפי השיעור בדיסקורד — המבנה המדויק דורש גרף.',
        run(f) {
            if (!has(f.perf126, f.lo10, f.loPrev, f.hi30)) return null;
            return {
                pass: f.perf126 >= 25 && f.range30 <= 15 && f.lo10 > f.loPrev && f.price >= f.hi30 * 0.95,
                detail: `6 חודשים ${pct(f.perf126)} · טווח 30j ${pct(f.range30)}`,
                sort: f.perf126,
            };
        },
    },
    {
        id: 'pullback', name: 'פולבק', groups: ['setups'],
        desc: 'חוזקה קודמת (+30% ב־3 חודשים), בתוך 15% משיא 60 הימים, נגעה ב־EMA20/SMA50 וחוזרת.',
        approx: 'קירוב יומי של מבנה הפולבק לפי השיעור בדיסקורד — נקודת הכניסה המדויקת על הגרף.',
        run(f) {
            if (!has(f.perf63, f.ema20, f.sma50, f.hi60, f.lo5)) return null;
            const ma = Math.min(f.ema20, f.sma50);
            const touched = Math.abs(f.lo5 - f.ema20) / f.ema20 <= 0.03 || Math.abs(f.lo5 - f.sma50) / f.sma50 <= 0.03;
            return {
                pass: f.perf63 >= 30 && f.price >= f.hi60 * 0.85 && touched && f.price >= ma * 0.98,
                detail: `3 חודשים ${pct(f.perf63)} · נגעה בממוצע, חזרה מעליו`,
                sort: f.perf63,
            };
        },
    },
    {
        id: 'hvc', name: 'HVC', groups: ['setups'],
        desc: 'סגירה ברבע העליון של הנר על נפח יחסי 1.5+ — קנייה אגרסיבית בסוף היום.',
        approx: 'לערוץ HVC אין שיעור/הגדרה כתובה — קירוב לוגי של "סגירה חזקה בנפח גבוה".',
        run(f) {
            if (!has(f.dayHigh, f.dayLow, f.relVol)) return null;
            const rng = f.dayHigh - f.dayLow;
            const pos = rng > 0 ? (f.price - f.dayLow) / rng : 0;
            return {
                pass: pos >= 0.85 && f.relVol >= 1.5 && f.chg > 0,
                detail: `נסגר ב־${Math.round(pos * 100)}% עליון של הנר · נפח יחסי ${f.relVol.toFixed(1)}`,
                sort: f.relVol,
            };
        },
    },
    {
        id: 'low-cheat', name: 'Low Cheat', groups: ['setups'],
        desc: 'התהדקות בשליש התחתון של הבסיס: בתוך 40% התחתונים של טווח 90 הימים, טווח 10 ימים 8% ומטה, נפח יבש.',
        approx: 'קירוב כמותי של "התהדקות בשליש התחתון" לפי השיעור בדיסקורד.',
        run(f) {
            if (!has(f.hi90, f.lo90, f.avgV15, f.avgV40)) return null;
            const rng = f.hi90 - f.lo90;
            const pos = rng > 0 ? (f.price - f.lo90) / rng : 1;
            return {
                pass: pos <= 0.4 && f.range10 <= 8 && f.avgV15 <= 0.85 * f.avgV40,
                detail: `ב־${Math.round(pos * 100)}% התחתון של טווח 90j · טווח 10j ${pct(f.range10)}`,
                sort: -f.range10,
            };
        },
    },
    {
        id: 'htf', name: 'HTF — דגל צמוד גבוה', groups: ['setups'],
        desc: 'ריצה של 50%+ ב־3 חודשים ואז דגל צמוד: טווח 10 ימים 10% ומטה, נסגר ליד שיא 60 הימים.',
        approx: 'קירוב יומי של מבנה הדגל — הדגל האמיתי נראה על הגרף.',
        run(f) {
            if (!has(f.perf63, f.hi60)) return null;
            return {
                pass: f.perf63 >= 50 && f.range10 <= 10 && f.price >= f.hi60 * 0.9,
                detail: `3 חודשים ${pct(f.perf63)} · טווח 10j ${pct(f.range10)}`,
                sort: f.perf63,
            };
        },
    },
    {
        id: 'htp', name: 'HTP', groups: ['setups'],
        desc: 'ריצה של 25–60% בחודש, התהדקות ליד השיאים: טווח 10 ימים 12% ומטה, בתוך 8% משיא 30 הימים.',
        approx: 'קירוב כמותי של מבנה ה־HTP לפי השיעור בדיסקורד.',
        run(f) {
            if (!has(f.perf21, f.hi30)) return null;
            return {
                pass: f.perf21 >= 25 && f.perf21 <= 60 && f.range10 <= 12 && f.price >= f.hi30 * 0.92,
                detail: `חודש ${pct(f.perf21)} · טווח 10j ${pct(f.range10)}`,
                sort: f.perf21,
            };
        },
    },
    {
        id: 'vcp', name: 'VCP', groups: ['setups'],
        desc: 'התכווצות תנודתיות: טווח 10 הימים קטן מ־70% מטווח 30 הימים, נפח מתייבש, ליד שיא 60 הימים.',
        approx: 'קירוב כמותי של התכווצות הטווחים והנפח לפי השיעור בדיסקורד.',
        run(f) {
            if (!has(f.hi60, f.avgV15, f.avgV40)) return null;
            return {
                pass: f.range10 < 0.7 * f.range30 && f.range30 > 0 && f.avgV15 <= 0.8 * f.avgV40 && f.price >= f.hi60 * 0.9,
                detail: `טווח 10j ${pct(f.range10)} מול 30j ${pct(f.range30)} · נפח יבש`,
                sort: -(f.range10 / f.range30),
            };
        },
    },
    {
        id: 'upthrust-short', name: 'אפרקאט (שורט)', groups: ['setups'],
        desc: 'דקירה מעל שיא 20 הימים וסגירה חלשה (ב־40% התחתון של הנר) על נפח יחסי 1.3+.',
        approx: 'קירוב יומי של דפוס האפרקאט — האישור האמיתי על הגרף.',
        run(f) {
            if (!has(f.dayHigh, f.dayLow, f.hi20)) return null;
            const rng = f.dayHigh - f.dayLow;
            const pos = rng > 0 ? (f.price - f.dayLow) / rng : 1;
            return {
                pass: f.dayHigh >= f.hi20 * 0.999 && pos <= 0.4 && f.relVol >= 1.3,
                detail: `דקירה מעל שיא 20j וסגירה חלשה · נפח יחסי ${f.relVol.toFixed(1)}`,
                sort: f.relVol,
            };
        },
    },
    {
        id: 'dtss', name: 'DTSS — יקום שורט', groups: ['setups'],
        desc: 'תנודתיות חודשית 4%+, מחזור דולרי $50M+ — היקום הנזיל לטריידי שורט.',
        run(f) {
            if (!has(f.mvol)) return null;
            return {
                pass: f.mvol >= 4 && f.dvol20 >= 50 * M,
                detail: `${dvol(f)} · תנודתיות חודשית ${pct(f.mvol)}`,
                sort: f.mvol,
            };
        },
    },
    {
        id: 'morning-washout', name: 'שטיפת בוקר', groups: ['setups'],
        desc: 'נפילה של 2%+ מהשיא הידוע עם שפל מתחת לסגירה הקודמת, התאוששות מעל אמצע הנר — בתוך 0.5% מעל EMA20 ו־2% מתחת ל־SMA50.',
        approx: 'קירוב יומי לפי כללי המחקר (שפל ≤ EMA20×1.005, ≥ SMA50×0.98, שפל מתחת לסגירה הקודמת, סגירה מעל אמצע).',
        run(f) {
            if (!has(f.dayHigh, f.dayLow, f.ema20, f.sma50, f.prevClose)) return null;
            const drop = (f.dayHigh - f.dayLow) / f.dayLow;
            const mid = (f.dayHigh + f.dayLow) / 2;
            return {
                pass: drop >= 0.02 && f.dayLow < f.prevClose && f.dayLow >= f.sma50 * 0.98
                    && f.dayLow <= f.ema20 * 1.005 && f.price > mid,
                detail: `שטיפה ${(drop * 100).toFixed(1)}% והתאוששות מעל אמצע הנר`,
                sort: drop,
            };
        },
    },
    // ---------------- חדר הסורקים ----------------
    {
        id: 'sae', name: 'SAE — סריקת הסווינג הראשית (#1)', groups: ['room'],
        desc: 'מחזור דולרי ממוצע $20M+, +30% ב־3 חודשים, ATR 4%+.',
        run(f) {
            if (!has(f.perf63, f.atrPct)) return null;
            return {
                pass: f.dvol20 >= 20 * M && f.perf63 >= 30 && f.atrPct >= 4,
                detail: `${dvol(f)} · 3 חודשים ${pct(f.perf63)} · ATR ${pct(f.atrPct)}`,
                sort: f.perf63,
            };
        },
    },
    {
        id: 'daily-breakout', name: 'Daily Breakout (#2)', groups: ['room'],
        desc: 'מחזור דולרי $50M+, +30% בחודש, ATR 4%+.',
        run(f) {
            if (!has(f.perf21, f.atrPct)) return null;
            return {
                pass: f.dvol20 >= 50 * M && f.perf21 >= 30 && f.atrPct >= 4,
                detail: `${dvol(f)} · חודש ${pct(f.perf21)} · ATR ${pct(f.atrPct)}`,
                sort: f.perf21,
            };
        },
    },
    {
        id: 'emagic', name: '30EMAgic (#3)', groups: ['room'],
        desc: 'ATR 7%+, מחזור דולרי $5M+, +30% בחודש.',
        run(f) {
            if (!has(f.perf21, f.atrPct)) return null;
            return {
                pass: f.atrPct >= 7 && f.dvol20 >= 5 * M && f.perf21 >= 30,
                detail: `ATR ${pct(f.atrPct)} · חודש ${pct(f.perf21)} · ${dvol(f)}`,
                sort: f.perf21,
            };
        },
    },
    {
        id: 'louie', name: 'Louie (#4)', groups: ['room'],
        desc: 'תנודתיות חודשית 5.9%+, מחזור דולרי $85K+, +100% ב־6 חודשים, שווי מתחת ל־$2B.',
        approx: 'float מתחת ל־100M מניות לא זמין בנתונים — מוחלף בשווי שוק מתחת ל־$2B.',
        run(f) {
            if (!has(f.mvol, f.perf126)) return null;
            return {
                pass: f.mvol >= 5.9 && f.dvol20 >= 85_000 && f.perf126 >= 100 && f.mcap > 0 && f.mcap < 2e9,
                detail: `6 חודשים ${pct(f.perf126)} · תנודתיות ${pct(f.mvol)} · שווי $${money(f.mcap)}`,
                sort: f.perf126,
            };
        },
    },
    {
        id: 'lead5y', name: 'מנהיגים 5 שנים (#13)', groups: ['room'],
        desc: '+1000% ב־5 שנים.',
        run(f) {
            if (!has(f.perf1260)) return null;
            return { pass: f.perf1260 >= 1000, detail: `5 שנים ${pct(f.perf1260)}`, sort: f.perf1260 };
        },
    },
    {
        id: 'lead1y', name: 'מנהיגים שנה (#14)', groups: ['room'],
        desc: '+300% בשנה.',
        run(f) {
            if (!has(f.perf252)) return null;
            return { pass: f.perf252 >= 300, detail: `שנה ${pct(f.perf252)}`, sort: f.perf252 };
        },
    },
    {
        id: 'lead3m', name: 'מנהיגים 3 חודשים (#15)', groups: ['room'],
        desc: '+100% ב־3 חודשים.',
        run(f) {
            if (!has(f.perf63)) return null;
            return { pass: f.perf63 >= 100, detail: `3 חודשים ${pct(f.perf63)}`, sort: f.perf63 };
        },
    },
    {
        id: 'sae-finviz', name: 'SAE Finviz (#16)', groups: ['room'],
        desc: 'מחיר $40+, נפח ממוצע 500K+, בתוך 5% משיא 52 שבועות, חודש ורבעון ירוקים, מעל SMA20/SMA50, SMA50 מעל SMA200.',
        run(f) {
            if (!has(f.avgV20, f.perf21, f.perf63, f.sma20, f.sma50, f.sma200, f.hi52)) return null;
            const near52 = f.price >= f.hi52 * 0.95;
            return {
                pass: f.price > 40 && f.avgV20 > 500_000 && near52 && f.perf21 > 0 && f.perf63 > 0
                    && f.price > f.sma20 && f.price > f.sma50 && f.sma50 > f.sma200,
                detail: `${Math.round((1 - f.price / f.hi52) * 100)}% מתחת לשיא 52 שבועות`,
                sort: 1 - f.price / f.hi52,
            };
        },
    },
    {
        id: 'trend-template', name: 'תבנית מגמה (#20)', groups: ['room'],
        desc: 'מחיר בתוך 25% משיא 52 שבועות, מעל SMA20 ו־SMA50, SMA50 מעל SMA200.',
        run(f) {
            if (!has(f.sma20, f.sma50, f.sma200, f.hi52)) return null;
            return {
                pass: f.price >= f.hi52 * 0.75 && f.price > f.sma20 && f.price > f.sma50 && f.sma50 > f.sma200,
                detail: `${Math.round((1 - f.price / f.hi52) * 100)}% מתחת לשיא 52 שבועות · מעל כל הממוצעים`,
                sort: -(1 - f.price / f.hi52),
            };
        },
    },
    {
        id: 'hot-week', name: 'החזקות בשבוע (#21)', groups: ['room'],
        desc: '+20% בשבוע, נפח ממוצע 300K+, נפח יומי 100K+, תנודתיות שבועית 4%+.',
        run(f) {
            if (!has(f.perf5, f.wvol, f.avgV20)) return null;
            return {
                pass: f.perf5 >= 20 && f.avgV20 >= 300_000 && f.vol >= 100_000 && f.wvol >= 4,
                detail: `שבוע ${pct(f.perf5)} · תנודתיות שבועית ${pct(f.wvol)}`,
                sort: f.perf5,
            };
        },
    },
    {
        id: 'hot-month30', name: 'החזקות בחודש (#22)', groups: ['room'],
        desc: '+30% בחודש, נפח ממוצע 300K+, נפח יומי 100K+, תנודתיות חודשית 5%+.',
        run(f) {
            if (!has(f.perf21, f.mvol, f.avgV20)) return null;
            return {
                pass: f.perf21 >= 30 && f.avgV20 >= 300_000 && f.vol >= 100_000 && f.mvol >= 5,
                detail: `חודש ${pct(f.perf21)} · תנודתיות ${pct(f.mvol)}`,
                sort: f.perf21,
            };
        },
    },
    {
        id: 'hot-month50', name: 'החזקות בחודש — +50% (#23)', groups: ['room'],
        desc: '+50% בחודש, נפח ממוצע 300K+, נפח יומי 100K+, תנודתיות חודשית 5%+.',
        run(f) {
            if (!has(f.perf21, f.mvol, f.avgV20)) return null;
            return {
                pass: f.perf21 >= 50 && f.avgV20 >= 300_000 && f.vol >= 100_000 && f.mvol >= 5,
                detail: `חודש ${pct(f.perf21)} · תנודתיות ${pct(f.mvol)}`,
                sort: f.perf21,
            };
        },
    },
    {
        id: 'hot-3m50', name: 'החזקות ב־3 חודשים (#24)', groups: ['room'],
        desc: '+50% ב־3 חודשים, נפח ממוצע 300K+, נפח יומי 100K+, תנודתיות חודשית 5%+.',
        run(f) {
            if (!has(f.perf63, f.mvol, f.avgV20)) return null;
            return {
                pass: f.perf63 >= 50 && f.avgV20 >= 300_000 && f.vol >= 100_000 && f.mvol >= 5,
                detail: `3 חודשים ${pct(f.perf63)} · תנודתיות ${pct(f.mvol)}`,
                sort: f.perf63,
            };
        },
    },
    {
        id: 'hot-6m100', name: 'החזקות ב־6 חודשים (#25)', groups: ['room'],
        desc: '+100% ב־6 חודשים, נפח ממוצע 300K+, נפח יומי 100K+, תנודתיות חודשית 5%+.',
        run(f) {
            if (!has(f.perf126, f.mvol, f.avgV20)) return null;
            return {
                pass: f.perf126 >= 100 && f.avgV20 >= 300_000 && f.vol >= 100_000 && f.mvol >= 5,
                detail: `6 חודשים ${pct(f.perf126)} · תנודתיות ${pct(f.mvol)}`,
                sort: f.perf126,
            };
        },
    },
    {
        id: 'hottest', name: 'Hottest Stocks (#27)', groups: ['room'],
        desc: '+30% בחודש, שווי מתחת ל־$2B, בתוך 10% משיא 20 הימים, תנודתיות שבועית 3%+.',
        approx: 'float מתחת ל־10M מניות לא זמין בנתונים — מוחלף בשווי שוק מתחת ל־$2B.',
        run(f) {
            if (!has(f.perf21, f.wvol, f.hi20)) return null;
            return {
                pass: f.perf21 >= 30 && f.mcap > 0 && f.mcap < 2e9 && f.price >= f.hi20 * 0.9 && f.wvol >= 3,
                detail: `חודש ${pct(f.perf21)} · שווי $${money(f.mcap)}`,
                sort: f.perf21,
            };
        },
    },
    {
        id: 'rebound-ma', name: 'ריבאונד מהממוצעים (#28)', groups: ['room'],
        desc: 'מעל SMA50, מתחת ל־SMA200, כ־40% מתחת לשיא 52 שבועות — מניות מתאוששות ממכירה.',
        approx: 'שחזור הלוגיקה מהשם וההקשר — הקריטריונים המדויקים של החדר לא תועדו.',
        run(f) {
            if (!has(f.sma50, f.sma200, f.hi52)) return null;
            const below = 1 - f.price / f.hi52;
            return {
                pass: f.price > f.sma50 && f.price < f.sma200 && below >= 0.3 && below <= 0.5,
                detail: `${Math.round(below * 100)}% מתחת לשיא 52 שבועות · מעל SMA50`,
                sort: -below,
            };
        },
    },
    {
        id: 'ema5-proximity', name: 'מסך בתוך מסך (#30)', groups: ['room'],
        desc: 'מרחק 5% ומטה מ־EMA5, מחזור דולרי $5M+.',
        approx: 'בחדר זה רץ על רשימות שבועיות — כאן רץ על כל היקום.',
        run(f) {
            if (!has(f.ema5)) return null;
            const dist = Math.abs(f.price / f.ema5 - 1) * 100;
            return {
                pass: dist <= 5 && f.dvol20 >= 5 * M,
                detail: `${dist.toFixed(1)}% מ־EMA5 · ${dvol(f)}`,
                sort: -dist,
            };
        },
    },
    {
        id: 'mean-reversion', name: 'Mean Reversion (#31)', groups: ['room'],
        desc: 'מכירה חדה: ‎-12%‎ בשבוע, מתחת ל־SMA20, מחזור דולרי $10M+ — מועמדות לתיקון חזרה לממוצע.',
        approx: 'ההגדרה בחדר חלקית ("המניות הכי טובות לתיקון") — קירוב לוגי: שבוע אדום חד על נפח נזיל.',
        run(f) {
            if (!has(f.perf5, f.sma20)) return null;
            return {
                pass: f.perf5 <= -12 && f.price < f.sma20 && f.dvol20 >= 10 * M,
                detail: `שבוע ${pct(f.perf5)} · מתחת ל־SMA20`,
                sort: f.perf5,
            };
        },
    },
    {
        id: 'etf-liquid', name: 'תעודות סל נזילות (#32)', groups: ['room'], src: 'etf',
        desc: 'תעודות סל: נפח ממוצע 1M+, תנודתיות שבועית 3%+.',
        run(f) {
            if (!has(f.wvol, f.avgV20)) return null;
            return {
                pass: f.etf && f.avgV20 >= 1_000_000 && f.wvol >= 3,
                detail: `נפח ממוצע ${(f.avgV20 / M).toFixed(1)}M · תנודתיות שבועית ${pct(f.wvol)}`,
                sort: f.avgV20,
            };
        },
    },
];

export const GROUPS = [
    { id: 'qullamaggie', name: 'קולמאגי' },
    { id: 'stokbee', name: 'סטוקבי' },
    { id: 'setups', name: 'סטאפים' },
    { id: 'room', name: 'חדר הסורקים' },
];

// exported for testing
export { SCANNERS };

const resultsCache = new Map(); // id -> { exp, rows }
const RESULTS_TTL = 30 * 60 * 1000;

export function listScanners() {
    return {
        groups: GROUPS,
        scanners: SCANNERS.map((s) => ({
            id: s.id, name: s.name, groups: s.groups, desc: s.desc,
            approx: s.approx || null,
        })),
    };
}

export function runScanner(id) {
    const def = SCANNERS.find((s) => s.id === id);
    if (!def) return null;
    const snap = getSnapshot();
    if (!snap) return { error: 'snapshot not ready' };
    const cacheKey = `${id}@${snap.asOf}`;
    const hit = resultsCache.get(cacheKey);
    if (hit && Date.now() < hit.exp) return hit.out;
    const rows = [];
    const source = def.src === 'etf' ? (snap.etfFeats || {}) : snap.feats;
    for (const sym of Object.keys(source)) {
        const f = source[sym];
        let r;
        try { r = def.run(f); } catch { continue; }
        if (r && r.pass) {
            rows.push({
                s: f.s, name: f.name,
                price: +f.price.toFixed(2),
                chg: +f.chg.toFixed(2),
                dvolM: +(f.dvol20 / M).toFixed(1),
                relVol: +f.relVol.toFixed(1),
                detail: r.detail, sort: r.sort,
            });
        }
    }
    rows.sort((a, b) => b.sort - a.sort);
    const out = {
        id: def.id, name: def.name, desc: def.desc, approx: def.approx || null,
        asOf: snap.asOf, count: rows.length, rows: rows.slice(0, 100),
    };
    resultsCache.set(cacheKey, { exp: Date.now() + RESULTS_TTL, out });
    return out;
}
