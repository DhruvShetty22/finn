"use client";

import Link from "next/link";
import { use, useEffect, useState, useSyncExternalStore } from "react";
import useSWR from "swr";
import { AnimatePresence, motion, type PanInfo } from "motion/react";
import { streamResearch, type ResearchHead } from "@/lib/api";
import type { Cost, Portfolio, Section, SectionKey } from "@/lib/types";
import { day, inr, tokens } from "@/lib/format";
import { CitationChip } from "@/components/citation";
import { LLM_SECTIONS, SECTION_ORDER, SECTION_SHORT, SECTION_WORK, SectionBody } from "@/components/research/sections";
import { EmptyState, PageHeader, Skeleton } from "@/components/ui";

type Panel = "overview" | SectionKey;
const PANELS: Panel[] = ["overview", ...SECTION_ORDER];

// The URL hash picks the opening panel, so a challenged pillar can deep-link straight to #ledger.
const subscribeHash = (cb: () => void) => { window.addEventListener("hashchange", cb); return () => window.removeEventListener("hashchange", cb); };
const hashPanel = (): Panel | null => {
  const h = window.location.hash.slice(1) as Panel;
  return PANELS.includes(h) ? h : null;
};

export function Deck({ params }: { params: Promise<{ symbol: string }> }) {
  const symbol = decodeURIComponent(use(params).symbol).toUpperCase();
  const [head, setHead] = useState<ResearchHead | null>(null);
  const [sections, setSections] = useState<Partial<Record<SectionKey, Section>>>({});
  const [done, setDone] = useState<{ total_cost: Cost; elapsed_ms: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Panel | null>(null);
  const fromHash = useSyncExternalStore(subscribeHash, hashPanel, () => null);
  const panel = chosen ?? fromHash ?? "overview";
  const [dir, setDir] = useState(1);
  const [elapsedMs, setElapsedMs] = useState(0);
  const { data: portfolio } = useSWR<Portfolio>("/portfolio");
  const held = portfolio?.holdings.some((h) => h.symbol === symbol);

  useEffect(() => {
    // A ticking clock while LLM sections are still out, so a 30s cold run reads as progress, not a hang.
    const t0 = Date.now();
    const tick = setInterval(() => setElapsedMs(Date.now() - t0), 500);
    const cancel = streamResearch(symbol, {
      onHead: setHead,
      onSection: (s) => setSections((prev) => ({ ...prev, [s.key]: s })),
      onDone: (d) => { clearInterval(tick); setDone(d); },
      onError: (m) => { clearInterval(tick); setError(m); },
    });
    return () => { clearInterval(tick); cancel(); };
  }, [symbol]);

  function go(p: Panel) {
    setDir(PANELS.indexOf(p) >= PANELS.indexOf(panel) ? 1 : -1);
    setChosen(p);
    history.replaceState(null, "", p === "overview" ? " " : `#${p}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function onSwipe(_: unknown, info: PanInfo) {
    if (Math.abs(info.offset.x) < 70 || Math.abs(info.offset.y) > Math.abs(info.offset.x)) return;
    const i = PANELS.indexOf(panel) + (info.offset.x < 0 ? 1 : -1);
    if (i >= 0 && i < PANELS.length) go(PANELS[i]);
  }

  const ready = Object.keys(sections).length;
  const elapsed = ((done?.elapsed_ms ?? elapsedMs) / 1000).toFixed(0);

  if (error && ready === 0) {
    return (
      <div>
        <PageHeader back="/ask" eyebrow="Research" title={symbol} />
        <EmptyState title="Couldn't build this deck" body={error}
          action={<Link href="/ask" className="mt-2 rounded-full bg-accent px-4 py-1.5 text-small font-medium text-accent-ink">Try another ticker</Link>} />
      </div>
    );
  }

  return (
    <div>
      <PageHeader back="/ask" eyebrow={head ? `${symbol} · as of ${day(head.as_of)}` : "Research"} title={head?.name ?? symbol}
        right={held && <Link href={`/thesis/${symbol}`} className="rounded-full border border-line px-3 py-1 text-small text-ink-2 hover:text-ink">Thesis</Link>} />

      {/* Section tabs. Each shows whether its content has arrived. */}
      <nav className="sticky top-[calc(env(safe-area-inset-top)+4.1rem)] z-20 border-b border-line bg-bg/85 backdrop-blur-xl" aria-label="Deck sections">
        <ul className="no-scrollbar flex gap-1 overflow-x-auto px-3 py-2">
          {PANELS.map((p) => {
            const s = p === "overview" ? null : sections[p];
            const pending = p !== "overview" && !s;
            return (
              <li key={p}>
                <button onClick={() => go(p)} aria-current={panel === p}
                  ref={panel === p ? (el) => el?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" }) : undefined}
                  className={`flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-small transition-colors ${
                    panel === p ? "bg-ink text-bg" : "text-ink-2 hover:bg-surface"
                  }`}>
                  {pending && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />}
                  {s?.status === "empty" && <span className="h-1.5 w-1.5 rounded-full bg-ink-3/50" />}
                  {p === "overview" ? "Overview" : SECTION_SHORT[p]}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <motion.div drag="x" dragConstraints={{ left: 0, right: 0 }} dragElastic={0.15} dragDirectionLock onDragEnd={onSwipe} className="touch-pan-y">
        <AnimatePresence mode="wait" initial={false} custom={dir}>
          <motion.div key={panel} custom={dir}
            initial={{ x: dir * 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: dir * -40, opacity: 0 }}
            transition={{ duration: 0.16 }} className="px-4 pt-4 pb-6">
            {panel === "overview" ? (
              <Overview sections={sections} head={head} go={go} held={!!held} symbol={symbol} />
            ) : (
              <SectionPanel k={panel} s={sections[panel]} elapsed={elapsed} />
            )}
          </motion.div>
        </AnimatePresence>
      </motion.div>

      <CostFooter done={done} sections={sections} ready={ready} elapsed={elapsed} error={error} />
    </div>
  );
}

function Overview({ sections, head, go, held, symbol }: {
  sections: Partial<Record<SectionKey, Section>>; head: ResearchHead | null; go: (p: Panel) => void; held: boolean; symbol: string;
}) {
  return (
    <div>
      <div className="eyebrow mb-3">The deck in seven lines</div>
      <ol className="space-y-1">
        {SECTION_ORDER.map((k) => {
          const s = sections[k];
          return (
            <li key={k}>
              <button onClick={() => go(k)} className="group flex w-full gap-3 rounded-xl px-2 py-2.5 text-left hover:bg-surface">
                <span className="w-20 shrink-0 pt-0.5 text-micro font-medium text-ink-3">{SECTION_SHORT[k]}</span>
                {s ? (
                  <span className={`flex-1 text-body leading-snug ${s.status === "ok" ? "text-ink" : "text-ink-3"} ${k === "ledger" ? "font-medium" : ""}`}>
                    {s.takeaway}
                  </span>
                ) : (
                  <span className="flex-1 space-y-1.5 pt-1">
                    <Skeleton className="h-3.5 w-full" />
                    <span className="block text-micro text-ink-3">{SECTION_WORK[k]}…</span>
                  </span>
                )}
                <span className="pt-0.5 text-ink-3 group-hover:text-accent">›</span>
              </button>
            </li>
          );
        })}
      </ol>
      {!held && (
        <p className="mt-4 rounded-xl bg-surface px-3 py-2.5 text-small text-ink-2">
          {symbol} isn&apos;t in your portfolio. The promise ledger would seed its thesis if you add it.
        </p>
      )}
      {head && head.sources.length > 0 && (
        <div className="mt-6">
          <div className="eyebrow mb-2">Primary sources read</div>
          <div className="flex flex-wrap gap-1.5">
            {head.sources.map((c) => <CitationChip key={c.url + c.doc} c={c} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function SectionPanel({ k, s, elapsed }: { k: SectionKey; s: Section | undefined; elapsed: string }) {
  if (!s) {
    return (
      <div>
        <h2 className="text-title font-semibold tracking-tight">{SECTION_SHORT[k]}</h2>
        <div className="mt-3 flex items-center gap-2 text-small text-ink-2">
          <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
          {SECTION_WORK[k]}… <span className="num text-ink-3">{elapsed}s</span>
        </div>
        {LLM_SECTIONS.has(k) && <p className="mt-1 text-micro text-ink-3">First run reads the documents; after that it&apos;s cached and instant.</p>}
        <div className="mt-5 space-y-3">
          <Skeleton className="h-5 w-4/5" />
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </div>
    );
  }
  return (
    <article>
      <h2 className="text-title font-semibold tracking-tight">{s.title}</h2>
      <p className="mt-1.5 text-lead leading-snug text-ink-2">{s.takeaway}</p>
      <div className="mt-5"><SectionBody s={s} /></div>
      {s.key !== "ledger" && s.key !== "bull_bear" && s.citations.length > 0 && (
        <div className="mt-5 flex flex-wrap gap-1.5">
          {s.citations.map((c, i) => <CitationChip key={i} c={c} n={i + 1} />)}
        </div>
      )}
      <div className="mt-6 border-t border-line/60 pt-2 text-micro text-ink-3">
        {s.cost.model ? (
          <>{s.cost.cached ? "Cached · ₹0" : `${inr(s.cost.inr)} · ${tokens(s.cost.tokens_in + s.cost.tokens_out)} tokens`} · {s.cost.model}</>
        ) : (
          <>Computed in code from reported numbers · ₹0</>
        )}
      </div>
    </article>
  );
}

function CostFooter({ done, sections, ready, elapsed, error }: {
  done: { total_cost: Cost; elapsed_ms: number } | null; sections: Partial<Record<SectionKey, Section>>;
  ready: number; elapsed: string; error: string | null;
}) {
  const running = Object.values(sections).reduce((s, x) => s + (x?.cost.cached ? 0 : x?.cost.inr ?? 0), 0);
  return (
    <div className="mx-4 mb-6 flex items-center justify-between rounded-xl border border-line bg-surface px-3 py-2 text-micro">
      {done ? (
        done.total_cost.cached || done.total_cost.inr === 0 ? (
          <span className="text-ink-2">Served from cache · <span className="num">₹0</span> · <span className="num">{elapsed}s</span></span>
        ) : (
          <span className="text-ink-2">
            <span className="num font-medium text-ink">{inr(done.total_cost.inr)}</span> ·{" "}
            <span className="num">{tokens(done.total_cost.tokens_in + done.total_cost.tokens_out)}</span> tokens ·{" "}
            <span className="num">{elapsed}s</span> · cached next time
          </span>
        )
      ) : (
        <span className="text-ink-2">
          Building · <span className="num">{ready}/{SECTION_ORDER.length}</span> sections · <span className="num">{inr(running)}</span> so far · <span className="num">{elapsed}s</span>
        </span>
      )}
      {error && <span className="text-down">stream interrupted</span>}
    </div>
  );
}
