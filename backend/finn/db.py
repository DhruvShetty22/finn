"""Tables. Same models on SQLite (local) and Postgres (production).

Push/pull phases add columns to Announcement and new tables; keep this file the single schema.
"""

import datetime as dt
from datetime import datetime

from sqlalchemy import JSON, Column, Text, inspect, text
from sqlmodel import Field, Session, SQLModel, create_engine

from finn.config import DATABASE_URL


class Company(SQLModel, table=True):
    """Every NSE equity (for search) plus portfolio metadata for our holdings."""

    symbol: str = Field(primary_key=True)
    name: str
    isin: str | None = None
    sector: str | None = None
    size: str | None = None
    weight: float | None = None
    in_portfolio: bool = Field(default=False, index=True)


class Price(SQLModel, table=True):
    symbol: str = Field(primary_key=True)
    date: dt.date = Field(primary_key=True)
    open: float | None = None
    high: float | None = None
    low: float | None = None
    close: float
    volume: int | None = None


class Announcement(SQLModel, table=True):
    """One exchange filing. Push-engine fields are filled in by finn.push."""

    id: str = Field(primary_key=True)  # "nse-<seq_id>"
    symbol: str = Field(index=True)
    company: str
    ts: datetime = Field(index=True)
    subject: str  # exchange's category line, e.g. "Outcome of Board Meeting"
    text: str = Field(default="", sa_column=Column(Text))  # exchange's one-line description
    pdf_url: str | None = None
    has_xbrl: bool = False
    source: str = "NSE"
    raw: dict = Field(default_factory=dict, sa_column=Column(JSON))
    # filled by finn.push.classify (rules) or the cheap LLM for leftovers
    category: str | None = Field(default=None, index=True)
    role: str = "primary"  # primary | ancillary (deck, newspaper ad, record date...)
    cls_source: str | None = None  # rule | llm


class Document(SQLModel, table=True):
    """A fetched PDF (annual report, transcript, results filing) and its text, cached by URL."""

    url: str = Field(primary_key=True)
    symbol: str | None = Field(default=None, index=True)
    kind: str  # annual_report | transcript | ppt | filing
    period: str | None = None  # "Oct 2026", "FY26"
    fetched_at: datetime
    sha: str
    n_pages: int
    scanned: bool = False  # too little text: needs the vision model
    pages: list[str] = Field(default_factory=list, sa_column=Column(JSON))


class Fundamentals(SQLModel, table=True):
    """Parsed screener.in company page (tables + document links), cached per symbol."""

    symbol: str = Field(primary_key=True)
    fetched_at: datetime
    data: dict = Field(default_factory=dict, sa_column=Column(JSON))


class Enrichment(SQLModel, table=True):
    """FINN's reading of one event, keyed by the event's primary filing id."""

    id: str = Field(primary_key=True)
    headline: str | None = None
    card: dict | None = Field(default=None, sa_column=Column(JSON))
    facts: dict = Field(default_factory=dict, sa_column=Column(JSON))  # materiality inputs (deal size, rating move...)
    error: str | None = None
    updated_at: datetime


class ItemState(SQLModel, table=True):
    """Triage gestures on brief items (event ids)."""

    id: str = Field(primary_key=True)
    seen: bool = False
    kept: bool = False


class Alert(SQLModel, table=True):
    id: str = Field(primary_key=True)  # deterministic: kind:symbol:date[:item]
    ts: datetime = Field(index=True)
    symbol: str
    kind: str  # volume | price | category | thesis
    message: str
    value: float | None = None
    threshold: float | None = None
    item_id: str | None = None
    seen: bool = False


class Setting(SQLModel, table=True):
    key: str = Field(primary_key=True)
    value: dict = Field(default_factory=dict, sa_column=Column(JSON))


class LLMCall(SQLModel, table=True):
    """Every model call (and cache hit), for the cost panel and the writeup."""

    id: int | None = Field(default=None, primary_key=True)
    ts: datetime
    purpose: str = Field(index=True)
    model: str
    tok_in: int = 0
    tok_out: int = 0
    tok_think: int = 0
    inr: float = 0.0
    cached: bool = False
    ms: int = 0
    key: str = Field(index=True)


class LLMCache(SQLModel, table=True):
    key: str = Field(primary_key=True)  # sha256(model, prompt, attachments, schema)
    model: str
    response: dict = Field(default_factory=dict, sa_column=Column(JSON))
    created_at: datetime


class ResearchCache(SQLModel, table=True):
    """A finished research deck per symbol; served instantly (and free) until the inputs change."""

    symbol: str = Field(primary_key=True)
    updated_at: datetime
    inputs: str  # fingerprint of the screener quarter + transcript URLs it was built from
    deck: dict = Field(default_factory=dict, sa_column=Column(JSON))


# research runs transcript extractions in threads; SQLite needs to allow that and wait out short write locks
# Postgres: no server-side prepared statements, so a transaction-mode pooler (Neon's "-pooler" host) is safe
CONNECT_ARGS = {"check_same_thread": False, "timeout": 30} if DATABASE_URL.startswith("sqlite") else {"prepare_threshold": None}
engine = create_engine(DATABASE_URL, pool_pre_ping=True, connect_args=CONNECT_ARGS)


def init_db() -> None:
    SQLModel.metadata.create_all(engine)
    _add_missing_columns()


def _add_missing_columns() -> None:
    """create_all never alters existing tables; add new nullable columns so iterating on the schema needs no reseed."""
    insp = inspect(engine)
    with engine.begin() as conn:
        for table in SQLModel.metadata.sorted_tables:
            have = {c["name"] for c in insp.get_columns(table.name)}
            for col in table.columns:
                if col.name not in have:
                    ddl = col.type.compile(dialect=engine.dialect)
                    default = col.default.arg if col.default is not None and not callable(col.default.arg) else None
                    clause = f" DEFAULT {default!r}" if isinstance(default, str) else (f" DEFAULT {int(default)}" if isinstance(default, bool) else "")
                    conn.execute(text(f'ALTER TABLE "{table.name}" ADD COLUMN "{col.name}" {ddl}{clause}'))


def session() -> Session:
    return Session(engine)
