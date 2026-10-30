"""Fetch a PDF once, keep its per-page text in the Document table, and flag scanned files."""

import hashlib
import logging

import pymupdf
from sqlmodel import Session

from finn.config import now
from finn.db import Document
from finn.ingest import http

log = logging.getLogger(__name__)

SCANNED_CHARS_PER_PAGE = 200  # below this the PDF is probably images; route it to the vision model


def extract_pages(pdf: bytes) -> list[str]:
    with pymupdf.open(stream=pdf, filetype="pdf") as doc:
        return [page.get_text("text") for page in doc]


def get_document(s: Session, url: str, *, symbol: str | None, kind: str, period: str | None = None) -> Document:
    """Cached by URL: a second call never touches the network."""
    if doc := s.get(Document, url):
        return doc
    raw = http.get(url, ttl=0)
    if not raw.startswith(b"%PDF"):
        raise http.FetchError(f"{url}: not a PDF ({raw[:60]!r})")
    pages = extract_pages(raw)
    chars = sum(len(p.strip()) for p in pages)
    doc = Document(url=url, symbol=symbol, kind=kind, period=period, fetched_at=now(),
                   sha=hashlib.sha256(raw).hexdigest(), n_pages=len(pages),
                   scanned=chars < SCANNED_CHARS_PER_PAGE * max(len(pages), 1), pages=pages)
    s.add(doc)
    s.commit()
    log.info("pdf %s: %d pages, %d chars%s", url[-50:], len(pages), chars, " (scanned)" if doc.scanned else "")
    return doc
