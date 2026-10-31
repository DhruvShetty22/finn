"""One door to the models: tiered fallback chains, JSON-schema output, PDF attachments, cache, cost log.

    from finn.llm.router import ask
    data = ask("results_card", "extract", prompt, schema=ResultsSchema, pdf=pdf_bytes)

Tiers (env FINN_MODEL_<TIER>, comma-separated fallback chain):
    cheap   - classification leftovers, batched one-liners
    extract - PDF → JSON (results numbers, guidance, appointee profiles)
    reason  - judgement calls (ledger verdicts, synthesis, bull/bear); same models, bigger thinking budget

Every request is cached by sha256(tier, prompt, attachments, schema): a repeat is free and instant,
and the cache hit is still logged so the cost panel can show the hit rate.
"""

import hashlib
import json
import logging
import os
import time

from google import genai
from google.genai import errors, types
from pydantic import BaseModel, TypeAdapter
from sqlmodel import Session

from finn.config import GEMINI_API_KEY, now
from finn.db import LLMCache, LLMCall, engine

log = logging.getLogger(__name__)

CHAINS = {
    "cheap": os.getenv("FINN_MODEL_CHEAP") or "gemini-3.5-flash-lite,gemini-3.1-flash-lite",
    # Flash-Lite closes every chain: free-tier Flash sheds load with 503s at peak, and a lighter answer beats none
    "extract": os.getenv("FINN_MODEL_EXTRACT") or "gemini-3.6-flash,gemini-3.5-flash,gemini-3.5-flash-lite",
    "reason": os.getenv("FINN_MODEL_REASON") or "gemini-3.6-flash,gemini-3.5-flash,gemini-3.5-flash-lite",
}
THINKING = {"cheap": "minimal", "extract": "low", "reason": "high"}

# List prices, USD per 1M tokens (input, output incl. thinking). Estimates as of Oct 2026; free tier actually costs ₹0.
PRICE_USD = {
    "gemini-3.6-flash": (1.50, 7.50),
    "gemini-3.5-flash": (1.50, 9.00),
    "gemini-3.5-flash-lite": (0.30, 2.50),
    "gemini-3.1-flash-lite": (0.30, 2.50),
}
USD_INR = float(os.getenv("FINN_USD_INR", "88"))

_exhausted: set[str] = set()  # models whose free-tier *daily* quota is spent: skip them for the rest of this process

_client = genai.Client(api_key=GEMINI_API_KEY, http_options=types.HttpOptions(timeout=90_000))


class LLMError(RuntimeError):
    pass


def inr(model: str, tok_in: int, tok_out: int) -> float:
    pin, pout = PRICE_USD.get(model, (1.50, 7.50))
    return round((tok_in * pin + tok_out * pout) / 1e6 * USD_INR, 4)


def _key(tier: str, prompt: str, pdf: bytes | None, schema) -> str:
    h = hashlib.sha256()
    for part in (tier, prompt, hashlib.sha256(pdf).hexdigest() if pdf else "", _schema_repr(schema)):
        h.update(part.encode())
        h.update(b"\0")
    return h.hexdigest()


def _schema_repr(schema) -> str:
    if schema is None:
        return ""
    if isinstance(schema, dict):
        return json.dumps(schema, sort_keys=True)
    return json.dumps(TypeAdapter(schema).json_schema(), sort_keys=True)  # models, list[Model], ...


def _config(tier: str, schema, system: str | None, thinking: str | None) -> types.GenerateContentConfig:
    cfg = dict(temperature=0.2 if tier == "reason" else 0.0, system_instruction=system,
               thinking_config=types.ThinkingConfig(thinking_level=thinking or THINKING[tier]))
    if schema is not None:
        cfg.update(response_mime_type="application/json", response_schema=schema)
    return types.GenerateContentConfig(**cfg)


def new_meter() -> dict:
    return {"tokens_in": 0, "tokens_out": 0, "inr": 0.0, "cached": True, "models": set()}


def meter_view(m: dict) -> dict:
    """Contract `Cost` shape. cached=True only when every call in the section was a cache hit (or there were none)."""
    return {"tokens_in": m["tokens_in"], "tokens_out": m["tokens_out"], "inr": round(m["inr"], 2),
            "cached": m["cached"], "model": " + ".join(sorted(m["models"])) or None}


def ask(purpose: str, tier: str, prompt: str, *, schema=None, pdf: bytes | None = None,
        system: str | None = None, thinking: str | None = None, use_cache: bool = True, meter: dict | None = None):
    """Returns parsed JSON (dict/list) when `schema` is given, else text. Raises LLMError if every model fails.
    `meter` (from new_meter) accumulates tokens and ₹ across calls, for per-section cost display."""
    key = _key(tier, (system or "") + "\n" + prompt, pdf, schema)
    with Session(engine) as s:
        if use_cache and (hit := s.get(LLMCache, key)):
            s.add(LLMCall(ts=now(), purpose=purpose, model=hit.model, cached=True, key=key))
            s.commit()
            if meter is not None:
                meter["models"].add(hit.model)
            return hit.response["value"]

    contents = [types.Part.from_bytes(data=pdf, mime_type="application/pdf"), prompt] if pdf else prompt
    last_err = None
    for model in CHAINS[tier].split(","):
        model = model.strip()
        if model in _exhausted:
            continue
        for attempt in range(3):
            t0 = time.time()
            try:
                r = _client.models.generate_content(model=model, contents=contents,
                                                    config=_config(tier, schema, system, thinking))
            except errors.APIError as e:
                last_err = f"{model}: {e.code} {str(e)[:160]}"
                log.warning("LLM %s %s failed: %s", purpose, model, last_err)
                if e.code == 429 and _daily_quota(e):
                    _exhausted.add(model)  # waiting won't help until the quota resets (midnight Pacific)
                    break
                if e.code in (429, 503) and attempt < 2:  # per-minute quota / overload: wait and retry the same model
                    time.sleep(_retry_delay(e) if e.code == 429 else 3 * (attempt + 1))
                    continue
                break  # 5xx / timeout / other: next model in the chain
            except Exception as e:  # network timeouts surface as httpx errors
                last_err = f"{model}: {type(e).__name__} {e}"
                log.warning("LLM %s %s failed: %s", purpose, model, last_err)
                break
            value = _parse(r, schema)
            if value is None:
                last_err = f"{model}: unparseable response {(r.text or '')[:120]!r}"
                break
            u = r.usage_metadata
            tin, tout, tthink = u.prompt_token_count or 0, u.candidates_token_count or 0, u.thoughts_token_count or 0
            with Session(engine) as s:
                s.merge(LLMCache(key=key, model=model, response={"value": value}, created_at=now()))
                s.add(LLMCall(ts=now(), purpose=purpose, model=model, tok_in=tin, tok_out=tout, tok_think=tthink,
                              inr=inr(model, tin, tout + tthink), ms=int((time.time() - t0) * 1000), key=key))
                s.commit()
            if meter is not None:
                meter["tokens_in"] += tin
                meter["tokens_out"] += tout + tthink
                meter["inr"] += inr(model, tin, tout + tthink)
                meter["cached"] = False
                meter["models"].add(model)
            return value
    raise LLMError(f"{purpose}: all models failed ({last_err})")


def _parse(r, schema):
    if schema is None:
        return r.text
    if getattr(r, "parsed", None) is not None:
        p = r.parsed
        return p.model_dump() if isinstance(p, BaseModel) else ([x.model_dump() if isinstance(x, BaseModel) else x for x in p] if isinstance(p, list) else p)
    try:
        return json.loads(r.text)
    except (TypeError, json.JSONDecodeError):
        return None


def _daily_quota(e: errors.APIError) -> bool:
    try:
        return any("PerDay" in v.get("quotaId", "") for d in e.details["error"]["details"] for v in d.get("violations", []))
    except (KeyError, TypeError, AttributeError):
        return False


def _retry_delay(e: errors.APIError) -> float:
    """Honour the server's retryDelay hint (e.g. '17s'), capped so a batch never stalls for long."""
    try:
        for d in e.details["error"]["details"]:
            if d.get("@type", "").endswith("RetryInfo"):
                return min(float(d["retryDelay"].rstrip("s")) + 1, 30)
    except (KeyError, TypeError, ValueError):
        pass
    return 8
