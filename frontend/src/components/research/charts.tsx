"use client";

import { useState } from "react";

// Hand-rolled SVG charts. Thin marks with 4px rounded data-ends, recessive axes, and no dual axes.
// Touch has no hover, so a readout line above each chart shows the tapped (or latest) value.

const fmt = (v: number, unit: string) =>
  unit === "%" ? `${v.toFixed(1)}%` : unit === "x" ? `${v.toFixed(2)}×` : `₹${new Intl.NumberFormat("en-IN").format(Math.round(v))} Cr`;

/** One series over periods: bars, with the last bar emphasised. */
export function BarSeries({ periods, values, unit, label, note }: {
  periods: string[]; values: number[]; unit: string; label: string; note?: string | null;
}) {
  const [sel, setSel] = useState(values.length - 1);
  const W = 300, H = 92, gap = 6, top = 6;
  const pctUnit = unit === "%";
  // Margins sit in a narrow band, so a zero baseline would flatten them; start at a rounded floor and say so.
  const min = pctUnit ? Math.floor(Math.min(...values) - 2) : 0;
  const max = Math.max(...values);
  const bw = (W - gap * (values.length - 1)) / values.length;
  const y = (v: number) => H - ((v - min) / (max - min || 1)) * (H - top);

  return (
    <figure>
      <figcaption className="flex items-baseline justify-between">
        <span className="text-small font-medium">{label}</span>
        <span className="num text-small">
          <span className="text-ink-3">{periods[sel]} </span>
          <span className="font-medium">{fmt(values[sel], unit)}</span>
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H + 16}`} className="mt-1.5 w-full" role="img" aria-label={`${label}: ${periods.map((p, i) => `${p} ${fmt(values[i], unit)}`).join(", ")}`}>
        <line x1="0" x2={W} y1={H} y2={H} stroke="var(--line-strong)" strokeWidth="1" />
        {values.map((v, i) => {
          const x = i * (bw + gap);
          const h = Math.max(2, H - y(v));
          return (
            <g key={periods[i]} onPointerEnter={() => setSel(i)} onClick={() => setSel(i)} className="cursor-pointer">
              <rect x={x} y={0} width={bw} height={H} fill="transparent" />
              <path d={roundedTop(x, H - h, bw, h, 4)} fill="var(--series-1)" opacity={i === sel ? 1 : 0.45} />
              <text x={x + bw / 2} y={H + 12} textAnchor="middle" className="fill-ink-3 text-[9px]">{periods[i]}</text>
            </g>
          );
        })}
      </svg>
      {(note || pctUnit) && (
        <p className="mt-1 text-micro text-ink-3">{[note, pctUnit ? `axis starts at ${min}%` : null].filter(Boolean).join(" · ")}</p>
      )}
    </figure>
  );
}

/** Two series side by side per period (e.g. CFO vs PAT). Legend plus a direct readout; never colour alone. */
export function PairedBars({ periods, a, b, labels }: {
  periods: string[]; a: number[]; b: number[]; labels: [string, string];
}) {
  const [sel, setSel] = useState(periods.length - 1);
  const W = 300, H = 92, groupGap = 10, inner = 2;
  const max = Math.max(...a, ...b, 1);
  const gw = (W - groupGap * (periods.length - 1)) / periods.length;
  const bw = (gw - inner) / 2;
  const h = (v: number) => Math.max(2, (Math.max(v, 0) / max) * (H - 6));

  return (
    <figure>
      <figcaption className="flex flex-wrap items-center justify-between gap-2 text-small">
        <span className="flex items-center gap-3 text-micro text-ink-2">
          <Key color="var(--series-1)" label={labels[0]} />
          <Key color="var(--series-2)" label={labels[1]} />
        </span>
        <span className="num text-micro">
          <span className="text-ink-3">{periods[sel]} </span>
          {labels[0]} <span className="font-medium">{fmt(a[sel], "cr")}</span>
          <span className="text-ink-3"> · </span>
          {labels[1]} <span className="font-medium">{fmt(b[sel], "cr")}</span>
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H + 16}`} className="mt-1.5 w-full" role="img"
        aria-label={periods.map((p, i) => `${p}: ${labels[0]} ${a[i]}, ${labels[1]} ${b[i]}`).join("; ")}>
        <line x1="0" x2={W} y1={H} y2={H} stroke="var(--line-strong)" strokeWidth="1" />
        {periods.map((p, i) => {
          const x = i * (gw + groupGap);
          const dim = i === sel ? 1 : 0.45;
          return (
            <g key={p} onPointerEnter={() => setSel(i)} onClick={() => setSel(i)} className="cursor-pointer">
              <rect x={x} y={0} width={gw} height={H} fill="transparent" />
              <path d={roundedTop(x, H - h(a[i]), bw, h(a[i]), 3)} fill="var(--series-1)" opacity={dim} />
              <path d={roundedTop(x + bw + inner, H - h(b[i]), bw, h(b[i]), 3)} fill="var(--series-2)" opacity={dim} />
              <text x={x + gw / 2} y={H + 12} textAnchor="middle" className="fill-ink-3 text-[9px]">{p}</text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

/** Parts of a whole (segment mix) as one bar with 2px gaps, labelled below. */
export function ShareBar({ parts }: { parts: { name: string; share_pct: number; growth_pct: number | null }[] }) {
  const colors = ["var(--series-1)", "var(--series-2)", "var(--series-3)"];
  const shown = parts.slice(0, 3);
  const other = parts.slice(3).reduce((s, p) => s + p.share_pct, 0);
  const all = other > 0 ? [...shown, { name: "Other", share_pct: other, growth_pct: null }] : shown;
  return (
    <figure>
      <div className="flex h-3 gap-[2px] overflow-hidden rounded-full" role="img"
        aria-label={all.map((p) => `${p.name} ${p.share_pct}%`).join(", ")}>
        {all.map((p, i) => (
          <div key={p.name} style={{ width: `${p.share_pct}%`, background: colors[i] ?? "var(--ink-3)" }} />
        ))}
      </div>
      <ul className="mt-2.5 space-y-1.5">
        {all.map((p, i) => (
          <li key={p.name} className="flex items-center gap-2 text-small">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: colors[i] ?? "var(--ink-3)" }} />
            <span className="flex-1 text-ink-2">{p.name}</span>
            <span className="num w-10 text-right font-medium">{p.share_pct}%</span>
            <span className="num w-16 text-right text-micro text-ink-3">
              {p.growth_pct != null ? `${p.growth_pct > 0 ? "▲" : "▼"} ${Math.abs(p.growth_pct).toFixed(1)}% YoY` : ""}
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

function Key({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-2 w-2 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}

function roundedTop(x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}
