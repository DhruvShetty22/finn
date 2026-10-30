"""Filings → events. Companies file one decision several times (NAUKRI's CEO transition came as 4 filings);
the investor should see it once.

Rules, per symbol:
  * primaries of the same category within GROUP_WINDOW merge (the first one is the event's id)
  * a dividend declared within the same board meeting as results rides on the results event
  * ancillaries (results deck, newspaper ad, record date) attach to the nearest same-category primary
    within ANCILLARY_WINDOW; orphans become their own (low-scoring) events
"""

from dataclasses import dataclass, field
from datetime import timedelta

from finn.db import Announcement

GROUP_WINDOW = timedelta(hours=6)
ANCILLARY_WINDOW = timedelta(hours=48)
RIDES_ON = {"dividend": "results", "earnings_call": None}  # category → category it folds into, if present


@dataclass
class Event:
    primary: Announcement
    members: list[Announcement] = field(default_factory=list)

    @property
    def id(self) -> str:
        return self.primary.id

    @property
    def category(self) -> str:
        return self.primary.category or "unclassified"

    @property
    def ancillary_only(self) -> bool:
        return self.primary.role == "ancillary"

    def all(self) -> list[Announcement]:
        return [self.primary, *self.members]


def group(anns: list[Announcement]) -> list[Event]:
    by_symbol: dict[str, list[Announcement]] = {}
    for a in sorted(anns, key=lambda a: a.ts):
        by_symbol.setdefault(a.symbol, []).append(a)

    events: list[Event] = []
    for rows in by_symbol.values():
        evs: list[Event] = []
        for a in (r for r in rows if r.role == "primary"):
            target = next((e for e in reversed(evs) if a.ts - e.primary.ts <= GROUP_WINDOW and
                           (e.category == a.category or RIDES_ON.get(a.category) == e.category)), None)
            if target:
                target.members.append(a)
            else:
                evs.append(Event(a))
        # a results event that started as a dividend filing (same board meeting) should lead with results
        for e in evs:
            if e.category == "dividend" and (r := next((m for m in e.members if m.category == "results"), None)):
                e.members = [e.primary, *[m for m in e.members if m is not r]]
                e.primary = r
        for a in (r for r in rows if r.role == "ancillary"):
            near = [e for e in evs if e.category == a.category and abs(a.ts - e.primary.ts) <= ANCILLARY_WINDOW]
            if near:
                min(near, key=lambda e: abs(a.ts - e.primary.ts)).members.append(a)
            else:
                evs.append(Event(a))
        events.extend(evs)
    return sorted(events, key=lambda e: e.primary.ts, reverse=True)
