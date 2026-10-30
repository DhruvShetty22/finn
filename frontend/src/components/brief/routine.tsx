"use client";

import { useState } from "react";
import type { Brief } from "@/lib/types";
import { CATEGORY_LABEL, when } from "@/lib/format";
import { ExternalIcon } from "../ui";

/** Routine filings stay folded into one row; the counts say what was filtered out, so nothing feels hidden. */
export function Routine({ routine }: { routine: Brief["routine"] }) {
  const [open, setOpen] = useState(false);
  if (routine.count === 0) return null;
  const cats = Object.entries(routine.by_category).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));

  return (
    <section className="mx-4 rounded-2xl border border-line bg-surface">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-3 px-4 py-3 text-left">
        <div className="min-w-0 flex-1">
          <div className="text-body font-medium">
            <span className="num">{routine.count}</span> routine filings
          </div>
          <div className="truncate text-micro text-ink-3">
            {cats.map(([c, n]) => `${n} ${CATEGORY_LABEL[c]?.toLowerCase() ?? c}`).join(" · ")}
          </div>
        </div>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
          className={`shrink-0 text-ink-3 transition-transform ${open ? "rotate-180" : ""}`}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <ul className="border-t border-line/70">
          {routine.items.map((it) => (
            <li key={it.id} className="flex items-center gap-3 border-b border-line/50 px-4 py-2.5 last:border-b-0">
              <span className="w-20 shrink-0 truncate text-micro font-semibold text-ink-2">{it.symbol}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-small text-ink">{it.headline}</div>
                <div className="text-micro text-ink-3">
                  {CATEGORY_LABEL[it.category]} · {when(it.ts)}
                  {it.card?.kind === "chip" && <span className="num"> · {it.card.value}</span>}
                </div>
              </div>
              {it.pdf_url && (
                <a href={it.pdf_url} target="_blank" rel="noreferrer" aria-label="Open filing" className="shrink-0 text-ink-3 hover:text-ink">
                  <ExternalIcon />
                </a>
              )}
            </li>
          ))}
          {routine.items.length < routine.count && (
            <li className="px-4 py-2 text-micro text-ink-3">
              Showing {routine.items.length} of {routine.count}
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
