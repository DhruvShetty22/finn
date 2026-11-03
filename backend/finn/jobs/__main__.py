"""Ingestion jobs, run by cron (GitHub Actions) or by hand.

    uv run python -m finn.jobs seed            # first run: equity list, portfolio, 6mo prices, 30d filings, fundamentals
    uv run python -m finn.jobs eod             # after market close: refresh prices
    uv run python -m finn.jobs filings [--days N]  # fetch → classify → enrich cards
    uv run python -m finn.jobs enrich [--days N] [--retry]
    uv run python -m finn.jobs fundamentals SYMBOL [SYMBOL ...]
    uv run python -m finn.jobs copy-db env:NEON_URL  # copy this DB (incl. LLM cache) into another; URL or env:VAR
    uv run python -m finn.jobs prewarm         # retry missing cards, build research decks (→ theses) for demo set + holdings
"""

import argparse
import logging

from finn import config
from finn.db import Company, init_db, session
from finn.ingest import nse, prices, screener
from finn.pull import research
from finn.push import classify, enrich

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


def copy_db(url: str) -> None:
    """Replace the target DB's tables with this DB's rows. Production starts with every card, deck and cached
    model answer already built, so going live costs zero model calls."""
    from sqlalchemy import create_engine
    from sqlmodel import SQLModel

    from finn.config import _db_url
    from finn.db import engine as src

    import os
    if url.startswith("env:"):  # read the target from the environment (.env) so it never shows up in a command line
        url = os.environ[url.removeprefix("env:")]
    os.environ["DATABASE_URL"] = url.replace("-pooler.", ".")  # bulk load over Neon's direct host, not the pooler
    dst = create_engine(_db_url(), pool_pre_ping=True, connect_args={"prepare_threshold": None})
    SQLModel.metadata.create_all(dst)
    with src.connect() as r, dst.begin() as w:
        for table in reversed(SQLModel.metadata.sorted_tables):
            w.execute(table.delete())
        for table in SQLModel.metadata.sorted_tables:
            rows = [dict(row._mapping) for row in r.execute(table.select())]
            for i in range(0, len(rows), 500):
                w.execute(table.insert(), rows[i:i + 500])
            log.info("copied %s: %d rows", table.name, len(rows))
        if dst.dialect.name == "postgresql":
            reset_sequences(w)
    log.info("target: %s", dst.url.render_as_string(hide_password=True).split("@")[-1].split("/")[0])


def reset_sequences(conn) -> None:
    """Rows copied with explicit ids leave Postgres sequences at 1, so the next insert collides (IntegrityError).
    Move every serial sequence past the copied max id."""
    from sqlalchemy import text
    from sqlmodel import SQLModel

    for table in SQLModel.metadata.sorted_tables:
        for col in table.primary_key.columns:
            if col.autoincrement is True or (col.autoincrement == "auto" and col.type.python_type is int):
                seq = conn.execute(text("SELECT pg_get_serial_sequence(:t, :c)"), {"t": table.name, "c": col.name}).scalar()
                if seq:
                    conn.execute(text(f'SELECT setval(:s, COALESCE((SELECT MAX("{col.name}") FROM "{table.name}"), 0) + 1, false)'), {"s": seq})
                    log.info("sequence %s reset", seq)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    p = argparse.ArgumentParser(prog="finn.jobs")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("seed")
    sub.add_parser("eod")
    f = sub.add_parser("filings")
    f.add_argument("--days", type=int, default=2)
    en = sub.add_parser("enrich")
    en.add_argument("--days", type=int, default=7)
    en.add_argument("--retry", action="store_true", help="retry events whose card failed before")
    cp = sub.add_parser("copy-db")
    cp.add_argument("url")
    pw = sub.add_parser("prewarm")
    pw.add_argument("--refresh", action="store_true", help="rebuild decks even if cached (extraction calls stay cached)")
    fu = sub.add_parser("fundamentals")
    fu.add_argument("symbols", nargs="*")
    a = p.parse_args()

    if a.cmd == "copy-db":
        return copy_db(a.url)
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
            log.info("classify: %s", classify.run(s))
            log.info("enrich: %s", enrich.run(s, days=max(a.days, 2)))
        elif a.cmd == "enrich":
            log.info("classify: %s", classify.run(s))
            log.info("enrich: %s", enrich.run(s, days=a.days, retry_failed=a.retry))
        elif a.cmd == "prewarm":
            log.info("enrich: %s", enrich.run(s, days=7, retry_failed=True))
            for sym in dict.fromkeys(config.portfolio()["research_demo"] + syms):
                try:
                    d = research.deck(s, sym, refresh=a.refresh)
                    led = next(x for x in d["sections"] if x["key"] == "ledger")
                    log.info("deck %s: ledger %s %s, %s", sym, led["status"], led["data"].get("score"), d["total_cost"])
                except LookupError as e:
                    log.error("deck %s: %s", sym, e)
        elif a.cmd == "fundamentals":
            fundamentals(s, a.symbols or syms)


if __name__ == "__main__":
    main()
