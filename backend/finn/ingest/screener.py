"""screener.in company page → standardised tables + links to annual reports and concall transcripts.

Works for any NSE symbol screener covers. Consolidated figures are preferred; companies without
subsidiaries only have meaningful standalone numbers, so we fall back when the consolidated table is empty.
"""

import logging
import re

from bs4 import BeautifulSoup
from sqlmodel import Session

from finn.config import now
from finn.db import Fundamentals
from finn.ingest import http

log = logging.getLogger(__name__)

BASE = "https://www.screener.in"
TABLES = {"quarters": "quarters", "profit-loss": "profit_loss", "balance-sheet": "balance_sheet",
          "cash-flow": "cash_flow", "ratios": "ratios", "shareholding": "shareholding"}
STALE_SECONDS = 6 * 3600


def _num(s: str):
    s = s.replace(",", "").replace("%", "").replace("₹", "").strip()
    if s in ("", "-", "--"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _table(section) -> dict | None:
    t = section.select_one("table") if section else None
    if t is None:
        return None
    periods = [th.get_text(strip=True) for th in t.select("thead th")][1:]
    rows = {}
    for tr in t.select("tbody tr"):
        tds = tr.select("td")
        if not tds:
            continue
        label = re.sub(r"\s*\+$", "", tds[0].get_text(" ", strip=True)).strip()
        if not label or label == "Raw PDF":
            continue
        rows[label] = [_num(td.get_text(strip=True)) for td in tds[1:]]
    if not any(v is not None for vals in rows.values() for v in vals):
        return None
    return {"periods": periods, "rows": rows}


def _documents(soup) -> dict:
    out = {"annual_reports": [], "concalls": []}
    ar = soup.select_one("div.documents.annual-reports")
    for li in ar.select("li") if ar else []:
        a = li.select_one("a[href]")
        m = re.search(r"(20\d\d)", li.get_text(" ", strip=True))
        if a and m:
            out["annual_reports"].append({"year": int(m.group(1)), "url": a["href"]})
    cc = soup.select_one("div.documents.concalls")
    for li in cc.select("li") if cc else []:
        period = li.select_one(".ink-600, .font-size-15, div")
        entry = {"period": (period.get_text(strip=True) if period else li.get_text(" ", strip=True)[:8]),
                 "transcript": None, "ppt": None, "rec": None}
        for a in li.select("a[href]"):
            kind = a.get_text(strip=True).lower()
            if kind.startswith("transcript"):
                entry["transcript"] = a["href"]
            elif kind == "ppt":
                entry["ppt"] = a["href"]
            elif kind == "rec":
                entry["rec"] = a["href"]
        out["concalls"].append(entry)
    return out


def parse(html: str) -> dict:
    soup = BeautifulSoup(html, "lxml")
    name = soup.select_one("h1")
    about = soup.select_one(".company-profile .about") or soup.select_one(".about")
    top = {}
    for li in soup.select("#top-ratios li"):
        k, v = li.select_one(".name"), li.select_one(".value")
        if k and v:
            top[k.get_text(" ", strip=True)] = v.get_text(" ", strip=True)
    sources = [{"period": None, "url": BASE + a["href"]} for a in soup.select("section#quarters a[href^='/company/source/quarter/']")]
    cid = soup.select_one("[data-company-id]")
    return {
        "name": name.get_text(strip=True) if name else None,
        "screener_id": cid.get("data-company-id") if cid else None,
        "about": about.get_text(" ", strip=True) if about else None,
        "top_ratios": top,
        **{key: _table(soup.select_one(f"section#{sid}")) for sid, key in TABLES.items()},
        "quarter_sources": sources,
        "documents": _documents(soup),
    }


def fetch_company(symbol: str, fresh: bool = False) -> dict:
    """Parsed company page. Raises http.FetchError if screener doesn't know the symbol. fresh=True skips the disk cache."""
    ttl = None if fresh else STALE_SECONDS
    html = http.get(f"{BASE}/company/{symbol}/consolidated/", ttl=ttl).decode()
    data, basis = parse(html), "consolidated"
    if not data["quarters"] or not data["profit_loss"]:
        html = http.get(f"{BASE}/company/{symbol}/", ttl=ttl).decode()
        data, basis = parse(html), "standalone"
    if data["quarters"]:  # label quarter source PDFs with their periods
        for src, p in zip(data["quarter_sources"], data["quarters"]["periods"]):
            src["period"] = p
    data.update(symbol=symbol, basis=basis,
                is_financial=bool(data["quarters"] and "Financing Profit" in data["quarters"]["rows"]))
    return data


def sync_fundamentals(s: Session, symbol: str) -> Fundamentals:
    f = Fundamentals(symbol=symbol, fetched_at=now(), data=fetch_company(symbol))
    s.merge(f)
    s.commit()
    return f
