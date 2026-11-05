# Deploy

## Docker

Build com a versão do `deno.json`:

```bash
VERSION=$(grep -o '"version": *"[^"]*"' deno.json | cut -d'"' -f4)
docker build --build-arg VERSION="$VERSION" -t vivabem:"$VERSION" .
```

Run:

```bash
docker run -d --name vivabem \
  -p 3000:3000 \
  -v vivabem-data:/app/data \
  -e ENV=production \
  -e JWT_SECRET="$(openssl rand -base64 48)" \
  -e APP_ORIGIN="https://app.seudominio.com" \
  --restart unless-stopped \
  vivabem:"$VERSION"
```

- O container roda como usuário não-root (`appuser`, uid 10001).
- O volume `/app/data` guarda o SQLite, o WAL e o SHM. **Sem volume, os dados
  somem no próximo deploy.**
- `JWT_SECRET` é obrigatório em produção; o processo falha no boot sem ele.
- Healthcheck em `GET /health`; readiness em `GET /ready`.

## Portainer

1. **Stacks → Add stack**.
2. Cole o compose abaixo (ajuste imagem, domínio e segredo).
3. Defina `JWT_SECRET` como variável de ambiente da stack (não no Git).

```yaml
services:
  vivabem:
    image: vivabem:0.1.0
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      ENV: production
      PORT: "3000"
      DATABASE_PATH: /app/data/app.db
      APP_ORIGIN: https://app.seudominio.com
      JWT_SECRET: ${JWT_SECRET}
    volumes:
      - vivabem-data:/app/data
    healthcheck:
      test: ["CMD", "deno", "eval", "const r = await fetch('http://127.0.0.1:3000/health'); if (!r.ok) Deno.exit(1);"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s

volumes:
  vivabem-data:
```

## Backup

Com a aplicação rodando (usa `VACUUM INTO`, consistente com WAL):

```bash
docker exec vivabem deno task db:backup
docker cp vivabem:/app/backups/. ./backups/
```

Ou, no host:

```bash
deno task db:backup
```

Agende diariamente e copie para fora do host. Teste o restore periodicamente.

## Restore

1. Pare o container.
2. Substitua `app.db` pelo backup e remova `app.db-wal`/`app.db-shm`.
3. Suba o container; as migrações pendentes rodam no boot.

```bash
docker compose stop vivabem
docker run --rm -v vivabem-data:/data -v "$PWD/backups:/backup" alpine \
  sh -c 'cp /backup/app-AAAAMMDD.db /data/app.db && rm -f /data/app.db-wal /data/app.db-shm'
docker compose start vivabem
```

## Limites conhecidos

- SQLite é single-writer. O deploy assume **uma instância**; escala horizontal
  exige migração para Postgres.
- O WAL cresce durante escrita intensa; o checkpoint acontece no shutdown e o
  SQLite faz checkpoints automáticos.
- Sem conversão cambial: resumos não somam moedas diferentes.
