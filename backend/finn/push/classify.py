"""Filing → reference category, rules first.

NSE's subject line is specific for ~30 of its 114 values; for the generic ones ("General Updates",
"Outcome of Board Meeting", "Press Release", ...) we read the one-line description. Anything the rules
can't place is returned as None and goes to the cheap LLM in a batch (llm_classify).

`role` separates the filing that *is* the news (primary) from its satellites (ancillary): the results deck,
the newspaper ad of results, the "copy of press release". Event grouping folds ancillaries into their primary.
"""

import re

CATEGORIES = ["results", "M&A", "fund_raise", "management_change", "litigation", "insider_trading",
              "earnings_call", "investor_meetings", "credit_rating", "dividend", "bonus_split", "capex",
              "press_release", "postal_ballot", "agm_egm", "pledging", "unclassified"]

# Specific subjects map directly. (category, role)
SUBJECT = {
    "Integrated Filing- Financial": ("results", "primary"),
    "Clarification - Financial Results": ("results", "ancillary"),
    "Reply to Clarification- Financial results": ("results", "ancillary"),
    "Reasons for Delayed/Non-submission of Financial Results": ("results", "primary"),
    "Investor Presentation": ("results", "ancillary"),
    "Acquisition": ("M&A", "primary"),
    "Amalgamation/Merger": ("M&A", "primary"),
    "Scheme of Arrangement": ("M&A", "primary"),
    "Demerger": ("M&A", "primary"),
    "Sale or disposal": ("M&A", "primary"),
    "Diversification/Disinvestment": ("M&A", "primary"),
    "Other Restructuring": ("M&A", "primary"),
    "Public Announcement-Open Offer": ("M&A", "primary"),
    "Delisting": ("M&A", "primary"),
    "Issue of Securities": ("fund_raise", "primary"),
    "Qualified Institutional Placement": ("fund_raise", "primary"),
    "Preferential issue": ("fund_raise", "primary"),
    "Rights Issue": ("fund_raise", "primary"),
    "Buyback": ("fund_raise", "primary"),
    "Public Announcement - Buyback of Shares": ("fund_raise", "primary"),
    "Post Buyback Public Announcement": ("fund_raise", "ancillary"),
    "Closure of Buy Back": ("fund_raise", "ancillary"),
    "Appointment": ("management_change", "primary"),
    "Resignation of Director/KMP/SMP": ("management_change", "primary"),
    "Change in Management": ("management_change", "primary"),
    "Resignation": ("management_change", "primary"),
    "Change in Director(s)": ("management_change", "primary"),
    "Cessation": ("management_change", "primary"),
    "Retirement": ("management_change", "primary"),
    "Demise": ("management_change", "primary"),
    "Change in Company Secretary/Compliance Officer": ("management_change", "ancillary"),
    "Resignation of Statutory Auditor": ("management_change", "primary"),  # red flag, see score.py
    "Action(s) taken or orders passed": ("litigation", "primary"),
    "Action(s) initiated or orders passed": ("litigation", "primary"),
    "Pendency of Litigation(s)/dispute(s) or the outcome impacting the Company": ("litigation", "primary"),
    "Corporate Insolvency Resolution Process": ("litigation", "primary"),
    "Defaults on Payment of Interest/Principal": ("litigation", "primary"),
    "Fraud/Default/Arrest": ("litigation", "primary"),
    "Frauds/Default by employees": ("litigation", "primary"),
    "Initiation of Forensic Audit": ("litigation", "primary"),
    "Delay/default in the payment of fines/penalties/dues etc. to authority": ("litigation", "primary"),
    "Suspension of Trading": ("litigation", "primary"),
    "Trading Plan under PIT": ("insider_trading", "primary"),
    "Credit Rating": ("credit_rating", "primary"),
    "Credit Rating- New": ("credit_rating", "primary"),
    "Credit Rating- Revision": ("credit_rating", "primary"),
    "Credit Rating- Others": ("credit_rating", "primary"),
    "Dividend": ("dividend", "primary"),
    "Bonus": ("bonus_split", "primary"),
    "Stock split": ("bonus_split", "primary"),
    "Capacity addition": ("capex", "primary"),
    "Commencement of commercial production/operations": ("capex", "primary"),
    "Postponement of commercial production/operations": ("capex", "primary"),
    "Adoption of new line(s) of business": ("capex", "primary"),
    "Bagging/Receiving of orders/contracts": ("press_release", "primary"),
    "Awarding of order(s)/contract(s)": ("press_release", "primary"),
    "Agreements": ("press_release", "primary"),
    "Memorandum of Understanding/Agreements": ("press_release", "primary"),
    "Arrangements for strategic, technical, manufacturing, or marketing tie up": ("press_release", "primary"),
    "Product launch": ("press_release", "primary"),
    "Monthly Business Updates": ("press_release", "primary"),
    "Disruption of Operations": ("press_release", "primary"),
    "Strikes/Lockouts/Disturbances": ("press_release", "primary"),
    "Closure of operations": ("press_release", "primary"),
    "Rescission/termination(s)": ("press_release", "primary"),
    "News Verification": ("press_release", "ancillary"),
    "Rumour Verification - Regulation 30(11)": ("press_release", "ancillary"),
    "Extension of Annual General Meeting": ("agm_egm", "primary"),
    # routine paperwork
    **{s: ("unclassified", "primary") for s in [
        "Certificate under SEBI (Depositories and Participants) Regulations, 2018", "Trading Window",
        "ESOP/ESOS/ESPS", "Structural Digital Database", "Monitoring Agency Report",
        "Statement of deviation(s) or variation(s) under Reg. 32", "Utilisation of Funds", "Committee Meeting Updates",
        "Options to purchase securities", "Amendment to AOA/MOA", "Corrigendum", "Loss of Share Certificates",
        "Issue of Duplicate Share Certificate", "Name Change", "Name and Symbol Change", "Address Change",
        "Registrar & Share Transfer Agent Update", "Integrated Filing- Governance", "Extension  of Financial Year",
        "Quarterly Compliance Report on Corporate governance - within 21 days from the end of the quarter",
        "Increase in Authorised Capital", "Addendum", "Amendment(s)", "Alteration/revision(s)",
        "Effect(s) on listed entity due to changed regulatory  framework applicable", "Spurt in Volume",
        "Price movement", "Conversion", "Related Party Transactions",
        "Giving guarantees/indemnity/ becoming a surety for third party"]},
}

# Generic subjects: first matching rule on the description wins. Order matters.
RULES: list[tuple[str, str, str]] = [
    (r"newspaper|news ?paper|publication of (the )?(un)?audited", "results", "ancillary"),
    (r"transcript|audio recording|recording of|earnings call|conference call|con\.? ?call", "earnings_call", "primary"),
    (r"financial results?|results for the (quarter|period|half|year)|(un)?audited (standalone|consolidated|financial)|(quarter|half.?year|year) ended (march|june|september|december)", "results", "primary"),
    (r"investor(s)? presentation|corporate (investors? )?pre[r]?sentation|earnings presentation", "results", "ancillary"),
    (r"clarification (regarding|on) media|media report|news item", "press_release", "ancillary"),
    (r"\bMCLR\b|lending rate|\bBRLLR\b|base rate|outstanding bond", "unclassified", "primary"),
    (r"provisional (business|production)|business figures|production and off.?take|monthly (business|sales)|company update for the quarter", "press_release", "primary"),
    (r"pledg|encumbr", "pledging", "primary"),
    (r"regulation 7\(2\)|\bPIT\b|insider trading|prohibition of insider|regulation 29|regulation 31", "insider_trading", "primary"),
    (r"postal ballot", "postal_ballot", "primary"),
    (r"\bAGM\b|\bEGM\b|annual general meeting|extra.?ordinary general meeting|general meeting", "agm_egm", "primary"),
    (r"analyst|investor(s)? meet|institutional investor|investor conference|non.?deal roadshow", "investor_meetings", "primary"),
    (r"credit rating|\brating\b", "credit_rating", "primary"),
    (r"buy.?back|rights issue|qualified institution|\bQIP\b|preferential|commercial paper|non.?convertible|\bNCD|raising of funds|fund ?rais", "fund_raise", "primary"),
    (r"acqui|merger|amalgamat|demerger|scheme of arrangement|joint venture|divest|stake (sale|purchase)|wholly.?owned subsidiary|incorporat", "M&A", "primary"),
    (r"appoint|resign|cessation|re.?designat|chief executive|chief financial|managing director|\bCFO\b|\bCEO\b|key managerial|whole.?time director|succession|transition of", "management_change", "primary"),
    (r"bonus|sub.?division|stock split|split of", "bonus_split", "primary"),
    (r"dividend|record date", "dividend", "primary"),
    (r"penalty|show cause|demand order|tribunal|\bNCLT\b|court|litigation|\bGST\b|income tax|enforcement|regulatory action|adjudicat", "litigation", "primary"),
    (r"capacity|new plant|commission|capex|capital expenditure|commercial production|greenfield|brownfield", "capex", "primary"),
    (r"order|contract|launch|partnership|\bMoU\b|agreement|collaborat|approval|licen[cs]e|business update|sales (volume|number)|production (volume|number)", "press_release", "primary"),
    (r"ESOP|ESOS|employee stock|trading window|compliance certificate|regulation 74|loss of share|duplicate|ESG|BRSR|sustainability report|secretarial|statutory auditor|change in auditor", "unclassified", "primary"),
    (r"reconstitution of (the )?committee|committee(s)? of the board|intimation of (closure|loss)|certificate under|regulation 74", "unclassified", "primary"),
]
_RULES = [(re.compile(p, re.I), c, r) for p, c, r in RULES]


def classify(subject: str, text: str) -> tuple[str | None, str]:
    """→ (category or None if the rules can't tell, role)."""
    if subject in SUBJECT:
        cat, role = SUBJECT[subject]
        # a few specific subjects still need a look at the text
        if subject == "Allotment of Securities" and re.search(r"ESOP|ESOS|employee|stock option", text, re.I):
            return "unclassified", "primary"
        return cat, role
    if subject == "Allotment of Securities":
        return ("unclassified" if re.search(r"ESOP|ESOS|employee|stock option", text, re.I) else "fund_raise"), "primary"
    if subject == "Disclosure under SEBI Takeover Regulations":
        return ("pledging" if re.search(r"pledg|encumbr", text, re.I) else "insider_trading"), "primary"
    if subject == "Change in Auditors":
        return ("management_change" if re.search(r"resign", text, re.I) else "unclassified"), "primary"
    if subject == "Granting/withdrawal/surrender/cancellation/suspension of key licenses/ regulatory approvals":
        return ("litigation" if re.search(r"withdraw|surrender|cancel|suspen", text, re.I) else "press_release"), "primary"
    if subject == "Record Date":
        return ("bonus_split" if re.search(r"bonus|split|sub.?division", text, re.I) else "dividend"), "ancillary"
    if subject == "Shareholders meeting":
        return ("postal_ballot" if re.search(r"postal ballot", text, re.I) else "agm_egm"), "primary"
    if subject == "Analysts/Institutional Investor Meet/Con. Call Updates":
        if re.search(r"transcript|audio|recording|earnings call|conference call|con\.? ?call", text, re.I):
            return "earnings_call", "primary"
        return "investor_meetings", "primary"
    if subject == "Copy of Newspaper Publication":
        return ("results", "ancillary") if re.search(r"result", text, re.I) else ("unclassified", "primary")
    for rx, cat, role in _RULES:
        if rx.search(text):
            if subject in ("Press Release", "Press Release (Revised)") and cat == "results":
                return "results", "ancillary"  # results press release rides with the results filing
            return cat, role
    if subject in ("Outcome of Board Meeting",):
        return None, "primary"  # board outcome we couldn't read: let the LLM look
    return None, "primary"
