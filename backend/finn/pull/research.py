"""Research deck for any NSE symbol: head → deterministic sections → promise ledger, streamed section by section.

Finished decks are cached per symbol with a fingerprint of their inputs (latest reported quarter + transcript URLs);
a repeat request replays the cache instantly at ₹0 until screener shows a new quarter or a new transcript.
"""

import hashlib
import logging
from collections.abc import Iterator
from datetime import timedelta

from sqlmodel import Session

from finn.config import now
from finn.db import Company, Fundamentals, ResearchCache
from finn.ingest import http, screener
from finn.pull import compute, ledger

log = logging.getLogger(__name__)

CUT = {
    "snapshot": ("Business snapshot", "Not in this prototype: the deck stays with reported numbers and management's own words"),
    "bull_bear": ("Bull vs bear", "Not in this prototype: we chose to check management's promises over writing opinions"),
}
FRESH = timedelta(hours=12)


def _cut(key: str) -> dict:
    title, why = CUT[key]
    return {"key": key, "status": "empty", "title": title, "takeaway": why, "data": {}, "citations": [],
            "cost": dict(compute.ZERO_COST)}


def fingerprint(fund: dict) -> str:
    q = (fund.get("quarters") or {}).get("periods", [])[-1:]
    tr = [c["transcript"] for c in fund.get("documents", {}).get("concalls", []) if c.get("transcript")][:ledger.N_CALLS]
    return hashlib.sha1("|".join(q + tr).encode()).hexdigest()[:16]


def _sources(fund: dict) -> list[dict]:
    calls = [c for c in fund.get("documents", {}).get("concalls", []) if c.get("transcript")][:ledger.N_CALLS]
    out = [{"doc": f"{c['period']} concall transcript", "date": c["period"], "url": c["transcript"], "page": None, "quote": None} for c in calls]
    ar = fund.get("documents", {}).get("annual_reports", [])[:1]
    out += [{"doc": f"Annual report {a['year']}", "date": str(a["year"]), "url": a["url"], "page": None, "quote": None} for a in ar]
    out.append({"doc": "Standardised financials (screener.in, from exchange filings)", "date": now().date().isoformat(),
                "url": f"{screener.BASE}/company/{fund['symbol']}/", "page": None, "quote": None})
    return out


def stream(s: Session, symbol: str, refresh: bool = False) -> Iterator[tuple[str, dict]]:
    symbol = symbol.upper().strip()
    t0 = now()
    cached = s.get(ResearchCache, symbol)
    if cached and not refresh and now() - cached.updated_at.astimezone(t0.tzinfo) < FRESH:
        yield from _replay(cached.deck, t0)
        return
    try:
        fund = screener.fetch_company(symbol)
    except http.FetchError:
        yield "error", {"message": f"{symbol}: not found on screener.in, so there are no primary documents to research"}
        return
    s.merge(Fundamentals(symbol=symbol, fetched_at=now(), data=fund))
    s.commit()
    fp = fingerprint(fund)
    if cached and not refresh and cached.inputs == fp:
        cached.updated_at = now()
        s.add(cached)
        s.commit()
        yield from _replay(cached.deck, t0)
        return

    company = s.get(Company, symbol)
    head = {"symbol": symbol, "name": fund.get("name") or (company.name if company else symbol),
            "as_of": now().date().isoformat(), "sources": _sources(fund)}
    yield "head", head
    sections = []
    for fn in (compute.financials, compute.trajectory, compute.balance_sheet, compute.cash_quality):
        sec = fn(fund)
        sections.append(sec)
        yield "section", sec
    sections.append(_cut("snapshot"))
    yield "section", sections[-1]
    led, _ = ledger.build(s, symbol, fund)
    sections.append(led)
    yield "section", led
    sections.append(_cut("bull_bear"))
    yield "section", sections[-1]

    total = _total(sections)
    deck = {**head, "sections": sections, "total_cost": total}
    s.merge(ResearchCache(symbol=symbol, updated_at=now(), inputs=fp, deck=deck))
    s.commit()
    yield "done", {"symbol": symbol, "total_cost": total, "elapsed_ms": int((now() - t0).total_seconds() * 1000)}


def _replay(deck: dict, t0) -> Iterator[tuple[str, dict]]:
    yield "head", {k: deck[k] for k in ("symbol", "name", "as_of", "sources")}
    for sec in deck["sections"]:
        yield "section", {**sec, "cost": {**sec["cost"], "tokens_in": 0, "tokens_out": 0, "inr": 0, "cached": True}}
    yield "done", {"symbol": deck["symbol"], "total_cost": {**deck["total_cost"], "inr": 0, "cached": True},
                   "elapsed_ms": int((now() - t0).total_seconds() * 1000)}


def _total(sections: list[dict]) -> dict:
    c = [x["cost"] for x in sections]
    models = sorted({m for x in c if x.get("model") for m in x["model"].split(" + ")})
    return {"tokens_in": sum(x["tokens_in"] for x in c), "tokens_out": sum(x["tokens_out"] for x in c),
            "inr": round(sum(x["inr"] for x in c), 2), "cached": all(x["cached"] for x in c), "model": " + ".join(models) or None}


def deck(s: Session, symbol: str, refresh: bool = False) -> dict:
    """Whole deck at once (?format=json, prewarm, theses)."""
    out = {}
    for ev, data in stream(s, symbol, refresh):
        if ev == "head":
            out.update(data, sections=[])
        elif ev == "section":
            out["sections"].append(data)
        elif ev == "done":
            out["total_cost"] = data["total_cost"]
        elif ev == "error":
            raise LookupError(data["message"])
    return out
