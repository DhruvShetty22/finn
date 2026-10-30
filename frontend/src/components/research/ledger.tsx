"use client";

import { useState } from "react";
import type { Citation, LedgerData, PromiseVerdict } from "@/lib/types";
import { CitationChip } from "../citation";

// Status colour always ships with a glyph and a word, never colour alone.
export const PROMISE_META: Record<PromiseVerdict, { label: string; glyph: string; text: string; fill: string; soft: string }> = {
  delivered: { label: "Delivered", glyph: "✓", text: "text-up", fill: "var(--up)", soft: "bg-up-soft" },
  partly: { label: "Partly", glyph: "◐", text: "text-watch", fill: "var(--watch)", soft: "bg-watch-soft" },
  missed: { label: "Missed", glyph: "✕", text: "text-down", fill: "var(--down)", soft: "bg-down-soft" },
  too_early: { label: "Too early", glyph: "…", text: "text-ink-3", fill: "var(--ink-3)", soft: "bg-surface-2" },
};
const ORDER: PromiseVerdict[] = ["delivered", "partly", "missed", "too_early"];

const METRIC_SHORT: Record<string, string> = {
  revenue_growth: "Growth", ebitda_margin: "Margin", pat_growth: "Profit", capex: "Capex",
  order_book: "Orders", volume: "Volume", other: "Other",
};

/** "Q3 FY26" → 26*4+3; a bare "FY26" sits at its Q4. */
function qIndex(label: string): number | null {
  const m = label.match(/(?:Q([1-4])\s*)?FY\s?(\d{2})/i);
  if (!m) return null;
  return Number(m[2]) * 4 + (m[1] ? Number(m[1]) : 4);
}
const qLabel = (i: number) => `Q${((i - 1) % 4) + 1} FY${Math.floor((i - 1) / 4)}`;

export function Ledger({ data, citations }: { data: LedgerData; citations: Citation[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const testable = data.score.delivered + data.score.partly + data.score.missed;
  const total = ORDER.reduce((s, k) => s + data.score[k], 0) || 1;

  // Timeline columns run from the earliest promise to the latest check.
  const idx = data.promises.flatMap((p) => [qIndex(p.said_in), qIndex(p.checked_in)]).filter((v): v is number => v != null);
  const lo = Math.min(...idx), hi = Math.max(...idx);
  const cols = idx.length ? Array.from({ length: hi - lo + 1 }, (_, i) => lo + i) : [];
  const colX = (q: number) => ((q - lo + 0.5) / cols.length) * 100;

  return (
    <div>
      {/* Track record */}
      <div className="flex items-baseline gap-2">
        <span className="num text-display font-semibold tracking-tight">{data.score.delivered}</span>
        <span className="text-body text-ink-2">of {testable} testable promises delivered in full</span>
      </div>
      <div className="mt-3 flex h-2 gap-[2px] overflow-hidden rounded-full" aria-hidden>
        {ORDER.filter((k) => data.score[k] > 0).map((k) => (
          <div key={k} style={{ width: `${(data.score[k] / total) * 100}%`, background: PROMISE_META[k].fill }} />
        ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-micro">
        {ORDER.map((k) => (
          <li key={k} className={PROMISE_META[k].text}>
            {PROMISE_META[k].glyph} <span className="num font-semibold">{data.score[k]}</span>{" "}
            <span className="text-ink-2">{PROMISE_META[k].label.toLowerCase()}</span>
          </li>
        ))}
      </ul>

      {/* Synthesis: the three lines worth reading */}
      {data.synthesis.length > 0 && (
        <ol className="mt-5 space-y-3">
          {data.synthesis.map((s, i) => (
            <li key={i} className="text-body leading-snug">
              {s.text}{" "}
              <span className="inline-flex flex-wrap gap-1 align-middle">
                {s.cites.map((c) => citations[c] && <CitationChip key={c} c={citations[c]} n={c + 1} />)}
              </span>
            </li>
          ))}
        </ol>
      )}

      {/* Promise timeline: said (hollow) → checked (verdict). Tap a row to read the quote. */}
      <div className="mt-6">
        <div className="eyebrow mb-2">Each promise, from when it was said to when it was checked</div>
        <div className="relative ml-16 flex text-[9px] text-ink-3">
          {cols.map((q) => <div key={q} className="num flex-1 text-center">{qLabel(q).replace(" ", " ")}</div>)}
        </div>
        <ul className="mt-1">
          {data.promises.map((p) => {
            const a = qIndex(p.said_in), b = qIndex(p.checked_in);
            const m = PROMISE_META[p.verdict];
            const isOpen = open === p.id;
            return (
              <li key={p.id} className="border-t border-line/60">
                <button onClick={() => setOpen(isOpen ? null : p.id)} aria-expanded={isOpen}
                  className="flex h-9 w-full items-center text-left">
                  <span className="w-16 shrink-0 truncate text-micro text-ink-2">{METRIC_SHORT[p.metric] ?? p.metric}</span>
                  <span className="relative h-full flex-1">
                    {cols.map((q) => (
                      <span key={q} className="absolute inset-y-1 w-px bg-line/60" style={{ left: `${colX(q) - 50 / cols.length}%` }} />
                    ))}
                    {a != null && b != null && (
                      <>
                        <span className="absolute top-1/2 h-[2px] -translate-y-1/2 rounded-full bg-line-strong"
                          style={{ left: `${colX(a)}%`, width: `${Math.max(0, colX(b) - colX(a))}%` }} />
                        <span className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ink-3 bg-surface"
                          style={{ left: `${colX(a)}%` }} title={`Said in ${p.said_in}`} />
                        <span className={`absolute top-1/2 grid h-5 w-5 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full text-[10px] font-bold ring-2 ring-surface ${m.soft} ${m.text}`}
                          style={{ left: `${colX(b)}%` }} title={`${m.label} by ${p.checked_in}`}>
                          {m.glyph}
                        </span>
                      </>
                    )}
                  </span>
                </button>
                {isOpen && (
                  <div className="mb-3 rounded-xl bg-surface-2/60 p-3">
                    <blockquote className="text-small text-ink italic">&ldquo;{p.quote}&rdquo;</blockquote>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-small">
                      <div><div className="text-micro text-ink-3">Promised</div><div className="num font-medium">{p.target ?? "Qualitative"}</div></div>
                      <div><div className="text-micro text-ink-3">Actual ({p.checked_in})</div><div className={`num font-medium ${m.text}`}>{p.actual ?? "—"}</div></div>
                    </div>
                    <p className="mt-2 text-small text-ink-2"><span className={`font-medium ${m.text}`}>{m.glyph} {m.label}.</span> {p.note}</p>
                    <div className="mt-2">
                      <CitationChip c={{ doc: p.said_in, date: p.said_on, url: p.url, page: p.page, quote: null }} />
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-micro text-ink-3">
          Numeric promises are checked in code against reported figures; only qualitative ones are judged by the model.
        </p>
      </div>
    </div>
  );
}
