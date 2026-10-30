"use client";

import Link from "next/link";
import { useState } from "react";
import { animate, motion, useMotionValue, useTransform, type PanInfo } from "motion/react";
import type { Item } from "@/lib/types";
import { CATEGORY_LABEL, signed, when } from "@/lib/format";
import { CardBody } from "../cards";
import { ExternalIcon, VERDICT_META } from "../ui";

const SWIPE = 96;

/**
 * One brief item. Swipe right to keep it, left to mark it done. Tap to open or close the rich body.
 * Top-tier items open by default; "worth reading" items stay closed until tapped.
 */
export function ItemCard({ item, defaultOpen, onTriage }: {
  item: Item; defaultOpen: boolean; onTriage?: (item: Item, action: "seen" | "keep") => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const x = useMotionValue(0);
  const keepOpacity = useTransform(x, [24, SWIPE], [0, 1]);
  const doneOpacity = useTransform(x, [-SWIPE, -24], [1, 0]);

  function onDragEnd(_: unknown, info: PanInfo) {
    const dx = info.offset.x + info.velocity.x * 0.15;
    if (onTriage && Math.abs(dx) > SWIPE) {
      const dir = dx > 0 ? 1 : -1;
      animate(x, dir * 480, { duration: 0.18 }).then(() => onTriage(item, dir > 0 ? "keep" : "seen"));
    } else {
      animate(x, 0, { type: "spring", stiffness: 500, damping: 35 });
    }
  }

  const v = item.thesis ? VERDICT_META[item.thesis.verdict] : null;

  return (
    <div className="relative">
      {onTriage && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-between rounded-2xl px-5 text-small font-medium">
          <motion.span style={{ opacity: keepOpacity }} className="text-accent">★ Keep</motion.span>
          <motion.span style={{ opacity: doneOpacity }} className="text-ink-3">Done ✓</motion.span>
        </div>
      )}
      <motion.article
        drag={onTriage ? "x" : false}
        dragDirectionLock
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.9}
        onDragEnd={onDragEnd}
        style={{ x }}
        className={`relative rounded-2xl border bg-surface ${item.thesis?.verdict === "challenges" ? "border-down/35" : "border-line"} ${item.seen ? "opacity-70" : ""}`}
      >
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="block w-full px-4 pt-3.5 pb-3 text-left"
        >
          <div className="flex items-center gap-2 text-micro">
            <span className="rounded-md bg-surface-2 px-1.5 py-0.5 font-semibold tracking-wide text-ink">{item.symbol}</span>
            <span className="text-ink-3">{CATEGORY_LABEL[item.category] ?? item.category}</span>
            <span className="text-ink-3">·</span>
            <time className="text-ink-3" dateTime={item.ts}>{when(item.ts)}</time>
            {!item.seen && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-accent" aria-label="Unseen" />}
          </div>
          <h3 className={`mt-1.5 text-body leading-snug font-medium text-ink ${open ? "" : "line-clamp-2"}`}>{item.headline}</h3>
          {/* Why it ranks here: always visible, since an unexplained rank is a black box. */}
          <p className={`mt-1 truncate text-micro ${item.why.startsWith("⚑") ? "text-down" : "text-ink-3"}`}>{item.why}</p>
          {v && item.thesis && (
            <div className={`mt-2.5 rounded-lg px-2.5 py-2 ${v.soft}`}>
              <div className={`text-micro font-semibold ${v.text}`}>
                {v.glyph} {v.label} your thesis
                <span className="font-normal text-ink-2"> · {item.thesis.pillar}</span>
              </div>
              {open && <p className="mt-0.5 text-small text-ink-2">{item.thesis.reason}</p>}
            </div>
          )}
        </button>

        {open && (
          <div className="px-4 pb-3">
            {item.card && <CardBody card={item.card} />}
            {item.card?.kind === "results" && <p className="mt-2 text-small text-ink-2">{item.card.verdict}</p>}
            <p className={`text-micro text-ink-3 ${item.card ? "mt-2" : ""}`}>
              {item.subject !== item.headline && <>Filed as &ldquo;{item.subject}&rdquo; · </>}
              {item.source} · rank <span className="num">{item.score}</span>/100
            </p>
          </div>
        )}

        <footer className="flex items-center gap-3 border-t border-line/70 px-4 py-2 text-micro">
          {item.market ? (
            <span className="num text-ink-3" title="Same-session price move and volume vs its 20-day average">
              <span className={item.market.chg_pct > 0 ? "text-up" : item.market.chg_pct < 0 ? "text-down" : ""}>
                {signed(item.market.chg_pct)}
              </span>
              {item.market.vol_ratio >= 1.5 && <span> · {item.market.vol_ratio.toFixed(1)}× vol</span>}
            </span>
          ) : (
            <span />
          )}
          <span className="ml-auto flex shrink-0 items-center gap-3">
            {item.pdf_url && (
              <a href={item.pdf_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-ink-2 hover:text-ink">
                Filing <ExternalIcon />
              </a>
            )}
            {item.thesis ? (
              <Link href={`/thesis/${item.symbol}#${item.thesis.pillar_id}`} className="font-medium text-accent">
                Thesis →
              </Link>
            ) : (
              <Link href={`/research/${item.symbol}`} className="font-medium text-accent">
                Dig in →
              </Link>
            )}
          </span>
        </footer>
      </motion.article>
    </div>
  );
}
