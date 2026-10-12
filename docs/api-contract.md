# 7D Platform — API Contract v1 (frozen for the finished-product build)

Base: same origin. All JSON. Errors: `{error: "message"}` (never invent data; unavailable → 502/503).

## Market data (public reads)
- `GET /api/health` → `{ok:true, snapshot:{asOf,count}, kv:bool}`
- `GET /api/bars?symbol=NVDA&timeframe=D` → `{symbol, timeframe, bars:[{time,open,high,low,close,volume}], count}` — `time` = ms epoch. timeframes: `1,5,15,30,60,D,W,M`.
- `GET /api/search?q=nv&limit=12` → `[{symbol,name,exchange,type}]`
- `GET /api/quote?symbol=NVDA` → `{symbol,price,changePct,dayHigh,dayLow,volume}` (nulls when unavailable)
- `GET /api/quotes?symbols=NVDA,AAPL` → `{NVDA:{...}}` (max 100 symbols)

## Custom scans (public run; saved scans are personal → protected)
- `POST /api/scan/run` `{criteria:[{field,op,value,value2?}], sort?:{field,dir}, limit?:200}`
  → `{tickers:[{symbol,name,price,changePct,dollarVolume,atrPct,gapPct,relVolume,rs63vsSpy,marketCap}], count, ms, asOf}`
- Fields: `price, dollarVolume, avgDollarVolume20, atrPct, gapPct, relVolume, sma20, sma50, sma200, priceVsSma20Pct, priceVsSma50Pct, priceVsSma200Pct, perf5, perf21, perf63, rs63vsSpy, marketCap, avgVolume20`
- Ops: `gt, gte, lt, lte, eq, between` (`between` uses `value` + `value2`)
- `GET /api/scans/custom` → `[{id,name,criteria,sort,createdAt,updatedAt}]`
- `POST /api/scans/custom` `{name,criteria,sort?}` → `{id,...}`
- `PUT /api/scans/custom/:id` `{name?,criteria?,sort?}`
- `DELETE /api/scans/custom/:id`
- `POST /api/scans/custom/:id/run` `{limit?}` → same shape as `/api/scan/run`

## Prebuilt scanners (existing, keep compatible)
- `GET /api/scans` → existing list
- `GET /api/scan/:id` → existing result shape

## Watchlists v2 (protected)
- `GET /api/watchlists` → `{lists:[{id,name,items:[{symbol,color}]}], activeListId}`
- `POST /api/watchlists` `{name}` → `{id,name,items:[],...}`
- `PUT /api/watchlists/:id` `{name?,items?}` (full-replace items; max 500)
- `DELETE /api/watchlists/:id`
- colors: `red, orange, yellow, green, blue` (null = none)

## Tabs (protected)
- `GET /api/tabs` → `{tabs:[{id,name,symbol}], activeId}`
- `PUT /api/tabs` `{tabs,activeId}` (full replace; max 30 tabs)

## Breadth (existing, keep compatible)
- `GET /api/breadth?exchange=nasdaq|nyse`
- `POST /api/breadth` (Bearer secret, existing shape)

## Auth & storage
- Single user (Israel). All personal/mutating endpoints (`/api/watchlists*`, `/api/tabs`, `/api/scans/custom*`, `POST /api/breadth`) require `Authorization: Bearer <API_SECRET>`. If `API_SECRET` is unset → 503; the client then falls back to localStorage-only mode.
- Storage abstraction: `Store {get,set,del}`. `KVStore` over Cloudflare KV binding `SEVEND_KV` when present; otherwise `FileStore` (JSON files, atomic write) for the express/dev target. Same code path selects automatically.
