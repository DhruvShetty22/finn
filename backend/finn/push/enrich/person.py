"""Management-change filing → PersonCard. SEBI requires appointment filings to carry a "brief profile",
so the bio comes from the filing itself (primary source, zero search cost)."""

import logging

from pydantic import BaseModel
from sqlmodel import Session

from finn.config import now
from finn.db import Announcement, Enrichment
from finn.ingest import http, pdf
from finn.llm.router import LLMError, ask
from finn.push.enrich.results import _subset

log = logging.getLogger(__name__)


class Prior(BaseModel):
    org: str
    role: str
    years: str | None = None


class Person(BaseModel):
    name: str
    role: str  # role this change is about, e.g. "MD & CEO", "CFO"
    change: str  # appointed | resigned | retired | redesignated | ceased
    effective: str | None = None  # ISO date if stated
    bio: str  # 1-2 lines from the filing's profile; "" if none given
    prior: list[Prior] = []
    reason: str | None = None  # stated reason for an exit, verbatim-ish


class Extract(BaseModel):
    headline: str  # one factual line, <= 22 words
    people: list[Person]


PROMPT = """This is an Indian listed company's stock-exchange filing about a change in directors / key managerial personnel.
Using ONLY this document (no outside knowledge), list every person whose position changes, most senior first.
For each: name, the role concerned, the change (appointed / resigned / retired / redesignated / ceased), effective date (YYYY-MM-DD)
if stated, a 1–2 line bio built from the filing's profile section (education + career highlights; empty string if no profile),
prior roles as org/role/years when the profile lists them, and any stated reason for an exit.
Then write `headline`: one factual line of at most 22 words a portfolio manager can read in two seconds
(who → what role, from when; mention the predecessor if the filing does)."""

ORDER = {"appointed": 0, "redesignated": 1, "resigned": 2, "ceased": 3, "retired": 4}


def enrich(s: Session, a: Announcement, red_flag: str | None = None) -> Enrichment:
    enr = Enrichment(id=a.id, updated_at=now())
    try:
        doc = pdf.get_document(s, a.pdf_url, symbol=a.symbol, kind="filing")
        if doc.scanned:  # let the model read the pages
            x = ask("person_card", "extract", PROMPT, schema=Extract,
                    pdf=_subset(http.get(a.pdf_url, ttl=0), list(range(min(5, doc.n_pages)))),
                    pdf_key=f"{doc.sha}:0-5")
        else:
            text = "\n".join(doc.pages)[:14000]
            x = ask("person_card", "extract", f"{PROMPT}\n\n--- FILING TEXT ---\n{text}", schema=Extract)
        x = Extract.model_validate(x)
        if not x.people:
            raise ValueError("no people found in filing")
        p = x.people[0]
        enr.card = {"kind": "person", "name": p.name, "role": p.role,
                    "change": p.change if p.change in ORDER else "redesignated", "effective": p.effective,
                    "bio": p.bio or (f"Reason given: {p.reason}" if p.reason else ""),
                    "prior": [q.model_dump() for q in p.prior[:3]],
                    "source": "filing", "source_url": a.pdf_url, "red_flag": red_flag}
        enr.headline = x.headline
        enr.facts = {"people": len(x.people)}
    except (http.FetchError, LLMError, ValueError) as e:
        log.warning("person card %s %s failed: %s", a.symbol, a.id, e)
        enr.error = str(e)[:500]
    s.merge(enr)
    s.commit()
    return enr
