"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import useSWR from "swr";
import { api } from "@/lib/api";
import type { Portfolio, SearchResult } from "@/lib/types";

const RECENT_KEY = "finn.recent";

// Minimal typing for the Web Speech API, which TypeScript's DOM lib doesn't ship.
type Recognition = { lang: string; interimResults: boolean; start(): void; stop(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null };
type RecognitionCtor = new () => Recognition;

const speechCtor = (): RecognitionCtor | null => {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};
const noSubscribe = () => () => {};

// Recent tickers live in localStorage; a custom event tells this tab's subscribers when they change.
const subscribeRecent = (cb: () => void) => {
  window.addEventListener("storage", cb);
  window.addEventListener("finn-recent", cb);
  return () => { window.removeEventListener("storage", cb); window.removeEventListener("finn-recent", cb); };
};
const readRecent = () => { try { return localStorage.getItem(RECENT_KEY) ?? "[]"; } catch { return "[]"; } };

export default function AskPage() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [active, setActive] = useState(0);
  const recentRaw = useSyncExternalStore(subscribeRecent, readRecent, () => "[]");
  const recent = useMemo<string[]>(() => { try { return JSON.parse(recentRaw); } catch { return []; } }, [recentRaw]);
  const [listening, setListening] = useState(false);
  const hasSpeech = useSyncExternalStore(noSubscribe, () => speechCtor() !== null, () => false);
  const recRef = useRef<Recognition | null>(null);
  const { data: portfolio } = useSWR<Portfolio>("/portfolio");

  useEffect(() => {
    const t = setTimeout(() => {
      api.search(q).then((r) => { setResults(r); setActive(0); }).catch(() => setResults([]));
    }, 150);
    return () => clearTimeout(t);
  }, [q]);

  function open(symbol: string) {
    const s = symbol.trim().toUpperCase();
    if (!s) return;
    const next = [s, ...recent.filter((r) => r !== s)].slice(0, 6);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); window.dispatchEvent(new Event("finn-recent")); } catch {}
    router.push(`/research/${encodeURIComponent(s)}`);
  }

  function listen() {
    const Ctor = speechCtor();
    if (!Ctor) return;
    if (listening) { recRef.current?.stop(); return; }
    const rec = new Ctor();
    rec.lang = "en-IN";
    rec.interimResults = true;
    rec.onresult = (e) => {
      const text = Array.from(e.results).map((r) => r[0].transcript).join(" ");
      // "research K P I T tech" → "KPIT TECH": drop filler words, keep what looks like a name.
      setQ(text.replace(/^(research|show me|open|look up|what about)\s+/i, "").replace(/\.$/, ""));
    };
    rec.onend = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    rec.start();
  }

  return (
    <div className="px-4 pt-[calc(env(safe-area-inset-top)+1rem)]">
      <h1 className="text-title font-semibold tracking-tight">Ask FINN</h1>
      <p className="mt-1 text-small text-ink-3">Any NSE ticker. A research deck built only from its annual report and concall transcripts.</p>

      <form
        className="mt-4"
        onSubmit={(e) => { e.preventDefault(); open(results[active]?.symbol ?? q); }}
      >
        <div className="flex items-center gap-2 rounded-2xl border border-line bg-surface px-3 focus-within:border-accent">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="shrink-0 text-ink-3">
            <circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" />
          </svg>
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            }}
            placeholder="Ticker or company, e.g. POLYCAB"
            autoCapitalize="characters" autoCorrect="off" spellCheck={false} enterKeyHint="go"
            role="combobox" aria-expanded={results.length > 0} aria-controls="ask-results" aria-autocomplete="list"
            className="h-12 min-w-0 flex-1 bg-transparent text-lead text-ink outline-none placeholder:text-ink-3"
          />
          {hasSpeech && (
            <button type="button" onClick={listen} aria-label={listening ? "Stop listening" : "Speak a ticker"}
              className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${listening ? "bg-down-soft text-down" : "text-ink-3 hover:text-ink"}`}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
              </svg>
            </button>
          )}
        </div>
      </form>

      {results.length > 0 ? (
        <ul id="ask-results" role="listbox" className="mt-2 overflow-hidden rounded-2xl border border-line bg-surface">
          {results.map((r, i) => (
            <li key={r.symbol} role="option" aria-selected={i === active}>
              <button onClick={() => open(r.symbol)} onMouseEnter={() => setActive(i)}
                className={`flex w-full items-center gap-3 px-4 py-3 text-left ${i === active ? "bg-surface-2" : ""}`}>
                <span className="w-24 shrink-0 font-semibold tracking-tight">{r.symbol}</span>
                <span className="flex-1 truncate text-small text-ink-2">{r.name}</span>
                <span className="text-ink-3">→</span>
              </button>
            </li>
          ))}
        </ul>
      ) : q.trim() ? (
        <button onClick={() => open(q)} className="mt-2 w-full rounded-2xl border border-dashed border-line-strong px-4 py-3 text-left text-small text-ink-2">
          Research <span className="font-semibold text-ink">{q.trim().toUpperCase()}</span> anyway →
        </button>
      ) : (
        <div className="mt-6 space-y-6">
          {recent.length > 0 && <Chips title="Recent" items={recent} />}
          {portfolio && <Chips title="Your holdings" items={portfolio.holdings.map((h) => h.symbol)} />}
          <Chips title="Outside your portfolio"
            items={["POLYCAB", "PERSISTENT", "TMPV", "KPITTECH"].filter((s) => !portfolio?.holdings.some((h) => h.symbol === s))} />
          <div className="rounded-2xl border border-line bg-surface p-4">
            <div className="text-small font-medium">What you get</div>
            <ul className="mt-2 space-y-1.5 text-small text-ink-2">
              <li><span className="text-ink">Promise ledger:</span> what management guided over the last 4 quarters, and whether it happened</li>
              <li><span className="text-ink">Numbers from code:</span> trajectory, balance sheet and cash quality, computed and never generated</li>
              <li><span className="text-ink">Bull vs bear:</span> every point cites a page in a primary document</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

function Chips({ title, items }: { title: string; items: string[] }) {
  return (
    <section>
      <div className="eyebrow mb-2">{title}</div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((s) => (
          <Link key={s} href={`/research/${s}`} className="rounded-full border border-line bg-surface px-3 py-1.5 text-small font-medium hover:border-line-strong">
            {s}
          </Link>
        ))}
      </div>
    </section>
  );
}
