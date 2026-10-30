"""FastAPI app. Phase 1 = walking skeleton (health + raw announcements); the contract endpoints land in Phase 2–3.

    uv run uvicorn finn.api.main:app --reload
"""

import os
from datetime import timedelta

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import func, select

from finn.config import IST, now
from finn.db import Announcement, Price, init_db, session

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
