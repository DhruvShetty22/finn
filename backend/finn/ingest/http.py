"""Polite HTTP: browser headers, per-host pacing, retries, and an optional on-disk cache.

NSE, BSE and screener all reject bare clients and throttle bursts, so every fetch goes through here.
"""

import hashlib
import json
import logging
import time
from urllib.parse import urlparse

import httpx

from finn.config import DATA, HTTP_CACHE

log = logging.getLogger(__name__)

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
BASE_HEADERS = {"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"}

# minimum seconds between requests to the same host
PACE = {"www.screener.in": 1.2, "www.nseindia.com": 0.6, "www.bseindia.com": 0.6, "api.bseindia.com": 0.6}
HOST_HEADERS = {
    "www.nseindia.com": {"Referer": "https://www.nseindia.com/companies-listing/corporate-filings-announcements"},
    "www.bseindia.com": {"Referer": "https://www.bseindia.com/"},
    "api.bseindia.com": {"Referer": "https://www.bseindia.com/", "Origin": "https://www.bseindia.com"},
}

_CACHE_DIR = DATA / "http_cache"
_last: dict[str, float] = {}
_client = httpx.Client(headers=BASE_HEADERS, follow_redirects=True, timeout=httpx.Timeout(45, connect=15))


class FetchError(RuntimeError):
    pass


def _cache_path(url: str):
    return _CACHE_DIR / hashlib.sha1(url.encode()).hexdigest()


def get(url: str, *, ttl: float | None = None, headers: dict | None = None, retries: int = 3) -> bytes:
    """GET a URL. ttl (seconds) enables the disk cache: None = never cache, 0 = cache forever."""
    path = _cache_path(url)
    if HTTP_CACHE and ttl is not None and path.exists() and (ttl == 0 or time.time() - path.stat().st_mtime < ttl):
        return path.read_bytes()

    host = urlparse(url).netloc
    hdrs = {**HOST_HEADERS.get(host, {}), **(headers or {})}
    for attempt in range(retries + 1):
        wait = PACE.get(host, 0.3) - (time.time() - _last.get(host, 0))
        if wait > 0:
            time.sleep(wait)
        _last[host] = time.time()
        try:
            r = _client.get(url, headers=hdrs)
        except httpx.HTTPError as e:
            err = f"{type(e).__name__}: {e}"
        else:
            if r.status_code == 200:
                if HTTP_CACHE and ttl is not None:
                    _CACHE_DIR.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(r.content)
                return r.content
            err = f"HTTP {r.status_code}"
            if r.status_code in (401, 403) and host == "www.nseindia.com":
                _warm_nse()
            elif r.status_code not in (429, 500, 502, 503, 504, 401, 403):
                break  # 404 etc.: retrying won't help
        log.warning("GET %s failed (%s), attempt %d", url, err, attempt + 1)
        time.sleep(2**attempt)
    raise FetchError(f"{url}: {err}")


def get_json(url: str, **kw):
    return json.loads(get(url, **kw))


def _warm_nse() -> None:
    """NSE's API sometimes wants cookies that its HTML pages set. Best effort."""
    for page in ("https://www.nseindia.com/", "https://www.nseindia.com/companies-listing/corporate-filings-announcements"):
        try:
            _client.get(page)
        except httpx.HTTPError:
            pass
