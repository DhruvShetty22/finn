"""Explainable priority: base(category) + modifiers, each modifier leaving a phrase for the card's `why`.

Nothing here calls a model. Enrichment facts (deal size, rating direction...) and thesis verdicts
sharpen the score when they exist, but an un-enriched filing still ranks sensibly.
"""

import re
from dataclasses import dataclass, field

from finn.market import Day
from finn.push.events import Event

BASE = {
    "results": 70, "management_change": 55, "M&A": 55, "fund_raise": 52, "pledging": 52, "litigation": 48,
    "credit_rating": 45, "capex": 42, "bonus_split": 35, "insider_trading": 32, "press_release": 30,
    "dividend": 20, "earnings_call": 14, "investor_meetings": 8, "agm_egm": 8, "postal_ballot": 8, "unclassified": 3,
}
LABEL = {
    "results": "Results", "management_change": "Management change", "M&A": "M&A", "fund_raise": "Fund raise",
    "pledging": "Promoter pledge", "litigation": "Legal / regulatory", "credit_rating": "Credit rating",
    "capex": "Capex", "bonus_split": "Bonus / split", "insider_trading": "Insider trade", "press_release": "Update",
    "dividend": "Dividend", "earnings_call": "Earnings call", "investor_meetings": "Investor meeting",
    "agm_egm": "Shareholder meeting", "postal_ballot": "Postal ballot", "unclassified": "Routine filing",
}
TOP, READ = 70, 40

SENIOR = re.compile(r"\b(CEO|CFO|MD|managing director|chief executive|chief financial|chairman|chairperson|whole.?time director|executive director|president)\b", re.I)
JUNIOR = re.compile(r"company secretary|compliance officer|independent director|nominee director|senior management personnel|\bSMP\b", re.I)
REAPPOINT = re.compile(r"re-?appoint|continuation", re.I)
AUDITOR_EXIT = re.compile(r"resign\w* of (the )?statutory auditor|statutory auditor\w* (has )?resign", re.I)
CFO_EXIT = re.compile(r"(resign|cessation)\w*.{0,60}\b(CFO|chief financial)|\b(CFO|chief financial officer)\b.{0,60}(resign|cessation)", re.I)


@dataclass
class Scored:
    event: Event
    score: int
    tier: str
    why: list[str] = field(default_factory=list)
    red_flag: str | None = None


def mgmt_level(text: str) -> int:
    """How much a management-change filing matters: 4 auditor exit, 3 CFO exit, 2 senior, 1 board/compliance, 0 unclear."""
    if AUDITOR_EXIT.search(text):
        return 4
    if CFO_EXIT.search(text):
        return 3
    if JUNIOR.search(text) or REAPPOINT.search(text):
        return 1
    return 2 if SENIOR.search(text) else 0


def promote_primary(e: Event) -> None:
    """Lead a management-change event with its most important filing (NAUKRI's CEO transition, not a director note)."""
    if e.category == "management_change" and e.members:
        best = max(e.all(), key=lambda a: (mgmt_level(f"{a.subject} {a.text}"), -a.ts.timestamp()))
        if best is not e.primary:
            e.members = [e.primary, *[m for m in e.members if m is not best]]
            e.primary = best


def score(e: Event, *, rules: dict, weight: float | None, reaction: Day | None, facts: dict | None = None,
          thesis_verdict: str | None = None) -> Scored:
    text = " ".join(f"{a.subject} {a.text}" for a in e.all())
    cat = e.category
    s, why, flag = BASE.get(cat, 5), [], None
    period = (facts or {}).get("period")
    why.append(f"{period} results" if cat == "results" and period else LABEL.get(cat, cat))
    if cat == "results" and facts and facts.get("pat_yoy") is not None:
        py, ry, mc = facts["pat_yoy"], facts.get("rev_yoy") or 0, facts.get("margin_chg_pp")
        surprise = abs(py) >= 25 or (mc is not None and abs(mc) >= 2) or (ry > 3 and py < 0)
        in_line = abs(py) < 8 and abs(ry) < 8 and (mc is None or abs(mc) < 1)
        s += 8 if surprise else -8 if in_line else 0
        why[0] = f"{period} results · PAT {py:+.0f}% YoY"

    if e.ancillary_only:
        s -= 15
    if rules.get("categories", {}).get(cat):
        s += 8  # a category the user asked to be alerted on

    if cat == "management_change":
        level = max(mgmt_level(f"{a.subject} {a.text}") for a in e.all())
        if level == 4:
            s, flag = s + 35, "Statutory auditor resigned"
        elif level == 3:
            s, flag = s + 15, "CFO exit"
        elif level == 2:
            s += 15
            why[0] = "Senior management change"
        elif level == 1:
            s -= 22
            why[0] = "Board / compliance change"
    if cat == "credit_rating":
        direction = (facts or {}).get("direction") or _rating_direction(text)
        s += {"downgrade": 22, "upgrade": 8, "new": 0, "reaffirm": -18}.get(direction, 0)
        if direction:
            why[0] = f"Rating {direction}"
    if (m := (facts or {}).get("materiality_pct")) is not None:  # deal / order / penalty vs revenue or net worth
        s += 25 if m >= 10 else 15 if m >= 3 else 5 if m >= 1 else -10
        why.append(f"{m:.1f}% of {(facts or {}).get('materiality_base', 'revenue')}")

    if reaction and reaction.chg_pct is not None:
        big_move = abs(reaction.chg_pct) >= rules.get("price_move_pct", 5)
        big_vol = (reaction.vol_ratio or 0) >= rules.get("volume_multiple", 2)
        if big_move or big_vol:
            s += 10 if big_move else 6
            why.append(f"stock {reaction.chg_pct:+.1f}%" + (f" on {reaction.vol_ratio:.1f}× volume" if big_vol else ""))
    if weight:
        s += round(weight / 2)

    if thesis_verdict == "challenges":
        s += 25
        why.insert(1, "challenges your thesis")
    elif thesis_verdict == "supports":
        s += 6
        why.insert(1, "supports your thesis")

    n = len(e.all())
    if n > 2 and cat != "results":
        why.append(f"{n} filings grouped")
    if flag:
        why.insert(0, f"⚑ {flag}")

    s = max(0, min(100, s))
    tier = "top" if s >= TOP else "read" if s >= READ else "routine"
    return Scored(e, s, tier, why, flag)


def _rating_direction(text: str) -> str | None:
    t = text.lower()
    for word, d in (("downgrad", "downgrade"), ("upgrad", "upgrade"), ("reaffirm", "reaffirm"), ("assign", "new")):
        if word in t:
            return d
    return None
