"""Vercel entrypoint: Vercel looks for a FastAPI `app` in main.py at the service root; the real app lives in finn.api."""

from finn.api.main import app  # noqa: F401
