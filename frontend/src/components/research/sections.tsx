"use client";

import type {
  BalanceSheetData, BullBearData, CashQualityData, FinancialsData, LedgerData, Section, SectionKey,
  SnapshotData, Tile, TrajectoryData,
} from "@/lib/types";
import { cr, signed } from "@/lib/format";
import { CitationChip } from "../citation";
import { BarSeries, PairedBars, ShareBar } from "./charts";
import { Ledger } from "./ledger";

export const SECTION_ORDER: SectionKey[] = ["snapshot", "financials", "trajectory", "ledger", "balance_sheet", "cash_quality", "bull_bear"];
export const SECTION_SHORT: Record<SectionKey, string> = {
  snapshot: "Business", financials: "Numbers", trajectory: "Trajectory", ledger: "Promises",
  balance_sheet: "Balance sheet", cash_quality: "Cash", bull_bear: "Bull vs bear",
};
/** What FINN is doing while a section is pending. The LLM sections take tens of seconds on a cold run. */
export const SECTION_WORK: Record<SectionKey, string> = {
  financials: "Computing from Screener tables",
  trajectory: "Computing multi-year growth",
  balance_sheet: "Computing leverage and working capital",
  cash_quality: "Comparing cash flow with profit",
  snapshot: "Reading the annual report's MD&A and segment note",
  ledger: "Pulling guidance from 5 concall transcripts, then matching each promise against reported numbers",
  bull_bear: "Weighing the compiled facts, with a citation for every point",
};
export const LLM_SECTIONS = new Set<SectionKey>(["snapshot", "ledger", "bull_bear"]);

export function SectionBody({ s }: { s: Section }) {
  if (s.status === "empty") return <p className="text-small text-ink-3">{s.takeaway}</p>;
  if (s.status === "error") return <p className="text-small text-down">This section failed to build. {s.takeaway}</p>;
  switch (s.key) {
    case "financials": return <Tiles tiles={(s.data as FinancialsData).tiles} />;
    case "trajectory": return <Trajectory d={s.data as TrajectoryData} />;
    case "balance_sheet": return <BalanceSheet d={s.data as BalanceSheetData} />;
    case "cash_quality": return <CashQuality d={s.data as CashQualityData} />;
    case "snapshot": return <Snapshot d={s.data as SnapshotData} />;
    case "ledger": return <Ledger data={s.data as LedgerData} citations={s.citations} />;
    case "bull_bear": return <BullBear d={s.data as BullBearData} s={s} />;
  }
}

function tileValue(t: Tile) {
  if (t.unit === "cr") return t.value < 0 && t.delta_label === "net cash" ? cr(-t.value) : cr(t.value);
  if (t.unit === "%") return `${t.value.toFixed(1)}%`;
  return `${t.value.toFixed(2)}×`;
}

function Tiles({ tiles }: { tiles: Tile[] }) {
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line">
      {tiles.map((t) => (
        <div key={t.label} className="bg-surface px-3 py-2.5">
          <dt className="text-micro text-ink-3">{t.label}</dt>
          <dd className="num mt-0.5 text-lead font-semibold">{tileValue(t)}</dd>
          {t.delta_pct != null ? (
            <dd className={`num text-micro ${t.delta_pct > 0 ? "text-up" : t.delta_pct < 0 ? "text-down" : "text-ink-3"}`}>
              {t.delta_label?.startsWith("pp") ? signed(t.delta_pct, "pp") : signed(t.delta_pct)} <span className="text-ink-3">{t.delta_label?.replace(/^pp\s*/, "")}</span>
            </dd>
          ) : t.delta_label ? (
            <dd className="text-micro text-ink-3">{t.delta_label}</dd>
          ) : null}
        </div>
      ))}
    </dl>
  );
}

const CALLOUT = { compressing: { g: "↘", c: "text-watch" }, growing: { g: "↗", c: "text-up" }, flat: { g: "→", c: "text-ink-3" } } as const;

function Trajectory({ d }: { d: TrajectoryData }) {
  return (
    <div className="space-y-5">
      {d.callouts.length > 0 && (
        <ul className="space-y-1.5">
          {d.callouts.map((c, i) => (
            <li key={i} className="flex gap-2 text-small">
              <span className={`${CALLOUT[c.kind]?.c ?? "text-ink-3"} font-semibold`}>{CALLOUT[c.kind]?.g ?? "·"}</span>
              <span className="text-ink-2">{c.text}</span>
            </li>
          ))}
        </ul>
      )}
      {d.series.map((s) => (
        <BarSeries key={s.metric} periods={d.periods} values={s.values} unit={s.unit} label={s.metric}
          note={[s.cagr_3y != null && `3y CAGR ${s.cagr_3y.toFixed(1)}%`, s.cagr_5y != null && `5y CAGR ${s.cagr_5y.toFixed(1)}%`].filter(Boolean).join(" · ") || null} />
      ))}
    </div>
  );
}

function BalanceSheet({ d }: { d: BalanceSheetData }) {
  const rows: [string, number[]][] = [
    ["Debtor days", d.wc.debtor_days], ["Inventory days", d.wc.inventory_days],
    ["Payable days", d.wc.payable_days], ["Cash cycle", d.wc.ccc],
  ];
  return (
    <div className="space-y-4">
      <Tiles tiles={d.tiles} />
      <div className="overflow-x-auto no-scrollbar">
        <table className="w-full text-small">
          <caption className="eyebrow pb-1.5 text-left">Working capital, days</caption>
          <thead>
            <tr className="text-micro text-ink-3">
              <th className="py-1 text-left font-normal" />
              {d.wc.periods.map((p) => <th key={p} className="num py-1 text-right font-normal">{p}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.filter(([, v]) => v.some((x) => x !== 0)).map(([label, v]) => {
              const delta = v[v.length - 1] - v[0];
              return (
                <tr key={label} className={`border-t border-line/60 ${label === "Cash cycle" ? "font-medium" : ""}`}>
                  <td className="py-1.5 pr-2 text-ink-2">{label}</td>
                  {v.map((x, i) => (
                    <td key={i} className={`num py-1.5 text-right ${i === v.length - 1 && label !== "Payable days" && delta > 5 ? "text-watch" : ""}`}>{x}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const CASH_VERDICT = { good: "text-up", ok: "text-ink-2", weak: "text-down" } as const;

function CashQuality({ d }: { d: CashQualityData }) {
  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-2">
        <span className="num text-display font-semibold">{d.cfo_to_pat_5y.toFixed(2)}×</span>
        <span className="text-small text-ink-2">operating cash flow per ₹1 of profit, 5-year</span>
        <span className={`ml-auto text-micro font-medium ${CASH_VERDICT[d.verdict]}`}>{d.verdict === "good" ? "✓ Good" : d.verdict === "weak" ? "⚑ Weak" : "OK"}</span>
      </div>
      <PairedBars periods={d.periods} a={d.cfo} b={d.pat} labels={["CFO", "PAT"]} />
      <table className="w-full text-small">
        <tbody>
          <tr className="border-t border-line/60">
            <td className="py-1.5 text-ink-2">CFO / PAT</td>
            {d.cfo_to_pat.map((v, i) => <td key={i} className={`num py-1.5 text-right ${v < 0.8 ? "text-down" : ""}`}>{v.toFixed(2)}</td>)}
          </tr>
          <tr className="border-t border-line/60">
            <td className="py-1.5 text-ink-2">FCF, ₹ Cr</td>
            {d.fcf.map((v, i) => <td key={i} className={`num py-1.5 text-right ${v < 0 ? "text-down" : ""}`}>{new Intl.NumberFormat("en-IN").format(v)}</td>)}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function Snapshot({ d }: { d: SnapshotData }) {
  return (
    <div className="space-y-4">
      <p className="text-body leading-relaxed">{d.what_it_does}</p>
      {d.segments.length > 0 && (
        <div>
          <div className="eyebrow mb-2">Revenue mix</div>
          <ShareBar parts={d.segments} />
        </div>
      )}
      {d.key_facts.length > 0 && (
        <ul className="space-y-1.5 border-t border-line/60 pt-3">
          {d.key_facts.map((f) => <li key={f} className="flex gap-2 text-small text-ink-2"><span className="text-ink-3">—</span>{f}</li>)}
        </ul>
      )}
    </div>
  );
}

function BullBear({ d, s }: { d: BullBearData; s: Section }) {
  const col = (title: string, glyph: string, cls: string, pts: BullBearData["bull"]) => (
    <div>
      <div className={`mb-2 text-small font-semibold ${cls}`}>{glyph} {title}</div>
      <ul className="space-y-3">
        {pts.map((p, i) => (
          <li key={i} className="text-body leading-snug">
            {p.point}{" "}
            {s.citations[p.cite] && <CitationChip c={s.citations[p.cite]} n={p.cite + 1} />}
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <div className="space-y-6">
      {col("Bull case", "↑", "text-up", d.bull)}
      {col("Bear case", "↓", "text-down", d.bear)}
      <p className="text-micro text-ink-3">Written only from the fact pack above, never from model memory. Every point cites a primary document.</p>
    </div>
  );
}
