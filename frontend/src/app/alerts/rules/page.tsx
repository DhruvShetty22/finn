"use client";

import { useState } from "react";
import useSWR from "swr";
import { api } from "@/lib/api";
import type { Category, Rules } from "@/lib/types";
import { CATEGORY_LABEL } from "@/lib/format";
import { ErrorState, PageHeader, Skeleton } from "@/components/ui";

// Material categories first: these are the ones worth an interruption.
const CATEGORY_ORDER: Category[] = [
  "results", "management_change", "credit_rating", "M&A", "fund_raise", "capex", "litigation", "pledging",
  "insider_trading", "bonus_split", "dividend", "earnings_call", "press_release", "investor_meetings",
  "agm_egm", "postal_ballot", "unclassified",
];

export default function RulesPage() {
  const { data, error, mutate } = useSWR<Rules>("/rules");
  // Edits live in `edits` until saved; with no edits the form shows the server's rules.
  const [edits, setEdits] = useState<Rules | null>(null);
  const draft = edits ?? data ?? null;
  const [state, setState] = useState<"idle" | "saving" | "saved" | "failed">("idle");

  const dirty = edits && data && JSON.stringify(edits) !== JSON.stringify(data);
  const set = (patch: Partial<Rules>) => { setEdits((d) => ({ ...(d ?? data!), ...patch })); setState("idle"); };

  async function save() {
    if (!draft) return;
    setState("saving");
    try {
      const saved = await api.saveRules(draft);
      await mutate("volume_multiple" in saved ? saved : draft, { revalidate: false });
      setEdits(null);
      setState("saved");
    } catch {
      setState("failed");
    }
  }

  return (
    <div>
      <PageHeader back="/alerts" eyebrow="Alerts" title="Rules" />
      {error && !data ? <ErrorState error={error} retry={() => mutate()} /> : !draft ? (
        <div className="space-y-3 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
      ) : (
        <div className="space-y-6 px-4 pt-4 pb-28">
          <Slider
            label="Unusual volume"
            value={draft.volume_multiple} min={1.5} max={5} step={0.5}
            display={`${draft.volume_multiple.toFixed(1)}×`}
            help={`Alert when a day's volume is at least ${draft.volume_multiple.toFixed(1)}× its ${draft.volume_lookback}-session average (today excluded).`}
            onChange={(v) => set({ volume_multiple: v })}
          />
          <div>
            <div className="text-small font-medium">Average over</div>
            <div className="mt-2 flex gap-1 rounded-full bg-surface p-1">
              {[10, 20, 50].map((n) => (
                <button key={n} onClick={() => set({ volume_lookback: n })}
                  className={`num flex-1 rounded-full py-1.5 text-small ${draft.volume_lookback === n ? "bg-surface-2 font-medium text-ink" : "text-ink-3"}`}>
                  {n} sessions
                </button>
              ))}
            </div>
          </div>
          <Slider
            label="Big daily move"
            value={draft.price_move_pct} min={2} max={15} step={0.5}
            display={`±${draft.price_move_pct.toFixed(1)}%`}
            help={`Alert when a holding closes more than ${draft.price_move_pct.toFixed(1)}% up or down on the day.`}
            onChange={(v) => set({ price_move_pct: v })}
          />

          <Toggle
            label="Thesis alerts"
            help="Alert the moment a filing or result challenges one of your thesis pillars."
            on={draft.thesis_alerts}
            onChange={(v) => set({ thesis_alerts: v })}
            strong
          />

          <section>
            <div className="text-small font-medium">Filings that alert you</div>
            <p className="text-micro text-ink-3">Everything else still shows in the Brief; this only controls interruptions.</p>
            <div className="mt-2 divide-y divide-line/60 rounded-2xl border border-line bg-surface">
              {CATEGORY_ORDER.map((c) => (
                <Toggle key={c} label={CATEGORY_LABEL[c]} on={draft.categories[c] ?? false} compact
                  onChange={(v) => set({ categories: { ...draft.categories, [c]: v } })} />
              ))}
            </div>
          </section>
        </div>
      )}

      {draft && (dirty || state !== "idle") && (
        <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 mx-auto flex max-w-[480px] items-center justify-between gap-3 border-t border-line bg-bg/90 px-4 py-2.5 backdrop-blur-xl">
          <span className={`text-small ${state === "failed" ? "text-down" : "text-ink-2"}`}>
            {state === "saved" ? "Saved. Applies from the next EOD run." : state === "failed" ? "Couldn't save, try again" : "Unsaved changes"}
          </span>
          {state !== "saved" && (
            <div className="flex gap-2">
              <button onClick={() => { setEdits(null); setState("idle"); }} className="rounded-full px-3 py-1.5 text-small text-ink-2">Reset</button>
              <button onClick={save} disabled={state === "saving"} className="rounded-full bg-accent px-4 py-1.5 text-small font-medium text-accent-ink disabled:opacity-50">
                {state === "saving" ? "Saving…" : "Save"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Slider({ label, value, min, max, step, display, help, onChange }: {
  label: string; value: number; min: number; max: number; step: number; display: string; help: string; onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <div className="flex items-baseline justify-between">
        <span className="text-small font-medium">{label}</span>
        <span className="num text-title font-semibold">{display}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 w-full accent-[var(--accent)]" />
      <p className="text-micro text-ink-3">{help}</p>
    </label>
  );
}

function Toggle({ label, help, on, onChange, compact, strong }: {
  label: string; help?: string; on: boolean; onChange: (v: boolean) => void; compact?: boolean; strong?: boolean;
}) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)}
      className={`flex w-full items-center gap-3 text-left ${compact ? "px-4 py-2.5" : strong ? "rounded-2xl border border-line bg-surface p-4" : ""}`}>
      <span className="min-w-0 flex-1">
        <span className={`block ${compact ? "text-small" : "text-small font-medium"}`}>{label}</span>
        {help && <span className="block text-micro text-ink-3">{help}</span>}
      </span>
      <span className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${on ? "bg-accent" : "bg-line-strong"}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-[1.125rem]" : "translate-x-0.5"}`} />
      </span>
    </button>
  );
}
