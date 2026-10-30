"use client";

import { useState } from "react";

export type BriefWindow = { key: "24h" | "3d" | "7d" | "custom"; from?: string; to?: string };

const PRESETS = [
  { key: "24h", label: "24h", days: 1 },
  { key: "3d", label: "3 days", days: 3 },
  { key: "7d", label: "7 days", days: 7 },
] as const;

/** Builds the window once, on selection, so the SWR key stays stable between renders. */
export function presetWindow(key: "24h" | "3d" | "7d"): BriefWindow {
  if (key === "24h") return { key }; // server default: last 24h
  const days = PRESETS.find((p) => p.key === key)!.days;
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  return { key, from: from.toISOString(), to: to.toISOString() };
}

export function WindowPicker({ value, onChange }: { value: BriefWindow; onChange: (w: BriefWindow) => void }) {
  const [custom, setCustom] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(value.from?.slice(0, 10) ?? today);
  const [to, setTo] = useState(value.to?.slice(0, 10) ?? today);

  return (
    <div>
      <div className="flex gap-1 rounded-full bg-surface p-1" role="radiogroup" aria-label="Brief window">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            role="radio"
            aria-checked={value.key === p.key}
            onClick={() => { setCustom(false); onChange(presetWindow(p.key)); }}
            className={`flex-1 rounded-full py-1.5 text-small font-medium transition-colors ${
              value.key === p.key ? "bg-surface-2 text-ink shadow-sm" : "text-ink-3 hover:text-ink-2"
            }`}
          >
            {p.label}
          </button>
        ))}
        <button
          role="radio"
          aria-checked={value.key === "custom"}
          onClick={() => setCustom((c) => !c)}
          className={`flex-1 rounded-full py-1.5 text-small font-medium transition-colors ${
            value.key === "custom" ? "bg-surface-2 text-ink shadow-sm" : "text-ink-3 hover:text-ink-2"
          }`}
        >
          Custom
        </button>
      </div>
      {custom && (
        <form
          className="mt-2 flex items-end gap-2 rounded-xl border border-line bg-surface p-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new Date(`${from}T00:00:00+05:30`);
            const t = new Date(`${to}T23:59:59+05:30`);
            if (f > t) return;
            onChange({ key: "custom", from: f.toISOString(), to: t.toISOString() });
            setCustom(false);
          }}
        >
          <label className="flex-1 text-micro text-ink-3">
            From
            <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)}
              className="num mt-0.5 block w-full rounded-md bg-surface-2 px-2 py-1 text-small text-ink" />
          </label>
          <label className="flex-1 text-micro text-ink-3">
            To
            <input type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)}
              className="num mt-0.5 block w-full rounded-md bg-surface-2 px-2 py-1 text-small text-ink" />
          </label>
          <button className="rounded-full bg-accent px-3 py-1.5 text-small font-medium text-accent-ink">Apply</button>
        </form>
      )}
    </div>
  );
}
