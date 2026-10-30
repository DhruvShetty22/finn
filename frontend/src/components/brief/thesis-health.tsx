"use client";

import Link from "next/link";
import type { Brief, Holding } from "@/lib/types";
import { STATUS_META } from "../ui";

const ORDER = { challenged: 0, watch: 1, intact: 2, none: 3 } as const;

/**
 * The top of the Brief: not "what happened" but "is my conviction still justified".
 * One tile per holding, worst first, so a challenged thesis is the first thing the eye lands on.
 */
export function ThesisHealth({ summary, holdings }: { summary: Brief["summary"]; holdings: Holding[] | undefined }) {
  const sorted = holdings ? [...holdings].sort((a, b) => ORDER[a.thesis_status] - ORDER[b.thesis_status]) : [];
  const allGood = summary.challenged.length === 0 && summary.theses_intact === summary.theses_total;

  // Before any thesis is drafted there is nothing to guard, so lead with materiality instead of a 0/0.
  if (summary.theses_total === 0) {
    return (
      <section className="px-4 pt-4 pb-5">
        <div className="eyebrow">Material in this window</div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="num text-[2.75rem] leading-none font-semibold tracking-tight">{summary.material}</span>
          <span className="text-body text-ink-3">
            + <span className="num">{summary.routine}</span> routine tucked away
          </span>
        </div>
        <p className="mt-3 text-body text-ink-2">{summary.headline}</p>
        <p className="mt-1 text-small text-ink-3">
          Theses are being drafted from each company&apos;s concall guidance. Until then FINN ranks by materiality and market reaction.
        </p>
      </section>
    );
  }

  return (
    <section className="px-4 pt-4 pb-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="eyebrow">Theses intact</div>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="num text-[2.75rem] leading-none font-semibold tracking-tight">{summary.theses_intact}</span>
            <span className="num text-title text-ink-3">/{summary.theses_total}</span>
          </div>
        </div>
        {summary.challenged.length > 0 && (
          <div className="flex flex-wrap justify-end gap-1.5">
            {summary.challenged.map((s) => (
              <Link key={s} href={`/thesis/${s}`} className="inline-flex items-center gap-1.5 rounded-full bg-down-soft px-2.5 py-1 text-micro font-semibold text-down">
                <span className="h-1.5 w-1.5 rounded-full bg-down" />
                {s} challenged
              </Link>
            ))}
          </div>
        )}
      </div>

      {sorted.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1" role="list" aria-label="Thesis status per holding">
          {sorted.map((h) => (
            <Link
              key={h.symbol}
              role="listitem"
              href={`/thesis/${h.symbol}`}
              title={`${h.symbol}: ${STATUS_META[h.thesis_status].label}`}
              className={`h-2.5 min-w-5 flex-1 rounded-sm ${STATUS_META[h.thesis_status].dot} ${h.thesis_status === "intact" ? "opacity-70" : ""}`}
            >
              <span className="sr-only">{h.symbol}: {STATUS_META[h.thesis_status].label}</span>
            </Link>
          ))}
        </div>
      )}

      <p className="mt-3 text-body text-ink-2">{allGood ? "Nothing in this window threatens your theses." : summary.headline}</p>
    </section>
  );
}
