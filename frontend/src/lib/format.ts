// Number and date formatting. Money is ₹ crore throughout (see contracts/api.md).

const IN = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const IN1 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 });

/** ₹14,820 Cr; ≥1 lakh crore collapses to "₹1.2L Cr". */
export function cr(v: number | null | undefined): string {
  if (v == null) return "—";
  const a = Math.abs(v);
  if (a >= 100000) return `₹${IN1.format(v / 100000)}L Cr`;
  if (a >= 100) return `₹${IN.format(v)} Cr`;
  return `₹${IN1.format(v)} Cr`;
}

/** Bare crore number for dense tables: 14,820. */
export function crBare(v: number | null | undefined): string {
  if (v == null) return "—";
  return Math.abs(v) >= 100 ? IN.format(v) : IN1.format(v);
}

/** Signed percentage with an arrow: ▲ 31.0% / ▼ 6.1%. */
export function pct(v: number | null | undefined, digits = 1): string {
  if (v == null) return "—";
  if (v === 0) return `0%`;
  return `${v > 0 ? "▲" : "▼"} ${Math.abs(v).toFixed(digits)}%`;
}

/** Signed without arrow: +2.3% / −6.1%. */
export function signed(v: number | null | undefined, unit = "%", digits = 1): string {
  if (v == null) return "—";
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(digits)}${unit}`;
}

export function price(v: number): string {
  // Exchange prices tick in paise; above ₹10,000 the paise are noise on a phone.
  const d = v >= 10000 ? 0 : 2;
  return `₹${new Intl.NumberFormat("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d }).format(v)}`;
}

export function tone(v: number | null | undefined): "up" | "down" | "flat" {
  if (v == null || Math.abs(v) < 0.05) return "flat";
  return v > 0 ? "up" : "down";
}

/** "2h ago", "yesterday 16:07", "28 Oct". Evaluated in IST. */
export function when(iso: string, now = Date.now()): string {
  const t = new Date(iso).getTime();
  const mins = Math.round((now - t) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 12) return `${hrs}h ago`;
  const d = new Date(iso);
  const opts = { timeZone: "Asia/Kolkata" } as const;
  const day = d.toLocaleDateString("en-IN", { ...opts, day: "numeric", month: "short" });
  const time = d.toLocaleTimeString("en-IN", { ...opts, hour: "2-digit", minute: "2-digit", hour12: false });
  return hrs < 36 ? `yesterday ${time}` : `${day}, ${time}`;
}

export function day(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });
}

export const CATEGORY_LABEL: Record<string, string> = {
  results: "Results", "M&A": "M&A", fund_raise: "Fund raise", management_change: "Management",
  litigation: "Litigation", insider_trading: "Insider trade", earnings_call: "Earnings call",
  investor_meetings: "Investor meet", credit_rating: "Rating", dividend: "Dividend", bonus_split: "Bonus / split",
  capex: "Capex", press_release: "Press release", postal_ballot: "Postal ballot", agm_egm: "AGM / EGM",
  pledging: "Pledge", unclassified: "Other",
};

export function inr(v: number): string {
  return v === 0 ? "₹0" : v < 0.01 ? "<₹0.01" : `₹${v.toFixed(2)}`;
}

export function tokens(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`;
}
