import type { Citation } from "@/lib/types";
import { day } from "@/lib/format";

/** A source chip that opens the primary document at the cited page (#page=N works in browser PDF viewers). */
export function CitationChip({ c, n }: { c: Citation; n?: number }) {
  const href = c.url ? (c.page ? `${c.url}#page=${c.page}` : c.url) : undefined;
  const body = (
    <>
      {n != null && <span className="num font-semibold text-accent">[{n}]</span>}
      <span className="text-ink-2">{c.doc}</span>
      {c.page != null && <span className="num text-ink-3">p.{c.page}</span>}
      {!c.page && c.date && <span className="text-ink-3">{day(c.date)}</span>}
    </>
  );
  const cls = "inline-flex max-w-full items-center gap-1.5 rounded-md border border-line bg-surface-2/60 px-1.5 py-0.5 text-micro";
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className={`${cls} hover:border-line-strong`}>{body}</a>
  ) : (
    <span className={cls}>{body}</span>
  );
}
