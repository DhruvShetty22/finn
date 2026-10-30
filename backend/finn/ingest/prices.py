"""End-of-day prices from Yahoo Finance (yfinance), one batched download for the whole portfolio."""

import logging

import pandas as pd
import yfinance as yf
from sqlmodel import Session

from finn.db import Price

log = logging.getLogger(__name__)


def fetch_eod(symbols: list[str], period: str = "6mo") -> pd.DataFrame:
    """Long frame: symbol, date, open, high, low, close, volume."""
    tickers = [f"{s}.NS" for s in symbols]
    df = yf.download(tickers, period=period, interval="1d", group_by="ticker",
                     auto_adjust=False, threads=True, progress=False)
    frames = []
    for sym, t in zip(symbols, tickers):
        if t not in df.columns.get_level_values(0):
            log.warning("no price data for %s", t)
            continue
        d = df[t].dropna(subset=["Close"]).reset_index()
        d.columns = [str(c).lower() for c in d.columns]
        d["symbol"] = sym
        frames.append(d[["symbol", "date", "open", "high", "low", "close", "volume"]])
    if not frames:
        raise RuntimeError("yfinance returned no data (rate-limited?)")
    return pd.concat(frames, ignore_index=True)


def sync_prices(s: Session, symbols: list[str], period: str = "6mo") -> int:
    df = fetch_eod(symbols, period)
    for r in df.itertuples(index=False):
        s.merge(Price(symbol=r.symbol, date=r.date.date(), open=_f(r.open), high=_f(r.high),
                      low=_f(r.low), close=float(r.close), volume=None if pd.isna(r.volume) else int(r.volume)))
    s.commit()
    log.info("prices: %d rows for %d symbols", len(df), df.symbol.nunique())
    return len(df)


def _f(x) -> float | None:
    return None if pd.isna(x) else float(x)
