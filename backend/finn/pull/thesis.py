"""Thesis-lite: a holding's pillars are management's own forward guidance, taken from the ledger.

Pillars are the checkable (revenue growth / margin / profit growth) promises still in play; their status comes from
the ledger's code verdicts. Results filings are then judged against them in code (see `impact`).
"""

from finn.config import now

NAMES = {"revenue_growth": "Revenue growth", "ebitda_margin": "EBITDA margin", "pat_growth": "PAT growth"}
STATUS = {"missed": "broken", "partly": "at_risk", "delivered": "on_track"}


def from_deck(symbol: str, deck: dict) -> dict:
    led = next((x for x in deck.get("sections", []) if x["key"] == "ledger"), None)
    promises = (led or {}).get("data", {}).get("promises", [])
    cits = (led or {}).get("citations", [])
    numeric = [(p, c) for p, c in zip(promises, cits) if p["metric"] in NAMES and p.get("target")]
    live = [pc for pc in numeric if pc[0]["verdict"] == "too_early"]
    picked = (live or numeric)[:3]
    pillars = []
    for i, (p, c) in enumerate(picked):
        status = ({"on_track": "on_track", "at_risk": "at_risk"}.get(p.get("tracking")) if p["verdict"] == "too_early"
                  else STATUS.get(p["verdict"], "untested")) or "untested"
        evidence = []
        if p.get("actual"):
            evidence.append({"ts": now().isoformat(), "item_id": None,
                             "verdict": "supports" if status == "on_track" else "challenges",
                             "note": f"Reported so far: {p['actual']}" + (f"; {p['note']}" if p.get("note") else "")})
        pillars.append({"id": f"{symbol.lower()}-p{i + 1}", "text": f"{NAMES[p['metric']]} {p['target']} in {p.get('period') or 'the guided period'}",
                        "metric": p["metric"], "target": p["target"], "period": p.get("period"),
                        "source": {"doc": c["doc"], "date": c["date"], "url": c["url"], "page": c.get("page"), "quote": c.get("quote")},
                        "status": status, "evidence": evidence, "_low": _low(p["target"])})
    st = [x["status"] for x in pillars]
    status = "none" if not pillars else "challenged" if "broken" in st else "watch" if "at_risk" in st else "intact"
    drafted = {(c["doc"], c["date"], c["url"]) for _, c in picked}
    return {"symbol": symbol, "status": status, "drafted_from": [{"doc": d, "date": dt, "url": u} for d, dt, u in sorted(drafted)],
            "user_edited": False, "pillars": pillars}


def _low(target: str | None) -> float | None:
    import re
    m = re.search(r"-?\d+(\.\d+)?", target or "")
    return float(m.group()) if m else None


def impact(thesis: dict | None, card: dict | None) -> dict | None:
    """Judge a results card against the thesis pillars, in code: is the quarter consistent with what was guided?"""
    if not thesis or not card or card.get("kind") != "results":
        return None
    rows = {r["metric"]: r for r in card.get("rows", [])}
    for pl in thesis["pillars"]:
        low = pl.get("_low")
        if low is None:
            continue
        if pl["metric"] == "ebitda_margin" and card.get("margin"):
            got = card["margin"]["cur"]
            ok = got >= low - 0.3
            return _verdict(pl, ok, f"{card['period']} EBITDA margin {got:.1f}% vs {pl['target']} guided")
        if pl["metric"] in ("revenue_growth", "pat_growth"):
            r = rows.get("Revenue" if pl["metric"] == "revenue_growth" else "PAT") or rows.get("NII")
            if r and r.get("yoy_pct") is not None:
                ok = r["yoy_pct"] >= low - 1
                return _verdict(pl, ok, f"{card['period']} {r['metric']} {r['yoy_pct']:+.0f}% YoY vs {pl['target']} guided")
    return None


def _verdict(pl: dict, ok: bool, reason: str) -> dict:
    return {"pillar_id": pl["id"], "pillar": pl["text"], "verdict": "supports" if ok else "challenges", "reason": reason}


def public(thesis: dict) -> dict:
    """Drop internal fields before sending over the API."""
    return {**thesis, "pillars": [{k: v for k, v in p.items() if not k.startswith("_")} for p in thesis["pillars"]]}


def load(s, symbols: list[str]) -> dict[str, dict]:
    """Theses for the given symbols, derived from their cached research decks (no deck → no thesis)."""
    from sqlmodel import select

    from finn.db import ResearchCache

    rows = s.exec(select(ResearchCache).where(ResearchCache.symbol.in_(symbols))).all()
    return {r.symbol: t for r in rows if (t := from_deck(r.symbol, r.deck))["pillars"]}
