"""Tables. Same models on SQLite (local) and Postgres (production).

Push/pull phases add columns to Announcement and new tables; keep this file the single schema.
"""

import datetime as dt
from datetime import datetime

from sqlalchemy import JSON, Column, Text
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


engine = create_engine(DATABASE_URL, pool_pre_ping=True)


def init_db() -> None:
    SQLModel.metadata.create_all(engine)


def session() -> Session:
    return Session(engine)
