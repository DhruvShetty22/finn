"use client";

import Link from "next/link";
import useSWR from "swr";
import { api } from "@/lib/api";
import type { Alert } from "@/lib/types";
import { day, when } from "@/lib/format";
import { EmptyState, ErrorState, PageHeader, Skeleton } from "@/components/ui";

const KIND = {
  thesis: { label: "Thesis", glyph: "⛨", cls: "bg-down-soft text-down" },
  volume: { label: "Volume", glyph: "▮▮", cls: "bg-accent-soft text-accent" },
  price: { label: "Price", glyph: "⇅", cls: "bg-accent-soft text-accent" },
  category: { label: "Filing", glyph: "▤", cls: "bg-surface-2 text-ink-2" },
} as const;

export default function AlertsPage() {
  const { data, error, mutate } = useSWR<{ items: Alert[] }>("/alerts");

  function seen(a: Alert) {
    if (a.seen) return;
    mutate({ items: data!.items.map((x) => (x.id === a.id ? { ...x, seen: true } : x)) }, { revalidate: false });
    api.alertSeen(a.id).catch(() => mutate());
  }

  const groups = new Map<string, Alert[]>();
  for (const a of data?.items ?? []) {
    const k = day(a.ts);
    groups.set(k, [...(groups.get(k) ?? []), a]);
  }

  return (
    <div>
      <PageHeader title="Alerts" eyebrow="Thresholds you set"
        right={<Link href="/alerts/rules" className="rounded-full border border-line px-3 py-1 text-small text-ink-2 hover:text-ink">Rules</Link>} />
      {error && !data ? (
        <ErrorState error={error} retry={() => mutate()} />
      ) : !data ? (
        <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
      ) : data.items.length === 0 ? (
        <EmptyState title="No alerts" body="Nothing crossed your thresholds. Loosen them in Rules if this is too quiet."
          action={<Link href="/alerts/rules" className="mt-2 text-small font-medium text-accent">Edit rules →</Link>} />
      ) : (
        [...groups.entries()].map(([d, items]) => (
          <section key={d}>
            <h2 className="eyebrow px-4 pt-4 pb-1.5">{d}</h2>
            <ul>
              {items.map((a) => {
                const k = KIND[a.kind];
                const href = a.kind === "thesis" ? `/thesis/${a.symbol}` : `/research/${a.symbol}`;
                return (
                  <li key={a.id}>
                    <Link href={href} onClick={() => seen(a)} className="flex items-start gap-3 px-4 py-3 hover:bg-surface">
                      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl text-small ${k.cls}`} aria-hidden>{k.glyph}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-micro">
                          <span className="font-semibold text-ink">{a.symbol}</span>
                          <span className="text-ink-3">{k.label} · {when(a.ts)}</span>
                          {!a.seen && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-accent" aria-label="Unseen" />}
                        </div>
                        <p className={`mt-0.5 text-body ${a.seen ? "text-ink-2" : "text-ink"}`}>{a.message}</p>
                        {a.value != null && a.threshold != null && <Gauge a={a} />}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

/** How far past the threshold the value went: the tick is your rule, the bar is what happened. */
function Gauge({ a }: { a: Alert }) {
  const v = Math.abs(a.value!), t = Math.abs(a.threshold!);
  const max = Math.max(v, t) * 1.25;
  const unit = a.kind === "volume" ? "×" : a.kind === "price" ? "%" : a.kind === "thesis" ? "%" : "";
  // A thesis alert fires when the value falls short of the pillar's floor.
  const breached = a.kind === "thesis" ? v < t : v >= t;
  return (
    <div className="mt-1.5 flex items-center gap-2">
      <div className="relative h-1.5 flex-1 rounded-full bg-surface-2">
        <div className={`h-full rounded-full ${breached ? "bg-watch" : "bg-ink-3"}`} style={{ width: `${(v / max) * 100}%` }} />
        <div className="absolute -top-1 h-3.5 w-0.5 rounded-full bg-ink-2" style={{ left: `${(t / max) * 100}%` }} title="Your threshold" />
      </div>
      <span className="num w-24 shrink-0 text-right text-micro text-ink-3">
        {a.value}{unit} vs {a.threshold}{unit}
      </span>
    </div>
  );
}
