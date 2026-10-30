"""Ingestion jobs, run by cron (GitHub Actions) or by hand.

    uv run python -m finn.jobs seed            # first run: equity list, portfolio, 6mo prices, 30d filings, fundamentals
    uv run python -m finn.jobs eod             # after market close: refresh prices
    uv run python -m finn.jobs filings [--days N]
    uv run python -m finn.jobs fundamentals SYMBOL [SYMBOL ...]
"""

import argparse
import logging

from finn import config
from finn.db import Company, init_db, session
from finn.ingest import nse, prices, screener

log = logging.getLogger("finn.jobs")


def upsert_portfolio(s) -> None:
    for h in config.holdings():
        c = s.get(Company, h["symbol"]) or Company(symbol=h["symbol"], name=h["symbol"])
        c.sector, c.size, c.weight, c.in_portfolio = h["sector"], h["size"], h["weight"], True
        s.add(c)
    s.commit()


def fundamentals(s, symbols: list[str]) -> None:
    for sym in symbols:
        try:
            f = screener.sync_fundamentals(s, sym)
            d = f.data
            log.info("fundamentals %s: %s, %d quarters, %d ARs, %d transcripts", sym, d["basis"],
                     len(d["quarters"]["periods"]) if d["quarters"] else 0, len(d["documents"]["annual_reports"]),
                     sum(1 for c in d["documents"]["concalls"] if c["transcript"]))
        except Exception as e:  # one bad symbol must not stop the batch
            log.error("fundamentals %s failed: %s", sym, e)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    p = argparse.ArgumentParser(prog="finn.jobs")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("seed")
    sub.add_parser("eod")
    f = sub.add_parser("filings")
    f.add_argument("--days", type=int, default=2)
    fu = sub.add_parser("fundamentals")
    fu.add_argument("symbols", nargs="*")
    a = p.parse_args()

    init_db()
    syms = config.portfolio_symbols()
    with session() as s:
        if a.cmd == "seed":
            log.info("equity list: %d", nse.sync_equity_list(s))
            upsert_portfolio(s)
            prices.sync_prices(s, syms, period="6mo")
            nse.sync_announcements(s, days=30, symbols=syms)
            fundamentals(s, syms + config.portfolio()["research_demo"])
        elif a.cmd == "eod":
            prices.sync_prices(s, syms, period="1mo")
        elif a.cmd == "filings":
            nse.sync_announcements(s, days=a.days, symbols=syms)
        elif a.cmd == "fundamentals":
            fundamentals(s, a.symbols or syms)


if __name__ == "__main__":
    main()
