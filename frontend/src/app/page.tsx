"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { AnimatePresence, motion } from "motion/react";
import type { Brief, Item, Portfolio } from "@/lib/types";
import { api, FIXTURE_FALLBACK, USING_FIXTURES } from "@/lib/api";
import { ItemCard } from "@/components/brief/item-card";
import { ThesisHealth } from "@/components/brief/thesis-health";
import { Routine } from "@/components/brief/routine";
import { presetWindow, WindowPicker, type BriefWindow } from "@/components/brief/window-picker";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui";

export default function BriefPage() {
  const [win, setWin] = useState<BriefWindow>(() => presetWindow("24h"));
  const key = win.from && win.to ? `/brief?from=${encodeURIComponent(win.from)}&to=${encodeURIComponent(win.to)}` : "/brief";
  const { data, error, isLoading, mutate } = useSWR<Brief>(key, { keepPreviousData: true });
  const { data: portfolio } = useSWR<Portfolio>("/portfolio");

  // Swiped-away items leave the list right away; the last one can be undone.
  const [done, setDone] = useState<Set<string>>(new Set());
  const [kept, setKept] = useState<Set<string>>(new Set());
  const [undo, setUndo] = useState<Item | null>(null);
  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), 4000);
    return () => clearTimeout(t);
  }, [undo]);

  function triage(item: Item, action: "seen" | "keep") {
    if (action === "keep") {
      setKept((s) => new Set(s).add(item.id));
      api.keep(item.id).catch(() => {});
      return;
    }
    setDone((s) => new Set(s).add(item.id));
    setUndo(item);
    api.markSeen(item.id).catch(() => {});
  }

  const visible = (items: Item[]) => items.filter((i) => !done.has(i.id));
  const keptItems = data ? [...data.top, ...data.worth_reading].filter((i) => kept.has(i.id) && !done.has(i.id)) : [];
  const unkept = (items: Item[]) => visible(items).filter((i) => !kept.has(i.id));

  return (
    <div>
      <header className="flex items-center justify-between px-4 pt-[calc(env(safe-area-inset-top)+1rem)]">
        <div className="flex items-baseline gap-2">
          <span className="text-title font-semibold tracking-tight">FINN</span>
          <span className="text-micro text-ink-3">{data?.window.label ?? "Brief"}</span>
        </div>
        {(USING_FIXTURES || FIXTURE_FALLBACK) && (
          <span className="rounded-full border border-watch/40 px-2 py-0.5 text-micro text-watch">{USING_FIXTURES ? "fixtures" : "live + fixtures"}</span>
        )}
      </header>

      {error && !data ? (
        <ErrorState error={error} retry={() => mutate()} />
      ) : !data ? (
        <BriefSkeleton />
      ) : (
        <>
          <ThesisHealth summary={data.summary} holdings={portfolio?.holdings} material={[...data.top, ...data.worth_reading]} />

          <div className="sticky top-0 z-20 bg-bg/85 px-4 pt-[calc(env(safe-area-inset-top)+0.5rem)] pb-2 backdrop-blur-xl">
            <WindowPicker value={win} onChange={setWin} />
          </div>

          <div className={`transition-opacity ${isLoading ? "opacity-50" : ""}`}>
            {data.window.widened_from && (
              <p className="mx-4 mt-2 rounded-xl bg-surface px-3 py-2 text-small text-ink-2">
                Nothing material in the {data.window.widened_from.toLowerCase()}, so this shows the{" "}
                <span className="text-ink">{data.window.label.toLowerCase()}</span>.
              </p>
            )}

            {keptItems.length > 0 && (
              <Group title="Kept" count={keptItems.length}>
                {keptItems.map((it) => <ItemCard key={it.id} item={it} defaultOpen={false} />)}
              </Group>
            )}

            <Group title="Needs your attention" count={unkept(data.top).length} hint="Swipe → keep · ← done">
              {unkept(data.top).length === 0 ? (
                <EmptyState title="All clear" body="Nothing material against your theses in this window." />
              ) : (
                unkept(data.top).map((it) => <Triageable key={it.id} item={it} open={!!(it.card || it.thesis)} onTriage={triage} />)
              )}
            </Group>

            {unkept(data.worth_reading).length > 0 && (
              <Group title="Worth reading" count={unkept(data.worth_reading).length}>
                {unkept(data.worth_reading).map((it) => <Triageable key={it.id} item={it} open={false} onTriage={triage} />)}
              </Group>
            )}

            <div className="mt-6 pb-6">
              <Routine routine={data.routine} />
            </div>
          </div>
        </>
      )}

      <AnimatePresence>
        {undo && (
          <motion.div
            key={undo.id}
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 20, opacity: 0 }}
            className="fixed inset-x-0 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-40 mx-auto flex w-fit items-center gap-3 rounded-full border border-line bg-surface-2 py-1.5 pr-1.5 pl-4 text-small shadow-lg"
          >
            <span className="text-ink-2">{undo.symbol} marked done</span>
            <button
              onClick={() => { setDone((s) => { const n = new Set(s); n.delete(undo.id); return n; }); setUndo(null); }}
              className="rounded-full bg-accent px-3 py-1 font-medium text-accent-ink"
            >
              Undo
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Triageable({ item, open, onTriage }: { item: Item; open: boolean; onTriage: (i: Item, a: "seen" | "keep") => void }) {
  return (
    <motion.div layout exit={{ opacity: 0, height: 0, marginTop: 0 }} transition={{ duration: 0.2 }}>
      <ItemCard item={item} defaultOpen={open} onTriage={onTriage} />
    </motion.div>
  );
}

function Group({ title, count, hint, children }: { title: string; count: number; hint?: string; children: React.ReactNode }) {
  return (
    <section className="mt-5">
      <div className="flex items-baseline justify-between px-4 pb-2">
        <h2 className="eyebrow">
          {title} <span className="num text-ink-2">{count}</span>
        </h2>
        {hint && <span className="text-micro text-ink-3">{hint}</span>}
      </div>
      <div className="space-y-3 px-4">
        <AnimatePresence initial={false}>{children}</AnimatePresence>
      </div>
    </section>
  );
}

function BriefSkeleton() {
  return (
    <div className="space-y-4 px-4 pt-4">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-11 w-28" />
      <Skeleton className="h-2.5 w-full" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="mt-4 h-9 w-full rounded-full" />
      {[0, 1, 2].map((i) => <Skeleton key={i} className="h-40 w-full rounded-2xl" />)}
    </div>
  );
}
