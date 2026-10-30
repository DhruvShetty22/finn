FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.10.7 /uv /bin/uv
WORKDIR /app
# dependencies first so code edits don't bust the layer cache
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY finn ./finn
RUN uv sync --frozen --no-dev
# no on-disk HTTP cache in production: the free host's disk is ephemeral, caches live in Postgres
ENV FINN_DATA_DIR=/app/data FINN_HTTP_CACHE=0 PORT=8000
CMD ["sh", "-c", "uv run --no-sync uvicorn finn.api.main:app --host 0.0.0.0 --port $PORT"]
