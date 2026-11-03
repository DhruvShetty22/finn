"""Promise ledger: what management guided on calls vs what the reported numbers show.

    transcripts ──(extract tier, one call each, parallel)──▶ verbatim, page-cited guidance claims
    claims + screener actuals ──(code)──▶ delivered / partly / missed / too_early / unverifiable
    ledger ──(reason tier, one call)──▶ 3-line synthesis that may cite only ledger rows

The model never supplies an actual number and never sees anything but the company's own transcripts.
"""

import logging
import re
from concurrent.futures import ThreadPoolExecutor

from pydantic import BaseModel
from sqlmodel import Session

from finn.ingest import http, pdf
from finn.llm.router import LLMError, ask, meter_view, new_meter
from finn.pull.compute import actuals

log = logging.getLogger(__name__)

N_CALLS = 5  # four quarters of promises need the call before the first of them
CHARS = 90_000


class Claim(BaseModel):
    metric: str  # revenue_growth | ebitda_margin | pat_growth | capex | volume | order_book | other
    quote: str
    page: int | None = None
    target: str | None = None
    low: float | None = None
    high: float | None = None
    direction: str | None = None  # up | down | flat
    period: str | None = None  # FY27 | Q3 FY27 | H2 FY27 | as stated
    speaker: str | None = None


class CallExtract(BaseModel):
    quarter_discussed: str  # e.g. "Q1 FY27"
    claims: list[Claim]


EXTRACT = """Below is an Indian listed company's earnings-call transcript, with [[page N]] markers.
Extract management's explicit FORWARD-LOOKING guidance on headline numbers only: revenue/sales growth, EBITDA or operating
margin, profit growth, capex, volumes, order book/inflows. Rules:
- only statements by company management, never by analysts; never historical results; never your own knowledge
- whole-company figures only: guidance for a single segment, division, product line or geography gets metric "other"
- quote verbatim, at most 45 words; page = the [[page N]] marker where the quote appears
- metric: revenue_growth (a % growth rate), ebitda_margin (a margin level), pat_growth, capex, volume, order_book, or other
  (use other for absolute revenue targets, market share, qualitative promises)
- low/high: numeric bounds in percent for growth/margin ("18 to 22%" → 18, 22; "upwards of 15%" → 15, null; "about 20%" → 20, 20)
- direction: up / down / flat when the statement is directional without numbers ("margins will improve in H2" → up)
- period: the period the guidance is for, as FY27 / Q3 FY27 / H2 FY27 (Indian FY runs April–March), else as stated
- quarter_discussed: the quarter whose results the call reviews, e.g. "Q1 FY27"
At most 8 claims, the most specific first. Return an empty list if management gave no forward guidance.

{text}"""

SYNTH = """You are reviewing whether a company's management delivered what it guided. Use ONLY the ledger below; do not
add facts, numbers or context from outside it. Write:
- takeaway: one sentence (max 22 words), the single most decision-relevant pattern
- synthesis: exactly 3 short lines (max 30 words each). Each line cites the ledger row numbers it rests on (cites).
Focus on credibility: which kinds of promises they keep, which they miss, any guidance cut or raised, tone vs numbers.

LEDGER (row | said in | metric | promise | target | period | actual | verdict | note):
{rows}"""


class Line(BaseModel):
    text: str
    cites: list[int]


class Synth(BaseModel):
    takeaway: str
    synthesis: list[Line]


def _period(p: str | None, fallback_fy: int | None):
    """→ ('FY', 27) | ('Q', 27, 3) | ('H', 27, 2) | None."""
    if not p:
        return None
    t = p.upper().replace("’", "'")
    if m := re.search(r"Q([1-4])\s*'?\s*FY\s*'?(\d{2,4})", t):
        return ("Q", int(m.group(2)) % 100, int(m.group(1)))
    if m := re.search(r"H([12])\s*'?\s*FY\s*'?(\d{2,4})", t):
        return ("H", int(m.group(2)) % 100, int(m.group(1)))
    if m := re.search(r"FY\s*'?(\d{2,4})", t):
        return ("FY", int(m.group(1)) % 100)
    if fallback_fy and re.search(r"THIS (FINANCIAL )?YEAR|CURRENT (FINANCIAL )?YEAR|FULL YEAR", t):
        return ("FY", fallback_fy)
    return None


def _yoy(act: dict, labels: list[str], prev: list[str], key: str):
    cur = [act.get(lab, {}).get(key) for lab in labels]
    old = [act.get(lab, {}).get(key) for lab in prev]
    if None in cur or None in old or not sum(old):
        return None
    return round((sum(cur) / sum(old) - 1) * 100, 1)


def _quarters(fy: int, ns) -> list[str]:
    return [f"Q{n} FY{fy:02d}" for n in ns]


# "30% growth in solutions and products" is a segment promise; checking it against company revenue would be unfair
SEGMENT = re.compile(r"\b(growth|margins?|revenues?)\s+(in|of|for|from)\s+(the |our )?[\w& -]{0,30}"
                     r"(segments?|solutions?|products?|divisions?|verticals?|business(es)?|portfolio|geograph\w*|regions?|practices?)\b", re.I)


def check(c: Claim, act: dict, call_fy: int | None) -> dict:
    """Code verdict for one claim against reported numbers."""
    out = {"actual": None, "verdict": "unverifiable", "note": None, "checked_in": None, "tracking": None}
    if c.metric != "other" and SEGMENT.search(c.quote):
        out["note"] = "segment-level guidance; not comparable with company totals"
        return out
    per = _period(c.period, call_fy)
    key = {"revenue_growth": "revenue", "pat_growth": "pat", "ebitda_margin": "margin"}.get(c.metric)
    if not key or not per:
        out["note"] = "not checkable against reported numbers" if not key else "no clear target period"
        return out
    kind, fy = per[0], per[1]
    if kind == "FY":
        qs, done = _quarters(fy, range(1, 5)), f"FY{fy:02d}" in act
    elif kind == "H":
        qs, done = _quarters(fy, (1, 2) if per[2] == 1 else (3, 4)), None
    else:
        qs, done = _quarters(fy, (per[2],)), None
    have = [q for q in qs if q in act]
    if done is None:
        done = len(have) == len(qs)
    if not have:
        out.update(verdict="too_early", note="no reported quarter of that period yet", checked_in=qs[0])
        return out
    prev = [re.sub(r"FY(\d{2})", lambda m: f"FY{int(m.group(1)) - 1:02d}", q) for q in have]
    if key == "margin":
        vals = [act[q]["margin"] for q in have if act[q].get("margin") is not None]
        if kind == "FY" and done and act.get(f"FY{fy:02d}", {}).get("margin") is not None:
            vals = [act[f"FY{fy:02d}"]["margin"]]
        actual = round(sum(vals) / len(vals), 1) if vals else None
        unit = "%"
    else:
        if kind == "FY" and done:
            a, b = act.get(f"FY{fy:02d}", {}).get(key), act.get(f"FY{fy - 1:02d}", {}).get(key)
            actual = round((a / b - 1) * 100, 1) if a is not None and b else None
        else:
            actual = _yoy(act, have, prev, key)
        unit = "% YoY"
    if actual is None:
        out["note"] = "reported numbers incomplete for that period"
        return out
    span = "" if done else f" ({len(have)} of {len(qs)} quarters)"
    out["actual"] = f"{actual:+.1f}{unit}{span}" if unit != "%" else f"{actual:.1f}%{span}"
    out["checked_in"] = f"FY{fy:02d}" if kind == "FY" else (f"H{per[2]} FY{fy:02d}" if kind == "H" else qs[0])

    lo, hi = c.low, c.high
    if lo is None and hi is None and c.direction in ("up", "down"):
        base_q = have[0]
        out["verdict"] = "too_early" if not done else "delivered" if (actual > 0) == (c.direction == "up") else "missed"
        return out
    if lo is None and hi is not None:
        lo = hi
    if lo is None:
        out["note"] = "no numeric target"
        return out
    slack = 0.3 if key == "margin" else 1.0
    hit = actual >= lo - slack
    near = actual >= lo - (1.0 if key == "margin" else max(2.0, abs(lo) * 0.15))
    if not done:
        out["verdict"] = "too_early"
        out["tracking"] = "on_track" if hit else "at_risk"
        out["note"] = f"tracking {'at or above' if hit else 'below'} the {c.target or lo} guided so far"
    else:
        out["verdict"] = "delivered" if hit else "partly" if near else "missed"
    return out


def _fy_of(quarter_label: str | None) -> int | None:
    m = re.search(r"FY\s*'?(\d{2,4})", quarter_label or "")
    return int(m.group(1)) % 100 if m else None


def build(s: Session, symbol: str, fund: dict) -> tuple[dict, list[dict]]:
    """→ (ledger Section, sources list). Fetches up to N_CALLS transcripts, extracts in parallel, checks in code."""
    meter = new_meter()
    calls = [c for c in fund.get("documents", {}).get("concalls", []) if c.get("transcript")][:N_CALLS]
    docs = []
    for c in calls:  # sequential: network + DB writes on this session
        try:
            d = pdf.get_document(s, c["transcript"], symbol=symbol, kind="transcript", period=c["period"])
            docs.append((c, list(d.pages)))  # plain data: worker threads must not touch the ORM session
        except http.FetchError as e:
            log.warning("transcript %s %s: %s", symbol, c["period"], e)
    sources = [{"doc": f"{c['period']} concall transcript", "date": c["period"], "url": c["transcript"], "page": None, "quote": None}
               for c, _ in docs]
    if not docs:
        return _empty("No concall transcripts available for this company, so there is no guidance to check"), sources

    def extract(item):
        c, pages = item
        text = "\n".join(f"[[page {i + 1}]]\n{p}" for i, p in enumerate(pages))[:CHARS]
        try:
            return c, pages, CallExtract.model_validate(ask("ledger_extract", "extract", EXTRACT.format(text=text),
                                                        schema=CallExtract, meter=meter))
        except LLMError as e:
            log.warning("ledger extract %s %s failed: %s", symbol, c["period"], e)
            return c, pages, None

    with ThreadPoolExecutor(max_workers=5) as pool:
        extracted = list(pool.map(extract, docs))
    failed_calls = sum(1 for _, _, x in extracted if x is None)

    act = actuals(fund)
    promises, citations = [], []
    for c, d, x in extracted:
        if not x:
            continue
        call_fy = _fy_of(x.quarter_discussed)
        for cl in x.claims:
            v = check(cl, act, call_fy)
            promises.append({"id": f"pr-{len(promises) + 1}", "said_in": f"{x.quarter_discussed} call ({c['period']})",
                             "said_on": c["period"], "checked_in": v["checked_in"], "metric": cl.metric, "quote": cl.quote,
                             "page": cl.page, "target": _target(cl),
                             "period": cl.period, "actual": v["actual"], "verdict": v["verdict"], "note": v["note"],
                             "tracking": v["tracking"], "url": c["transcript"]})
            citations.append({"doc": f"{x.quarter_discussed} concall", "date": c["period"], "url": c["transcript"],
                              "page": cl.page, "quote": cl.quote})
    # what they missed first, then what they kept, then what's pending; citations move with their promise
    pairs = sorted(zip(promises, citations), key=lambda pc: ORDER.get(pc[0]["verdict"], 9))
    promises, citations = [p for p, _ in pairs], [c for _, c in pairs]
    for i, p in enumerate(promises):
        p["id"] = f"pr-{i + 1}"
    if not promises:
        sec = _empty("Management gave no explicit numeric guidance on the calls we read")
        sec["cost"] = meter_view(meter)
        sec["degraded"] = bool(failed_calls)
        return sec, sources

    score = {k: sum(p["verdict"] == k for p in promises) for k in ("delivered", "partly", "missed", "too_early", "unverifiable")}
    rows = "\n".join(f"{i} | {p['said_in']} | {p['metric']} | {p['quote'][:160]} | {p['target']} | {p['period']} | "
                     f"{p['actual']} | {p['verdict']} | {p['note'] or ''}" for i, p in enumerate(promises))
    takeaway = _default_takeaway(score)
    synthesis, synth_failed = [], False
    try:
        sy = Synth.model_validate(ask("ledger_synthesis", "reason", SYNTH.format(rows=rows), schema=Synth, meter=meter))
        takeaway = sy.takeaway
        synthesis = [{"text": l.text, "cites": [i for i in l.cites if 0 <= i < len(promises)]} for l in sy.synthesis[:3]]
    except LLMError as e:
        log.warning("ledger synthesis %s failed: %s", symbol, e)
        synth_failed = True

    checked_quarters = sorted({p["checked_in"] for p in promises if p["checked_in"]})
    return {"key": "ledger", "status": "ok", "title": "Promised vs delivered", "takeaway": takeaway,
            "data": {"score": score, "quarters": checked_quarters, "promises": promises, "synthesis": synthesis},
            "citations": citations, "cost": meter_view(meter),
            "degraded": bool(failed_calls or synth_failed)}, sources


def _target(cl: Claim) -> str | None:
    unit = "%" if cl.metric in ("revenue_growth", "pat_growth", "ebitda_margin") else ""
    if cl.low is not None and cl.high is not None and cl.low != cl.high:
        return f"{cl.low:g}–{cl.high:g}{unit}"
    if cl.low is not None or cl.high is not None:
        return f"{'≥' if cl.low is not None and cl.high is None else ''}{(cl.low if cl.low is not None else cl.high):g}{unit}"
    return cl.target or cl.direction


ORDER = {"missed": 0, "partly": 1, "delivered": 2, "too_early": 3, "unverifiable": 4}


def _default_takeaway(score: dict) -> str:
    judged = score["delivered"] + score["partly"] + score["missed"]
    if not judged:
        return f"{score['too_early']} promises still in play; none due yet"
    return f"Delivered {score['delivered']} of {judged} checkable promises; {score['missed']} missed"


def _empty(msg: str) -> dict:
    return {"key": "ledger", "status": "empty", "title": "Promised vs delivered", "takeaway": msg, "data": {},
            "citations": [], "cost": {"tokens_in": 0, "tokens_out": 0, "inr": 0, "cached": False, "model": None}}
