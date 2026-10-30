"""FastAPI app. Phase 1 = walking skeleton (health + raw announcements); the contract endpoints land in Phase 2–3.

    uv run uvicorn finn.api.main:app --reload
"""

import os
from datetime import timedelta

from datetime import datetime

from fastapi import Body, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import func, select

from finn import market
from finn.config import IST, now
from finn.db import Alert, Announcement, Company, ItemState, Price, init_db, session
from finn.push import digest
from finn.push import rules as user_rules

app = FastAPI(title="FINN")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("FINN_CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup() -> None:
    init_db()


@app.get("/api/health")
def health() -> dict:
    with session() as s:
        return {
            "ok": True,
            "announcements": s.exec(select(func.count()).select_from(Announcement)).one(),
            "last_eod": s.exec(select(func.max(Price.date))).one(),
        }


@app.get("/api/announcements")
def announcements(symbol: str | None = None, hours: int = Query(24, le=24 * 31)) -> list[dict]:
    """Raw filings, newest first. Debug/skeleton endpoint; the product reads /api/brief."""
    since = now() - timedelta(hours=hours)
    q = select(Announcement).where(Announcement.ts >= since).order_by(Announcement.ts.desc())
    if symbol:
        q = q.where(Announcement.symbol == symbol.upper())
    with session() as s:
        return [{**a.model_dump(exclude={"raw"}), "ts": a.ts.astimezone(IST).isoformat()} for a in s.exec(q.limit(500))]


def short_name(name: str) -> str:
    for suffix in (" Limited", " Ltd.", " Ltd"):
        name = name.removesuffix(suffix)
    return name


@app.get("/api/portfolio")
def portfolio() -> dict:
    with session() as s:
        holdings, as_of = [], None
        for c in s.exec(select(Company).where(Company.in_portfolio).order_by(Company.weight.desc())):
            ds = market.days(market.history(s, c.symbol, 60))
            if not ds:
                continue
            last = ds[-1]
            as_of = max(as_of or last.date, last.date)
            holdings.append({
                "symbol": c.symbol, "name": short_name(c.name), "sector": c.sector, "weight": c.weight,
                "close": round(last.close, 2), "chg_pct": last.chg_pct, "vol_ratio": last.vol_ratio,
                "spark": [round(d.close, 2) for d in ds[-30:]],
                "thesis_status": "none",  # Phase 3
                "unseen": 0,  # filled once the brief exists
            })
        return {"as_of": as_of.isoformat() if as_of else None, "holdings": holdings}


@app.get("/api/search")
def search(q: str = Query(..., min_length=1), limit: int = Query(8, le=25)) -> dict:
    """Ticker/name autocomplete over all NSE equities; exact symbol first, then prefix, then substring."""
    q = q.strip()
    with session() as s:
        rows = s.exec(select(Company).where(
            (func.upper(Company.symbol).startswith(q.upper())) | (func.lower(Company.name).contains(q.lower()))
        ).limit(200)).all()
    rank = lambda c: (c.symbol != q.upper(), not c.symbol.startswith(q.upper()), not c.in_portfolio, len(c.symbol))
    return {"results": [{"symbol": c.symbol, "name": short_name(c.name)} for c in sorted(rows, key=rank)[:limit]]}


def _dt(v: str | None) -> datetime | None:
    if not v:
        return None
    d = datetime.fromisoformat(v.replace("Z", "+00:00"))
    return d if d.tzinfo else d.replace(tzinfo=IST)


@app.get("/api/brief")
def brief(from_: str | None = Query(None, alias="from"), to: str | None = None) -> dict:
    with session() as s:
        return digest.build(s, _dt(from_), _dt(to))


@app.post("/api/items/{item_id}/{action}")
def triage(item_id: str, action: str) -> dict:
    if action not in ("seen", "keep"):
        raise HTTPException(404)
    with session() as s:
        st = s.get(ItemState, item_id) or ItemState(id=item_id)
        if action == "seen":
            st.seen = True
        else:
            st.kept = True
        s.add(st)
        s.commit()
    return {"ok": True}


@app.get("/api/rules")
def get_rules() -> dict:
    with session() as s:
        return user_rules.get(s)


@app.put("/api/rules")
def put_rules(body: dict = Body(...)) -> dict:
    with session() as s:
        return user_rules.put(s, body)
