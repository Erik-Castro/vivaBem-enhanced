# syntax=docker/dockerfile:1

ARG DENO_VERSION=2.9.8

# ---------- build ----------
FROM denoland/deno:${DENO_VERSION} AS build

WORKDIR /app

# Dependências primeiro para aproveitar o cache de camadas.
COPY deno.json deno.lock ./
RUN deno install --frozen

COPY src ./src
COPY bin ./bin
COPY scripts ./scripts
COPY CHANGELOG.md ./

RUN deno check src/main.ts src/worker/main.ts

# ---------- runtime ----------
FROM denoland/deno:${DENO_VERSION} AS runtime

ARG VERSION=0.0.0

LABEL org.opencontainers.image.title="Viva Bem" \
      org.opencontainers.image.description="API de finanças pessoais e hábitos" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.licenses="UNLICENSED"

WORKDIR /app

RUN useradd --create-home --uid 10001 appuser

# Cache do Deno (dependências remotas) e dependências npm resolvidas.
COPY --from=build /deno-dir /deno-dir
COPY --from=build --chown=appuser:appuser /app /app

ENV ENV=production \
    PORT=3000 \
    DATABASE_PATH=/app/data/app.db

RUN mkdir -p /app/data && chown -R appuser:appuser /app/data

USER appuser

EXPOSE 3000
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["deno", "eval", "const response = await fetch('http://127.0.0.1:3000/health'); if (!response.ok) Deno.exit(1);"]

CMD ["deno", "run", "--allow-net", "--allow-read", "--allow-write", "--allow-env", "--allow-sys", "--allow-ffi", "src/main.ts"]
