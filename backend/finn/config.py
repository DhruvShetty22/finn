"""Paths, env and the portfolio file. Everything else imports settings from here."""

import os
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path

import yaml
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]  # repo root (holds .env, data/)
PKG = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")

IST = timezone(timedelta(hours=5, minutes=30), "IST")


def now() -> datetime:
    """Timezone-aware IST now. The DB stores aware datetimes (returned as UTC); render with .astimezone(IST)."""
    return datetime.now(IST)


ON_VERCEL = bool(os.getenv("VERCEL"))  # serverless functions: only /tmp is writable
DATA = Path(os.getenv("FINN_DATA_DIR") or ("/tmp/finn" if ON_VERCEL else ROOT / "data"))
try:
    DATA.mkdir(parents=True, exist_ok=True)
except OSError:  # read-only filesystem we didn't anticipate: fall back rather than crash at import
    DATA = Path("/tmp/finn")
    DATA.mkdir(parents=True, exist_ok=True)


def _db_url() -> str:
    url = os.getenv("DATABASE_URL") or f"sqlite:///{DATA / 'finn.db'}"
    if url.startswith("sqlite:///") and not url.startswith("sqlite:////"):
        # relative sqlite paths are relative to the repo root, not the cwd
        url = f"sqlite:///{ROOT / url.removeprefix('sqlite:///')}"
    # Neon/Render hand out postgres:// URLs; SQLAlchemy wants an explicit driver
    if url.startswith("postgres://"):
        url = "postgresql+psycopg://" + url.removeprefix("postgres://")
    elif url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url.removeprefix("postgresql://")
    return url


DATABASE_URL = _db_url()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
# On-disk HTTP cache for development; production relies on the DB tables instead.
HTTP_CACHE = os.getenv("FINN_HTTP_CACHE", "0" if ON_VERCEL else "1") == "1"


@lru_cache
def portfolio() -> dict:
    return yaml.safe_load((PKG / "portfolio.yaml").read_text())


def holdings() -> list[dict]:
    return portfolio()["holdings"]


def portfolio_symbols() -> list[str]:
    return [h["symbol"] for h in holdings()]
