// Small shared primitives. Anything coloured red/green/amber here carries meaning, never decoration.
import Link from "next/link";
import type { PillarStatus, ThesisStatus, Verdict } from "@/lib/types";
import { pct, tone } from "@/lib/format";

const TONE_TEXT = { up: "text-up", down: "text-down", flat: "text-ink-2" } as const;

export function Delta({ v, className = "" }: { v: number | null | undefined; className?: string }) {
  return <span className={`num ${TONE_TEXT[tone(v)]} ${className}`}>{pct(v)}</span>;
}

export const STATUS_META: Record<ThesisStatus, { label: string; dot: string; text: string; soft: string }> = {
  intact: { label: "Intact", dot: "bg-up", text: "text-up", soft: "bg-up-soft" },
  watch: { label: "Watch", dot: "bg-watch", text: "text-watch", soft: "bg-watch-soft" },
  challenged: { label: "Challenged", dot: "bg-down", text: "text-down", soft: "bg-down-soft" },
  none: { label: "No thesis", dot: "bg-ink-3/40", text: "text-ink-3", soft: "bg-surface-2" },
};

export function StatusPill({ status }: { status: ThesisStatus }) {
  const m = STATUS_META[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-micro font-medium ${m.soft} ${m.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />
      {m.label}
    </span>
  );
}

export const PILLAR_META: Record<PillarStatus, { label: string; text: string; soft: string; dot: string }> = {
  on_track: { label: "On track", text: "text-up", soft: "bg-up-soft", dot: "bg-up" },
  at_risk: { label: "At risk", text: "text-watch", soft: "bg-watch-soft", dot: "bg-watch" },
  broken: { label: "Broken", text: "text-down", soft: "bg-down-soft", dot: "bg-down" },
  untested: { label: "Untested", text: "text-ink-3", soft: "bg-surface-2", dot: "bg-ink-3/50" },
};

export const VERDICT_META: Record<Verdict, { label: string; text: string; soft: string; glyph: string }> = {
  supports: { label: "Supports", text: "text-up", soft: "bg-up-soft", glyph: "↑" },
  challenges: { label: "Challenges", text: "text-down", soft: "bg-down-soft", glyph: "↓" },
  neutral: { label: "Neutral", text: "text-ink-2", soft: "bg-surface-2", glyph: "·" },
};

export function Sparkline({ values, width = 72, height = 24, className = "" }: {
  values: number[]; width?: number; height?: number; className?: string;
}) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = width / (values.length - 1);
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(height - 2 - ((v - min) / span) * (height - 4)).toFixed(1)}`);
  const t = tone(values[values.length - 1] - values[0]);
  const color = t === "up" ? "var(--up)" : t === "down" ? "var(--down)" : "var(--ink-3)";
  const [lx, ly] = pts[pts.length - 1].split(",");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} aria-hidden>
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lx} cy={ly} r="2" fill={color} />
    </svg>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden />;
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <p className="text-lead font-medium text-ink">{title}</p>
      {body && <p className="max-w-xs text-small text-ink-3">{body}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <EmptyState
      title="Couldn't reach FINN"
      body={`The server may be waking up (free tier). ${msg}`}
      action={retry && (
        <button onClick={retry} className="mt-2 rounded-full bg-accent px-4 py-1.5 text-small font-medium text-accent-ink">
          Try again
        </button>
      )}
    />
  );
}

export function PageHeader({ title, eyebrow, back, right }: {
  title: React.ReactNode; eyebrow?: React.ReactNode; back?: string; right?: React.ReactNode;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/85 px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)] pb-3 backdrop-blur-xl">
      <div className="flex items-center gap-3">
        {back && (
          <Link href={back} aria-label="Back" className="-ml-1 grid h-8 w-8 place-items-center rounded-full text-ink-2 hover:bg-surface-2">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m15 5-7 7 7 7" /></svg>
          </Link>
        )}
        <div className="min-w-0 flex-1">
          {eyebrow && <div className="eyebrow truncate">{eyebrow}</div>}
          <h1 className="truncate text-title font-semibold tracking-tight">{title}</h1>
        </div>
        {right}
      </div>
    </header>
  );
}

export function ExternalIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
      <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </svg>
  );
}
