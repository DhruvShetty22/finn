// Mirrors contracts/api.md (v0). Change the contract first, then this file.

export type ThesisStatus = "intact" | "watch" | "challenged" | "none";
export type Verdict = "supports" | "challenges" | "neutral";

export type Category =
  | "results" | "M&A" | "fund_raise" | "management_change" | "litigation" | "insider_trading"
  | "earnings_call" | "investor_meetings" | "credit_rating" | "dividend" | "bonus_split" | "capex"
  | "press_release" | "postal_ballot" | "agm_egm" | "pledging" | "unclassified";

export type Holding = {
  symbol: string; name: string; sector: string; weight: number;
  close: number; chg_pct: number; vol_ratio: number; spark: number[];
  thesis_status: ThesisStatus; unseen: number;
};
export type Portfolio = { as_of: string; holdings: Holding[] };

export type ThesisImpact = { pillar_id: string; pillar: string; verdict: Verdict; reason: string };

export type ResultsRow = {
  metric: "Revenue" | "EBITDA" | "PBT" | "PAT" | "NII" | "PPOP";
  cur: number; prev_q: number; prev_y: number; qoq_pct: number | null; yoy_pct: number | null;
};
export type ResultsCard = {
  kind: "results"; period: string; basis: "consolidated" | "standalone"; is_financial: boolean;
  rows: ResultsRow[];
  margin: { label: string; cur: number; prev_q: number; prev_y: number } | null;
  ebitda_formula: string | null;
  check: "matched" | "mismatch" | "unverified";
  verdict: string;
};
export type PersonCard = {
  kind: "person"; name: string; role: string;
  change: "appointed" | "resigned" | "retired" | "redesignated";
  effective: string | null; bio: string;
  prior: { org: string; role: string; years: string | null }[];
  source: "filing" | "web"; source_url: string | null; red_flag: string | null;
};
export type DealCard = {
  kind: "deal"; what: string; counterparty: string | null; value_cr: number | null;
  pct_of_mcap: number | null; pct_of_revenue: number | null;
};
export type RatingCard = {
  kind: "rating"; agency: string; instrument: string; from: string | null; to: string;
  outlook: string | null; direction: "upgrade" | "downgrade" | "reaffirm" | "new";
};
export type ChipCard = { kind: "chip"; label: string; value: string; date: string | null };
export type Card = ResultsCard | PersonCard | DealCard | RatingCard | ChipCard;

export type Tier = "top" | "read" | "routine" | "hidden";
export type Item = {
  id: string; symbol: string; company: string; ts: string;
  category: Category; subject: string; source: "NSE" | "BSE"; pdf_url: string | null;
  tier: Tier; score: number; why: string; headline: string;
  thesis: ThesisImpact | null; card: Card | null;
  market: { chg_pct: number; vol_ratio: number } | null;
  seen: boolean;
};

export type Brief = {
  window: { from: string; to: string; label: string; widened_from: string | null };
  summary: {
    theses_intact: number; theses_total: number; challenged: string[];
    material: number; routine: number; headline: string;
  };
  top: Item[];
  worth_reading: Item[];
  routine: { count: number; by_category: Partial<Record<Category, number>>; items: Item[] };
  alerts_unseen: number;
};

export type Alert = {
  id: string; ts: string; symbol: string;
  kind: "volume" | "price" | "category" | "thesis";
  message: string; value: number | null; threshold: number | null;
  item_id: string | null; seen: boolean;
};

export type Rules = {
  volume_multiple: number; volume_lookback: number; price_move_pct: number;
  categories: Record<Category, boolean>; thesis_alerts: boolean;
};

export type Citation = { doc: string; date: string; url: string; page: number | null; quote: string | null };

export type PillarStatus = "on_track" | "at_risk" | "broken" | "untested";
export type Pillar = {
  id: string; text: string;
  metric: "revenue_growth" | "ebitda_margin" | "pat_growth" | "capex" | "order_book" | "volume" | "other";
  target: string | null; period: string | null;
  source: Citation; status: PillarStatus;
  evidence: { ts: string; item_id: string | null; verdict: "supports" | "challenges"; note: string }[];
};
export type Thesis = {
  symbol: string; status: ThesisStatus;
  drafted_from: { doc: string; date: string; url: string }[];
  user_edited: boolean; pillars: Pillar[];
};
export type PillarInput = Pick<Pillar, "text" | "metric" | "target" | "period"> & { id?: string };

export type Cost = { tokens_in: number; tokens_out: number; inr: number; cached: boolean; model: string | null };

export type SectionKey =
  | "snapshot" | "financials" | "trajectory" | "balance_sheet" | "cash_quality" | "ledger" | "bull_bear";
export type Section = {
  key: SectionKey; status: "ok" | "empty" | "error";
  title: string; takeaway: string;
  // Shape depends on key; see research_KPITTECH.json and the narrowing types below.
  data: Record<string, unknown>;
  citations: Citation[]; cost: Cost;
};
export type ResearchDeck = {
  symbol: string; name: string; as_of: string; sources: Citation[];
  sections: Section[]; total_cost: Cost;
};

// Section payloads, as in the fixture.
export type Tile = { label: string; value: number; unit: "cr" | "%" | "x"; delta_pct: number | null; delta_label: string | null };
export type FinancialsData = { tiles: Tile[] };
export type TrajectoryData = {
  periods: string[];
  series: { metric: string; unit: "cr" | "%"; values: number[]; cagr_3y: number | null; cagr_5y: number | null }[];
  callouts: { kind: "compressing" | "growing" | "flat"; text: string }[];
};
export type BalanceSheetData = {
  tiles: Tile[];
  wc: { periods: string[]; debtor_days: number[]; inventory_days: number[]; payable_days: number[]; ccc: number[] };
};
export type CashQualityData = {
  periods: string[]; cfo: number[]; pat: number[]; fcf: number[]; cfo_to_pat: number[];
  cfo_to_pat_5y: number; verdict: "good" | "ok" | "weak";
};
export type SnapshotData = {
  what_it_does: string;
  segments: { name: string; share_pct: number; growth_pct: number | null }[];
  key_facts: string[];
};
export type PromiseVerdict = "delivered" | "partly" | "missed" | "too_early";
export type LedgerData = {
  score: Record<PromiseVerdict, number>;
  quarters: string[];
  promises: {
    id: string; said_in: string; said_on: string; checked_in: string; metric: string;
    quote: string; page: number | null; target: string | null; actual: string | null;
    verdict: PromiseVerdict; note: string; url: string;
  }[];
  synthesis: { text: string; cites: number[] }[];
};
export type BullBearData = { bull: { point: string; cite: number }[]; bear: { point: string; cite: number }[] };

export type SearchResult = { symbol: string; name: string };
