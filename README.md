# FINN: Financial Investment Agent

**Live (open it on your phone):** https://finn-alpha-sepia.vercel.app

FINN is a mobile-first agent for an investor with a high-conviction portfolio of 18 NSE stocks.
It is built around one point of view:

> An investor doesn't need to know *what happened*. They need to know **whether their conviction is still justified.**

So FINN keeps a short, falsifiable **thesis** for every holding. Each pillar of the thesis is drafted from
management's own words on earnings calls, with a quote and a page number. FINN then judges every new filing,
price move and result against those pillars, and tells you only what changes the picture.

| Push (FINN comes to you) | Pull (you ask FINN) |
|---|---|
| **Brief:** filings across the portfolio for 24h, 3d, 7d or a custom window. They are grouped into events and ranked, and each card explains *why* it ranks where it does. Routine paperwork collapses into one row. If nothing material happened, the window widens on its own. | **Research deck for any NSE ticker:** financial snapshot, trajectory, balance sheet, cash quality, and the **promise ledger**. |
| **Results card:** Revenue, EBITDA, PBT and PAT for this quarter vs last quarter (QoQ) vs a year ago (YoY), read from the filing itself and cross-checked against an independent source. | **Promise ledger:** the last 4–5 calls. Each promise is quoted verbatim with its page, then checked against the reported numbers: delivered, partly, missed, too early, or not scorable. |
| **Person card:** for a senior management change, the bio is taken from the filing's mandatory "brief profile". | **Thesis:** up to 3 pillars per holding, drafted from the ledger and editable. A results filing *supports* or *challenges* a pillar, and that is decided in code. |
| **Alerts:** volume ≥ k× its 20-day average, price move ≥ ±X%, and watched categories. Thresholds are yours, and changing one re-draws the list immediately. | Works on companies FINN has never seen. Ones with no earnings calls (e.g. TRENT) get the numbers and a plain statement that there is no guidance to check. |

## How it is built

```
                        ┌──────────── Vercel (one project, two services, Singapore) ────────────┐
 phone ──── https ────► │  frontend/  Next.js 16 PWA  ── same-origin /api/* ──►  backend/  FastAPI  │
                        └───────────────────────────────────────────────────────────┬────────────┘
                                                                                    │
 GitHub Actions cron ── filings every 30 min, EOD prices ──► Neon Postgres (Singapore) ◄┘
   (fetch → classify → cards)                                  filings · prices · cards · decks · LLM cache · call log
        │
        ├── NSE corporate-announcements API (one bulk call covers every listed company)
        ├── Yahoo Finance (yfinance) end-of-day prices
        ├── screener.in: standardised financials + links to annual reports and transcripts
        └── BSE / NSE PDFs: results filings, appointment letters, concall transcripts
```

**Numbers come from code; the model only reads documents.** Gemini transcribes tables, extracts verbatim
quotes and writes three-line summaries. Every growth rate, margin, EBITDA figure (PBT + finance cost +
D&A − other income), QoQ/YoY change and promise verdict is computed in Python against reported figures.

### Model routing, caching, cost

| Tier | Models (fallback chain) | Used for |
|---|---|---|
| `cheap` | gemini-3.5-flash-lite → 3.1-flash-lite | the ~13% of filings the rules can't classify, in batches of 25 |
| `extract` | gemini-3.6-flash → 3.5-flash → 3.5-flash-lite | results tables (only the 2 relevant PDF pages are sent), appointee profiles, guidance quotes |
| `reason` | same chain, higher thinking budget | the ledger's 3-line synthesis (it may cite only ledger rows) |

- **Rules first.** 87% of filings (242 of 278) are classified by subject and text rules at zero cost. The other 36 took **4** batched calls.
- **Every call is cached** on (tier, prompt, document hash, schema). A repeat request is instant and free, and research decks are cached against a fingerprint of their inputs.
- **The router copes with free-tier reality.** A 429 or 503 retries the same model with backoff. A *daily* quota error marks that model exhausted and moves straight to the next one in the chain, so work degrades rather than failing. A deck that lost a model call is shown but never cached, so the next request rebuilds it.
- **Measured cost.** Building and testing everything, including prewarming 22 research decks and 18 results cards, came to **₹86.51 at Gemini list prices** over 325 logged calls, with a 39% cache-hit rate. Actual spend was **₹0**, because all of it ran on the free tier. A first-time deck for a new ticker is typically 60–130k input tokens, ₹2–4.6 at list price, and less for companies with few calls. A repeat costs ₹0. Live totals: `/api/stats/cost`.

### Judgment calls worth knowing about

- **One event, many filings.** Info Edge's MD & CEO transition arrived as 7 separate filings. FINN groups them into one event, and the senior-most filing leads it.
- **A share-price move belongs to the results.** On a results day, the move is credited to the results card and not to a director note filed the same evening.
- **Not every "red flag" category is one.** A *mandatory* auditor rotation is routine. An auditor *resignation* or a CFO exit is flagged.
- **Honest numbers.** 13 of 18 results cards match screener.in's figures independently. Two disagree (SUNPHARMA, RADICO) and carry a ⚠ instead of being shown as fine. Three filings read as standalone (BANKBARODA, NAUKRI, MARUTI) are marked unverified, because screener's figures are consolidated.
- **Fair promise checks.** Segment-level guidance ("30% growth in solutions and products") is never scored against company-wide revenue. A loss that narrows is not called a "strong quarter".
- **Primary sources only on the pull side.** That means transcripts, annual reports and exchange filings, plus screener's standardised tables (themselves built from filings). No news, no broker notes, and no model memory.

### Deliberately left out

Business snapshot and bull/bear (we chose checking promises over writing opinions), LLM one-liners for every other
filing type (a ranked, cleaned headline is enough), web-search bios, voice, real phone push, and annual-report
deep notes (related-party transactions, contingent liabilities). Cut sections stream as explicit "not in this prototype" entries.

### Where it goes next

Push notifications (Web Push or Telegram) for thesis breaks. Exact results from exchange XBRL once NSE's integrated filings expose it, instead of reading PDFs.
Analyst-question tone tracking across calls. Per-user portfolios and auth. Confidence intervals on "too early" pillars.

## Repo layout

```
backend/finn/
  ingest/   nse.py · prices.py · screener.py · pdf.py · http.py      data plumbing (polite, cached)
  push/     classify.py · events.py · score.py · digest.py · alerts.py · enrich/{results,person}.py
  pull/     compute.py (deterministic sections) · ledger.py · research.py · thesis.py
  llm/      router.py        tiers, fallback chains, cache, cost meter, health
  api/      main.py          FastAPI (/api/brief, /api/research/{symbol} SSE, /api/theses, …)
  jobs/     __main__.py      seed · eod · filings · enrich · prewarm · copy-db
frontend/   Next.js 16 app (Brief, Holdings, Thesis, Research, Ask, Alerts)
contracts/  api.md + fixtures: the frontend/backend contract both sessions built against
PLAN.md     the phased plan and session log, kept as the work happened
vercel.json one project, two services; .github/workflows/ingest.yml refreshes production (needs the DATABASE_URL and GEMINI_API_KEY repo secrets)
```

## Run it locally

```bash
cp .env.example .env            # add GEMINI_API_KEY; DATABASE_URL defaults to local SQLite
cd backend && uv sync
uv run python -m finn.jobs seed     # equity list, 6 months of prices, 30 days of filings, fundamentals
uv run python -m finn.jobs prewarm  # results/person cards + research decks (and so theses)
uv run uvicorn finn.api.main:app --port 8000
cd ../frontend && npm install && NEXT_PUBLIC_API_BASE=http://localhost:8000 npm run dev
```

## Built with AI

The whole build was done in Claude Code. Two sessions ran in parallel, one on the backend and one on the frontend,
coordinating through `contracts/api.md`; the backend session later took over frontend integration and deployment.
The build history is submitted alongside this repo.
