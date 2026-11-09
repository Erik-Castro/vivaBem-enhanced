# Deploy

## Pré-requisitos

- Docker Engine 24+ com Compose v2 (`docker compose`).
- Um domínio HTTPS apontando para o host (ex.: `https://app.seudominio.com`).
- Segredos fora do Git: use um `.env` no host ou variáveis da stack no Portainer.

## Deploy em um comando (Compose)

O `compose.yaml` na raiz builda as duas imagens (API e frontend), cria os
volumes e configura os healthchecks. Ele exige `APP_ORIGIN` e `JWT_SECRET`.

```bash
cp .env.example .env
# Edite pelo menos APP_ORIGIN e JWT_SECRET (mínimo 32 caracteres).
# Gere um segredo forte com: openssl rand -base64 48
# Em HTTP local use APP_ORIGIN=http://localhost:8080 e COOKIE_SECURE=false.

make deploy        # equivale a: docker compose up -d --build
make logs          # acompanha os logs
curl -fsS http://127.0.0.1:3000/health
curl -fsS http://127.0.0.1:3000/ready
curl -fsS http://127.0.0.1:8080/healthz   # frontend
```

O frontend fica em `http://localhost:${WEB_PORT:-8080}` e encaminha `/api`,
`/health` e `/ready` para o serviço `vivabem:3000` na rede do Compose.

Para parar sem perder dados: `make down` (os volumes `vivabem-data` e
`vivabem-backups` permanecem).

### O que o Compose garante

- API e frontend não-root (`appuser` uid 10001 / `nginx` uid 101), com imagens
  multi-stage.
- Volume nomeado `/app/data` para SQLite, WAL e SHM.
- Volume `/app/backups` para snapshots gerados por `deno task db:backup`.
- `ENV=production`, `COOKIE_SECURE=true`, `AI_ENABLED=false` por padrão.
- Reinício automático, `stop_grace_period` de 30s e healthcheck em `/health`.
- Shutdown gracioso em `SIGINT`/`SIGTERM`: servidor, checkpoint do WAL e banco
  fechado.
- Nginx servindo o SPA com fallback, CSP, cache de assets e `sw.js` sem cache.

## Build manual

Build com a versão do `deno.json`:

```bash
VERSION=$(grep -o '"version": *"[^"]*"' deno.json | cut -d'"' -f4)
docker build --build-arg VERSION="$VERSION" -t vivabem:"$VERSION" .
docker run -d --name vivabem \
  -p 3000:3000 \
  -v vivabem-data:/app/data \
  -v vivabem-backups:/app/backups \
  -e ENV=production \
  -e JWT_SECRET="$(openssl rand -base64 48)" \
  -e APP_ORIGIN="https://app.seudominio.com" \
  --restart unless-stopped \
  vivabem:"$VERSION"
```

Frontend (Nginx não-root, porta 8080):

```bash
docker build -t vivabem-web:"$VERSION" ./web
```

O `web/nginx.conf` resolve a API pelo nome `vivabem:3000`, então publique o
frontend na mesma rede do Compose (ou ajuste o `proxy_pass`). A origem pública
do frontend precisa ser igual a `APP_ORIGIN` da API.

## Portainer

1. **Stacks → Add stack**.
2. Cole o `compose.yaml` do repositório (ajuste a imagem/versão se necessário).
3. Em **Environment variables**, defina `APP_ORIGIN` e `JWT_SECRET`; deixe
   `AI_ENABLED=false` até o usuário autorizar a IA.
4. Faça o deploy e confira o healthcheck do container.

## Variáveis essenciais

| Variável | Obrigatória | Observação |
| --- | --- | --- |
| `APP_ORIGIN` | sim | Origem exata do frontend; usada por CORS e CSRF |
| `JWT_SECRET` | sim em produção | Mínimo 32 caracteres; rotate com cuidado |
| `DATABASE_PATH` | não | Padrão `/app/data/app.db` na imagem |
| `COOKIE_SECURE` | não | Use `true` atrás de HTTPS |
| `WEB_PORT` | não | Porta publicada do frontend no Compose (padrão 8080) |
| `RATE_LIMIT_AUTH_MAX` | não | Padrão 5/min por IP e por e-mail |
| `RATE_LIMIT_DATA_MAX` | não | Padrão 30/min para import/export |
| `AI_ENABLED` | não | Padrão `false`; opt-in por usuário |
| `LOG_LEVEL` | não | `info` em produção |

Lista completa: `.env.example`.

## Backup

O backup usa `VACUUM INTO`, que produz um snapshot consistente mesmo com o WAL
ativo e a aplicação escrevendo. Nunca copie apenas `app.db` a quente.

```bash
# Gera /app/backups/app-<timestamp>.db dentro do container
docker compose exec vivabem deno task db:backup

# Copia para o host
docker compose cp vivabem:/app/backups/. ./backups/
```

Ou no host, com a aplicação parada ou não:

```bash
deno task db:backup
```

### Agendamento diário (cron no host)

```cron
15 3 * * * cd /opt/vivabem && docker compose exec -T vivabem deno task db:backup && docker compose cp vivabem:/app/backups/. /var/backups/vivabem/
```

Mantenha pelo menos 7 cópias diárias e uma mensal fora do host. **Teste o
restore** periodicamente — backup não testado não é backup.

## Restore

1. Pare a stack: `make down`.
2. Substitua o banco no volume e remova `app.db-wal`/`app.db-shm`.
3. Suba de novo; as migrações pendentes rodam no boot.

```bash
docker run --rm -v vivabem-data:/data -v "$PWD/backups:/backup" alpine \
  sh -c 'cp /backup/app-AAAAMMDD.db /data/app.db && rm -f /data/app.db-wal /data/app.db-shm'
make deploy
curl -fsS http://127.0.0.1:3000/ready
```

O `compose.yaml` fixa os nomes `vivabem-data` e `vivabem-backups`, então os
comandos de restore continuam válidos mesmo se a stack for renomeada.

## Manutenção automática

No boot e a cada 24h a aplicação executa uma limpeza operacional:

- sessões expiradas;
- eventos de outbox concluídos com mais de 30 dias;
- bloqueios de IP vencidos;
- embeddings de insights que não existem mais.

Nenhum dado de domínio do usuário é removido. O resultado é logado em
`maintenance_complete`; falhas são logadas em `maintenance_failed` e não
derrubam o processo. O índice `idx_user_sessions_expires` e o índice parcial
`idx_event_outbox_cleanup` (migração `009_hardening.sql`) mantêm a limpeza
barata.

## Checklist de produção

- [ ] `ENV=production`, `COOKIE_SECURE=true` e HTTPS no proxy.
- [ ] `JWT_SECRET` forte, fora do Git, e plano de rotação.
- [ ] `APP_ORIGIN` exatamente igual à origem do frontend.
- [ ] Volume `/app/data` persistente e monitorado.
- [ ] Backup diário agendado, cópia off-host e restore testado.
- [ ] `/health` e `/ready` monitorados; logs JSON coletados.
- [ ] `AI_ENABLED=false` até o usuário autorizar; chaves de IA só no ambiente.
- [ ] Rate limits revisados para o tráfego esperado.
- [ ] Uma única instância (SQLite é single-writer).
- [ ] Frontend servido por HTTPS e `APP_ORIGIN` igual à URL pública.
- [ ] `WEB_PORT` publicado apenas onde o proxy reverso alcança.

## Limites conhecidos

- SQLite é single-writer. Escala horizontal exige migração para Postgres.
- O WAL cresce durante escrita intensa; o SQLite faz checkpoints automáticos e
  o shutdown força checkpoint.
- Sem conversão cambial: resumos não somam moedas diferentes.
- O rate limiter é em memória; reiniciar o processo zera as janelas.
- O service worker não faz cache de dados nem fila de mutações: offline, o app
  abre mas ações de escrita falham com mensagem de erro.
