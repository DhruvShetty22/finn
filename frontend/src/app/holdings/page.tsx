"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import type { Holding, Portfolio, Rules } from "@/lib/types";
import { day, price, signed } from "@/lib/format";
import { ErrorState, PageHeader, Skeleton, Sparkline, STATUS_META } from "@/components/ui";

const ORDER = { challenged: 0, watch: 1, intact: 2, none: 3 } as const;
type SortKey = "thesis" | "weight" | "move";
const SORTS: Record<SortKey, { label: string; cmp: (a: Holding, b: Holding) => number }> = {
  thesis: { label: "Thesis", cmp: (a, b) => ORDER[a.thesis_status] - ORDER[b.thesis_status] || b.weight - a.weight },
  weight: { label: "Weight", cmp: (a, b) => b.weight - a.weight },
  move: { label: "Move", cmp: (a, b) => Math.abs(b.chg_pct) - Math.abs(a.chg_pct) },
};
// Used until /rules loads, matching the contract defaults.
const DEFAULT_RULES = { volume_multiple: 2, price_move_pct: 5 };

export default function HoldingsPage() {
  const { data, error, mutate } = useSWR<Portfolio>("/portfolio");
  const { data: rules } = useSWR<Rules>("/rules");
  const anyThesis = data?.holdings.some((h) => h.thesis_status !== "none") ?? false;
  const [sort, setSort] = useState<SortKey | null>(null);
  const active: SortKey = sort ?? (anyThesis ? "thesis" : "weight");

  const r = rules ?? DEFAULT_RULES;
  const crossed = (h: Holding) => ({ move: Math.abs(h.chg_pct) >= r.price_move_pct, vol: h.vol_ratio >= r.volume_multiple });
  const movers = data ? data.holdings.filter((h) => crossed(h).move || crossed(h).vol).sort(SORTS.move.cmp) : [];
  const rows = data ? [...data.holdings].sort(SORTS[active].cmp) : [];

  return (
    <div>
      <PageHeader title="Holdings" eyebrow={data ? `${data.holdings.length} holdings · close of ${day(data.as_of)}` : "Portfolio"} />
      {error && !data ? (
        <ErrorState error={error} retry={() => mutate()} />
      ) : !data ? (
        <div className="space-y-2 p-4">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
      ) : (
        <>
          {movers.length > 0 && (
            <section className="px-4 pt-4">
              <div className="eyebrow mb-2">
                Crossed your rules today · <span className="num">±{r.price_move_pct}%</span> or <span className="num">{r.volume_multiple}×</span> volume
              </div>
              <ul className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
                {movers.map((h) => {
                  const c = crossed(h);
                  return (
                    <li key={h.symbol} className="shrink-0">
                      <Link href={`/research/${h.symbol}`} className="block w-32 rounded-2xl border border-line bg-surface px-3 py-2.5 hover:border-line-strong">
                        <div className="text-small font-semibold">{h.symbol}</div>
                        <div className={`num text-lead font-semibold ${h.chg_pct > 0 ? "text-up" : "text-down"} ${c.move ? "" : "opacity-60"}`}>{signed(h.chg_pct)}</div>
                        <div className={`num text-micro ${c.vol ? "text-watch" : "text-ink-3"}`}>{h.vol_ratio.toFixed(1)}× avg volume</div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <div className="flex items-center justify-between px-4 pt-4 pb-1">
            <span className="eyebrow">All holdings</span>
            <div className="flex gap-0.5 rounded-full bg-surface p-0.5" role="radiogroup" aria-label="Sort holdings">
              {(Object.keys(SORTS) as SortKey[]).filter((k) => k !== "thesis" || anyThesis).map((k) => (
                <button key={k} role="radio" aria-checked={active === k} onClick={() => setSort(k)}
                  className={`rounded-full px-2.5 py-0.5 text-micro font-medium ${active === k ? "bg-surface-2 text-ink" : "text-ink-3"}`}>
                  {SORTS[k].label}
                </button>
              ))}
            </div>
          </div>
          <ul className="divide-y divide-line/70">
            {rows.map((h) => <Row key={h.symbol} h={h} crossed={crossed(h)} />)}
          </ul>
        </>
      )}
    </div>
  );
}

function Row({ h, crossed }: { h: Holding; crossed: { move: boolean; vol: boolean } }) {
  const s = STATUS_META[h.thesis_status];
  const hasThesis = h.thesis_status !== "none";
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <Link href={hasThesis ? `/thesis/${h.symbol}` : `/research/${h.symbol}`} className="flex min-w-0 flex-1 items-center gap-3">
        <span className={`h-9 w-1 shrink-0 rounded-full ${hasThesis ? s.dot : "bg-line"}`} title={`Thesis: ${s.label}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold tracking-tight">{h.symbol}</span>
            {h.unseen > 0 && (
              <span className="num rounded-full bg-accent-soft px-1.5 text-micro font-semibold text-accent">{h.unseen}</span>
            )}
          </div>
          <div className="truncate text-micro text-ink-3">
            <span className="num">{h.weight}%</span>
            {hasThesis && <> · <span className={s.text}>{s.label}</span></>}
            {" · "}{h.sector}
          </div>
        </div>
        <Sparkline values={h.spark} width={56} height={22} className="shrink-0" />
        <div className="w-[5.25rem] shrink-0 text-right">
          <div className="num text-small">{price(h.close)}</div>
          <div className="num text-micro">
            <span className={`${h.chg_pct > 0 ? "text-up" : h.chg_pct < 0 ? "text-down" : "text-ink-3"} ${crossed.move ? "font-semibold" : ""}`}>
              {signed(h.chg_pct)}
            </span>
            {crossed.vol && <span className="text-watch"> · {h.vol_ratio.toFixed(1)}×</span>}
          </div>
        </div>
      </Link>
      <Link href={`/research/${h.symbol}`} aria-label={`Research ${h.symbol}`}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-3 hover:bg-surface-2 hover:text-accent">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" />
        </svg>
      </Link>
    </li>
  );
}
