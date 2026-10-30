"use client";

import Link from "next/link";
import useSWR from "swr";
import type { Holding, Portfolio } from "@/lib/types";
import { day, price, signed } from "@/lib/format";
import { ErrorState, PageHeader, Skeleton, Sparkline, STATUS_META } from "@/components/ui";

const ORDER = { challenged: 0, watch: 1, intact: 2, none: 3 } as const;

export default function HoldingsPage() {
  const { data, error, mutate } = useSWR<Portfolio>("/portfolio");
  const rows = data ? [...data.holdings].sort((a, b) => ORDER[a.thesis_status] - ORDER[b.thesis_status] || b.weight - a.weight) : [];

  return (
    <div>
      <PageHeader title="Holdings" eyebrow={data ? `Close of ${day(data.as_of)}` : "Portfolio"} />
      {error && !data ? (
        <ErrorState error={error} retry={() => mutate()} />
      ) : !data ? (
        <div className="space-y-2 p-4">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
      ) : (
        <ul className="divide-y divide-line/70">
          {rows.map((h) => <Row key={h.symbol} h={h} />)}
        </ul>
      )}
    </div>
  );
}

function Row({ h }: { h: Holding }) {
  const s = STATUS_META[h.thesis_status];
  const hot = h.vol_ratio >= 2;
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <Link href={`/thesis/${h.symbol}`} className="flex min-w-0 flex-1 items-center gap-3">
        <span className={`h-9 w-1 shrink-0 rounded-full ${s.dot}`} title={`Thesis: ${s.label}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold tracking-tight">{h.symbol}</span>
            {h.unseen > 0 && (
              <span className="num rounded-full bg-accent-soft px-1.5 text-micro font-semibold text-accent">{h.unseen}</span>
            )}
          </div>
          <div className="truncate text-micro text-ink-3">
            <span className={s.text}>{s.label}</span> · {h.sector} · <span className="num">{h.weight}%</span>
          </div>
        </div>
        <Sparkline values={h.spark} width={56} height={22} className="shrink-0" />
        <div className="w-[4.5rem] shrink-0 text-right">
          <div className="num text-small">{price(h.close)}</div>
          <div className={`num text-micro ${h.chg_pct > 0 ? "text-up" : h.chg_pct < 0 ? "text-down" : "text-ink-3"}`}>
            {signed(h.chg_pct)}
            {hot && <span className="text-watch"> · {h.vol_ratio.toFixed(1)}×</span>}
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
