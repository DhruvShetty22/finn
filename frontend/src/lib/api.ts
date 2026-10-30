import type {
  Alert, Brief, Cost, PillarInput, Portfolio, ResearchDeck, Rules, SearchResult, Section, Thesis,
} from "./types";

// With no API base configured, dev runs entirely on contracts/fixtures (served at /fixtures).
// Production never falls back to fixtures unless NEXT_PUBLIC_USE_FIXTURES=1 says so explicitly.
const BASE = (process.env.NEXT_PUBLIC_API_BASE ?? "").replace(/\/$/, "");
export const USING_FIXTURES =
  BASE === "" && (process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_USE_FIXTURES === "1");
const MISCONFIGURED = BASE === "" && !USING_FIXTURES;

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
  if (MISCONFIGURED) throw new ApiError(0, "NEXT_PUBLIC_API_BASE is not set");
  if (!USING_FIXTURES) return getJson<T>(`${BASE}/api${path}`);
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
    if (USING_FIXTURES) {
      const p = await fetcher<Portfolio>("/portfolio");
      const needle = q.trim().toUpperCase();
      const extra = [{ symbol: "KPITTECH", name: "KPIT Technologies" }, { symbol: "POLYCAB", name: "Polycab India" },
        { symbol: "PERSISTENT", name: "Persistent Systems" }];
      return [...p.holdings.map((h) => ({ symbol: h.symbol, name: h.name })), ...extra]
        .filter((r) => r.symbol.includes(needle) || r.name.toUpperCase().includes(needle))
        .slice(0, 8);
    }
    const res = await getJson<{ results: SearchResult[] }>(`${BASE}/api/search?q=${encodeURIComponent(q)}`);
    return res.results;
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
  if (USING_FIXTURES) {
    const timers: ReturnType<typeof setTimeout>[] = [];
    let cancelled = false;
    fetcher<ResearchDeck>(`/research/${symbol}`)
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
      .catch((e: unknown) => !cancelled && h.onError(e instanceof ApiError && e.status === 404
        ? "No research yet for this ticker (fixture mode only has KPITTECH)." : String(e)));
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }

  const es = new EventSource(`${BASE}/api/research/${encodeURIComponent(symbol)}`);
  es.addEventListener("head", (e) => h.onHead?.(JSON.parse((e as MessageEvent).data)));
  es.addEventListener("section", (e) => h.onSection(JSON.parse((e as MessageEvent).data)));
  es.addEventListener("done", (e) => {
    h.onDone(JSON.parse((e as MessageEvent).data));
    es.close();
  });
  es.addEventListener("error", (e) => {
    const data = (e as MessageEvent).data;
    h.onError(data ? JSON.parse(data).message : "Connection to the research stream was lost.");
    es.close();
  });
  return () => es.close();
}
