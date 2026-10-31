"""Results filing → ResultsCard: Revenue / EBITDA / PBT / PAT, this quarter vs last quarter vs a year ago.

The model only *transcribes* the results table; everything else is code:
  1. find the consolidated P&L page by keywords (DIXON: page 11 of 14) and send just those pages as a PDF subset;
     scanned filings (no text layer) send the first pages for the model to read visually
  2. Gemini transcribes the three quarter columns into a schema (SEBI's format prints all three side by side)
  3. code converts units to ₹ crore, computes EBITDA = PBT + finance cost + D&A − other income, QoQ/YoY, margins
  4. cross-check against screener's quarterly table (independent source); disagreement is flagged, not hidden
"""

import logging
import re
from datetime import date, datetime

import pymupdf
from pydantic import BaseModel
from sqlmodel import Session

from finn.config import now
from finn.db import Announcement, Document, Enrichment, Fundamentals
from finn.ingest import http, pdf, screener
from finn.llm.router import LLMError, ask

log = logging.getLogger(__name__)


class Column(BaseModel):
    period_end: str  # as printed, e.g. "30.09.2026"
    revenue_from_operations: float | None = None
    other_income: float | None = None
    finance_costs: float | None = None
    depreciation_and_amortisation: float | None = None
    profit_before_tax: float | None = None
    profit_for_the_period: float | None = None
    # banks / NBFCs
    interest_earned: float | None = None
    interest_expended: float | None = None
    operating_profit_before_provisions: float | None = None


class Extract(BaseModel):
    found: bool
    basis: str  # consolidated | standalone
    unit_as_printed: str  # e.g. "₹ in crore", "Rs. in lakhs", "₹ million"
    is_bank: bool
    current_quarter: Column | None = None
    previous_quarter: Column | None = None
    same_quarter_last_year: Column | None = None


PROMPT = """These pages are from an Indian listed company's quarterly results filing (SEBI format).
Transcribe the {basis} statement of profit and loss for the QUARTER columns only (ignore half-year / nine-month / full-year columns):
the current quarter, the immediately preceding quarter, and the corresponding quarter of the previous year.
Copy numbers exactly as printed, in the unit printed on the statement (negative for losses or bracketed figures).
Use null for a line that is not printed; never compute or guess. "profit_for_the_period" is net profit after tax for the period
(before other comprehensive income; include minority share). For banks, fill interest_earned, interest_expended and
operating_profit_before_provisions (operating profit before provisions and contingencies) and leave revenue lines null.
If no {basis} statement is on these pages, use the standalone one and say so in basis. Set found=false if there is no P&L table at all."""

UNIT = [(r"lakh|lac", 0.01), (r"million|mn\b", 0.1), (r"crore|cr\b", 1.0), (r"thousand|'000", 1e-4), (r"billion|bn\b", 100.0)]


def _pick_pages(doc: Document) -> tuple[list[int], str]:
    """0-based pages to send, and the basis we expect to find there."""
    if doc.scanned:
        return list(range(min(12, doc.n_pages))), "consolidated"
    scored = []
    for i, t in enumerate(doc.pages):
        tl = t.lower()
        pl = ("revenue from operations" in tl or "interest earned" in tl) + ("profit before tax" in tl or "profit/(loss) before tax" in tl)
        if pl < 2:
            continue
        cons = "consolidated" in tl
        scored.append((2 * cons - ("standalone" in tl and not cons) + ("quarter ended" in tl or "three months" in tl), i, cons))
    if not scored:
        return list(range(min(8, doc.n_pages))), "consolidated"
    _, best, cons = max(scored, key=lambda x: (x[0], -x[1]))
    return [p for p in (best, best + 1) if p < doc.n_pages], "consolidated" if cons else "standalone"


def _subset(raw: bytes, pages: list[int]) -> bytes:
    with pymupdf.open(stream=raw, filetype="pdf") as src, pymupdf.open() as out:
        for p in pages:
            out.insert_pdf(src, from_page=p, to_page=p)
        return out.tobytes()


MONTHS = {m: i for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}


def quarter_label(period_end: str) -> tuple[str | None, str | None]:
    """Any printed quarter-end → ('Q2 FY27', 'Sep 2026'). Seen in filings: '30.09.2026', '2026-09-30', '30-Sep-26',
    '30th September, 2026', 'Sep 30, 2026', 'September 30, 2026', 'Q2FY27'. Indian FY runs Apr–Mar."""
    t = (period_end or "").strip()
    if m := re.search(r"Q([1-4])\s*'?\s*FY\s*'?(\d{2,4})", t, re.I):
        q, fy = int(m.group(1)), int(m.group(2)) % 100
        month, year = {1: 6, 2: 9, 3: 12, 4: 3}[q], 2000 + (fy if q == 4 else fy - 1)
    elif m := re.search(r"(20\d\d)-(\d{1,2})-(\d{1,2})", t):
        year, month = int(m.group(1)), int(m.group(2))
    elif m := re.search(r"\b(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})\b", t):
        month, year = int(m.group(2)), int(m.group(3))
    elif mon := re.search(r"(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*", t, re.I):
        month = MONTHS[mon.group(1).lower()]
        y4 = re.search(r"(20\d\d)", t)
        y2 = re.search(r"[-/' ](\d{2})\s*$", t)
        if not (y4 or y2):
            return None, None
        year = int(y4.group(1)) if y4 else int(y2.group(1))
    else:
        return None, None
    year += 2000 if year < 100 else 0
    q = {6: 1, 9: 2, 12: 3, 3: 4}.get(month)
    if not q or not 2000 < year < 2100:
        return None, None
    fy = year + 1 if month >= 4 else year
    return f"Q{q} FY{fy % 100:02d}", f"{date(year, month, 1):%b %Y}"


def _pct(a, b):
    return None if a is None or b in (None, 0) else round((a / b - 1) * 100 * (1 if b > 0 else -1), 1)


def _ebitda(c: dict) -> float | None:
    need = ("profit_before_tax", "finance_costs", "depreciation_and_amortisation")
    if any(c.get(k) is None for k in need):
        return None
    return c["profit_before_tax"] + c["finance_costs"] + c["depreciation_and_amortisation"] - (c.get("other_income") or 0)


def _scale(x: Extract, fund: dict | None, period: str | None) -> float:
    """Multiplier to ₹ crore: from the printed unit, sanity-checked against screener's revenue for the same quarter."""
    mult = next((m for rx, m in UNIT if re.search(rx, x.unit_as_printed or "", re.I)), None)
    ref = _screener_row(fund, period, ("Sales", "Revenue"))
    raw = (x.current_quarter.revenue_from_operations or x.current_quarter.interest_earned) if x.current_quarter else None
    if ref and raw:
        best = min([1.0, 0.01, 0.1, 1e-4, 1e-7, 100.0], key=lambda m: abs(raw * m - ref))
        if mult is None or abs(raw * mult - ref) / ref > 0.25:
            mult = best
    return mult or 1.0


def _screener_row(fund: dict | None, period: str | None, labels: tuple[str, ...]) -> float | None:
    q = (fund or {}).get("quarters")
    if not q or not period or period not in q["periods"]:
        return None
    i = q["periods"].index(period)
    for lab in labels:
        if lab in q["rows"] and q["rows"][lab][i] is not None:
            return q["rows"][lab][i]
    return None


def _verdict(rows: dict, margin: dict | None, is_bank: bool) -> str:
    rev = rows.get("NII" if is_bank else "Revenue", {})
    pat = rows.get("PAT", {})
    ry, py = rev.get("yoy_pct"), pat.get("yoy_pct")
    mchg = round(margin["cur"] - margin["prev_y"], 1) if margin and margin.get("prev_y") is not None else None
    top = "NII" if is_bank else "Revenue"
    low = top if is_bank else top.lower()
    if ry is None or py is None:
        return f"{top} {_fmt(ry)} YoY" if ry is not None else "Results filed; quarter comparison incomplete"
    if pat.get("cur") is not None and pat["cur"] < 0:
        prev = pat.get("prev_y")
        if prev is None or prev >= 0:
            s = f"Swung to a loss: PAT ₹{pat['cur']:,.0f} Cr vs ₹{prev or 0:,.0f} Cr a year ago"
        else:
            s = f"Loss of ₹{abs(pat['cur']):,.0f} Cr, {'narrower' if pat['cur'] > prev else 'wider'} than ₹{abs(prev):,.0f} Cr a year ago; {low} {_fmt(ry)}"
    elif pat.get("prev_y") is not None and pat["prev_y"] < 0 <= (pat.get("cur") or 0):
        s = f"Back to profit: PAT ₹{pat['cur']:,.0f} Cr vs a ₹{abs(pat['prev_y']):,.0f} Cr loss a year ago"
    elif py >= 20 and ry >= 10:
        s = f"Strong quarter: {low} {_fmt(ry)}, PAT {_fmt(py)} YoY"
    elif ry > 3 and py < 0:
        s = f"{top} grew {ry:.0f}% but PAT fell {abs(py):.0f}% YoY"
    elif ry < 0 and py < 0:
        s = f"Weak quarter: {low} {_fmt(ry)}, PAT {_fmt(py)} YoY"
    elif py > ry + 15:
        s = f"Profit outran {low}: PAT {_fmt(py)} on {low} {_fmt(ry)} YoY"
    else:
        s = f"{top} {_fmt(ry)}, PAT {_fmt(py)} YoY"
    pby = rows.get("PBT", {}).get("yoy_pct")
    if pby is not None and abs(py - pby) >= 30:  # a tax credit/charge a year ago distorts PAT; PBT tells the operating story
        s += f" (PBT {_fmt(pby)}: tax line distorts PAT)"
    elif mchg is not None and abs(mchg) >= 1.0:
        s += f"; EBITDA margin {'up' if mchg > 0 else 'down'} {abs(mchg):.1f}pp"
    return s


def _fmt(p):
    return "n/a" if p is None else f"{p:+.0f}%"


def build_card(x: Extract, fund: dict | None) -> tuple[dict, dict]:
    x.basis = "consolidated" if "consol" in (x.basis or "").lower() else "standalone"
    period, scr_period = quarter_label(x.current_quarter.period_end)
    k = _scale(x, fund, scr_period)
    cols = {name: {f: (v * k if isinstance(v, (int, float)) else v) for f, v in getattr(x, name).model_dump().items()}
            for name in ("current_quarter", "previous_quarter", "same_quarter_last_year") if getattr(x, name)}
    cur, pq, py = (cols.get(n, {}) for n in ("current_quarter", "previous_quarter", "same_quarter_last_year"))
    if x.is_bank:
        nii = lambda c: (c.get("interest_earned") - c.get("interest_expended")) if c.get("interest_earned") is not None and c.get("interest_expended") is not None else None
        lines = [("NII", nii), ("PPOP", lambda c: c.get("operating_profit_before_provisions")),
                 ("PBT", lambda c: c.get("profit_before_tax")), ("PAT", lambda c: c.get("profit_for_the_period"))]
    else:
        lines = [("Revenue", lambda c: c.get("revenue_from_operations")), ("EBITDA", _ebitda),
                 ("PBT", lambda c: c.get("profit_before_tax")), ("PAT", lambda c: c.get("profit_for_the_period"))]
    rows = {}
    for metric, f in lines:
        a, b, c = f(cur), f(pq), f(py)
        rows[metric] = {"metric": metric, "cur": _r(a), "prev_q": _r(b), "prev_y": _r(c), "qoq_pct": _pct(a, b), "yoy_pct": _pct(a, c)}
    margin = None
    if not x.is_bank and all(rows["EBITDA"][k2] is not None and rows["Revenue"][k2] for k2 in ("cur", "prev_q", "prev_y")):
        m = lambda k2: round(rows["EBITDA"][k2] / rows["Revenue"][k2] * 100, 1)
        margin = {"label": "EBITDA margin", "cur": m("cur"), "prev_q": m("prev_q"), "prev_y": m("prev_y")}

    # independent check: screener's numbers for the same quarter (PBT is the cleanest common line)
    check = "unverified"
    ref_pbt = _screener_row(fund, scr_period, ("Profit before tax",))
    ref_rev = _screener_row(fund, scr_period, ("Sales", "Revenue"))
    if ref_pbt is not None and rows["PBT"]["cur"] is not None and (fund or {}).get("basis") == x.basis:
        ok_pbt = abs(rows["PBT"]["cur"] - ref_pbt) <= max(2.0, abs(ref_pbt) * 0.03)
        ok_rev = x.is_bank or ref_rev is None or rows["Revenue"]["cur"] is None or abs(rows["Revenue"]["cur"] - ref_rev) <= max(2.0, ref_rev * 0.03)
        check = "matched" if ok_pbt and ok_rev else "mismatch"
    elif ref_pbt and rows["PBT"]["cur"] and abs(ref_pbt) > 10:
        # different basis (standalone vs consolidated) can't be compared exactly, but it never explains a >3× gap:
        # that means a misread table or unit, so say so instead of showing the numbers as fine
        ratio = abs(rows["PBT"]["cur"]) / abs(ref_pbt)
        if ratio > 3 or ratio < 1 / 3:
            check = "mismatch"

    card = {"kind": "results", "period": period, "basis": x.basis, "is_financial": x.is_bank,
            "rows": list(rows.values()), "margin": margin,
            "ebitda_formula": None if x.is_bank else "PBT + finance cost + D&A − other income",
            "check": check, "verdict": _verdict(rows, margin, x.is_bank)}
    top = rows["NII" if x.is_bank else "Revenue"]
    facts = {"period": period, "rev_yoy": top["yoy_pct"], "pat_yoy": rows["PAT"]["yoy_pct"],
             "margin_chg_pp": round(margin["cur"] - margin["prev_y"], 1) if margin else None, "check": check}
    return card, facts


def _r(v):
    return None if v is None else round(v, 1)


def enrich(s: Session, a: Announcement) -> Enrichment:
    """Build (or rebuild) the results card for a primary results filing."""
    enr = Enrichment(id=a.id, updated_at=now())
    try:
        doc = pdf.get_document(s, a.pdf_url, symbol=a.symbol, kind="filing")
        pages, basis = _pick_pages(doc)
        raw = http.get(a.pdf_url, ttl=0)
        x = Extract.model_validate(ask("results_card", "extract", PROMPT.format(basis=basis), schema=Extract,
                                       pdf=_subset(raw, pages), pdf_key=f"{doc.sha}:{pages}"))
        if not x.found or not x.current_quarter:
            raise ValueError("no P&L table found on the selected pages")
        fund = _fundamentals(s, a.symbol, quarter_label(x.current_quarter.period_end)[1])
        enr.card, enr.facts = build_card(x, fund)
        enr.headline = enr.card["verdict"]
    except (http.FetchError, LLMError, ValueError) as e:
        log.warning("results card %s %s failed: %s", a.symbol, a.id, e)
        enr.error = str(e)[:500]
    s.merge(enr)
    s.commit()
    return enr


def _fundamentals(s: Session, symbol: str, period: str | None) -> dict | None:
    """Screener data that already includes `period`; refetch once if screener has since added the quarter."""
    f = s.get(Fundamentals, symbol)
    have = f.data.get("quarters", {}).get("periods", []) if f else []
    if f and period in have:
        return f.data
    try:
        data = screener.fetch_company(symbol, fresh=True)
        s.merge(Fundamentals(symbol=symbol, fetched_at=now(), data=data))
        s.commit()
        return data
    except http.FetchError:
        return f.data if f else None
