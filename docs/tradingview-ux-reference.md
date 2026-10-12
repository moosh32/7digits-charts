# TradingView UX Reference (patterns only — do NOT copy code, text, or assets)

Practical UX spec for the 7D charting platform. Patterns observed from public knowledge
of TradingView's web interface. Our implementation is original (Vela chart engine);
this doc tells the builder *what users expect*, not how TradingView implements it.

---

## 1. Chart Tabs

- Tab strip sits at the **top of the chart pane**, below the top toolbar, above the chart itself.
- Each tab holds independent state: symbol, timeframe, chart type, indicators, drawings, layout/split.
- **Add**: "+" button at the end of the strip; new tab opens with default symbol.
- **Close**: "×" on the active tab (visible on hover for inactive tabs); closing the last tab is not allowed — it resets to a default empty tab instead.
- **Rename**: double-click the tab title → inline text field, Enter commits, Esc cancels.
- **Reorder**: drag a tab horizontally to reorder.
- **Keyboard**: Ctrl/Cmd+1..9 jumps to tab N; Ctrl+Tab / Ctrl+Shift+Tab cycles; Ctrl/Cmd+T opens a new tab; Ctrl/Cmd+W closes the active tab.
- **Context menu** (right-click on tab): rename, duplicate, close others, close to the right, close all.
- **Persistence**: tab set, per-tab state, and active tab survive reload (local state + cloud sync).
- Per-tab symbol is also mirrored in the top toolbar's symbol-search field.

## 2. Watchlist Panel

- Right-side vertical panel, collapsible; toggle from a toolbar button.
- **Multiple lists**: dropdown/header selects the active list ("+ New list" at the bottom of the menu; right-click a list to rename/delete/duplicate).
- **Add symbol**: "+" button opens symbol search; also "+" on any chart symbol header ("add to watchlist" → target list).
- **Remove**: hover row → "×"; also right-click → remove.
- **Color flags**: right-click a row → assign one of ~7 colors; flag is a small dot/stripe on the row. Used for visual grouping; filterable.
- **Sorting**: header click toggles sort by symbol (A–Z), price, change%, volume; click again reverses; third click clears to manual order. Drag rows to reorder manually.
- **Search filter**: text field at panel top filters rows live (symbol or name).
- **Click-to-load**: clicking a row loads that symbol in the **active chart tab**; double-click keeps the tab and focuses the chart.
- **Compact row content**: symbol (bold), exchange suffix when ambiguous, last price, change% (colored green/red), and optional mini sparkline; volume and market-cap as toggleable columns.
- **Section support**: users can create named sections within a list (e.g. "Earnings", "Breakouts"); rows drag between sections.
- **Auto-save**: every list change persists immediately.

## 3. Screener / Scan Builder

- Filters are presented as **rows**: `[field/indicator] [condition] [value]`.
- Field picker: searchable dropdown grouped by category (Recommendations, Price, Volume, Technicals, Fundamentals, etc.).
- Condition picker depends on field type: numeric → above/below/crossing/equal; boolean → is true/false; text → contains.
- Value: number input, or for cross/comparison, a second field reference.
- Logic is **AND across all rows** (a row can be negated). Remove row via "×"; "Reset" clears all.
- **Column customization**: "Columns" button opens a checklist of available fields; checked fields appear as result columns in chosen order.
- **Sorting**: click any column header to sort results by it; arrow shows direction.
- **Result count**: "X symbols match" displayed live above the grid; capped at a page size with pagination.
- **Save**: "Save" stores the filter set under a name (user's saved screeners list); "Open" restores.
- Row preview: hovering a result row shows the symbol; clicking loads it in the chart tab.

## 4. Symbol Search

- **Trigger**: click the symbol button in the top-left of the chart toolbar, or press **Ctrl/Cmd+K** anywhere.
- A modal/search overlay opens with the input focused; Esc closes.
- **Grouped results**: top group = "Symbols" (best matches across all exchanges), then by exchange/market (NASDAQ, NYSE…); each row shows logo/color dot, symbol, full name, exchange, and current price when available.
- **Keyboard**: ↑/↓ navigate, Enter loads the highlighted symbol in the **active tab**, Tab switches to next result group.
- **Recent searches**: shown when the input is empty, as a "Recent" list; clearable.
- **Exchange filter chips**: row of market tabs (All, Stocks, Crypto, Forex…) to narrow scope.
- Typing a ticker and pressing Enter with no match → "no results" state, not an error toast.
- Search is debounced and incremental; results rank exact-symbol prefix matches first.

## 5. Drawing Toolbar

- **Left vertical rail** of icon buttons: cursor/arrow (select), cross, dot, then trend line, horizontal line, horizontal ray, vertical line, parallel channel, fibonacci retracement, fibonacci extension, brush/freehand, text, long/short position tools, price range, date range, arrow, rectangle, ellipse.
- **Tool selection flow**: click a tool → it becomes active (rail button highlighted); next click-drag on the chart draws that object; some tools are "sticky" (repeat until Esc or another tool chosen), others single-use.
- Tools with variants group under one button with a flyout (long-press / small arrow), e.g. trend line → ray / extended / info line.
- **Magnet mode**: toggle button at the rail bottom; when on, drawing points snap to OHLC values; "strong magnet" snaps to the nearest point across all panes.
- **Object management**: click a drawing to select (handles appear); drag to move; drag handles to resize; Delete removes; **Esc deselects**; Ctrl/Cmd+Z undoes a draw.
- Right-click a drawing → context menu: settings, clone, lock, hide, remove, "bring to front / send to back".
- Object tree: a small "objects" panel lists all drawings per tab with show/hide, lock, delete per item.

## 6. Top Toolbar

- Left to right: **symbol search button** (ticker + price display), **timeframe switcher** (dropdown with common presets: 1m 5m 15m 1H 4H D W M, plus "more" for seconds/ticks/ranges), **chart type** (candles, bars, line, area, Heikin Ashi, Renko…).
- **Indicators**: "Indicators" button opens a searchable dialog (built-in + community scripts + "my scripts"); applying adds the indicator to the active pane; each indicator gets a legend entry with settings/remove.
- **Undo/redo** buttons (also Ctrl/Cmd+Z / Shift+Z) covering drawings and indicator changes.
- **Chart layout**: split button (1 / 2H / 2V / 3 / 4 panes); each sub-chart in a multi-layout is independently symbol/timeframe-switchable.
- **Screenshot/share**: camera icon → copies a chart image or opens share dialog (link + embed).
- **Alert** button (bell) opens the alert editor anchored to current symbol/price.
- **Replay** (bar replay) and **calendar** toggles sit at the right end.
- Toolbar is customizable: "…" menu lets users add/remove buttons.

## 7. Keyboard Shortcuts (the essential set)

- `←` / `→` — scroll chart; `Shift`+arrows = faster scroll
- `+` / `-` (or `↑` / `↓` while hovering price scale) — zoom in/out
- `Alt+I` — invert price scale
- `Alt+L` / `Alt+R` — toggle logarithmic / regular scale
- `Alt+T` — reset chart view
- `Ctrl/Cmd+K` — symbol search
- `Ctrl/Cmd+Z` / `Ctrl/Cmd+Shift+Z` — undo / redo
- `Delete` — remove selected drawing; `Esc` — deselect / cancel tool
- `Alt+H` — hide/show drawings; `Alt+G` — go to date
- `Ctrl/Cmd+Alt+L` — toggle extended-hours data
- `F` — crosshair; `C` — cross cursor toggle
- `S` — snapshot/screenshot
- `Ctrl/Cmd+1..9` — jump to chart tab N

## 8. General Layout & Interaction

- **Pane arrangement**: top toolbar → tab strip → chart area (left drawing rail, right watchlist panel) → bottom status bar (timezone, symbol session, layout indicator). Right panel hosts watchlist; bottom panel (toggleable) hosts screener/watchlist detail or data window.
- **Right price scale**: drag vertically to scale; **double-click resets**; right-click opens scale menu (log %, auto, invert, merge scales); scroll-wheel on the scale zooms it.
- **Bottom time scale**: drag horizontally to pan; wheel = zoom; double-click resets view.
- **Crosshair**: follows the mouse with dashed lines and live price/time labels on both scales; OHLC values of the hovered bar show in the legend.
- **Dark theme tokens** (approximate, inspiration only): background `#131722`-ish near-black navy; panels `#1e222d`-ish; grid lines subtle `#2a2e39`; text `#d1d4dc`; up `#26a69a` teal, down `#ef5350` red; accent blue `#2962ff`. Choose our own palette — do not lift exact values.
- Chart panes support multiple indicator sub-panes stacked below the main pane with their own mini scales; drag the divider to resize.
- Hovering a bar shows a data window (OHLCV + indicator values) pinned top-left as a legend.
- Empty state: new tab shows symbol search prompt centered, not a blank chart.

---

## Do NOT Copy

- TradingView logo, name, "TV" glyphs, or any brand assets.
- Exact icon artwork — draw our own icons in the same functional style.
- Proprietary Pine Script built-ins or indicator implementations (rewrite our own math).
- TradingView's marketing copy, empty-state text, or error strings — write original text.
- Exact color hex values from their stylesheets; use approximate inspiration above.
