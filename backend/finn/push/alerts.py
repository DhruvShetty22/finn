"""Triggered alerts: the user's tripwires evaluated over recent EOD data and filings.

Computed on read from the current rules, so moving a slider re-draws the list immediately; only the
seen-state is stored (ItemState, keyed by the deterministic alert id).
"""

from datetime import datetime, time, timedelta

from sqlmodel import Session, select

from finn import market
from finn.config import IST, now
from finn.db import Company, ItemState
from finn.push import rules as user_rules
from finn.push.score import LABEL

LOOKBACK_DAYS = 7
ALERT_SCORE = 55  # a watched category alone isn't enough: routine board items in it shouldn't ping


def compute(s: Session) -> list[dict]:
    from finn.push import digest  # digest imports this module for the unseen badge

    r = user_rules.get(s)
    seen = {st.id for st in s.exec(select(ItemState).where(ItemState.seen == True))}  # noqa: E712
    since = now() - timedelta(days=LOOKBACK_DAYS)
    out = []

    for c in s.exec(select(Company).where(Company.in_portfolio)):
        days = market.days(market.history(s, c.symbol, 90), lookback=r["volume_lookback"])
        for d in days:
            ts = datetime.combine(d.date, time(15, 30), IST)
            if ts < since:
                continue
            if d.vol_ratio is not None and d.vol_ratio >= r["volume_multiple"]:
                out.append(_alert(f"volume:{c.symbol}:{d.date}", ts, c.symbol, "volume",
                                  f"Volume {d.vol_ratio:.1f}× its {r['volume_lookback']}-day average",
                                  d.vol_ratio, r["volume_multiple"]))
            if d.chg_pct is not None and abs(d.chg_pct) >= r["price_move_pct"]:
                out.append(_alert(f"price:{c.symbol}:{d.date}", ts, c.symbol, "price",
                                  f"{'Rose' if d.chg_pct > 0 else 'Fell'} {abs(d.chg_pct):.1f}% in a day",
                                  d.chg_pct, r["price_move_pct"]))

    ctx = digest._context(s)
    for x in digest._scored(s, since, now(), r, ctx):
        e = x.event
        if x.score >= ALERT_SCORE and r["categories"].get(e.category):
            enr = ctx["enrich"].get(e.id)
            head = (enr.headline if enr and enr.headline else digest.headline(e.primary))
            out.append(_alert(f"category:{e.id}", e.primary.ts, e.primary.symbol, "category",
                              f"{LABEL.get(e.category, e.category)}: {head}", None, None, item_id=e.id))

    for a in out:
        a["seen"] = a["id"] in seen
    return sorted(out, key=lambda a: a["ts"], reverse=True)


def _alert(id_, ts, symbol, kind, message, value, threshold, item_id=None) -> dict:
    return {"id": id_, "ts": ts.astimezone(IST).isoformat(), "symbol": symbol, "kind": kind, "message": message,
            "value": None if value is None else round(value, 2), "threshold": threshold, "item_id": item_id}


def unseen(s: Session) -> int:
    return sum(1 for a in compute(s) if not a["seen"])
