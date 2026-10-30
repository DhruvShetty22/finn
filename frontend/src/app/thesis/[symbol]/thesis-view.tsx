"use client";

import Link from "next/link";
import { use, useState } from "react";
import useSWR from "swr";
import { api, ApiError } from "@/lib/api";
import type { Pillar, PillarInput, Thesis } from "@/lib/types";
import { day, when } from "@/lib/format";
import { CitationChip } from "@/components/citation";
import { EmptyState, ErrorState, PageHeader, PILLAR_META, Skeleton, StatusPill } from "@/components/ui";

const METRICS: Pillar["metric"][] = ["revenue_growth", "ebitda_margin", "pat_growth", "capex", "order_book", "volume", "other"];
const METRIC_LABEL: Record<Pillar["metric"], string> = {
  revenue_growth: "Revenue growth", ebitda_margin: "EBITDA margin", pat_growth: "PAT growth", capex: "Capex",
  order_book: "Order book", volume: "Volume", other: "Other",
};

export function ThesisView({ params }: { params: Promise<{ symbol: string }> }) {
  const symbol = decodeURIComponent(use(params).symbol).toUpperCase();
  const { data, error, mutate } = useSWR<Thesis>(`/theses/${symbol}`);
  const [editing, setEditing] = useState(false);

  const header = (
    <PageHeader
      back="/holdings"
      eyebrow="Thesis"
      title={symbol}
      right={data && data.pillars.length > 0 && !editing && (
        <button onClick={() => setEditing(true)} className="rounded-full border border-line px-3 py-1 text-small text-ink-2 hover:text-ink">Edit</button>
      )}
    />
  );

  if (error instanceof ApiError && error.status === 404) {
    return (
      <div>
        {header}
        <EmptyState
          title="No thesis yet"
          body={`FINN drafts a thesis from management's guidance on the last two concalls. Run research on ${symbol} to draft one.`}
          action={<Link href={`/research/${symbol}`} className="mt-2 rounded-full bg-accent px-4 py-1.5 text-small font-medium text-accent-ink">Research {symbol}</Link>}
        />
      </div>
    );
  }
  if (error && !data) return <div>{header}<ErrorState error={error} retry={() => mutate()} /></div>;
  if (!data) return <div>{header}<div className="space-y-3 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-36 w-full rounded-2xl" />)}</div></div>;

  async function save(pillars: PillarInput[]) {
    const optimistic: Thesis = {
      ...data!, user_edited: true,
      pillars: pillars.map((p, i) => {
        const old = data!.pillars.find((o) => o.id === p.id);
        return old ? { ...old, ...p } : {
          id: `new-${i}`, ...p, status: "untested" as const, evidence: [],
          source: { doc: "Your edit", date: new Date().toISOString(), url: "", page: null, quote: null },
        };
      }),
    };
    await mutate(api.saveThesis(symbol, pillars).then((r) => ("pillars" in r ? r : optimistic)), {
      optimisticData: optimistic, rollbackOnError: true, populateCache: true, revalidate: false,
    });
    setEditing(false);
  }

  return (
    <div>
      {header}
      <section className="px-4 pt-4">
        <div className="flex items-center gap-2">
          <StatusPill status={data.status} />
          {data.user_edited && <span className="text-micro text-ink-3">edited by you</span>}
        </div>
        <p className="mt-2 text-small text-ink-3">
          Drafted from management&apos;s own words on{" "}
          {data.drafted_from.map((d, i) => (
            <span key={d.url}>
              {i > 0 && (i === data.drafted_from.length - 1 ? " and " : ", ")}
              <a href={d.url} target="_blank" rel="noreferrer" className="text-ink-2 underline decoration-line-strong underline-offset-2">{d.doc}</a>
            </span>
          ))}
          . Each pillar is a claim that later filings can prove or break.
        </p>
      </section>

      {editing ? (
        <PillarEditor initial={data.pillars} onCancel={() => setEditing(false)} onSave={save} />
      ) : (
        <ol className="mt-4 space-y-3 px-4">
          {data.pillars.map((p, i) => <PillarCard key={p.id} p={p} n={i + 1} />)}
        </ol>
      )}

      <Link href={`/research/${symbol}#ledger`}
        className="mx-4 mt-5 mb-6 flex items-center justify-between rounded-2xl border border-line bg-surface px-4 py-3 hover:border-line-strong">
        <div>
          <div className="text-body font-medium">Does management deliver?</div>
          <div className="text-small text-ink-3">Promises vs results over the last 4 quarters</div>
        </div>
        <span className="text-accent">→</span>
      </Link>
    </div>
  );
}

function PillarCard({ p, n }: { p: Pillar; n: number }) {
  const m = PILLAR_META[p.status];
  return (
    <li id={p.id} className="scroll-mt-24 rounded-2xl border border-line bg-surface target:border-accent">
      <div className="px-4 pt-3.5">
        <div className="flex items-center justify-between gap-2 text-micro">
          <span className="text-ink-3">Pillar {n} · {METRIC_LABEL[p.metric]}{p.period && ` · ${p.period}`}</span>
          <span className={`rounded-full px-2 py-0.5 font-medium ${m.soft} ${m.text}`}>{m.label}</span>
        </div>
        <p className="mt-1.5 text-lead font-medium leading-snug">{p.text}</p>
        {p.source.quote && (
          <blockquote className="mt-2.5 border-l-2 border-line-strong pl-3 text-small text-ink-2 italic">
            &ldquo;{p.source.quote}&rdquo;
          </blockquote>
        )}
        <div className="mt-2"><CitationChip c={p.source} /></div>
      </div>

      <div className="mt-3 border-t border-line/70 px-4 py-3">
        {p.evidence.length === 0 ? (
          <p className="text-small text-ink-3">No evidence yet. The next results or concall will test this.</p>
        ) : (
          <ol className="relative space-y-2.5 border-l border-line pl-4">
            {p.evidence.map((e, i) => (
              <li key={i} className="relative">
                <span className={`absolute top-1.5 -left-[1.29rem] h-2 w-2 rounded-full ring-2 ring-surface ${e.verdict === "supports" ? "bg-up" : "bg-down"}`} />
                <div className="text-micro text-ink-3">
                  <span className={e.verdict === "supports" ? "text-up" : "text-down"}>{e.verdict === "supports" ? "Supports" : "Challenges"}</span>
                  {" · "}{when(e.ts)}
                </div>
                <p className="text-small text-ink">{e.note}</p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </li>
  );
}

function PillarEditor({ initial, onCancel, onSave }: {
  initial: Pillar[]; onCancel: () => void; onSave: (p: PillarInput[]) => Promise<void>;
}) {
  const [rows, setRows] = useState<PillarInput[]>(initial.map(({ id, text, metric, target, period }) => ({ id, text, metric, target, period })));
  const [busy, setBusy] = useState(false);
  const set = (i: number, patch: Partial<PillarInput>) => setRows((r) => r.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  const field = "w-full rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-small text-ink placeholder:text-ink-3";

  return (
    <form
      className="mt-4 space-y-3 px-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try { await onSave(rows.filter((r) => r.text.trim())); } finally { setBusy(false); }
      }}
    >
      {rows.map((r, i) => (
        <fieldset key={r.id ?? `new-${i}`} className="space-y-2 rounded-2xl border border-line bg-surface p-3">
          <div className="flex items-center justify-between">
            <legend className="text-micro text-ink-3">Pillar {i + 1}</legend>
            <button type="button" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} className="text-micro text-down">Remove</button>
          </div>
          <textarea rows={2} value={r.text} onChange={(e) => set(i, { text: e.target.value })} className={field} placeholder="A claim that a filing could prove wrong" />
          <div className="grid grid-cols-3 gap-2">
            <select value={r.metric} onChange={(e) => set(i, { metric: e.target.value as Pillar["metric"] })} className={field}>
              {METRICS.map((m) => <option key={m} value={m}>{METRIC_LABEL[m]}</option>)}
            </select>
            <input value={r.target ?? ""} onChange={(e) => set(i, { target: e.target.value || null })} className={field} placeholder="Target" />
            <input value={r.period ?? ""} onChange={(e) => set(i, { period: e.target.value || null })} className={field} placeholder="Period" />
          </div>
        </fieldset>
      ))}
      {rows.length < 4 && (
        <button type="button" onClick={() => setRows((r) => [...r, { text: "", metric: "other", target: null, period: null }])}
          className="w-full rounded-2xl border border-dashed border-line-strong py-2.5 text-small text-ink-2">
          + Add pillar
        </button>
      )}
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className="rounded-full px-4 py-1.5 text-small text-ink-2">Cancel</button>
        <button disabled={busy} className="rounded-full bg-accent px-4 py-1.5 text-small font-medium text-accent-ink disabled:opacity-50">
          {busy ? "Saving…" : "Save thesis"}
        </button>
      </div>
      <p className="pb-4 text-micro text-ink-3">Edited pillars start as untested; FINN checks them against the next filing. {day(new Date().toISOString())}</p>
    </form>
  );
}
