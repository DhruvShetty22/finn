"""The windowed brief (GET /api/brief): classify → group → score → tier, in that order, all from the DB."""

import re
from datetime import datetime, timedelta

from sqlmodel import Session, func, select

from finn import market
from finn.config import IST, now
from finn.db import Alert, Announcement, Company, Enrichment, ItemState
from finn.push import rules as user_rules
from finn.push.events import ANCILLARY_WINDOW, group
from finn.push.score import Scored, promote_primary, score

WIDEN = [(timedelta(hours=24), "Last 24 hours"), (timedelta(days=3), "Last 3 days"), (timedelta(days=7), "Last 7 days")]
MAX_TOP = 5
TITLED = re.compile(r'titled\s+["“]([^"”]{8,})["”]?', re.I)
BOILERPLATE = re.compile(r"^.*?\bhas (informed|submitted)( to)? the Exchange,?\s*(about|regarding|that|the)?\s*", re.I)


def headline(a: Announcement) -> str:
    """The exchange's description minus the 'X Limited has informed the Exchange about' preamble."""
    if m := TITLED.search(a.text or ""):  # 'a press release dated ..., titled "Real headline"'
        return m.group(1).strip()
    t = BOILERPLATE.sub("", a.text or "").strip() or a.subject
    t = re.sub(r"\s+", " ", t).strip(" .'\"")
    return (t[0].upper() + t[1:]) if t else a.subject


def label(start: datetime, end: datetime) -> str:
    for span, name in WIDEN:
        if abs((end - start) - span) < timedelta(minutes=5):
            return name
    return f"{start.astimezone(IST):%d %b} – {end.astimezone(IST):%d %b}"


def build(s: Session, start: datetime | None = None, end: datetime | None = None) -> dict:
    end = end or now()
    custom = start is not None
    start = start or end - WIDEN[0][0]
    widened_from = None
    r = user_rules.get(s)
    ctx = _context(s)

    scored = _scored(s, start, end, r, ctx)
    if not custom:
        for span, _ in WIDEN[1:]:
            if any(x.tier in ("top", "read") for x in scored):
                break
            widened_from = widened_from or label(start, end)
            start = end - span
            scored = _scored(s, start, end, r, ctx)

    scored.sort(key=lambda x: (x.score, x.event.primary.ts), reverse=True)
    top = [x for x in scored if x.tier == "top"][:MAX_TOP]
    read = [x for x in scored if x.tier == "read" or (x.tier == "top" and x not in top)]
    routine = [x for x in scored if x.tier == "routine"]
    by_cat: dict[str, int] = {}
    for x in routine:
        by_cat[x.event.category] = by_cat.get(x.event.category, 0) + 1

    items = lambda xs: [_item(x, ctx) for x in xs]
    material = len(top) + len(read)
    return {
        "window": {"from": start.astimezone(IST).isoformat(), "to": end.astimezone(IST).isoformat(),
                   "label": label(start, end), "widened_from": widened_from},
        "summary": {"theses_intact": 0, "theses_total": 0, "challenged": [], "material": material,
                    "routine": len(routine), "headline": _summary_line(top + read, len(routine))},
        "top": items(top), "worth_reading": items(read),
        "routine": {"count": len(routine), "by_category": by_cat, "items": items(routine)},
        "alerts_unseen": s.exec(select(func.count()).select_from(Alert).where(Alert.seen == False)).one(),  # noqa: E712
    }


def _context(s: Session) -> dict:
    companies = {c.symbol: c for c in s.exec(select(Company).where(Company.in_portfolio))}
    series = {sym: market.days(market.history(s, sym, 90)) for sym in companies}
    return {"companies": companies, "series": series,
            "enrich": {}, "state": {st.id: st for st in s.exec(select(ItemState))}}


def _scored(s: Session, start: datetime, end: datetime, r: dict, ctx: dict) -> list[Scored]:
    # look back past the window so a deck filed today still attaches to yesterday's results (and is dropped with it)
    anns = s.exec(select(Announcement).where(Announcement.ts >= start - ANCILLARY_WINDOW, Announcement.ts <= end,
                                             Announcement.symbol.in_(list(ctx["companies"])))).all()
    events = [e for e in group(list(anns)) if e.primary.ts >= start]
    # the session's move belongs to the results, not to the director appointment filed the same evening
    results_days = {(e.primary.symbol, d.date) for e in events if e.category == "results"
                    and (d := market.reaction_day(e.primary.ts, ctx["series"].get(e.primary.symbol, [])))}
    out = []
    for e in events:
        promote_primary(e)
        if e.id not in ctx["enrich"]:
            ctx["enrich"][e.id] = s.get(Enrichment, e.id)
        enr = ctx["enrich"][e.id]
        c = ctx["companies"].get(e.primary.symbol)
        react = market.reaction_day(e.primary.ts, ctx["series"].get(e.primary.symbol, []))
        if react and e.category != "results" and (e.primary.symbol, react.date) in results_days:
            react = None
        out.append(score(e, rules=r, weight=c.weight if c else None, reaction=react, facts=enr.facts if enr else None))
    return out


def _item(x: Scored, ctx: dict) -> dict:
    a = x.event.primary
    enr = ctx["enrich"].get(a.id)
    react = market.reaction_day(a.ts, ctx["series"].get(a.symbol, []))
    st = ctx["state"].get(a.id)
    card = enr.card if enr and enr.card else None
    if card and card.get("kind") == "person" and x.red_flag and not card.get("red_flag"):
        card = {**card, "red_flag": x.red_flag}
    return {
        "id": a.id, "symbol": a.symbol, "company": a.company, "ts": a.ts.astimezone(IST).isoformat(),
        "category": x.event.category, "subject": a.subject, "source": a.source, "pdf_url": a.pdf_url,
        "tier": x.tier, "score": x.score, "why": " · ".join(x.why),
        "headline": (enr.headline if enr and enr.headline else headline(a)),
        "thesis": None, "card": card,
        "market": {"chg_pct": react.chg_pct, "vol_ratio": react.vol_ratio} if react and react.chg_pct is not None else None,
        "seen": bool(st and st.seen),
    }


def _summary_line(material: list[Scored], routine: int) -> str:
    if not material:
        return f"Nothing material · {routine} routine filings tucked away"
    cats: dict[str, int] = {}
    for x in material:
        cats[x.event.category] = cats.get(x.event.category, 0) + 1
    names = {"results": "results", "management_change": "management change", "M&A": "deal", "credit_rating": "rating action",
             "litigation": "legal / regulatory", "fund_raise": "fund raise", "press_release": "update", "capex": "capex"}
    parts = [f"{n} {names.get(c, c.replace('_', ' '))}" for c, n in sorted(cats.items(), key=lambda kv: -kv[1])[:3]]
    return f"{len(material)} worth your attention ({', '.join(parts)}) · {routine} routine tucked away"
