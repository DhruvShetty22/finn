"""NSE: corporate announcements and the equity master list.

One announcements call without a symbol returns *every* equity's filings for the range
(30 days ≈ 13k rows, 9 MB, ~3 s), so we fetch in bulk and filter locally.
Timestamps are aware IST datetimes (NSE publishes IST wall-clock times).
"""

import csv
import io
import logging
from datetime import date, datetime, timedelta

from sqlmodel import Session, select

from finn.config import IST, now
from finn.db import Announcement, Company
from finn.ingest import http

log = logging.getLogger(__name__)

ANN_URL = "https://www.nseindia.com/api/corporate-announcements?index=equities&from_date={f}&to_date={t}"
EQUITY_LIST_URL = "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv"


def fetch_announcements(start: date, end: date, symbol: str | None = None) -> list[dict]:
    url = ANN_URL.format(f=start.strftime("%d-%m-%Y"), t=end.strftime("%d-%m-%Y"))
    if symbol:
        url += f"&symbol={symbol}"
    data = http.get_json(url, headers={"Accept": "application/json"})
    if not isinstance(data, list):  # NSE answers {} or an error object when unhappy
        raise http.FetchError(f"unexpected NSE payload: {str(data)[:200]}")
    return data


def _row(a: dict) -> Announcement:
    return Announcement(
        id=f"nse-{a['seq_id']}",
        symbol=a["symbol"],
        company=a.get("sm_name") or a["symbol"],
        ts=datetime.strptime(a["sort_date"], "%Y-%m-%d %H:%M:%S").replace(tzinfo=IST),
        subject=(a.get("desc") or "").strip(),
        text=(a.get("attchmntText") or "").strip(),
        pdf_url=a.get("attchmntFile") or None,
        has_xbrl=bool(a.get("hasXbrl")),
        raw=a,
    )


def sync_announcements(s: Session, days: int = 2, symbols: list[str] | None = None, end: date | None = None) -> int:
    """Upsert the last `days` of filings, keeping only `symbols` (None = keep all)."""
    end = end or now().date()
    start = end - timedelta(days=days)
    if symbols and len(symbols) <= 3:
        raw = [a for sym in symbols for a in fetch_announcements(start, end, sym)]
    else:
        raw = fetch_announcements(start, end)
    keep = set(symbols) if symbols else None
    n = 0
    for a in raw:
        if keep is not None and a.get("symbol") not in keep:
            continue
        s.merge(_row(a))
        n += 1
    s.commit()
    log.info("announcements: %d fetched, %d kept (%s → %s)", len(raw), n, start, end)
    return n


def sync_equity_list(s: Session) -> int:
    """All NSE equities, for search/autocomplete and name lookup. Keeps portfolio metadata intact."""
    text = http.get(EQUITY_LIST_URL, ttl=86400).decode("utf-8-sig")
    existing = {c.symbol: c for c in s.exec(select(Company))}
    n = 0
    for r in csv.DictReader(io.StringIO(text)):
        r = {k.strip(): (v or "").strip() for k, v in r.items()}
        if r.get("SERIES") not in ("EQ", "BE", "BZ", "SM", "ST"):
            continue
        sym = r["SYMBOL"]
        c = existing.get(sym) or Company(symbol=sym, name=r["NAME OF COMPANY"])
        c.name, c.isin = r["NAME OF COMPANY"], r.get("ISIN NUMBER") or c.isin
        s.add(c)
        n += 1
    s.commit()
    return n
