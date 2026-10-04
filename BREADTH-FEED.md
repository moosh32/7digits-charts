# Breadth Feed — חוזה הזנה יומית

שירות המשיכה היומית (אינסטינקט, שרת ענן) דוחף נתוני רוחב שוק לפלטפורמה.
הפלטפורמה שומרת ומגישה; היא לא מושכת בעצמה.

## Endpoint

```
POST https://7digits-charts-production.up.railway.app/api/breadth
Authorization: Bearer <BREADTH_SECRET>
Content-Type: application/json
```

## גוף הבקשה

```json
{
  "records": [
    {"d": "2026-10-05", "exchange": "nasdaq", "adv": 2859, "dec": 2076, "net": 783},
    {"d": "2026-10-05", "exchange": "nyse",   "adv": 1646, "dec": 1081, "net": 565}
  ]
}
```

- `d`: תאריך `YYYY-MM-DD` (יום המסחר).
- `exchange`: `nasdaq` או `nyse` בלבד.
- `adv` / `dec`: מספרי מניות עולות / יורדות (חובה, מספרים).
- `net`: אופציונלי — אם חסר, השרת מחשב `adv - dec`.
- עד 2,000 רשומות לקריאה. רשומה לא תקינה מדולגת בשקט.

## התנהגות

- Upsert לפי `(exchange, d)` — שליחה חוזרת של אותו יום דורסת, לא מכפילה.
- תשובה: `{"ok": true, "upserted": N, "total": M}`.
- 401 = קוד שגוי. 503 = `BREADTH_SECRET` לא מוגדר בשרת.

## מקור הנתונים (נבדק ועובד דרך TradingView MCP)

| סימול | בורסה | משמעות |
|---|---|---|
| USI:ADVQ | nasdaq | עולות |
| USI:DECLQ | nasdaq | יורדות |
| USI:ADV | nyse | עולות |
| USI:DECL | nyse | יורדות |

(אפשר גם `net` ישירות מ־USI:ADDQ / USI:ADD, אבל `adv - dec` עקבי יותר.)

## קריאה (מה שהפלטפורמה מגישה ללקוח)

```
GET /api/breadth?exchange=nasdaq   → {"exchange":"nasdaq","records":[{d,exchange,adv,dec,net}...]}
```

ממוין עולה לפי תאריך. הלקוח מחשב קו A/D מצטבר = סכום מצטבר של `net`.

## אחסון

קובץ JSON על ה־volume ב־`/data/breadth.json`. שורד דיפלויים (volume), לא תלוי בדפדפן.

## קצב מומלץ

פעם ביום אחרי סגירת המסחר בארה״ב. מספיק לשלוח את היום האחרון (או כמה ימים אחרונים לגיבוי).
