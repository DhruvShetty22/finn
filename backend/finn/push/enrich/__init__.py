"""Enrichment runner: give each event that earns it a card, once (cards are cached in the Enrichment table).

Only two kinds of events earn an LLM call: results (numbers card) and senior management changes (person card).
Everything else is surfaced by rank with a cleaned exchange headline, at zero model cost.
"""

import logging
from datetime import timedelta

from sqlmodel import Session, select

from finn import config
from finn.config import now
from finn.db import Announcement, Enrichment
from finn.push.events import group
from finn.push.score import mgmt_level, promote_primary

log = logging.getLogger(__name__)


def run(s: Session, days: int = 7, retry_failed: bool = False) -> dict:
    from finn.push.enrich import person, results

    since = now() - timedelta(days=days)
    anns = s.exec(select(Announcement).where(Announcement.ts >= since,
                                             Announcement.symbol.in_(config.portfolio_symbols()))).all()
    done = {"results": 0, "person": 0, "failed": 0, "skipped": 0}
    for e in group(list(anns)):
        promote_primary(e)
        a = e.primary
        if a.role != "primary" or not a.pdf_url:
            continue
        old = s.get(Enrichment, a.id)
        if old and (old.card or not retry_failed):
            done["skipped"] += 1
            continue
        if e.category == "results":
            enr = results.enrich(s, a)
            kind = "results"
        elif e.category == "management_change":
            level = max(mgmt_level(f"{m.subject} {m.text}") for m in e.all())
            if level < 2:
                continue  # board / compliance changes: rank only
            flag = {4: "Statutory auditor resigned", 3: "CFO exit"}.get(level)
            enr = person.enrich(s, a, red_flag=flag)
            kind = "person"
        else:
            continue
        done[kind if enr.card else "failed"] += 1
        log.info("enriched %s %s %s: %s", kind, a.symbol, a.id, enr.headline or enr.error)
    return done
