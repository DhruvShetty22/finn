"""The user's alert thresholds and category choices (single user, stored in Setting)."""

from sqlmodel import Session

from finn.db import Setting
from finn.push.classify import CATEGORIES

DEFAULT = {
    "volume_multiple": 2.0,
    "volume_lookback": 20,
    "price_move_pct": 5.0,
    "categories": {c: c in {"results", "M&A", "fund_raise", "management_change", "litigation", "credit_rating",
                            "bonus_split", "capex", "pledging"} for c in CATEGORIES},
    "thesis_alerts": True,
}


def get(s: Session) -> dict:
    row = s.get(Setting, "rules")
    stored = row.value if row else {}
    return {**DEFAULT, **stored, "categories": {**DEFAULT["categories"], **stored.get("categories", {})}}


def put(s: Session, new: dict) -> dict:
    cur = get(s)
    merged = {**cur, **{k: v for k, v in new.items() if k in DEFAULT},
              "categories": {**cur["categories"], **{k: bool(v) for k, v in new.get("categories", {}).items() if k in CATEGORIES}}}
    merged["volume_multiple"] = max(1.0, float(merged["volume_multiple"]))
    merged["volume_lookback"] = int(min(max(5, merged["volume_lookback"]), 60))
    merged["price_move_pct"] = max(0.5, float(merged["price_move_pct"]))
    s.merge(Setting(key="rules", value=merged))
    s.commit()
    return merged
