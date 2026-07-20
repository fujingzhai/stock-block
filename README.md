# Stock Block

Stock Block embeds a lightweight stock widget directly inside SiYuan documents, for jotting down trades, checking fundamentals, and comparing price trends right in your investment notes, review journals, single-stock research, or personal dashboard.

It is not a market-data terminal, and it is not a replacement for database views. It focuses on a narrower workflow: putting an editable, long-lived, multi-device stock block inside the note you are already writing, without creating a database or leaving the document. Every stock block shares one dataset, so adding, editing, or deleting in any block updates the others instantly.

> Quotes and fundamentals come from East Money (Eastmoney) public endpoints, for personal record-keeping and study only. Nothing here is investment advice.

## One Block, Multiple Views

Insert from the slash menu `/股票块` (also matches `股票`, `持仓`, `记录`, `gupiao`, `stock`) or the top-bar icon menu's "Insert Stock Block". Add as many as you like in any document. Each block carries three views, switched in place without interfering with each other:

- **Records**: one record = one round trip on a stock (a buy plus an optional sell). The table sorts by ticker, buy date, buy price, quantity, sell date, sell price, P&L, P&L %, and status (holding / closed); records can be created, edited, and deleted in place, each with its own tags. A header summary shows "X holding, Y closed, total P&L".
- **Fundamentals**: enter a code or name to fetch a stock's fundamentals, shown by reporting period (annual / interim / Q1 / Q3, multiple years side by side): EPS, ROE, gross margin, debt ratio, revenue growth, profit growth, and market cap — handy for side-by-side comparison and review.
- **Compare**: put broad indices, industry/concept boards, ETFs, individual stocks, or a tagged group of stocks on one chart, normalized to a 100 baseline for trend comparison (a single selection shows absolute values instead).

## The Compare View

Compare is the heart of the plugin — pick instruments on the left, watch trends on the right:

- **Five instrument types**: Indices (seven built-in: SSE Composite, SZSE Component, ChiNext, STAR 50, CSI 300, CSI 500, CSI 1000), Boards, ETFs, Stocks, and Tags. Boards / ETFs / stocks are imported via "Fetch" and can be removed anytime; the Tags pane groups imported stocks by tag and supports whole-group selection.
- **Three time ranges**, mutually exclusive and auto-clearing each other:
  - **Recent**: last 1 / 3 / 6 months, year-to-date, or last 1 year.
  - **Year / Quarter**: hover a year to expand its full-year / Q1–Q4 options, clamped to the data's actual range.
  - **Since a date**: from a chosen day to the latest data.
- **Normalized comparison**: with multiple selections every line starts from the same 100 baseline, making interval returns easy to compare; a single selection shows the instrument's real index level.
- **Hover crosshair**: moving the mouse shows each instrument's value and that day's change for the hovered date, sorted by value; a line is highlighted (and the rest faded) only when the cursor is genuinely close to it — blank areas never mis-highlight.
- **Legend & focus**: click a legend item to lock focus on one line; "Clear" deselects everything and empties the chart.
- Redraws responsively as the widget resizes, staying legible even with many instruments.

## Highlights

- One dataset, synced live across multiple blocks and views, with no SiYuan database required.
- Quotes and fundamentals are fetched from East Money through SiYuan's kernel network proxy, sidestepping browser CORS limits; K-line requests retry across several fallback hosts.
- Seven broad-based indices are built in and work out of the box; stocks / boards / ETFs are imported on demand, defaulting to the last year with a customizable month/year span at fetch time.
- Standalone "Stock" panel: open an enlarged view from the top-bar icon menu or the command palette, shown in a SiYuan tab with roomier width over the same data — handy for focused viewing and comparison.
- Follows SiYuan's theme: both embedded blocks and the standalone panel switch their palette live with SiYuan's light / dark theme, including automatic OS day/night switching.
- Both records and stocks can be tagged; two-level tag management supports add, rename, and delete, removing a deleted tag from every record.
- Data lives in a standalone workspace file and syncs across devices via SiYuan's official cloud sync; it is backed up before every write and refuses to write when the file is corrupt, to avoid overwriting good data.

## Data Storage

Stock data is stored in the SiYuan workspace:

`/data/storage/stock-block/data.json`

Before each write the previous good copy is backed up to `data.json.bak` in the same folder; if the file is corrupt or unreadable, writes are blocked to avoid overwriting existing data. Multiple open blocks sync instantly via BroadcastChannel, and cross-device sync relies on SiYuan's official cloud sync.

## Use Cases

- Position records and P&L in investment notes and review journals.
- Fundamental and trend comparison inside single-stock research documents.
- Putting a few stocks from one theme (e.g. "robotics", "AI compute") on one chart for side-by-side comparison.
- A market overview in your personal dashboard.
- Any scenario where you want quotes and holdings right inside your notes, without opening a separate market app.

## License

MIT

---

## Data Source

Quotes and fundamentals come from East Money public endpoints, for personal record-keeping and study only, and are not investment advice.

## Support Development — Buy me a token

This plugin was built entirely through vibe coding. The tools and models involved include:

- Codex (GPT 5.5): ~40% of the work
- Claude Code (Opus 4.8): ~40% of the work
- Antigravity (Gemini 3.5 Flash): ~20% of the work

(The figures above are estimates from the plugin's first release; it keeps being updated, always with the most capable models available at the time.)

Top-tier models are expensive and my study schedule is tight, so this work has not come easily. If you like this plugin or benefit from it, you are warmly invited to support its development. I will keep updating it and making the experience better.

Please leave your LianDi (ld246) username or any other social account with your payment, and I will add you to the plugin's sponsor list as a token of my gratitude. Your support is my greatest motivation to create!

| ![WeChat Pay](https://fastly.jsdelivr.net/gh/fujingzhai/stock-block@main/assets/sponsor-wechat.png) | ![Alipay](https://fastly.jsdelivr.net/gh/fujingzhai/stock-block@main/assets/sponsor-alipay.jpg) |
| :---: | :---: |

## Sponsors

- [youxia](https://ld246.com/member/youxia)
