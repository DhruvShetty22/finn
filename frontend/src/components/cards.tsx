"use client";

import { useState } from "react";
import type { Card, ChipCard, DealCard, PersonCard, RatingCard, ResultsCard } from "@/lib/types";
import { crBare, cr, day, signed } from "@/lib/format";
import { Delta, ExternalIcon } from "./ui";

export function CardBody({ card }: { card: Card }) {
  switch (card.kind) {
    case "results": return <ResultsView c={card} />;
    case "person": return <PersonView c={card} />;
    case "deal": return <DealView c={card} />;
    case "rating": return <RatingView c={card} />;
    case "chip": return <ChipView c={card} />;
  }
}

const CHECK = {
  matched: { label: "Cross-checked", cls: "text-ink-3" },
  mismatch: { label: "⚠ Differs from Screener", cls: "text-watch" },
  unverified: { label: "Not cross-checked", cls: "text-ink-3" },
} as const;

function ResultsView({ c }: { c: ResultsCard }) {
  const [abs, setAbs] = useState(false);
  return (
    <div className="rounded-xl border border-line bg-bg/40">
      <div className="flex items-center justify-between px-3 pt-2.5 pb-1.5">
        <span className="text-micro text-ink-3">
          {c.period} · {c.basis} · ₹ Cr
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); setAbs((v) => !v); }}
          className="text-micro font-medium text-accent"
          aria-pressed={abs}
        >
          {abs ? "Show change" : "Show values"}
        </button>
      </div>
      <table className="w-full text-small">
        <thead>
          <tr className="text-micro text-ink-3">
            <th className="py-1 pl-3 text-left font-normal">&nbsp;</th>
            <th className="py-1 text-right font-normal">{c.period.split(" ")[0]}</th>
            <th className="py-1 text-right font-normal">{abs ? "Prev Q" : "QoQ"}</th>
            <th className="py-1 pr-3 text-right font-normal">{abs ? "Last yr" : "YoY"}</th>
          </tr>
        </thead>
        <tbody>
          {c.rows.map((r) => (
            <tr key={r.metric} className="border-t border-line/60">
              <td className="py-1.5 pl-3 text-ink-2">{r.metric}</td>
              <td className="num py-1.5 text-right font-medium">{crBare(r.cur)}</td>
              <td className="py-1.5 text-right">{abs ? <span className="num text-ink-2">{crBare(r.prev_q)}</span> : <Delta v={r.qoq_pct} />}</td>
              <td className="py-1.5 pr-3 text-right">{abs ? <span className="num text-ink-2">{crBare(r.prev_y)}</span> : <Delta v={r.yoy_pct} />}</td>
            </tr>
          ))}
          {c.margin && (
            <tr className="border-t border-line/60">
              <td className="py-1.5 pl-3 text-ink-2">{c.margin.label.replace("EBITDA margin", "Margin")}</td>
              <td className="num py-1.5 text-right font-medium">{c.margin.cur.toFixed(1)}%</td>
              <MarginDelta cur={c.margin.cur} prev={c.margin.prev_q} abs={abs} />
              <MarginDelta cur={c.margin.cur} prev={c.margin.prev_y} abs={abs} last />
            </tr>
          )}
        </tbody>
      </table>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-line/60 px-3 py-2 text-micro">
        <span className={CHECK[c.check].cls}>{CHECK[c.check].label}</span>
        {c.ebitda_formula && <span className="text-ink-3" title="EBITDA is computed in code, not by the model">EBITDA = {c.ebitda_formula}</span>}
      </div>
    </div>
  );
}

function MarginDelta({ cur, prev, abs, last }: { cur: number; prev: number; abs: boolean; last?: boolean }) {
  const d = cur - prev;
  return (
    <td className={`num py-1.5 text-right ${last ? "pr-3" : ""} ${abs ? "text-ink-2" : d > 0.05 ? "text-up" : d < -0.05 ? "text-down" : "text-ink-2"}`}>
      {abs ? `${prev.toFixed(1)}%` : signed(d, "pp")}
    </td>
  );
}

const CHANGE_LABEL = { appointed: "Joining", resigned: "Leaving", retired: "Retiring", redesignated: "New role" } as const;

function PersonView({ c }: { c: PersonCard }) {
  const initials = c.name.replace(/\(.*?\)/g, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("");
  const leaving = c.change === "resigned" || c.change === "retired";
  return (
    <div className="rounded-xl border border-line bg-bg/40 p-3">
      <div className="flex items-start gap-3">
        <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-full text-small font-semibold ${leaving ? "bg-surface-2 text-ink-2" : "bg-accent-soft text-accent"}`}>
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-semibold">{c.name}</span>
            <span className={`text-micro font-medium ${leaving ? "text-ink-3" : "text-accent"}`}>
              {CHANGE_LABEL[c.change]}{c.effective && ` · ${day(c.effective)}`}
            </span>
          </div>
          <div className="text-small text-ink-2">{c.role}</div>
        </div>
      </div>
      {c.red_flag && (
        <div className="mt-2.5 rounded-lg bg-down-soft px-2.5 py-1.5 text-small text-down">⚑ {c.red_flag}</div>
      )}
      <p className="mt-2.5 text-small text-ink-2">{c.bio}</p>
      {c.prior.length > 0 && (
        <ol className="mt-2.5 space-y-1.5 border-l border-line pl-3">
          {c.prior.map((p) => (
            <li key={p.org + p.role} className="relative text-small">
              <span className="absolute top-[0.45rem] -left-[0.9rem] h-1.5 w-1.5 rounded-full bg-line-strong" />
              <span className="text-ink">{p.role}</span>
              <span className="text-ink-3"> · {p.org}</span>
              {p.years && <span className="num text-micro text-ink-3"> · {p.years}</span>}
            </li>
          ))}
        </ol>
      )}
      <div className="mt-2.5 text-micro text-ink-3">
        Profile from the {c.source === "filing" ? "exchange filing" : "web"}
        {c.source_url && (
          <a href={c.source_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="ml-1 inline-flex items-center gap-0.5 text-accent">
            source <ExternalIcon />
          </a>
        )}
      </div>
    </div>
  );
}

/** Materiality: the one number that says whether a deal/penalty matters for this company. */
function DealView({ c }: { c: DealCard }) {
  const pctVal = c.pct_of_revenue ?? c.pct_of_mcap;
  const pctLabel = c.pct_of_revenue != null ? "of TTM revenue" : "of market cap";
  // Log-ish scale: 0.1% is a sliver, 5%+ fills the bar.
  const fill = pctVal == null ? 0 : Math.min(100, Math.max(3, (Math.log10(pctVal * 10 + 1) / Math.log10(51)) * 100));
  const material = pctVal != null && pctVal >= 2;
  return (
    <div className="rounded-xl border border-line bg-bg/40 p-3">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <div className="text-small font-medium">{c.what}</div>
          {c.counterparty && <div className="truncate text-micro text-ink-3">{c.counterparty}</div>}
        </div>
        <div className="num shrink-0 text-lead font-semibold">{cr(c.value_cr)}</div>
      </div>
      {pctVal != null && (
        <div className="mt-2.5">
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div className={`h-full rounded-full ${material ? "bg-watch" : "bg-ink-3"}`} style={{ width: `${fill}%` }} />
          </div>
          <div className="mt-1 flex justify-between text-micro">
            <span className={material ? "text-watch" : "text-ink-3"}>{material ? "Material" : "Immaterial"}</span>
            <span className="num text-ink-2">{pctVal.toFixed(pctVal < 1 ? 2 : 1)}% {pctLabel}</span>
          </div>
        </div>
      )}
    </div>
  );
}

const DIRECTION = {
  upgrade: { cls: "text-up", glyph: "▲", label: "Upgrade" },
  downgrade: { cls: "text-down", glyph: "▼", label: "Downgrade" },
  reaffirm: { cls: "text-ink-2", glyph: "=", label: "Reaffirmed" },
  new: { cls: "text-ink-2", glyph: "＋", label: "New rating" },
} as const;

function RatingView({ c }: { c: RatingCard }) {
  const d = DIRECTION[c.direction];
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-bg/40 p-3">
      <div className="flex items-baseline gap-2">
        {c.from && <span className="num text-lead text-ink-3 line-through decoration-1">{c.from}</span>}
        {c.from && <span className="text-ink-3">→</span>}
        <span className={`num text-title font-semibold ${d.cls}`}>{c.to}</span>
      </div>
      <div className="min-w-0 flex-1 text-right">
        <div className={`text-micro font-medium ${d.cls}`}>{d.glyph} {d.label}{c.outlook && ` · ${c.outlook}`}</div>
        <div className="truncate text-micro text-ink-3">{c.agency} · {c.instrument}</div>
      </div>
    </div>
  );
}

function ChipView({ c }: { c: ChipCard }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-line bg-bg/40 px-2.5 py-1 text-micro">
      <span className="text-ink-3">{c.label}</span>
      <span className="num font-medium text-ink">{c.value}</span>
      {c.date && <span className="text-ink-3">· {day(c.date)}</span>}
    </span>
  );
}
