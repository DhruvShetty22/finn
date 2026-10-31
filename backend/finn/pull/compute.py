"""Deterministic research sections from screener's standardised tables. No model touches a number here.

Each function returns a contract Section (key, status, title, takeaway, data, citations, cost).
"""

import re

ZERO_COST = {"tokens_in": 0, "tokens_out": 0, "inr": 0, "cached": False, "model": None}


def row(table: dict | None, *labels: str) -> list | None:
    if not table:
        return None
    for lab in labels:
        if lab in table["rows"]:
            return table["rows"][lab]
    return None


def fy(period: str) -> str:
    """'Mar 2026' → 'FY26'; 'TTM' stays."""
    m = re.match(r"Mar (\d{4})", period)
    return f"FY{int(m.group(1)) % 100:02d}" if m else period


def quarter(period: str) -> str | None:
    """'Sep 2026' → 'Q2 FY27'."""
    m = re.match(r"(Jun|Sep|Dec|Mar) (\d{4})", period)
    if not m:
        return None
    q = {"Jun": 1, "Sep": 2, "Dec": 3, "Mar": 4}[m.group(1)]
    y = int(m.group(2))
    return f"Q{q} FY{(y + 1 if q < 4 else y) % 100:02d}"


def growth(a, b):
    return None if a is None or not b else round((a / b - 1) * 100 * (1 if b > 0 else -1), 1)


def cagr(first, last, years):
    if not first or not last or first <= 0 or last <= 0 or years <= 0:
        return None
    return round(((last / first) ** (1 / years) - 1) * 100, 1)


def _num(s: str | None):
    m = re.search(r"-?[\d,]+\.?\d*", s or "")
    return float(m.group().replace(",", "")) if m else None


def _section(key, title, takeaway, data, status="ok"):
    return {"key": key, "status": status, "title": title, "takeaway": takeaway, "data": data,
            "citations": [], "cost": dict(ZERO_COST)}


def _sum(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) if xs else None


def financials(f: dict) -> dict:
    q = f.get("quarters")
    sales, op, np_ = row(q, "Sales", "Revenue"), row(q, "Operating Profit", "Financing Profit"), row(q, "Net Profit")
    if not sales or len(sales) < 4:
        return _section("financials", "Financial snapshot", "Not enough quarterly history", {"tiles": []}, "empty")
    ttm = lambda xs, off=0: _sum(xs[len(xs) - 4 - off:len(xs) - off]) if xs and len(xs) >= 4 + off else None
    rev, rev_p = ttm(sales), ttm(sales, 4)
    pat, pat_p = ttm(np_), ttm(np_, 4)
    m = round(ttm(op) / rev * 100, 1) if rev and ttm(op) is not None else None
    m_p = round(ttm(op, 4) / rev_p * 100, 1) if rev_p and ttm(op, 4) is not None else None
    bs = f.get("balance_sheet")
    debt, eq = row(bs, "Borrowings"), [(_c or 0) + (_r or 0) for _c, _r in zip(row(bs, "Equity Capital") or [], row(bs, "Reserves") or [])]
    de = round(debt[-1] / eq[-1], 2) if debt and eq and eq[-1] else None
    tr = f.get("top_ratios", {})
    label = "Financing margin" if f.get("is_financial") else "EBITDA margin"
    tiles = [
        {"label": "Revenue (TTM)", "value": round(rev), "unit": "cr", "delta_pct": growth(rev, rev_p), "delta_label": "YoY"},
        {"label": f"{label} (TTM)", "value": m, "unit": "%", "delta_pct": round(m - m_p, 1) if m is not None and m_p is not None else None, "delta_label": "pp YoY"},
        {"label": "PAT (TTM)", "value": round(pat) if pat is not None else None, "unit": "cr", "delta_pct": growth(pat, pat_p), "delta_label": "YoY"},
        {"label": "ROCE", "value": _num(tr.get("ROCE")), "unit": "%", "delta_pct": None, "delta_label": None},
        {"label": "ROE", "value": _num(tr.get("ROE")), "unit": "%", "delta_pct": None, "delta_label": None},
    ]
    if not f.get("is_financial"):
        tiles.append({"label": "Debt / Equity", "value": de, "unit": "x", "delta_pct": None, "delta_label": None})
    tiles.append({"label": "Market cap", "value": _num(tr.get("Market Cap")), "unit": "cr", "delta_pct": None, "delta_label": None})
    g = growth(rev, rev_p)
    take = f"₹{rev:,.0f} Cr revenue over the last 4 quarters" + (f" ({g:+.0f}% YoY)" if g is not None else "")
    if m is not None:
        take += f" at a {m:.0f}% {label.split()[0] if label.startswith("EBITDA") else label.split()[0].lower()} margin"
    if _num(tr.get("ROCE")) is not None:
        take += f"; ROCE {_num(tr.get('ROCE')):.0f}%"
    return _section("financials", "Financial snapshot", take, {"tiles": tiles})


def trajectory(f: dict) -> dict:
    pl = f.get("profit_loss")
    if not pl:
        return _section("trajectory", "Trajectory", "No multi-year history", {}, "empty")
    keep = slice(-6, None)  # last 5 FYs + TTM
    periods = [fy(p) for p in pl["periods"]][keep]
    sales, opm, np_ = row(pl, "Sales", "Revenue"), row(pl, "OPM %", "Financing Margin %"), row(pl, "Net Profit")
    fy_idx = [i for i, p in enumerate(pl["periods"]) if p.startswith("Mar ")]
    last_fy = fy_idx[-1] if fy_idx else None

    def cg(vals, n):
        if last_fy is None or vals is None or last_fy - n < 0:
            return None
        return cagr(vals[last_fy - n], vals[last_fy], n)

    series = [{"metric": "Revenue", "unit": "cr", "values": (sales or [])[keep], "cagr_3y": cg(sales, 3), "cagr_5y": cg(sales, 5)}]
    if opm:
        series.append({"metric": "Financing margin" if f.get("is_financial") else "EBITDA margin", "unit": "%", "values": opm[keep], "cagr_3y": None, "cagr_5y": None})
    if np_:
        series.append({"metric": "PAT", "unit": "cr", "values": np_[keep], "cagr_3y": cg(np_, 3), "cagr_5y": cg(np_, 5)})

    callouts = []
    s6 = (sales or [])[-7:]
    yoy = [growth(b, a) for a, b in zip(s6, s6[1:])]
    labels = [fy(p) for p in pl["periods"]][-6:]
    if yoy and all(g is not None for g in yoy[-3:]):
        early, late = sum(yoy[:-2]) / max(len(yoy[:-2]), 1), sum(yoy[-2:]) / 2
        kind = "compressing" if late < early - 5 else "growing"
        callouts.append({"kind": kind, "text": "Revenue growth by year: " + ", ".join(
            f"{g:+.0f}% ({lab})" for g, lab in zip(yoy, labels) if g is not None)})
    if opm and opm[keep][0] is not None and opm[-1] is not None:
        d = round(opm[-1] - opm[keep][0], 1)
        callouts.append({"kind": "growing" if d >= 0 else "compressing",
                         "text": f"Margin {opm[keep][0]:.0f}% ({periods[0]}) → {opm[-1]:.0f}% ({periods[-1]}), {d:+.1f}pp"})
    rc, pc = cg(sales, 3), cg(np_, 3)
    if rc is not None and pc is not None and abs(pc - rc) >= 3:
        callouts.append({"kind": "growing" if pc > rc else "compressing",
                         "text": f"PAT 3-yr CAGR {pc:.0f}% vs revenue {rc:.0f}%: " + ("operating leverage" if pc > rc else "profits lagging sales")})
    take = callouts[0]["text"] if callouts else "Multi-year history"
    if rc is not None:
        take = f"Revenue 3-yr CAGR {rc:.0f}%" + (f", PAT {pc:.0f}%" if pc is not None else "") + (f"; {callouts[1]['text'][:60]}" if len(callouts) > 1 else "")
    return _section("trajectory", "Trajectory", take, {"periods": periods, "series": series, "callouts": callouts})


def balance_sheet(f: dict) -> dict:
    bs, rt = f.get("balance_sheet"), f.get("ratios")
    if not bs:
        return _section("balance_sheet", "Balance sheet", "No balance sheet data", {}, "empty")
    debt = row(bs, "Borrowings") or []
    eq = [(_c or 0) + (_r or 0) for _c, _r in zip(row(bs, "Equity Capital") or [], row(bs, "Reserves") or [])]
    de = round(debt[-1] / eq[-1], 2) if debt and eq and eq[-1] else None
    tiles = [{"label": "Borrowings", "value": round(debt[-1]) if debt else None, "unit": "cr", "delta_pct": growth(debt[-1], debt[-2]) if len(debt) > 1 else None, "delta_label": "vs last year-end"},
             {"label": "Net worth", "value": round(eq[-1]) if eq else None, "unit": "cr", "delta_pct": None, "delta_label": None}]
    if f.get("is_financial"):
        return _section("balance_sheet", "Balance sheet",
                        "A lender's balance sheet: borrowings and deposits are the business, so D/E and working-capital days don't apply",
                        {"tiles": tiles, "wc": None})
    tiles.insert(1, {"label": "Debt / Equity", "value": de, "unit": "x", "delta_pct": None, "delta_label": None})
    wc = None
    if rt:
        keep = slice(-5, None)
        wc = {"periods": [fy(p) for p in rt["periods"]][keep],
              "debtor_days": (row(rt, "Debtor Days") or [])[keep], "inventory_days": (row(rt, "Inventory Days") or [])[keep],
              "payable_days": (row(rt, "Days Payable") or [])[keep], "ccc": (row(rt, "Cash Conversion Cycle") or [])[keep]}
    take = f"Debt/Equity {de:.2f}×" if de is not None else "Leverage n/a"
    if wc and wc["ccc"] and wc["ccc"][0] is not None and wc["ccc"][-1] is not None:
        take += f"; cash conversion cycle {wc['ccc'][-1]:.0f} days ({wc['periods'][-1]}) vs {wc['ccc'][0]:.0f} ({wc['periods'][0]})"
    return _section("balance_sheet", "Balance sheet", take, {"tiles": tiles, "wc": wc})


def cash_quality(f: dict) -> dict:
    cf, pl = f.get("cash_flow"), f.get("profit_loss")
    if f.get("is_financial") or not cf or not pl:
        return _section("cash_quality", "Cash quality", "Operating cash flow isn't a meaningful test for a lender" if f.get("is_financial") else "No cash-flow data", {}, "empty")
    keep = slice(-5, None)
    periods = cf["periods"][keep]
    pat_by = dict(zip(pl["periods"], row(pl, "Net Profit") or []))
    cfo, fcf = (row(cf, "Cash from Operating Activity") or [])[keep], (row(cf, "Free Cash Flow") or [None] * 6)[keep]
    pat = [pat_by.get(p) for p in periods]
    ratio = [round(c / p, 2) if c is not None and p else None for c, p in zip(cfo, pat)]
    tot = round(_sum(cfo) / _sum(pat), 2) if _sum(cfo) is not None and _sum(pat) else None
    verdict = None if tot is None else "good" if tot >= 0.9 else "watch" if tot >= 0.6 else "poor"
    take = {"good": "Profits turn into cash", "watch": "Cash lags profits", "poor": "Profits are not turning into cash"}.get(verdict, "Cash conversion n/a")
    if tot is not None:
        take += f": {len(periods)}-year operating cash flow / PAT = {tot:.2f}"
    return _section("cash_quality", "Cash quality", take,
                    {"periods": [fy(p) for p in periods], "cfo": cfo, "pat": pat, "fcf": fcf, "cfo_to_pat": ratio,
                     "cfo_to_pat_5y": tot, "verdict": verdict})


def actuals(f: dict) -> dict:
    """Period → reported numbers, for checking guidance: quarters ('Q2 FY27') and full years ('FY26')."""
    out = {}
    q = f.get("quarters")
    if q:
        sales, opm, np_ = row(q, "Sales", "Revenue"), row(q, "OPM %", "Financing Margin %"), row(q, "Net Profit")
        for i, p in enumerate(q["periods"]):
            if (lab := quarter(p)):
                out[lab] = {"revenue": sales[i] if sales else None, "margin": opm[i] if opm else None, "pat": np_[i] if np_ else None}
    pl = f.get("profit_loss")
    if pl:
        sales, opm, np_ = row(pl, "Sales", "Revenue"), row(pl, "OPM %", "Financing Margin %"), row(pl, "Net Profit")
        for i, p in enumerate(pl["periods"]):
            if p.startswith("Mar "):
                out[fy(p)] = {"revenue": sales[i] if sales else None, "margin": opm[i] if opm else None, "pat": np_[i] if np_ else None}
    return out
