# FINN API contract (v0)

Frontend and backend sessions build against this file. `contracts/fixtures/*.json` are
example responses for each endpoint, which the frontend uses until the live API is ready.
**Change this file first, then the code.** All responses are JSON unless noted. Times are ISO-8601 with an IST offset.
Money is in **₹ crore** unless a field says otherwise. Percentages are plain numbers (`12.4` means 12.4%).

Base URL: `NEXT_PUBLIC_API_BASE` (local `http://localhost:8000`). All routes are prefixed `/api`.

---

## Core idea: Thesis Guardian

Each holding has a **thesis**: 2–4 **pillars**, each a falsifiable claim drafted from management's own words
on recent concalls (e.g. *"EBITDA margin 13–14% in FY27"*). The user can edit them.
Every material push item and every EOD anomaly is judged against the pillars:

- `supports`: the evidence is consistent with a pillar
- `challenges`: the evidence contradicts or threatens a pillar
- `neutral`: material, but not related to any pillar

Pillar status rolls up to a holding status: `intact` | `watch` | `challenged` | `none` (no thesis yet).

---

## Endpoints

### `GET /api/portfolio`
Holdings, with their latest EOD and thesis status. Fixture: `portfolio.json`
```ts
{ as_of: string /* last EOD date */, holdings: Holding[] }
Holding = {
  symbol: string, name: string, sector: string, weight: number,
  close: number, chg_pct: number,          // last session
  vol_ratio: number,                       // today's volume / 20-day average (today excluded)
  spark: number[],                         // last 30 closes, oldest first
  thesis_status: "intact" | "watch" | "challenged" | "none",
  unseen: number                           // unseen material items for this symbol
}
```

### `GET /api/brief?from=<iso>&to=<iso>`
The windowed digest. Defaults to the last 24h. If the window holds no material items, the server **widens it**
(24h → 3d → 7d) and reports that in `window.widened_from`. Fixture: `brief.json`
```ts
{
  window: { from: string, to: string, label: string, widened_from: string | null },
  summary: {
    theses_intact: number, theses_total: number,
    challenged: string[],                  // symbols
    material: number, routine: number,
    headline: string                       // one sentence, e.g. "2 theses challenged, 1 strengthened, 14 routine filings"
  },
  top: Item[],          // tier "top", highest score first
  worth_reading: Item[],
  routine: { count: number, by_category: Record<Category, number>, items: Item[] },
  alerts_unseen: number
}

Item = {
  id: string, symbol: string, company: string, ts: string,
  category: Category, subject: string,     // subject = the exchange's raw subject line
  source: "NSE" | "BSE", pdf_url: string | null,
  tier: "top" | "read" | "routine" | "hidden",
  score: number,                           // 0-100
  why: string,                             // short reason it is at this rank, shown on the card
  headline: string,                        // FINN's one-line summary; may repeat the subject when nothing is worth adding
  thesis: ThesisImpact | null,
  card: Card | null,                       // rich body for categories that earn one
  market: { chg_pct: number, vol_ratio: number } | null,   // same-session reaction
  seen: boolean
}

ThesisImpact = { pillar_id: string, pillar: string, verdict: "supports" | "challenges" | "neutral", reason: string }

Category = "results" | "M&A" | "fund_raise" | "management_change" | "litigation" | "insider_trading"
         | "earnings_call" | "investor_meetings" | "credit_rating" | "dividend" | "bonus_split" | "capex"
         | "press_release" | "postal_ballot" | "agm_egm" | "pledging" | "unclassified"
```

#### Cards
```ts
Card = ResultsCard | PersonCard | DealCard | RatingCard | ChipCard

ResultsCard = {
  kind: "results", period: string /* "Q2 FY27" */, basis: "consolidated" | "standalone",
  is_financial: boolean,                   // banks/NBFCs: rows are NII / PPOP / PBT / PAT
  rows: { metric: "Revenue" | "EBITDA" | "PBT" | "PAT" | "NII" | "PPOP",
          cur: number, prev_q: number, prev_y: number,
          qoq_pct: number | null, yoy_pct: number | null }[],
  margin: { label: string, cur: number, prev_q: number, prev_y: number } | null,  // EBITDA margin
  ebitda_formula: string | null,           // e.g. "PBT + finance cost + D&A − other income"
  check: "matched" | "mismatch" | "unverified",   // cross-check against screener's quarterly table
  verdict: string                          // one line, e.g. "Growth held up but margin slipped 1.9pp"
}

PersonCard = {
  kind: "person", name: string, role: string,
  change: "appointed" | "resigned" | "retired" | "redesignated",
  effective: string | null,
  bio: string,                             // 1–2 lines
  prior: { org: string, role: string, years: string | null }[],
  source: "filing" | "web", source_url: string | null,
  red_flag: string | null                  // e.g. "CFO exit mid-quarter"
}

DealCard = { kind: "deal", what: string, counterparty: string | null, value_cr: number | null,
             pct_of_mcap: number | null, pct_of_revenue: number | null }

RatingCard = { kind: "rating", agency: string, instrument: string, from: string | null, to: string,
               outlook: string | null, direction: "upgrade" | "downgrade" | "reaffirm" | "new" }

ChipCard = { kind: "chip", label: string, value: string, date: string | null }   // dividend, record date, call time
```

### `POST /api/items/{id}/seen` · `POST /api/items/{id}/keep`
Triage gestures. Returns `{ ok: true }`.

### `GET /api/alerts`
Fixture: `alerts.json`
```ts
{ items: Alert[] }
Alert = { id: string, ts: string, symbol: string,
          kind: "volume" | "price" | "category" | "thesis",
          message: string,                 // "Volume 3.4× its 20-day average"
          value: number | null, threshold: number | null,
          item_id: string | null,          // links to a brief Item when the alert is announcement-driven
          seen: boolean }
```
`POST /api/alerts/{id}/seen` → `{ ok: true }`

### `GET /api/rules` · `PUT /api/rules`
Fixture: `rules.json`
```ts
Rules = {
  volume_multiple: number,     // default 2.0
  volume_lookback: number,     // default 20 sessions
  price_move_pct: number,      // default 5.0 (absolute 1-day move)
  categories: Record<Category, boolean>,   // which categories raise an alert
  thesis_alerts: boolean       // alert whenever a pillar is challenged
}
```

### `GET /api/theses` · `GET /api/theses/{symbol}` · `PUT /api/theses/{symbol}`
Fixture: `thesis_KPITTECH.json`
```ts
Thesis = {
  symbol: string, status: "intact" | "watch" | "challenged" | "none",
  drafted_from: { doc: string, date: string, url: string }[],
  user_edited: boolean,
  pillars: Pillar[]
}
Pillar = {
  id: string, text: string,
  metric: "revenue_growth" | "ebitda_margin" | "pat_growth" | "capex" | "order_book" | "volume" | "other",
  target: string | null, period: string | null,       // "18-22%", "FY27"
  source: Citation,
  status: "on_track" | "at_risk" | "broken" | "untested",
  evidence: { ts: string, item_id: string | null, verdict: "supports" | "challenges", note: string }[]
}
Citation = { doc: string /* "Q1 FY27 concall" */, date: string, url: string, page: number | null, quote: string | null }
```
For `PUT`, send `{ pillars: { id?, text, metric, target, period }[] }`. Pillars without an `id` are new.

### `GET /api/research/{symbol}`
**Server-Sent Events.** One `section` event per section as it completes, then `done`.
`GET /api/research/{symbol}?format=json` returns the whole cached deck at once. Fixture: `research_KPITTECH.json`
```ts
event: head      data: { symbol, name, as_of, sources: Citation[] }   // always first, before any section
event: section   data: Section
event: done      data: { symbol, total_cost: Cost, elapsed_ms: number }
event: error     data: { message }

Section = {
  key: "snapshot" | "financials" | "trajectory" | "balance_sheet" | "cash_quality" | "ledger" | "bull_bear",
  status: "ok" | "empty" | "error",
  title: string, takeaway: string,         // the one line to read if nothing else
  data: object,                            // shape depends on key, see the fixture
  citations: Citation[],
  cost: Cost
}
Cost = { tokens_in: number, tokens_out: number, inr: number, cached: boolean, model: string | null }
```
Order of events: `financials`, `trajectory`, `balance_sheet` and `cash_quality` are deterministic and arrive almost at once.
`snapshot`, `ledger` and `bull_bear` need the LLM and arrive later.

### `GET /api/search?q=<text>`
Ticker autocomplete over the NSE equity list. `{ results: { symbol, name }[] }`

### `GET /api/stats/cost`
`{ total_inr, calls, cache_hit_rate, by_purpose: { purpose, calls, tokens_in, tokens_out, inr }[] }`
