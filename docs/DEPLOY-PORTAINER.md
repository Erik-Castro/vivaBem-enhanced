# Deploy do Viva Bem no Portainer
#
# Este guia pressupõe que você já tem uma instância do Portainer rodando
# com acesso a um host Docker e (opcionalmente) a um registry de imagens.

## Pré-requisitos

- Portainer CE ou Business Edition instalado e acessível.
- Um endpoint Docker registrado no Portainer (localhost ou host remoto).
- Um domínio HTTPS apontando para o host (ex.: `https://app.seudominio.com`).
- Segredos fora do Git: `APP_ORIGIN` e `JWT_SECRET` devem ser definidos na
  stack do Portainer.

## Passo 1 — Preparar as imagens (opção A: build no Portainer)

O Portainer pode construir as imagens diretamente a partir do repositório
Git. Não é necessário fazer push manual das imagens.

1. No Portainer, vá em **Stacks** → **Add stack**.
2. Nome da stack: `vivabem`.
3. Método: **Web editor** ou **Upload file**.
4. Cole ou envie o conteúdo do arquivo `compose.yaml` (raiz do repositório).
5. Em **Environment variables**, adicione:
   - `APP_ORIGIN=https://app.seudominio.com`
   - `JWT_SECRET=<seu segredo de 32+ caracteres>`
   - `VERSION=1.1.0`
   - `COOKIE_SECURE=true`
   - `ENV=production`
   - `AI_ENABLED=false` (ou `true` se quiser IA com provider configurado)
   - As demais variáveis do `.env.production.example` conforme necessário.
6. Clique em **Deploy the stack**.

O Portainer fará o build das imagens `vivabem:1.1.0` e `vivabem-web:1.1.0`
localmente no endpoint Docker.

---

## Passo 1 (alternativa) — Build e push manual para registry

Se preferir construir as imagens fora do Portainer e usar um registry:

```bash
# Na máquina com Docker disponível:
VERSION=1.1.0

# Build da API
docker build --build-arg VERSION="$VERSION" -t registry.seudominio.com/vivabem:"$VERSION" .

# Build do frontend
docker build --build-arg VERSION="$VERSION" -t registry.seudominio.com/vivabem-web:"$VERSION" ./web

# Push para o registry
docker push registry.seudominio.com/vivabem:"$VERSION"
docker push registry.seudominio.com/vivabem-web:"$VERSION"
```

Em seguida, no Portainer, edite o `compose.yaml` para usar as imagens do
registry em vez de build local:

```yaml
services:
  vivabem:
    image: registry.seudominio.com/vivabem:1.1.0
    # ... restante sem a chave `build`
  web:
    image: registry.seudominio.com/vivabem-web:1.1.0
    # ... restante sem a chave `build`
```

---

## Passo 2 — Worker de IA e push (perfis `ai` e `push`)

O worker é um serviço separado que consome a outbox e entrega as notificações
push. No Portainer, perfis do Compose (`profiles`) não são ativados
automaticamente.

Para subir o worker:

1. No Portainer, vá em **Stacks** → `vivabem` → **Editor**.
2. Adicione o serviço `worker` ao stack (ele já está no `compose.yaml` com
   `profiles: ["ai", "push"]`).
3. Ou crie um stack separado apenas para o worker com o mesmo `compose.yaml`,
   definindo apenas as variáveis de ambiente do worker.
4. Variáveis obrigatórias do worker (quando `AI_ENABLED=true`):
   - `AI_ENABLED=true`
   - `AI_PROVIDER=ollama` ou `openai`
   - `AI_API_MODEL_EMBEDDINGS_NAME=nomic-embed-text`
   - `AI_EMBEDDING_DIMENSIONS=768`
   - `AI_API_BASE_URL` e `AI_API_KEY` (se `openai`)
   - `AI_MODEL` (se `ollama`)
   - `WORKER_ID=worker-01`
5. Com push ligado (`PUSH_ENABLED=true`), repasse também ao worker as mesmas
   `PUSH_VAPID_PUBLIC_KEY`, `PUSH_VAPID_PRIVATE_KEY` e `PUSH_VAPID_SUBJECT` da
   API. Gere o par uma única vez com `deno task push:keys`.

Se não for usar IA nem push, deixe `AI_ENABLED=false` e `PUSH_ENABLED=false` e
não suba o worker. A API funciona normalmente sem ele.

---

## Passo 3 — Volumes

O `compose.yaml` já define volumes nomeados fixos:

| Volume | Uso |
|--------|-----|
| `vivabem-data` | Banco SQLite, WAL e SHM |
| `vivabem-backups` | Snapshots gerados por `deno task db:backup` |

No Portainer, esses volumes são criados automaticamente na primeira implantação.
Eles persistem entre reinícios e atualizações da stack.

---

## Passo 4 — Verificar o deploy

Após o deploy, acesse:

```bash
# Saúde da API
curl -fsS https://app.seudominio.com/health

# Prontidão (banco + schema)
curl -fsS https://app.seudominio.com/ready

# Frontend
curl -fsS https://app.seudominio.com/healthz
```

No Portainer, vá em **Stacks** → `vivabem** → estado deve ser "Active" e todos
os containers com healthcheck "Healthy".

---

## Atualização para nova versão

1. Atualize a tag no `compose.yaml` (ou na variável `VERSION`).
2. No Portainer, edite a stack e clique em **Update the stack**.
3. O Portainer fará o rollout com zero downtime (graças ao `restart: unless-stopped`
   e ao healthcheck).

> **Imutabilidade:** nunca reutilize uma tag `X.Y.Z` já publicada. Uma correção
> sai como novo patch (`1.0.2`, ...) e a stack aponta para a tag nova. `latest`
> pode acompanhar a última versão, mas não substitui a tag versionada.

---

## Backup e restore

```bash
# Backup (dentro do container da API)
docker compose exec vivabem deno task db:backup

# Ou via Portainer: container vivabem → Console → deno task db:backup

# O backup fica em /app/backups/ (volume vivabem-backups)
```

---

## Logs

No Portainer: **Stacks** → `vivabem` → **Logs**.

Ou via CLI:
```bash
docker compose logs -f --tail=100 vivabem
docker compose logs -f --tail=100 worker   # se o perfil ai estiver ativo
docker compose logs -f --tail=100 web
```
