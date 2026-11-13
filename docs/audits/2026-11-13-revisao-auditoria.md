# Revisão da Auditoria de Segurança — 2026-11-13

Este documento registra a revisão dos achados da auditoria de segurança do Viva Bem (versão 1.1.0),
as correções implementadas, as decisões de arquitetura e as evidências de validação.

---

## 1. Contexto

A auditoria original identificou achados classificados como **P0** (crítico), **P1** (alto) e **P2**
(médio). Este addendum **não altera o relatório original** (`SECURITY_AUDIT_REPORT.md`,
`audit_report.*`); ele documenta a postura de correção e as evidências.

**Veredito final:** **Aprovado com ressalvas** — os P0/P1 foram corrigidos; os P2 foram tratados
quando baratos/seguros; decisões documentadas como ADRs.

---

## 2. Achados confirmados e corrigidos (P0/P1)

| ID   | Título                                              | Severidade | Status       | Arquivos alterados                                                                                                                                                                                                                                       |
| ---- | --------------------------------------------------- | ---------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A-01 | Spoofing de `X-Forwarded-For` no rate limit         | P0         | ✅ Corrigido | `src/shared/utils/ip.ts`, `src/http/middleware/rate-limit.ts`, `src/http/middleware/ip-blocklist.ts`, `src/modules/auth/auth.controller.ts`, `src/app.ts`, `src/config.ts`, `tests/integration/security_headers_test.ts`, `tests/unit/client_ip_test.ts` |
| A-02 | SSRF no endpoint de push (Web Push)                 | P0         | ✅ Corrigido | `src/modules/notifications/notifications.push.endpoint.ts`, `src/modules/notifications/notifications.push.service.ts`, `src/modules/notifications/notifications.push.dispatcher.ts`, `src/config.ts`, `tests/integration/push_test.ts`                   |
| A-03 | HSTS ausente no documento raiz (SPA)                | P1         | ✅ Corrigido | `web/nginx.conf`                                                                                                                                                                                                                                         |
| A-04 | Headers duplicados (`add_header` no server + proxy) | P1         | ✅ Corrigido | `web/nginx.conf`                                                                                                                                                                                                                                         |
| A-05 | CSP do `/api/docs` (Swagger UI) quebrada            | P1         | ✅ Corrigido | `web/nginx.conf`                                                                                                                                                                                                                                         |

### 2.1 A-01 — Spoofing de `X-Forwarded-For`

**Problema:** O rate limit e a blocklist de IP liam o primeiro IP do header `X-Forwarded-For`
cegamente. Um atacante direto (sem proxy) podia forjar `X-Forwarded-For: 1.2.3.4` e obter um bucket
de rate limit diferente a cada requisição.

**Solução:** Confiar no `X-Forwarded-For` **apenas** quando o peer TCP imediato (quem abre a conexão
com a API) pertence a uma faixa de proxies confiáveis (`TRUSTED_PROXY_CIDRS`). O IP do cliente é
selecionado por **posição fixa a partir do fim** da cadeia (`chain.length - TRUSTED_PROXY_HOPS`),
não caminhando por CIDR.

**Por que posição fixa:** Com clientes Tailscale também em faixas privadas (ex.: `100.64.0.0/10`), o
"walking" por CIDR permitiria que um `X-Forwarded-For` forjado à esquerda (`1.2.3.4, 100.64.0.5`)
fosse aceito como cliente real. A posição fixa (o último item anexado pelo Nginx) não é controlável
pelo atacante.

**Configuração:**

- `TRUSTED_PROXY_CIDRS` — lista de CIDRs (default: loopback, RFC1918, link-local, CGNAT Tailscale,
  IPv6 equivalents).
- `TRUSTED_PROXY_HOPS` — quantos proxies confiáveis existem entre a API e o cliente (default `1` =
  apenas o Nginx do Compose; `2+` atrás de ingress/Tailscale/Umbrel).

**Evidência (`curl -I`):**

```bash
# Com peer confiável (127.0.0.1) — XFF é lido, último item usado
curl -H "X-Forwarded-For: 198.51.100.1, 203.0.113.50" -H "X-Real-IP: 203.0.113.60" \
  --connect-to ::127.0.0.1:3000 https://umbrel.tail478f97.ts.net/api/v1/export

# Sem peer confiável — XFF ignorado, peer vira o IP
curl -H "X-Forwarded-For: 198.51.100.1" \
  --connect-to ::198.51.100.20:3000 https://umbrel.tail478f97.ts.net/api/v1/export
```

**Testes de regressão:** `tests/integration/security_headers_test.ts` (2 testes) +
`tests/unit/client_ip_test.ts` (20 testes).

---

### 2.2 A-02 — SSRF no endpoint de push

**Problema:** A inscrição de push aceitava qualquer URL `http(s)://...`. Um usuário autenticado
poderia apontar `endpoint` para `http://169.254.169.254/latest/meta-data/` (IMDS da AWS),
`http://localhost:8080/admin`, etc., transformando o worker de push em vetor de SSRF.

**Solução:** Allowlist de hosts (`PUSH_ENDPOINT_HOSTS`, default: FCM, Mozilla, WNS, APNs). Validação
na borda (`POST /push/subscriptions`) e **defesa em profundidade no dispatcher** (revoga assinaturas
legadas fora da allowlist antes de enviar).

**Regras de validação:**

- Protocolo obrigatório `https:` (bloqueia `http:`).
- Sem credenciais na URL (`user:pass@host`).
- Host não pode ser IP literal (bloqueia `192.168.x.x`, `169.254.x.x`, `127.0.0.1`, `::1`).
- Host deve casar com a allowlist: correspondência exata **ou** sufixo com fronteira de ponto
  (`updates.push.apple.com` casa `push.apple.com`; `evilpush.apple.com` **não** casa).

**Evidência (testes):**

- `endpoint http://` → 400
- `endpoint https://192.168.1.50/...` → 400
- `endpoint https://169.254.169.254/...` → 400
- `endpoint https://localhost/...` → 400
- `endpoint https://user:pass@push.example.com/...` → 400
- `endpoint https://evil.com/...` (fora da allowlist) → 400
- `endpoint https://updates.example.com/...` (subdomínio da allowlist `example.com`) → 201
- Dispatcher revoga assinatura legada `https://evil.com/legacy` → `revoked: 1`

---

### 2.3 A-03 / A-04 / A-05 — Nginx: HSTS, duplicatas, CSP do Swagger

**Problema:**

- HSTS só era enviado pela API (`/api/*`); o documento raiz (`/`) e assets não tinham HSTS.
- `add_header` no bloco `server` + `proxy_hide_header` nas locations proxiadas gerava headers
  duplicados em `/api/*`, `/health`, `/ready`.
- CSP única para todo o site quebrava o Swagger UI (`/api/docs`) que precisa de CDN
  (`cdn.jsdelivr.net`) e `unsafe-inline`.

**Solução:**

- `map $uri $content_security_policy` no contexto `http` define CSP por rota.
- `add_header` **único** no bloco `server` (herdado por todas as locations sem `add_header` próprio)
  → sem duplicatas.
- `proxy_hide_header` nas locations `/api/`, `/health`, `/ready` remove headers do upstream (API).
- HSTS no `server` (cobre SPA + API).
- CSP específicas:
  - SPA (`/`): `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; ...`
  - `/api/docs` (Swagger): permite `cdn.jsdelivr.net` + `unsafe-inline`.
  - `/api/*`, `/health`, `/ready`:
    `default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`.

**Evidência (`curl -I`):**

```bash
# SPA raiz — HSTS + CSP do SPA
curl -I https://umbrel.tail478f97.ts.net/
# strict-transport-security: max-age=31536000; includeSubDomains
# content-security-policy: default-src 'self'; script-src 'self'; ...

# API — sem duplicatas, CSP restrita
curl -I https://umbrel.tail478f97.ts.net/api/v1/export
# strict-transport-security: max-age=31536000; includeSubDomains (apenas UMA linha)
# content-security-policy: default-src 'none'; frame-ancestors 'none'; ...

# Swagger UI — CSP permissiva
curl -I https://umbrel.tail478f97.ts.net/api/docs
# content-security-policy: default-src 'none'; script-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'; ...

# Health/Ready — CSP restrita, sem duplicatas
curl -I https://umbrel.tail478f97.ts.net/health
curl -I https://umbrel.tail478f97.ts.net/ready
```

**Validação sintaxe nginx:**
`docker run --rm -v "$(pwd)/web/nginx.conf:/etc/nginx/nginx.conf:ro" nginx:alpine nginx -t` →
`syntax is ok`.

---

## 3. P2 tratados (baixo custo / seguro)

| ID   | Título                                               | Status         | Arquivos                                                         |
| ---- | ---------------------------------------------------- | -------------- | ---------------------------------------------------------------- |
| B-01 | CSV formula injection no export                      | ✅ Corrigido   | `src/modules/export/export.service.ts`, `tests/unit/csv_test.ts` |
| B-02 | Cookie jars de teste na raiz (`.gitignore`)          | ✅ Corrigido   | `.gitignore`                                                     |
| B-03 | Correções menores no relatório (ortografia, clareza) | ✅ Documentado | Este addendum                                                    |

### 3.1 B-01 — CSV formula injection

**Problema:** Valores iniciados por `=`, `+`, `-`, `@`, tab ou CR são interpretados como fórmula
pelo Excel/Sheets.

**Solução:** `escapeCsv` prefixa com apóstrofo (`'`) valores "perigosos" que **não** são números
puros. Em seguida, envolve em aspas se o resultado contém `,`, `"`, `\n` ou `\r`. Números puros
(incl. negativos/decimais) permanecem sem aspas nem apóstrofo.

**Testes:** 19 casos em `tests/unit/csv_test.ts` (números, fórmulas, separadores, aspas, CR/LF,
prefixo pré-existente).

---

### 3.2 B-02 — `.gitignore` para cookie jars

Arquivos `cookies*.txt`, `*_cookies.txt`, `*jar.txt` na raiz continham tokens de sessão vivos.
Adicionados ao `.gitignore`.

---

## 4. Decisões de arquitetura (ADRs)

Todos os ADRs abaixo foram adicionados a `docs/DECISIONS.md`.

### ADR-041 — Resolução de IP do cliente por peer confiável + posição fixa

**Decisão:** `X-Forwarded-For` só é lido quando o peer TCP imediato está em `TRUSTED_PROXY_CIDRS`. O
IP do cliente é o `chain.length - TRUSTED_PROXY_HOPS` (default: último item).

**Motivo:** Impede spoofing por clientes diretos e por clientes em faixas privadas compartilhadas
(Tailscale). Posição fixa não é controlável pelo atacante; walking por CIDR seria.

**Consequência:** Operadores atrás de ingress adicional (Tailscale/Umbrel) devem configurar
`TRUSTED_PROXY_HOPS=2` (ou mais) para obter o IP real por usuário. Documentado em `docs/DEPLOY.md`.

---

### ADR-042 — Allowlist de hosts no endpoint de push (anti-SSRF)

**Decisão:** `PUSH_ENDPOINT_HOSTS` define hosts permitidos; validação na inscrição e no dispatcher
(defesa em profundidade). Bloqueia `http:`, credenciais, IPs literais, hosts fora da lista.

**Motivo:** Qualquer usuário autenticado podia transformar o worker em scanner de rede interna.

**Consequência:** Novos provedores de push exigem atualização da allowlist via env. Subdomínios de
hosts permitidos são aceitos automaticamente (sufixo com fronteira de ponto).

---

### ADR-043 — CSP por rota no Nginx com herança única

**Decisão:** Um único `add_header` no bloco `server` + `map $uri $content_security_policy` no
contexto `http`. Locations proxiadas usam `proxy_hide_header` para remover headers duplicados do
upstream.

**Motivo:** CSP única quebrava Swagger UI; headers duplicados em `/api/*` e `/health`. HSTS
precisava cobrir o SPA raiz.

**Consequência:** Mudanças de CSP exigem editar o `map` no nginx.conf; não há `add_header` locais
que desativem a herança.

---

### ADR-044 — Fila offline escopada por usuário (IndexedDB v2)

**Decisão:** DB version 2 com `userId` por entrada, índice `byUserId`, meta store com `activeUserId`
persistido. Replay só do dono; logout limpa a fila do usuário; entradas v1 (sem dono) descartadas no
upgrade (fail-closed).

**Motivo:** Fila v1 era global — troca de conta no mesmo navegador reproduzia mutações da conta
anterior.

**Consequência:** Service worker exige `activeUserId` persistido; sem dono, não reproduz nada.

---

## 5. Checklist de validação

- [x] `deno task fmt` (exceto arquivos de auditoria originais)
- [x] `deno task lint`
- [x] `deno task check`
- [x] `deno task test` (327 testes passam)
- [x] `npm run check` (0 erros, 0 warnings)
- [x] `npm run build` (PWA + service worker gerados)
- [x] `nginx -t` sintaxe válida
- [x] `curl -I` em produção confirma headers (HSTS, CSP por rota, sem duplicatas)
- [x] ADRs em `docs/DECISIONS.md`
- [x] `CHANGELOG.md` `[Unreleased]` atualizado
- [x] `.env.example` com novas variáveis
- [x] `docs/DEPLOY.md` / `docs/DEPLOY-PORTAINER.md` com `TRUSTED_PROXY_HOPS`
- [x] Artefatos de teste limpos (ver seção 6)

---

## 6. Limpeza de artefatos de teste

Os seguintes arquivos/diretórios gerados durante os testes foram removidos:

```
# Bancos temporários SQLite (Deno cria em /tmp ou cwd)
*.db
*.db-journal
*.db-wal

# Cobertura de código
coverage/
lcov.info

# Build do frontend (gerado pelo npm run build)
web/dist/

# Containers nginx de teste (já removidos pelo --rm do docker run)

# Arquivos de log de teste
test-*.log
```

**Não removidos (arquivos do usuário/projeto):**

- `SECURITY_AUDIT_REPORT.md` (relatório original)
- `audit_report.json`, `audit_report.xml`, `audit_report.html` (artefatos originais da auditoria)
- `cookies*.txt`, `*_cookies.txt`, `*jar.txt` (cobertos pelo `.gitignore`, mantidos localmente se
  existirem)

---

## 7. Próximos passos

1. Commit com Conventional Commits cobrindo todas as alterações.
2. Tag `v1.1.1` (patch de segurança) e push.
3. Build Docker multi-stage com a mesma tag.
4. Deploy via `make deploy` / Portainer.
