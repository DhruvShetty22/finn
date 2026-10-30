"""EOD price helpers shared by the portfolio view, the brief (same-session reaction) and alerts."""

import datetime as dt
from dataclasses import dataclass

from sqlmodel import Session, select

from finn.config import IST
from finn.db import Price

MARKET_CLOSE = dt.time(15, 30)


@dataclass
class Day:
    date: dt.date
    close: float
    chg_pct: float | None  # vs previous close
    volume: int | None
    vol_ratio: float | None  # volume / average of the previous `lookback` sessions


def history(s: Session, symbol: str, n: int = 90) -> list[Price]:
    rows = s.exec(select(Price).where(Price.symbol == symbol).order_by(Price.date.desc()).limit(n)).all()
    return rows[::-1]  # oldest first


def days(prices: list[Price], lookback: int = 20) -> list[Day]:
    out = []
    for i, p in enumerate(prices):
        prev = prices[i - 1].close if i else None
        window = [q.volume for q in prices[max(0, i - lookback):i] if q.volume]
        avg = sum(window) / len(window) if len(window) >= min(lookback, 5) else None
        out.append(Day(p.date, p.close, round((p.close / prev - 1) * 100, 2) if prev else None, p.volume,
                       round(p.volume / avg, 2) if avg and p.volume else None))
    return out


def reaction_day(ts: dt.datetime, series: list[Day]) -> Day | None:
    """The session that priced in a filing: same day if filed before the close, else the next session."""
    local = ts.astimezone(IST)
    first = local.date() if local.time() < MARKET_CLOSE else local.date() + dt.timedelta(days=1)
    return next((d for d in series if d.date >= first), None)
