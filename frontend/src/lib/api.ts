import type {
  Alert, Brief, Cost, PillarInput, Portfolio, ResearchDeck, Rules, SearchResult, Section, Thesis,
} from "./types";

// NEXT_PUBLIC_API_BASE:
//   a URL → that backend.
//   "/"   → same origin: Vercel services route /api/* on this domain to the FastAPI service.
//   unset → same origin in a production build; contracts/fixtures (served at /fixtures) in dev.
// Production never falls back to fixtures unless NEXT_PUBLIC_USE_FIXTURES=1 says so explicitly.
const RAW = (process.env.NEXT_PUBLIC_API_BASE ?? "").trim();
const PROD = process.env.NODE_ENV === "production";
export const USING_FIXTURES = RAW === "" && (!PROD || process.env.NEXT_PUBLIC_USE_FIXTURES === "1");
const BASE = RAW === "/" ? "" : RAW.replace(/\/$/, "");
// Dev-only, for integrating while the backend grows: with an API base set, any endpoint that
// 404s falls back to its fixture. Opt in with NEXT_PUBLIC_FIXTURE_FALLBACK=1 in .env.local.
export const FIXTURE_FALLBACK =
  BASE !== "" && !PROD && process.env.NEXT_PUBLIC_FIXTURE_FALLBACK === "1";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new ApiError(res.status, `${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

async function send<T>(method: "POST" | "PUT", path: string, body?: unknown): Promise<T> {
  if (USING_FIXTURES) return { ok: true } as T;
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, `${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

// Fixture files exist only for KPITTECH research and thesis; other symbols get a 404 like a cold backend would.
const FIXTURE_FOR: Record<string, (path: string) => string | null> = {
  "/portfolio": () => "portfolio.json",
  "/brief": () => "brief.json",
  "/alerts": () => "alerts.json",
  "/rules": () => "rules.json",
};

function fixtureUrl(path: string): string | null {
  const bare = path.split("?")[0];
  if (FIXTURE_FOR[bare]) return `/fixtures/${FIXTURE_FOR[bare](bare)}`;
  let m = bare.match(/^\/theses\/([A-Z0-9&-]+)$/);
  if (m) return m[1] === "KPITTECH" ? "/fixtures/thesis_KPITTECH.json" : null;
  m = bare.match(/^\/research\/([A-Z0-9&-]+)$/);
  if (m) return m[1] === "KPITTECH" ? "/fixtures/research_KPITTECH.json" : null;
  return null;
}

/** SWR fetcher: keys are API paths such as "/brief?from=…". */
export async function fetcher<T>(path: string): Promise<T> {
  if (!USING_FIXTURES) {
    try {
      return await getJson<T>(`${BASE}/api${path}`);
    } catch (e) {
      const url = FIXTURE_FALLBACK && e instanceof ApiError && e.status === 404 ? fixtureUrl(path) : null;
      if (!url) throw e;
      return getJson<T>(url);
    }
  }
  const url = fixtureUrl(path);
  if (!url) throw new ApiError(404, "No fixture for this path");
  return getJson<T>(url);
}

export const api = {
  portfolio: () => fetcher<Portfolio>("/portfolio"),
  brief: (from?: string, to?: string) =>
    fetcher<Brief>(from && to ? `/brief?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}` : "/brief"),
  alerts: () => fetcher<{ items: Alert[] }>("/alerts"),
  rules: () => fetcher<Rules>("/rules"),
  thesis: (symbol: string) => fetcher<Thesis>(`/theses/${symbol}`),

  markSeen: (id: string) => send<{ ok: true }>("POST", `/items/${encodeURIComponent(id)}/seen`),
  keep: (id: string) => send<{ ok: true }>("POST", `/items/${encodeURIComponent(id)}/keep`),
  alertSeen: (id: string) => send<{ ok: true }>("POST", `/alerts/${encodeURIComponent(id)}/seen`),
  saveRules: (rules: Rules) => send<Rules>("PUT", "/rules", rules),
  saveThesis: (symbol: string, pillars: PillarInput[]) => send<Thesis>("PUT", `/theses/${symbol}`, { pillars }),

  async search(q: string): Promise<SearchResult[]> {
    if (!q.trim()) return [];
    if (!USING_FIXTURES) {
      try {
        return (await getJson<{ results: SearchResult[] }>(`${BASE}/api/search?q=${encodeURIComponent(q)}`)).results;
      } catch (e) {
        if (!(FIXTURE_FALLBACK && e instanceof ApiError && e.status === 404)) throw e;
      }
    }
    {
      const p = await fetcher<Portfolio>("/portfolio");
      const needle = q.trim().toUpperCase();
      const extra = [{ symbol: "KPITTECH", name: "KPIT Technologies" }, { symbol: "POLYCAB", name: "Polycab India" },
        { symbol: "PERSISTENT", name: "Persistent Systems" }];
      return [...p.holdings.map((h) => ({ symbol: h.symbol, name: h.name })), ...extra]
        .filter((r) => r.symbol.includes(needle) || r.name.toUpperCase().includes(needle))
        .slice(0, 8);
    }
  },
};

export type ResearchHead = Pick<ResearchDeck, "symbol" | "name" | "as_of" | "sources">;
type StreamHandlers = {
  onHead?: (head: ResearchHead) => void;
  onSection: (s: Section) => void;
  onDone: (d: { symbol: string; total_cost: Cost; elapsed_ms: number }) => void;
  onError: (message: string) => void;
};

/**
 * Streams /research/{symbol} over SSE; returns a cancel function.
 * In fixture mode the deterministic sections arrive at once and the LLM ones trickle in,
 * so the progressive skeleton gets exercised the same way it will against the live API.
 */
export function streamResearch(symbol: string, h: StreamHandlers): () => void {
  if (USING_FIXTURES) return simulateFromFixture(symbol, h);

  let fallback: (() => void) | null = null;
  let heard = false;
  const es = new EventSource(`${BASE}/api/research/${encodeURIComponent(symbol)}`);
  const hear = <T,>(fn: (d: T) => void) => (e: Event) => { heard = true; fn(JSON.parse((e as MessageEvent).data)); };
  es.addEventListener("head", hear<ResearchHead>((d) => h.onHead?.(d)));
  es.addEventListener("section", hear<Section>(h.onSection));
  es.addEventListener("done", hear<Parameters<StreamHandlers["onDone"]>[0]>((d) => { h.onDone(d); es.close(); }));
  es.addEventListener("error", (e) => {
    es.close();
    const data = (e as MessageEvent).data;
    if (!heard && !data && FIXTURE_FALLBACK) { fallback = simulateFromFixture(symbol, h); return; }
    // The stream never started (a proxy that doesn't pass text/event-stream, a cold function...):
    // fetch the same deck as one JSON response instead of failing.
    if (!heard && !data) { fallback = deckAsJson(symbol, h); return; }
    h.onError(data ? JSON.parse(data).message : "Connection to the research stream was lost.");
  });
  return () => { es.close(); fallback?.(); };
}

function deckAsJson(symbol: string, h: StreamHandlers): () => void {
  let cancelled = false;
  getJson<ResearchDeck & { total_cost: Cost }>(`${BASE}/api/research/${encodeURIComponent(symbol)}?format=json`)
    .then((deck) => {
      if (cancelled) return;
      h.onHead?.({ symbol: deck.symbol, name: deck.name, as_of: deck.as_of, sources: deck.sources });
      deck.sections.forEach((s) => h.onSection(s));
      h.onDone({ symbol: deck.symbol, total_cost: deck.total_cost, elapsed_ms: 0 });
    })
    .catch((e: unknown) => {
      if (!cancelled) h.onError(e instanceof ApiError && e.status === 404 ? "Not found on screener.in: no primary documents to research." : String(e));
    });
  return () => { cancelled = true; };
}

function simulateFromFixture(symbol: string, h: StreamHandlers): () => void {
  const timers: ReturnType<typeof setTimeout>[] = [];
  let cancelled = false;
  const url = fixtureUrl(`/research/${symbol}`);
  (url ? getJson<ResearchDeck>(url) : Promise.reject(new ApiError(404, "no fixture")))
    .then((deck) => {
      if (cancelled) return;
      h.onHead?.({ symbol: deck.symbol, name: deck.name, as_of: deck.as_of, sources: deck.sources });
      const llm = new Set(["snapshot", "ledger", "bull_bear"]);
      let slow = 0;
      deck.sections.forEach((s, i) => {
        const at = llm.has(s.key) ? 900 + 700 * slow++ : 120 + 40 * i;
        timers.push(setTimeout(() => h.onSection(s), at));
      });
      timers.push(setTimeout(() => h.onDone({ symbol, total_cost: deck.total_cost, elapsed_ms: 900 + 700 * slow }),
        950 + 700 * slow));
    })
    .catch((e: unknown) => {
      if (cancelled) return;
      h.onError(e instanceof ApiError && e.status === 404
        ? "No research yet for this ticker (fixtures only cover KPITTECH)." : String(e));
    });
  return () => {
    cancelled = true;
    timers.forEach(clearTimeout);
  };
}
