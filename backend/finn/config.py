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


DATA = Path(os.getenv("FINN_DATA_DIR", ROOT / "data"))
DATA.mkdir(parents=True, exist_ok=True)


def _db_url() -> str:
    url = os.getenv("DATABASE_URL", "sqlite:///data/finn.db")
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
HTTP_CACHE = os.getenv("FINN_HTTP_CACHE", "1") == "1"


@lru_cache
def portfolio() -> dict:
    return yaml.safe_load((PKG / "portfolio.yaml").read_text())


def holdings() -> list[dict]:
    return portfolio()["holdings"]


def portfolio_symbols() -> list[str]:
    return [h["symbol"] for h in holdings()]
