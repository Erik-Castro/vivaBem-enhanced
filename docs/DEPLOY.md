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
# O exemplo vem com AI_ENABLED=true usando Ollama local: em produção defina
# AI_ENABLED=false (a IA é opt-in por usuário) ou configure um provider com chave.

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

### Worker de IA (perfis `ai` e `push`)

O consumidor do outbox e das notificações push é um serviço separado, com a
mesma imagem e o mesmo volume SQLite. Ele sobe quando o perfil `ai` e/ou `push`
é ativado; a API funciona sem ele (sem IA, sem push).

```bash
# Sobe API + frontend + worker (IA e push)
docker compose --profile ai --profile push up -d --build

# Só o worker de push (API já em execução)
docker compose --profile push up -d worker

docker compose logs -f worker
```

- Com `AI_ENABLED=false` **e** `PUSH_ENABLED=false` o worker registra
  `worker_disabled` e encerra com código 0; por isso o perfil existe: não faz
  sentido manter um processo ocioso.
- O worker **não migra**. Se a API ainda não aplicou o schema, ele sai com
  erro `Schema desatualizado` e o `restart` tenta de novo até o banco estar ok.
- `stop_grace_period: 35s` é maior que `WORKER_SHUTDOWN_GRACE_MS` (30s) para o
  encerramento gracioso terminar antes do `SIGKILL`.
- A entrega é pelo menos uma vez; handlers deduplicam por `dedupe_key`.
- Push usa a própria linha de `notifications` (`push_state`) com claim/lease, sem
  evento novo na outbox.

### Chaves VAPID

Push exige um par de chaves EC P-256 fixo por instalação:

```bash
deno task push:keys
# PUSH_ENABLED=true
# PUSH_VAPID_PUBLIC_KEY='{"kty":"EC",...}'
# PUSH_VAPID_PRIVATE_KEY='{"kty":"EC",...}'
# PUSH_VAPID_SUBJECT='mailto:voce@exemplo.com'
```

- Cole as três variáveis no `.env`/Portainer e repasse ao serviço `worker`.
- `PUSH_VAPID_SUBJECT` precisa ser `mailto:` ou `https://` (RFC 8292).
- Trocar o par invalida as assinaturas existentes; os navegadores renovam na
  próxima abertura do app (o service worker avisa a aba).
- Push exige HTTPS no navegador (ou `localhost`); em HTTP puro o botão de
  ativar não aparece.

### Ollama acessível pelo container

O Compose publica `host.docker.internal` (via `host-gateway`), mas o Ollama do
host precisa aceitar conexões nesse endereço. Por padrão ele escuta apenas em
`127.0.0.1`, e o container recebe `Connection refused`:

```bash
sudo systemctl edit ollama
# [Service]
# Environment="OLLAMA_HOST=0.0.0.0:11434"
sudo systemctl restart ollama
```

Alternativa apenas em hosts Linux que não devem expor o Ollama na rede: rodar o
worker com `network_mode: host` e `AI_OLLAMA_URL=http://127.0.0.1:11434`. Com
`AI_PROVIDER=openai` isso não se aplica: use `AI_API_BASE_URL` e `AI_API_KEY`.

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

Tags de imagem já publicadas são imutáveis: para corrigir algo, suba a versão no
`deno.json`, gere uma tag nova (`1.0.2`, ...) e publique essa tag; nunca
sobrescreva `1.0.0`/`1.0.1`. `latest` pode acompanhar a última versão.

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
| `AI_ENABLED` | não | Defina `false` em produção; o `.env.example` liga com Ollama local |
| `WORKER_ID` | não | Identificador do worker; padrão `worker-<uuid>` |
| `WORKER_CONCURRENCY` | não | Eventos processados em paralelo (1 a 8; padrão 1) |
| `WORKER_LEASE_MS` | não | Validade do lease; padrão 60000 |
| `WORKER_HEARTBEAT_MS` | não | Renovação do lease; deve ser menor que o lease |
| `WORKER_MAX_ATTEMPTS` | não | Tentativas antes do dead letter (padrão 5) |
| `WORKER_POLL_INTERVAL_MS` | não | Intervalo de polling (padrão 1000) |
| `WORKER_SHUTDOWN_GRACE_MS` | não | Espera no shutdown gracioso (padrão 30000) |
| `PUSH_ENABLED` | não | Liga Web Push; exige as três variáveis VAPID |
| `PUSH_VAPID_PUBLIC_KEY` | com push | JWK público gerado por `deno task push:keys` |
| `PUSH_VAPID_PRIVATE_KEY` | com push | JWK privado; nunca commitar |
| `PUSH_VAPID_SUBJECT` | com push | `mailto:` ou `https://` (RFC 8292) |
| `PUSH_TTL_SECONDS` | não | Padrão 86400; máximo 2419200 (4 semanas) |
| `PUSH_DISPATCH_INTERVAL` | não | Intervalo da fila de push (padrão 15000 ms) |
| `PUSH_BATCH_SIZE` | não | Notificações por ciclo (padrão 20) |
| `PUSH_MAX_ATTEMPTS` | não | Tentativas antes de `failed` (padrão 3) |
| `PUSH_CLAIM_LEASE_MS` | não | Validade do claim de entrega (padrão 60000) |
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

Confirme `"database":"ok"` e que `migrations` corresponde ao número de arquivos em
`src/db/migrations` — o `/ready` reporta a contagem, não valida o schema. Depois
faça login com um usuário que já existia: se a sessão abrir, o restore está
íntegro.

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

## Replay de eventos (dead letter)

Eventos que esgotaram as tentativas ou falharam de forma permanente ficam em
`dead_letter`. A inspeção e o reprocessamento são feitos pela CLI, nunca por
`UPDATE` manual:

```bash
# Panorama da fila (totais, idade do pendente mais antigo, retries e dead letter por tipo)
docker compose exec vivabem deno task outbox:replay --stats

# Lista os eventos terminais (JSON no stdout)
docker compose exec vivabem deno task outbox:replay --list

# Devolve um evento à fila (auditado em replay_count/replayed_at)
docker compose exec vivabem deno task outbox:replay --id=<uuid>

# Força replay de um evento pending/processing (use com cautela)
docker compose exec vivabem deno task outbox:replay --id=<uuid> --force
```

Replay não garante execução única: os handlers são idempotentes por
`dedupe_key`, mas efeitos externos devem continuar sendo reprocessáveis. Se a
falha for de configuração (provider, chave, modelo), corrija antes de reenviar.

## Checklist de produção

- [ ] `ENV=production`, `COOKIE_SECURE=true` e HTTPS no proxy.
- [ ] `JWT_SECRET` forte, fora do Git, e plano de rotação.
- [ ] `APP_ORIGIN` exatamente igual à origem do frontend.
- [ ] Volume `/app/data` persistente e monitorado.
- [ ] Backup diário agendado, cópia off-host e restore testado.
- [ ] `/health` e `/ready` monitorados; logs JSON coletados.
- [ ] `AI_ENABLED=false` até o usuário autorizar; chaves de IA só no ambiente.
- [ ] Worker no perfil `ai` e/ou `push` monitorado conforme o recurso ligado;
      logs em `worker_started`/`worker_stats`/`worker_stopped`/`push_dispatch`.
- [ ] Push com par VAPID próprio, `PUSH_VAPID_SUBJECT` válido e worker de push
      no ar (`push_dispatch` nos logs).
- [ ] Eventos em `dead_letter` revisados e reenviados com `outbox:replay`.
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
- A fila offline cobre apenas mutações e depende de Background Sync (parcial em
  Firefox/Safari); sem ela, o replay acontece na próxima abertura do app.
- Push depende do serviço de push do navegador (FCM/APNs/Mozilla); a entrega é
  at-least-once e pode atrasar quando o dispositivo está em economia de bateria.
- Sem cache offline de leituras: abrir uma tela nova sem rede mostra erro.
