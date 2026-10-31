# FINN — Build Plan

> ENAM AI Engineer Build Challenge. Source briefs: `1. ENAM_AI_Engineer_Build_Challenge_Main.pdf`, `2. ENAM_AI_Engineer_Build_Challenge_Reference.pdf`.
> **Deadline: Sunday 1 Nov 2026.** Plan written Fri 30 Oct, 17:30 IST, so we have about 2.5 working days.
> At the end of every session: tick the boxes below, add a line to the **Session log**, and commit.

---

## ⏱ Crunch scope (decided Sat 31 Oct, 19:10 IST): this overrides the phase lists below
About one working day is left, so we build only what the brief weights most. Everything else is cut.

| # | Deliverable | Why it's in (brief's words) |
|---|---|---|
| M1 | Results card: Revenue/EBITDA/PBT/PAT, QoQ/YoY, from the filing | "two examples we love" |
| M2 | Management-change person card, bio taken from the filing | "two examples we love" |
| M3 | Threshold alerts (price ±X%, volume k×, categories) + `/api/alerts` | "Triggered alerts… I decide what unusual means" |
| M4 | `/api/research/{any NSE symbol}`: deterministic sections + **promise ledger** | "numbers vs narrative… what we value most"; "must generalise" |
| M5 | Thesis-lite: pillars = latest guidance from M4's extraction; numeric checks vs results in code | our interaction point of view (Thesis Guardian) |
| M6 | Deployed link + cron | "a demo that doesn't run is the worst outcome" |
| M7 | README (architecture, routing, cost) + writeup + build history + email | submission |

**Status, Sat 31 Oct ~20:30:** M1 ✅ (18/18 cards, 14 match screener exactly, mismatches flagged ⚠) · M2 ✅ (person cards from filing profiles) · M3 ✅ · M4 ✅ (22 decks prewarmed; TRENT shows the no-transcript path) · M5 ✅ (theses for 17 holdings, edit via PUT) · M6 ⏳ waiting on Neon/Render/Vercel accounts; `copy-db`, `ingest.yml` and `keepalive.yml` are ready · M7 ⏳ Sunday.
Gemini: the free daily quota for the Flash models ran out on Sat evening (it resets about 13:30 IST). The router's daily-quota breaker moves everything to Flash-Lite, and quality held up.

**Cut:** LLM one-liners for other categories (a ranked, cleaned headline is enough), business snapshot, bull/bear, web-search bios, voice, real phone push, BSE fallback, AR deep notes.
Research sections that are cut return `status: "empty"`.

## 0. What's being graded (read this first)

| They said | What it means for us |
|---|---|
| "Creativity, product sense, judgment, architecture, *not* completeness" | Do fewer things, do them well, and explain why we chose them. |
| "Thin-but-working beats broad-but-broken… a demo that doesn't run is the worst outcome" | The deployed link must work even when the scrapers or LLMs fail, so we serve from cache. |
| "Frontend is the heart… show a point of view on interaction" | The frontend gets the most time. It needs a clear interaction idea, not a generic dashboard. |
| "Efficiency earns bonus points" | Rules before LLMs, cheap models for bulk work, a strong model only for reasoning, cache everything, and show the cost in the UI. |
| "Pull must be grounded in primary sources only" | Use only annual reports and transcripts, with citations on every claim. Numbers are computed in code, not by the LLM. |
| "Numbers vs narrative… what we value most" | The guidance check ("promise ledger") is the showpiece of the pull side. |
| "Must generalise to any NSE ticker" | Nothing is hard-coded per company. Missing data shows a clear empty state. |
| Deliverables | Deployed mobile link, GitHub repo, **AI build history**, and a covering email to assessment@enam.com with subject **"ENAM - IIT screening - 2027"**. |

---

## 1. Product concept: **Thesis Guardian** ✅ (decided)

**The point of view:** a high-conviction investor doesn't need to know *what happened*. They need to know **whether their conviction is still justified.** FINN keeps a short **thesis** for every holding and judges every new fact against it.

- **Thesis per holding:** 2–4 falsifiable **pillars** (e.g. *"EBITDA margin 13–14% in FY27"*), **drafted automatically from management's own concall guidance**. Each pillar cites the quote and page, and the user can edit it. Pillar status is `on_track / at_risk / broken / untested`, and it rolls up to the holding as `intact / watch / challenged`.
- **Brief (Push):** a headline line at the top, e.g. "Theses intact 15/18 · 1 challenged". It is followed by ranked cards, each with a **thesis verdict** (supports / challenges / neutral) and a *why*. Routine filings collapse into one row. A window picker offers 24h, 3d, 7d or a custom range. If the window is empty, it widens automatically (24h → 3d → 7d).
- **Rich cards where they earn it:**
  - results: QoQ/YoY numbers card
  - management change: person card with the bio from the filing
  - deal, rating and litigation: one-liners with a materiality %
  - everything else: a chip or collapsed into Routine
- **Alerts:** user-set thresholds (volume ≥ k× its 20-day average, |move| ≥ X%, categories), plus **thesis alerts** ("a pillar was just challenged").
- **Push → pull bridge:** a challenged pillar links to the **promise ledger**: management's last 4 quarters of promises vs delivery. That ledger is also the evidence for the thesis.
- **Ask FINN (Pull):** a command bar for any NSE ticker. It returns a structured, swipeable research deck with citations, and its guidance extraction seeds that company's thesis.
- **Cost honesty:** each research view shows its footprint, e.g. "₹0.82 · 121k tokens · cached next time".
- **Stretch:** "Play my brief" (browser text-to-speech), voice input for Ask, real phone push.
- **Fallback if time runs short:** without the thesis layer it is still a working triage inbox. Thesis tags sit on top as an extra layer.

---

## 2. Architecture & stack (recommended)

```
 GitHub Actions cron ──► Python ingestion worker ──► Postgres (Neon/Supabase free)
  (EOD 16:30 IST,          prices · announcements ·      ▲
   filings every 30m)      classify · score · enrich     │
                                                         │
 Next.js PWA (Vercel) ◄──── FastAPI backend (Render/Fly free, keep-alive ping)
  Brief · Alerts ·           /digest /alerts /rules /research (SSE stream)
  Research · Ask bar         Pull pipeline: screener → PDFs → extract → compute → reason
```

- **Backend:** Python 3.12 + FastAPI + SQLModel/SQLAlchemy. Python because yfinance and PDF tooling live there.
- **PDF text:** PyMuPDF (fast). Scanned PDFs go straight to a vision-capable model.
- **Frontend:** Next.js + Tailwind + Framer Motion (for gestures), installed as a PWA with a manifest so it can be added to the home screen. We use a custom design language rather than stock component-library looks, to avoid "AI slop".
- **DB:** SQLite locally, Postgres in production (same ORM).
- **LLM router** (`llm/router.py`), **Gemini only** ✅, with three tiers set by env vars `FINN_MODEL_*`:
  - `cheap`: fallback classification and batched one-liners (Gemini Flash-Lite).
  - `extract`: PDF → JSON for results numbers, guidance statements, appointee profiles and thesis pillars (Gemini Flash, which reads PDFs natively).
  - `reason`: qualitative ledger verdicts, synthesis and bull/bear (Gemini Pro if the free tier allows it, otherwise Flash with thinking).
  - Every call is cached by `hash(model, prompt, doc)` and logged to `llm_calls` (tokens, ₹ cost, purpose).
  - Free-tier limits are per project and differ by model; reports in Oct 2026 conflict, so **confirm with `models.list` and AI Studio once the key is in.** Free-tier inputs may be used by Google for training, which is fine because all our inputs are public filings.

### Repo layout
```
finn/
  backend/finn/
    ingest/   prices.py  nse.py  bse.py  screener.py  pdf.py
    push/     classify.py  score.py  digest.py  alerts.py
              enrich/ results.py  mgmt.py  oneliner.py
    pull/     docs.py  compute.py  guidance.py  synthesize.py
    llm/      router.py  cache.py  prompts/
    api/      main.py  schemas.py
    jobs/     run_eod.py  run_filings.py  prewarm.py
  frontend/   (Next.js app)
  contracts/  api.md + fixtures/*.json   ← lets frontend & backend sessions run in parallel
  .github/workflows/ingest.yml
  README.md  PLAN.md
```

### Core tables
`companies(symbol, name, sector, mcap, in_portfolio, weight)` ·
`prices(symbol, date, o,h,l,c, volume)` ·
`announcements(id, symbol, ts, subject, source_cat, category, pdf_url, text, score, tier, why, summary, enrichment_json)` ·
`alert_rules(...)` · `alerts(id, rule, symbol, ts, payload, seen)` ·
`documents(symbol, kind, period, url, sha, text)` · `research(symbol, section, as_of, json, cost)` ·
`llm_calls(ts, model, purpose, tok_in, tok_out, cost, cache_hit)`

---

## 3. Phases

Each phase is sized to fit one session. Its **Done when** line is the handoff a fresh session can verify.

### Phase 0: Decisions & scaffolding (≈1–1.5h) · *Session 1, Fri evening*
- [x] Confirm decisions D1–D5 (bottom of file).
- [x] **Portfolio (18)** in `backend/finn/portfolio.yaml`: one company per sector, 8 large and 10 mid caps. **All 18 filed Q2 FY27 results between 27 and 30 Oct**, and the set covers management changes (NAUKRI, DIXON, RADICO), a rating action (SUZLON), M&A (KPITTECH, APARINDS, DELHIVERY), an order win (LT), a GST penalty (DELHIVERY) and a mandatory auditor rotation (SUNPHARMA). BANKBARODA is the bank-format test.
- [x] **Research set:** KPITTECH, DIXON (in the portfolio), POLYCAB, PERSISTENT (outside). *Confirm on screener in Phase 1 that they have transcripts.*
- [x] `git init`, repo layout, `.gitignore` (the brief PDFs are excluded), `.env.example`, uv backend on Python 3.12 with dependencies installed, Next.js scaffold.
- [x] `contracts/api.md` + 6 fixtures (brief, alerts, rules, portfolio, thesis, research).
- [x] `GEMINI_API_KEY` in `.env`; models probed and tiers set (see D2).
- [x] Private GitHub remote `DhruvShetty22/finn`, pushed. Make it public at submission.
- **Done when:** the repo is pushed, the portfolio list is committed as `backend/finn/portfolio.yaml`, the contracts and fixtures exist, and the keys work.

**What we learned while probing (Phase 0):**
- `GET nseindia.com/api/corporate-announcements?index=equities&from_date=…&to_date=…` works **without** a symbol: one call returns *all* equities (30 days = 13k filings, 9 MB, 3s). So we fetch in bulk and filter locally. The homepage returns 403, but the API still answers with browser headers.
- Constituent lists come from `nsearchives.nseindia.com/content/indices/ind_nifty500list.csv`. The `equity-stockIndices` API returned 404.
- Filings carry `hasXbrl: true`, so results may be available as **structured XBRL**: exact numbers at zero LLM cost. Try that first in Phase 2.
- **One event, many filings:** NAUKRI's MD transition arrived as 4 filings (Change in Management, Resignation, Appointment ×2). We need to group them into events.
- Noise is heavy: 667 of 3,109 filings in 4 days were "Analysts/Institutional Investor Meet" updates, and 343 were newspaper ads.

### Phase 1: Data plumbing (≈4–5h) · *Session 2, Fri night / Sat early*
Plumbing only: get it working and don't gold-plate it.
- [x] **EOD prices:** batch `yf.download([...".NS"], period="6mo")`, then upsert. Fallback if Yahoo rate-limits: the NSE daily bhavcopy CSV.
- [x] **Announcements (NSE):** one bulk call per date range (see the Phase 0 findings), filtered to the portfolio. For research or ad-hoc symbols, add `&symbol=`. Store `seq_id`, `desc` (subject), `attchmntText`, `attchmntFile` (PDF), `sort_date` and `hasXbrl`. **Fallback adapter: BSE API**, because NSE often blocks cloud IPs.
- [x] **Screener.in fetcher:** for any symbol, get the quarterly, P&L, balance sheet, cash flow and ratios tables as structured JSON, plus **document links** (annual reports and concall transcripts). Try consolidated first, then fall back to standalone.
- [x] **PDF fetch + text extraction** with caching by URL/sha, and detection of scanned PDFs (low text density → flag for the vision model).
- [x] Polite rate limits, retries and an on-disk HTTP cache, so development doesn't hammer the sources.
- [x] Seed the DB locally: 6 months of prices and 30 days of announcements for the portfolio.
- [ ] **Walking skeleton deploy:** FastAPI `/health` + `/announcements` on the host, and a bare Next.js page on Vercel showing the raw list. This proves the deploy path on day 1 instead of Sunday.
- [x] Test the NSE fetch **from GitHub Actions** early, to find out whether it gets blocked.
- **Status (Fri 30 Oct, 18:45):** all built, in `finn/ingest/*` with `python -m finn.jobs seed|eod|filings|fundamentals`.
  - Local DB: 2,620 equities, 6 months of EOD for 18 holdings, 246 filings over 30 days, screener data for 22 companies.
  - **CI probe passed:** NSE bulk, screener, Yahoo and BSE are all reachable from GitHub runners, so the BSE fallback is a contingency, not needed now.
  - The deploy is ready (`backend/Dockerfile`, tested locally; `render.yaml`) and **waits on the Neon, Render and Vercel accounts**.
  - Gotcha: the newest concall often has **no transcript yet** (published days later), so the ledger anchors on the latest call that has one.
- **Done when:** `python -m finn.jobs.run_eod` and `run_filings` populate the DB, `screener.py SYMBOL` returns tables and document links for an arbitrary ticker, and the skeleton is live on a phone.

### Phase 2: Push engine (≈4–5h) · *Session 3, Sat morning*
- [x] **Event grouping:** merge filings that share a symbol, have similar text and fall within about 2h, or share a PDF stem, into one event. The card shows "grouped 4 filings".
- [x] **Classifier, rules first:** map the NSE/BSE subject and category strings to the 17 reference categories with a lookup table and regexes, at zero cost. Send only the leftovers ("General Updates", "Press Release" etc.) to the `cheap` model in **batches**. Hand-label about 40 announcements and report accuracy in the README.
- [x] **Priority score (explainable):** `base(category) × user_care(category) + modifiers`. Modifiers:
  - a same-day abnormal price or volume move
  - the position's weight in the portfolio
  - **materiality ratio** (order/deal/fine size as a % of TTM revenue or net worth)
  - rating direction (a downgrade outranks a reaffirmation)
  - red flags (CFO or auditor resignation, rising pledge)

  The score maps to tiers **Top / Worth reading / Routine (collapsed) / Hidden**, and every item carries a generated `why` string.
- [ ] **Treatment per category** (the "what earns attention" judgment):

  | Category | Treatment |
  |---|---|
  | results | **Numbers card:** Revenue, EBITDA, PBT, PAT, current vs previous quarter vs same quarter last year (all three columns are in the standard SEBI results format), QoQ/YoY %, margins. Cross-checked against the Screener quarterly table, with a ⚠ flag on any mismatch. |
  | management_change | **Person card:** name, role, joining or leaving, effective date, background. The profile is taken first from the filing itself (SEBI Reg. 30 appointment filings include a "brief profile"), then optionally enriched by web search (LinkedIn snippet). |
  | M&A / fund_raise / capex / litigation / credit_rating / pledging / insider | **One-liner with the key number:** deal size as % of mcap, dilution %, old → new rating, pledge % change. |
  | dividend / bonus_split / earnings_call notice | Compact chip: amount, record date, call time. A transcript gets a "→ run guidance check" link. |
  | investor_meetings / agm_egm / postal_ballot / unclassified | Collapsed under Routine, with the filing link only. |

- [ ] **Results extraction:** **XBRL first** (exact and free). If there is no XBRL, pass the first pages of the PDF to the `extract` tier with a JSON schema. EBITDA is computed **in code** (PBT + finance cost + D&A − other income), with the formula shown in the UI. Prefer consolidated figures. Spot-check 5 filings by hand.
- [ ] **Alerts engine:** runs after EOD with configurable rules (volume ≥ k× 20-day average excluding today, |return| ≥ X%, watched categories). Default k = 2 and X = 5%. Rules are stored server-side, single user.
- [ ] **API:** `GET /digest?from&to`, `GET /alerts`, `GET/PUT /rules`, `GET /announcements/{id}`, matching the contracts.
- **Done when:** `/digest` returns a ranked, tiered, enriched digest for the last 24h/7d that matches the contract, at least 2 results cards and 1 person card render correctly, and alerts fire on seeded data.

### Phase 3: Pull research engine (≈5–6h) · *Session 4, Sat afternoon*
The principle is **numbers from code, words from documents, nothing from model memory.**
- [ ] `docs.py`: for any symbol, fetch the latest AR and the **last 5 concall transcripts**. Five, because checking 4 quarters of promises needs the call before the first of them.
- [ ] `compute.py` (deterministic, no LLM), using the Screener tables:
  - Financial snapshot: revenue, margins, PAT, ROE/ROCE
  - Trajectory: 3–5 year CAGRs, and which lines are compressing or expanding
  - Balance sheet: D/E, net debt, working-capital days
  - Cash quality: CFO/PAT, FCF, multi-year trend
- [ ] `guidance.py`, the showpiece:
  1. The `extract` tier pulls guidance statements from each transcript into a schema: `{metric, value/range, period, quote, speaker, call_date, page}`. Boilerplate (safe harbour, operator lines) is stripped first to save tokens.
  2. **Code matches** numeric claims to actuals: revenue growth, OPM/EBITDA margin, capex from the cash-flow table. The verdict is Delivered / Partly / Missed / Too early.
  3. The `reason` tier judges **only** the qualitative claims and writes the 3-line "what they said vs what happened" synthesis. Every line cites its source.
- [ ] `synthesize.py`: business snapshot (from AR MD&A and segment note, located by keyword page search, never the whole 300-page AR) and **bull vs bear** (strong model, given *only* the compiled fact pack, with a citation for every bullet).
- [ ] **Caching and streaming:** results are cached per (symbol, document sha). The `/research/{symbol}` endpoint streams sections over SSE, so deterministic sections appear instantly and LLM sections fill in after. Each section records its cost.
- [ ] Graceful degradation: no transcripts → the guidance section says so plainly, and the rest still renders.
- [ ] **Thesis drafting (`pull/thesis.py`):** reuse the guidance extraction, then pick the 2–4 most specific, checkable forward claims from the latest 2 calls → pillars with citations. Run it for all 18 holdings, at one cheap call per transcript, cached.
- [ ] **Thesis linkage (`push/thesis_link.py`):** for each *material* item only, run one `cheap`/`extract` call with the item plus the pillars → `{pillar_id, verdict, reason}`. Numeric pillars (margin, growth) vs a results card are checked **in code** first, so no LLM is needed. Then roll up the pillar and holding status and fire thesis alerts.
- [ ] `prewarm.py`: pre-compute the 3–5 demo companies and the 18 theses.
- [ ] Generality test: run on 2 tickers we've never touched.
- **Done when:** `/research/<any NSE symbol>` streams a full deck with citations, a cached repeat is instant at ₹0, and the promise ledger looks convincing for at least 2 demo companies.

### Phase 4: Frontend (≈7–9h total) · *Session 5 Sat evening + Session 6 Sun morning*
**Can start in parallel right after Phase 0**, built against `contracts/fixtures` (served at `/fixtures/*.json` through a symlink), then switched to the live API.
⚠ The scaffold is **Next.js 16.4 / React 19.3 / Tailwind 4**, and its `frontend/AGENTS.md` warns of breaking API changes. **Read `frontend/node_modules/next/dist/docs/` before writing code**; don't assume older Next conventions.
- [x] **4a. Design system (≈1h):** type scale, a dense card layout, a single accent colour, semantic red and green used sparingly, dark mode first, number formatting (₹ Cr, %, ▲▼).
- [x] **4b. Brief screen:** thesis health header ("15/18 intact"), window picker, Top cards with thesis verdict badges, "Worth reading", collapsed Routine, results card, person card, one-liner cards, swipe triage, "Dig in →".
- [x] **4b′. Thesis view per holding:** pillars with status, the source quote, and an evidence timeline, which links to the promise ledger. Pillars can be edited inline.
- [x] **4c. Alerts:** inbox with badge, and a rule editor with sliders for k× volume and ±X%, plus category toggles.
- [x] **4d. Research deck:** swipeable sections, a promise-ledger timeline (the showpiece visual), small sparklines for trajectory, citation chips that open the source PDF page, a progressive loading skeleton while sections stream, and a cost footer.
- [x] **4e. Ask bar:** ticker autocomplete over the NSE list, a free-text question (stretch: answered over cached document chunks with BM25, no embeddings cost), and a mic button using the Web Speech API. *(Autocomplete, recents and mic are done; the free-text Q&A stretch is not.)*
- [x] **4f. Portfolio view (minimal):** holdings with daily move and volume ratio, each tapping into its research deck.
- [x] Empty and error states, e.g. "Quiet 24h — showing last 7 days instead". **Evaluators may open the app on a weekend.**
- [ ] PWA manifest, icons, and test on a real phone (iOS Safari and Android Chrome). *(Manifest and icons are done; the real-phone test is still open.)*
- **Done when:** the full Brief → Dig in → Research → Ask loop works on a phone against the live API.

### Phase 5: Deploy & harden (≈2–3h) · *Session 7, Sun early afternoon*
- [ ] GitHub Actions cron: EOD at 16:30 IST, filings every 30 min during market days. **It must keep running after submission**, because the evaluators will look later.
- [ ] Keep-alive ping for the free-tier backend (cron-job.org or the Actions cron).
- [ ] The read paths never call external sources live; they are served from the DB.
- [ ] Pre-warm research caches in production, and check rate-limit and timeout behaviour.
- [ ] Final phone pass: first load under about 2s, no dead buttons, no spinners that never resolve.
- [ ] **Feature freeze: Sun 15:00 IST.**
- **Done when:** a fresh phone with no cache can do the whole demo flow from the public link.

### Phase 6: Submission (≈2h) · *Session 8, Sun evening*
- [ ] README with the architecture diagram, setup steps, model-routing table, a **cost table** (e.g. "full research on a new ticker ≈ X tokens / ₹Y; cached ₹0"), classifier accuracy, known limits.
- [ ] Short demo GIF or video (optional but high value).
- [ ] **AI build history:** use `/export` in each Claude Code session, and/or zip the session transcripts from `~/.claude/projects/-home-shetty-Desktop-iitk-Practice-ENAM/`. Keep every session in this project directory so the history stays in one place.
- [ ] Covering-email writeup: what was built · key decisions and trade-offs · what was deliberately left out · where it goes next.
- [ ] Send to **assessment@enam.com**, subject **"ENAM - IIT screening - 2027"**, with links and attachments.

---

## 4. Priority / cut-line (if behind schedule, cut from the bottom)

| Tier | Items |
|---|---|
| **P0 must ship** | Deployed mobile PWA · digest with classification, priority tiers and window picker · results QoQ/YoY card · management-change card (filing profile only) · price/volume alerts with configurable thresholds · research on any ticker (snapshot, trajectory, **promise ledger**) · README, writeup, build history |
| **P1 should** | Web-search bio enrichment · one-liners with materiality ratio · balance sheet and cash quality · bull/bear · push→pull "Dig in" · cost footer · swipe triage |
| **P2 nice** | Voice brief and voice ask · real push (Web Push or Telegram bot) · follow-up Q&A over documents · AR deep notes (related-party transactions, contingent liabilities, auditor remarks) · 52-week high/low alerts |

## 5. Risks & mitigations

| Risk | Mitigation |
|---|---|
| NSE blocks cloud/CI IPs | BSE fallback adapter. Seed locally. Test from Actions in Phase 1. |
| Yahoo rate-limits yfinance | Batch download, cache, NSE bhavcopy fallback |
| Scanned or messy results PDFs | Text-density check → vision model; cross-check with Screener; ⚠ flag rather than wrong numbers |
| Screener layout changes or throttling | Cache aggressively; parse by table id; polite delays |
| LLM free-tier quota exhaustion | Rules-first, batching, caching, prewarm before the deadline; router can switch providers through env vars |
| Free-host cold start makes the demo look broken | Keep-alive ping; reads served from DB; skeleton loaders |
| Empty 24h window when evaluators look | Cron keeps running; smart empty state that widens the window |
| Running out of time | Contract-first parallel frontend; feature freeze Sun 15:00; cut-line above |

## 6. Decisions (resolved Fri 30 Oct)
- **D1 Stack:** Next.js PWA + FastAPI ✅
- **D2 LLM:** Gemini only ✅. Probed the free tier on 30 Oct: `gemini-3.5-flash-lite` (cheap, ~1s), `gemini-3.6-flash` (extract; reason with a larger thinking budget), fallbacks `gemini-3.5-flash` / `gemini-3.1-flash-lite`. **Pro = 429 (no free quota)**; 3.7/3.8-flash = 504 timeouts. The router uses per-tier fallback chains (`FINN_MODEL_*` in `.env.example`).
- **D3 Hosting:** Vercel + Render/Fly + Neon ✅
- **D4 Concept:** **Thesis Guardian** ✅ (§1). Alternatives considered: Stories brief, Analyst chat thread, plain Triage inbox (still the fallback).
- **D5 Hours:** about 20h over Sat and Sun ✅, so we target P0 + P1 and take P2 items opportunistically.

---

## Session log
| # | Date | Phase | Done | Next |
|---|---|---|---|---|
| 0 | Fri 30 Oct | Planning | Read both briefs, wrote this plan | Phase 0 |
| 1 | Fri 30 Oct | Phase 0 | Decisions D1–D5; probed the NSE API (bulk works); portfolio and research set; repo scaffold; contracts + fixtures | Gemini key, GitHub remote, then Phase 1 |
| 2 | Fri 30 Oct | Phase 4 (parallel: frontend) | Ran alongside session 1 by agreement: frontend/ here, backend/ and remote there. Built all screens against fixtures: design tokens (dark first, one violet accent, validated chart palette), Brief (thesis-health strip, window picker, swipe triage with undo, results/person/deal/rating/chip cards, folded Routine), Thesis (pillars, quotes, evidence timeline, inline edit), Research deck (SSE with per-section skeletons, the promise-ledger timeline, charts, citation chips, cost footer), Ask (autocomplete, recents, mic), Alerts (inbox with threshold gauges, rule editor), Holdings, PWA manifest and icons. tsc, eslint and `next build` are clean | Switch to the live API once /api/brief and /api/portfolio are up; real-phone pass; swipe and PWA install test |
