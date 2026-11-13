# Changelog

Todas as mudanças notáveis deste projeto são documentadas neste arquivo.

O formato é baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/)
e este projeto adere ao [Semantic Versioning](https://semver.org/lang/pt-BR/).

## [Unreleased]

## [1.1.0] - 2026-11-13

Release de funcionalidade: notificações push, fila offline e sincronização em
segundo plano. A API v1 continua estável; `1.0.1` permanece imutável.

### Added

- Notificações push (Web Push + VAPID) de ponta a ponta: `PUSH_ENABLED` e as
  chaves VAPID no ambiente, `GET /notifications/push/key`,
  `POST|GET|DELETE /notifications/push/subscriptions` e
  `POST /notifications/push/test` (`202`). A entrega usa a própria linha de
  `notifications` (`push_state`, claim/lease) e roda no worker, sem depender da
  IA; `404`/`410` do serviço de push revogam a assinatura.
- `deno task push:keys` gera o par VAPID em JWK para colar no `.env`/Portainer.
- Manifest PWA gerado com `id: "/"`,
  `display_override: ["standalone", "minimal-ui"]` e
  `categories: ["finance", "productivity", "lifestyle"]`.
- Fila de mutações offline em IndexedDB com `Idempotency-Key` e snapshot de
  CSRF, reproduzida ao voltar a conexão (aba aberta) ou por Background Sync
  (`vivabem-flush`) com o app fechado.
- Periodic Background Sync (`vivabem-refresh`, `minInterval` 24h) para atualizar
  o badge de notificações não lidas.
- Tela **Configurações → Notificações push**: ativar/desativar o dispositivo,
  estado de permissão e envio de aviso de teste.
- `PUSH_DISABLED` (`503`) na taxonomia de erros para instalações com push
  desligado.

### Changed

- O service worker passou a usar `strategies: "injectManifest"` com handler
  próprio (`web/src/sw.ts`), necessário para `push`/`notificationclick`/`sync`
  e `periodicsync`; o tipo do worker é validado por `tsconfig.sw.json`.
- O worker independente também entrega push: ele sobe com `AI_ENABLED` ou
  `PUSH_ENABLED` e só encerra quando os dois estão desligados. No Compose ele
  atende aos perfis `ai` e `push`.
- A manutenção periódica remove assinaturas push revogadas antigas
  (`revokedPushSubscriptions`).

## [1.0.1] - 2026-11-13

Release de correção da autenticação. A tag `1.0.0` permanece imutável; a
correção sai como novo patch.

### Fixed

- Cadastro, login e logout voltaram a funcionar no cliente web: o middleware de
  idempotência estava aplicado a `/api/v1/*` e exigia `userId`, então as rotas
  públicas de autenticação respondiam 401 quando o frontend enviava o
  `Idempotency-Key` automático. A idempotência agora é registrada apenas nos
  grupos autenticados, sempre depois do `requireAuth`.
- `compose.yaml` e `portainer-stack.yml` repassam as variáveis `AI_*` para a API
  e publicam `host.docker.internal` (`host-gateway`) para o Ollama no host. Sem
  isso, `AI_ENABLED=true` derrubava a API no boot (o provider caía no padrão
  `openai` sem `AI_API_BASE_URL`) e o container não alcançava o Ollama local.

## [1.0.0] - 2026-11-11

Primeira release estável: API v1 congelada.

### Added

- Contrato da API v1 congelado em `/api/v1`: mudanças retrocompatíveis aceitas;
  remoções ou renomeações exigem `/api/v2` + release MAJOR.
- `deno task outbox:replay --stats`: panorama da fila com totais por status,
  idade do evento pendente mais antigo, pendentes em retry (`attempts > 0`) e
  dead letter agrupado por tipo de evento.
- `worker_stats` agora inclui `retrying` e `deadLetterByType`, para diferenciar
  falha de provider de payload inválido sem abrir o banco.
- `GET /ready` valida se o schema aplicado corresponde às migrações do código e
  responde 503 (`status: not_ready`, `checks.schema: outdated`) quando o banco
  está atrás — antes só checava se a conexão respondia. A resposta ganhou
  `checks.schema` (`ok`, `outdated` ou `unknown`).
- Idempotência de escritas via cabeçalho `Idempotency-Key` opcional em
  POST/PUT/PATCH/DELETE: reenvios com a mesma chave devolvem o resultado em
  cache em vez de reexecutar a operação.
- Fila offline no cliente: mutações são enfileiradas em IndexedDB quando
  sem conexão e replayadas automaticamente ao retornar.

## [0.12.0] - 2026-11-11

Décima segunda release: worker independente do Event Intelligence Engine
(Fase 11).

### Added

- Worker do Event Intelligence Engine extraído para processo independente:
  `src/worker/main.ts` (`deno task worker`/`deno task dev:worker`) consome o
  outbox sozinho e a API deixa de iniciar o consumidor. Os dois processos
  compartilham apenas o arquivo SQLite (WAL + `busy_timeout`).
- `src/worker/runtime.ts` com polling, pool de concorrência
  (`WORKER_CONCURRENCY`), heartbeat de lease, recuperação de leases vencidos,
  shutdown gracioso (`WORKER_SHUTDOWN_GRACE_MS`) e estatísticas
  `worker_stats`.
- `src/events/event-registry.ts`: catálogo fechado de tipos de evento com
  pipeline e validação de payload por Zod. Tipo desconhecido ou payload
  inválido vira falha permanente (dead letter), não retry infinito.
- Variáveis `WORKER_*` em `src/config.ts` (`WORKER_ID`,
  `WORKER_POLL_INTERVAL_MS`, `WORKER_LEASE_MS`, `WORKER_HEARTBEAT_MS`,
  `WORKER_MAX_ATTEMPTS`, `WORKER_CONCURRENCY`, `WORKER_SHUTDOWN_GRACE_MS`),
  com fallback para `AI_WORKER_INTERVAL`/`AI_MAX_RETRIES`/`AI_REQUEST_TIMEOUT`.
  `loadWorkerConfig` rejeita heartbeat maior ou igual ao lease.
- `deno task outbox:replay` (`--list`, `--id=`, `--force`, `--limit=`) para
  inspecionar e reprocessar eventos em dead letter. O replay é auditado por
  `replay_count`/`replayed_at` e mantém o identificador original.
- `assertSchemaCurrent` em `src/db/migrate.ts`: o worker (e a CLI de replay)
  não migram; falham no boot com mensagem acionável quando o schema está
  atrasado, falta uma migração ou o checksum diverge.
- Migração `010_worker.sql`: lease explícito (`lease_token`,
  `lease_expires_at`), estado terminal `dead_letter`, contadores de replay e
  `dedupe_key` em `ai_insights`/`notifications`.
- Deduplicação de insights e notificações por
  `dedupe_key = "<eventId>:<título>"` com índice único parcial. A entrega
  continua sendo pelo menos uma vez; os efeitos é que são idempotentes.
- Serviço `worker` no `compose.yaml` (mesma imagem, `command: deno task worker`,
  `profiles: ["ai"]`, `stop_grace_period: 35s`) e verificação de
  `src/worker/main.ts` no `Dockerfile`.
- Tela de insights (`#/insights`) com filtros por categoria e leitura, busca
  semântica com fallback textual, marcação de leitura (uma/todas), feedback
  "útil"/"não útil", paginação e aviso quando a IA está desativada.
- Tela de família (`#/family`) com convite por e-mail, aceite/recusa de
  convites recebidos, cancelamento de enviados e resumo agregado do parceiro
  (totais do mês por moeda e contagens), sem expor transações individuais.
- Tela de dados (`#/data`) com importação de CSV/OFX (prévia de linhas
  novas/duplicadas, erros por linha e commit idempotente) e exportação do backup
  JSON completo ou das transações em CSV.
- Tela de recorrências (`#/recurring`) com lista de ativas e pausadas,
  projeção de próximas ocorrências (30/60/90 dias), criação, edição,
  "Executar agora" e pausa/reativação sem apagar o histórico.
- Sino de notificações no topbar com badge de não lidas (cap `9+`), painel com
  as 8 mais recentes (dropdown no desktop, bottom sheet no mobile), marcação
  de leitura ao abrir e atalho para a central.
- Página `#/notifications` com abas "Todas"/"Não lidas", contador de não lidas,
  atualização manual, "Marcar todas como lidas", paginação e estados de vazio
  e erro.
- Contador de notificações atualizado no boot e a cada 60s, pausado com a aba
  oculta e revalidado em `visibilitychange`/`online`.
- Links de notificação traduzidos para rotas do SPA (`/finances` →
  `/dashboard`, `/budgets/:id` → `/budgets`, `/settings/sessions` →
  `/settings`); links sem tela equivalente apenas marcam a leitura.

### Changed

- A API não consome mais o outbox: provider, processor, executor,
  correlações e o antigo `EventWorker` foram para o processo do worker, e
  `src/events/worker.ts` foi removido em favor de `src/worker/`.
- `AI_WORKER_INTERVAL`, `AI_MAX_RETRIES` e `AI_REQUEST_TIMEOUT` passam a ser
  fallback de `WORKER_*`; `.env.example` documenta o bloco novo e o Compose só
  sobe o worker com `--profile ai`. Com `AI_ENABLED=false` o worker registra
  `worker_disabled` e encerra com código 0 (sem restart loop).
- `.env.example` liga a IA (`AI_ENABLED=true`) com Ollama local: `qwen3.5:2b`
  para chat e `nomic-embed-text` para embeddings (768 dimensões). Em produção
  defina `AI_ENABLED=false`; a IA continua opt-in por usuário.

### Fixed

- `deno task dev` carrega `.env.example`; a task usava `--env-file-if-exists`,
  flag inexistente no Deno 2.9.8, e falhava antes de iniciar o servidor.
- Painel do sino fecha ao abrir um item cujo link aponta para a rota atual e
  usa bottom sheet correto no mobile (o `backdrop-filter` do topbar quebrava
  o `position: fixed` do layer).

## [0.11.0] - 2026-11-11

Décima primeira release: frontend completo (Fase 10).

### Added

- Frontend SPA em `web/` com Svelte 5 (runes), Vite 7, TypeScript strict e PWA:
  hash routing, guards de rota, cliente HTTP com cookies, bootstrap de CSRF,
  refresh *single-flight* e tradução de erros da API.
- Telas de login/cadastro, painel do mês, contas (cartão, saldo e ativação),
  transações (filtros, paginação, criação, edição, remoção, compensação e
  transferência entre contas), categorias (árvore e subcategorias) e
  configurações (perfil, preferências, sessões e sair).
- Tela de orçamentos com seleção de mês de referência, totais por moeda,
  progresso por categoria/subárvore, níveis `ok`/`warning`/`exceeded`, criação,
  edição, desativação e reativação (`DELETE` apenas desativa o orçamento).
- Tela de metas com abas por status, progresso por meta, criação, edição,
  pausa/retomada, cancelamento (`DELETE` apenas cancela) e um detalhe com
  histórico de contribuições (adicionar e remover).
- Tela de hábitos com abas de hábitos e gatilhos, check-in diário, sequência
  atual/recorde, calendário mensal, registro/remoção de logs e criação,
  edição, desativação e reativação de hábitos e gatilhos de substituição.
- Tela de investimentos com carteira consolidada por moeda, posições, criação e
  edição de ativos (moeda travada após a primeira operação), registro de
  compras, vendas, dividendos e taxas, cotações, remoção com soft delete e
  detalhe com custo médio, valor de mercado e resultado.
- Tela de conquistas com catálogo público filtrado (sem regras/parâmetros),
  progresso do usuário, resumo com pontos e percentual de coleção, abas por
  status, filtro por categoria e busca; ocultas só aparecem se desbloqueadas.
- Navegação mobile com cinco atalhos fixos e menu "Mais" em bottom sheet para
  categorias, hábitos, investimentos, conquistas, configurações.
- Tema claro/escuro com design tokens em CSS próprio, layout responsivo com
  sidebar e navegação inferior, e toast de feedback.
- PWA com manifest, ícones PNG/SVG (`192`, `512`, maskable e apple-touch) e
  precache do app shell; chamadas de API nunca são cacheadas.
- Serviço `web` no `compose.yaml` (Nginx não-root na porta `${WEB_PORT:-8080}`,
  dependente da API saudável) e `web/Dockerfile` multi-stage.
- `web/nginx.conf` com fallback do SPA, proxy de `/api`, `/health` e `/ready`,
  CSP, headers de segurança, cache de assets e `sw.js` sem cache.
- Job `Frontend` no CI (`npm ci`, `svelte-check`, build) e build da imagem do
  frontend junto do job Docker.
- `docs/FRONTEND.md` com arquitetura, rotas, fluxo de auth, PWA, URLs de
  desenvolvimento e limitações.

### Changed

- `APP_ORIGIN` do `.env.example` passa a apontar para o frontend
  (`http://localhost:5173`) e `COOKIE_SECURE` no Compose é configurável
  (`${COOKIE_SECURE:-true}`), permitindo HTTP local.
- `Makefile` ganha `web-install`, `web-dev`, `web-check` e `web-build`.
- `README.md`, `docs/PLAN.md` e `docs/DEPLOY.md` documentam o frontend e o
  deploy com API + Nginx.

### Security

- O container do frontend roda como usuário não-root e aplica CSP restritiva
  (`script-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`) e
  `X-Frame-Options: DENY`.
- Nenhum token é exposto ao JavaScript: o frontend usa apenas os cookies
  HttpOnly `vb_access`/`vb_refresh` e o `vb_csrf` para double-submit.

## [0.10.0] - 2026-11-09

Décima release: hardening e operação (Fase 9).

### Added

- Migração `009_hardening.sql` com `idx_user_sessions_expires` e o índice
  parcial `idx_event_outbox_cleanup`, que tornam a limpeza periódica barata.
- Manutenção operacional no boot e a cada 24h (`src/db/maintenance.ts`):
  remove sessões expiradas, eventos de outbox concluídos com mais de 30 dias,
  bloqueios de IP vencidos e embeddings de insights inexistentes. Nenhum dado
  de domínio do usuário é apagado; falhas são logadas sem derrubar o processo.
- `src/db/backup.ts` extrai o backup com `VACUUM INTO`; a CLI
  `deno task db:backup` passa a reutilizar o mesmo módulo testável.
- Testes de integração para manutenção, backup (snapshot consultável e
  independente) e headers de segurança/rate limit de import/export.
- Testes E2E de rede real com `Deno.serve` em porta aleatória e cliente HTTP
  com cookie jar: fluxo register → login → conta → transação → resumo →
  logout → export e detecção de reuso de refresh token.
- `compose.yaml` com build, volumes de dados/backups, healthcheck, shutdown
  gracioso e `AI_ENABLED=false` por padrão; alvos `make deploy`, `up`, `down`
  e `logs`.
- `docs/API.md` com convenções, autenticação, erros e grupos de rotas;
  `docs/DEPLOY.md` reescrito com deploy em um comando, backup agendado,
  restore testado, manutenção e checklist de produção.
- Cobertura de testes no CI, com relatório e artefato LCOV.

### Changed

- `RATE_LIMIT_DATA_MAX` (padrão 30/min por IP) limita importação e exportação,
  separado do limite rígido de autenticação.
- Tasks de teste incluem `--allow-net` para os E2E de rede real, sem
  `--allow-all`.
- `securityHeaders` adiciona `Cross-Origin-Opener-Policy`,
  `X-Permitted-Cross-Domain-Policies`, CSP `default-src 'none'` e
  `Cache-Control: no-store` nas respostas de API; `/api/docs` fica sem CSP para
  o Swagger UI funcionar.

### Security

- Respostas de API não são cacheáveis e não podem ser enquadradas ou carregar
  recursos externos.
- Limpeza periódica reduz a janela de sessões expiradas, eventos antigos,
  bloqueios vencidos e embeddings órfãos.
- CI valida formatação, lint, typecheck, versão/changelog, testes com cobertura
  e build da imagem Docker.

## [0.9.0] - 2026-11-09

Nona release: dados e colaboração (Fase 8).

### Added

- Migração `008_data.sql` com `family_links`, índices por solicitante e
  destinatário, unicidade do par não ordenado (`ux_family_links_pair`) e
  unicidade parcial de `transactions.import_hash` por conta entre transações
  vivas (`ux_transactions_import_hash`).
- Importação de extratos CSV e OFX em `POST /api/v1/import/preview` e
  `POST /api/v1/import/commit`, via `multipart/form-data` (`accountId` +
  `file`), com detecção de formato pelo conteúdo.
- Parser de CSV com separador `,` ou `;`, campos citados, valores em pt-BR ou
  internacional e cabeçalhos em português ou inglês; parser de OFX 1.x (SGML) e
  2.x (XML) por `STMTTRN`, com `FITID`, `DTPOSTED`, `TRNAMT` e `MEMO`.
- Deduplicação automática por `import_hash`: `FITID` quando presente; caso
  contrário, data + tipo + valor + descrição normalizada, sempre incluindo a
  conta. O preview marca linhas duplicadas e o commit é idempotente mesmo com
  importações concorrentes.
- Limites de importação de 1 MB e 5.000 linhas, com erros por linha sem
  interromper o arquivo; o preview devolve no máximo 500 linhas e os totais
  completos.
- Exportação em `GET /api/v1/export?format=json|csv`: JSON com todas as
  entidades do usuário em camelCase e CSV de transações não removidas com nome
  da conta e da categoria. Hashes de senha/refresh token e vetores de embedding
  ficam fora do bundle.
- Vínculos familiares em `POST /api/v1/family/invite`, `GET /api/v1/family`,
  `POST /api/v1/family/{id}/accept`, `POST /api/v1/family/{id}/reject` e
  `DELETE /api/v1/family/{id}`, com notificações para o outro lado.
- `GET /api/v1/family/summary` com apenas totais agregados do parceiro no mês
  corrente por moeda (receita, despesa, transferências, líquido e contagem) e
  contagens de contas, hábitos, logs, metas e conquistas; nenhuma transação,
  conta ou categoria individual é exposta.
- Evento `finance.transaction.imported` publicado no outbox dentro da transação
  do commit, com totais da importação e amostra limitada de IDs.
- Testes de parsers CSV/OFX, importação idempotente, exportação e vínculos
  familiares (206 testes no total).

### Changed

- `transactions` aceita `import_hash` com unicidade parcial por conta; linhas
  importadas usam `ON CONFLICT DO NOTHING`, preservando a idempotência.
- `src/app.ts` monta os módulos de importação, exportação e família; as rotas
  exigem autenticação.
- O OpenAPI ganhou as tags `Data` e `Family`.
- Recusar ou revogar um vínculo e convidar de novo reabre a mesma linha em vez
  de acumular histórico duplicado.

## [0.8.0] - 2026-11-05

Oitava release: eventos + IA (Fase 7).

### Added

- Migração `007_ai.sql` com `event_outbox`, `ai_action_logs`, `ai_insights`,
  `ai_feedback`, `embedding_items`, `ip_blocklist` e
  `ai_correlation_state`, além do opt-in `user_preferences.ai_enabled`.
- `event_outbox` transacional: os eventos nascem na mesma transação da regra de
  negócio e só são gravados quando `AI_ENABLED=true` e o usuário autorizou a IA.
- Worker do outbox com claim atômico por `UPDATE ... RETURNING`, lease,
  recuperação de eventos travados, backoff exponencial, limite de tentativas e
  dead-letter.
- Providers OpenAI-compatible e Ollama via `fetch`, com timeout por
  `AbortController` e `AI_PROVIDER` para escolher o adaptador.
- Context builders de finanças, hábitos, investimentos, segurança, recorrência
  e correlação; métricas continuam sendo calculadas em SQL.
- Parser robusto de resposta do LLM (blocos `think`, cercas markdown, prosa,
  formatos alternativos de tool call) e validação Zod.
- Redação de PII (e-mail, CPF, telefone, cartão e chaves sensíveis) antes de
  enviar contexto ao provider.
- Tool registry e executor com validação de schema, confiança mínima,
  exigência extra para ferramentas de risco alto, cooldown, deduplicação por
  argumentos e auditoria em `ai_action_logs`.
- Ferramentas de segurança (`block_ip`, `notify_admin`, `invalidate_session`),
  finanças, hábitos, investimentos e correlação.
- Módulo de insights com `GET /api/v1/insights`,
  `GET /api/v1/insights/unread-count`, `GET /api/v1/insights/search`,
  `PATCH /api/v1/insights/{id}/read`, `POST /api/v1/insights/read-all` e
  `POST /api/v1/insights/{id}/feedback`.
- Embeddings assíncronos via `embedding.requested`, `vector_init` preguiçoso,
  normalização L2 e busca semântica escopada por usuário, com fallback textual
  quando a indexação ainda não aconteceu.
- Correlação cross-domain calculada em SQL (`habit_spending_link` e
  `weekend_spending_peak`), disparada por volume de eventos processados.
- `ip_blocklist` e middleware de bloqueio aplicado às rotas de autenticação.
- Testes de parser, redação, executor, outbox/worker, opt-in e API de insights
  (185 testes no total).

### Changed

- `src/config.ts` valida `AI_PROVIDER`, modelos e dimensões obrigatórios quando
  a IA está ligada.
- `src/app.ts` monta publisher, insights e bloqueio de IP; as rotas de insights
  exigem autenticação.
- `src/main.ts` cria o runtime de IA apenas quando habilitado, inicia o worker
  após o catch-up de recorrências e o encerra no shutdown.
- Serviços de transações, transferências, hábitos, investimentos, metas,
  orçamentos, recorrências e autenticação publicam eventos no outbox.
- OpenAPI ganhou a tag `Insights`.
- README, `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`,
  `docs/PLAN.md` e `docs/erDiagram.mmd` atualizados para a Fase 7.

### Security

- IA é opt-in por usuário e desligada por padrão; sem provedor, a API continua
  funcionando e o outbox permanece vazio.
- O LLM nunca executa SQL: só pode chamar ferramentas registradas, validadas e
  auditadas; ferramentas de risco alto exigem confiança ≥ 0.9.
- Contexto enviado ao provider passa por redação de PII, inclusive no modo
  Ollama local.
- Insights, feedback e busca são sempre escopados pelo `user_id` da sessão;
  acesso cruzado retorna `NOT_FOUND`.
- Falha ao publicar evento é logada e nunca derruba a regra de negócio já
  transacionada.

## [0.7.0] - 2026-11-05

Sétima release: engajamento (Fase 6).

### Added

- Migração `006_engagement.sql` com `achievements`, `user_achievements` e
  `notifications`, com índices para avaliação por regra, progresso por usuário
  e listagem cronológica de notificações.
- Catálogo de 352 conquistas portado de `reference_only/`, com 106 regras
  únicas e 22 conquistas ocultas.
- DSL declarativa de critérios (`count`, `exists`, `sum`, `max`, `maxGroup`,
  `maxGroupDays`, `streak`, `maxGroupStreak`, `rowStreak`, `sameValueStreak`,
  `daysSince`, `ratioPredicate`, `maxRatioPredicate`, `uniform`,
  `conditional`, `allOf`, `score`, `constant`) com datasets fechados e
  validação de colunas/ordenação antes de montar o SQL.
- `criteria_params` em JSON para conquistas que compartilham a regra e variam
  um detalhe, como o dia da semana em `CONSECUTIVE_DAY_OF_WEEK`.
- `GET /api/v1/achievements`, `GET /api/v1/achievements/me` e
  `GET /api/v1/achievements/me/progress` com resumo de desbloqueadas, total e
  pontos.
- `GET /api/v1/notifications`, `GET /api/v1/notifications/unread-count`,
  `PATCH /api/v1/notifications/{id}/read` e
  `POST /api/v1/notifications/read-all`.
- Seed idempotente do catálogo por título no boot e no helper de testes.
- Avaliação preguiçosa nas leituras de conquistas e middleware pós-mutação para
  desbloquear conquistas sem acoplar a regra de negócio ao motor.
- Notificação de desbloqueio criada apenas na primeira conquista, com título
  estável para deduplicação.
- Testes de catálogo/seed, autorização, desbloqueio idempotente, escopo de
  notificações, leitura e avaliação de todas as 106 regras (137 testes no
  total).

### Changed

- `src/app.ts` monta `AchievementsRepository`/`AchievementsService` e
  `NotificationsRepository`/`NotificationsService`, protege as rotas com
  `requireAuth` e registra a avaliação pós-mutação.
- OpenAPI ganhou as tags `Achievements` e `Notifications`.
- `src/main.ts` semeia o catálogo depois das migrações.
- README, `AGENTS.md`, `docs/DECISIONS.md`, `docs/PLAN.md` e
  `docs/erDiagram.mmd` atualizados para a Fase 6.

### Security

- Conquistas e notificações são sempre escopadas pelo `user_id` da sessão;
  marcar notificação de outro usuário retorna `NOT_FOUND`.
- Nenhum SQL de critério interpola entrada de usuário: datasets, colunas e
  ordenações vêm de listas validadas por regex.
- Conquistas ocultas só aparecem depois de desbloqueadas; o catálogo público
  não expõe a regra interna nem os parâmetros de avaliação.

## [0.6.0] - 2026-11-05

Sexta release: investimentos (Fase 5).

### Added

- Migração `005_investments.sql` com `investments`, `investment_transactions` e
  `investment_quotes`, com índices, constraints de data/quantidade e unicidade
  de ticker por usuário entre ativos não removidos.
- `GET/POST /api/v1/investments`, `GET/PATCH/DELETE /api/v1/investments/{id}`.
- `GET/POST /api/v1/investments/{id}/transactions` com os tipos `buy`, `sell`,
  `dividend` e `fee`.
- `GET /api/v1/investments/portfolio` com posições e totais consolidados por
  moeda.
- `GET /api/v1/investments/{id}/performance` com custo médio ponderado, P&L
  realizado, dividendos, P&L não realizado e retorno percentual.
- `GET/POST /api/v1/investments/{id}/quotes`; a cotação mais recente valoriza a
  posição e a carteira.
- Cálculo puro de posição com quantidades fracionárias, custo médio ponderado,
  bloqueio de venda a descoberto e ordem determinística de operações no mesmo
  dia.
- Testes unitários de posição/P&L e 5 testes de integração de investimentos
  (128 testes no total).
- ADRs 018–020 sobre custo médio, cotações e imutabilidade/soft delete.

### Changed

- `src/app.ts` monta `InvestmentsRepository`/`InvestmentsService` e protege
  `/api/v1/investments` e `/api/v1/investments/*` com `requireAuth`.
- OpenAPI ganhou a tag `Investments` com todas as rotas de ativos, operações,
  cotações, carteira e performance.
- README, `AGENTS.md`, `docs/DECISIONS.md` e `docs/PLAN.md` atualizados para a
  Fase 5.

### Security

- Ativos, operações, cotações e performance são sempre escopados pelo `user_id`
  da sessão; acesso cruzado retorna `NOT_FOUND`.
- Operações exigem conta do mesmo usuário e da mesma moeda do ativo.
- Datas futuras ou anteriores à criação do ativo são rejeitadas, assim como
  venda acima da posição, inclusive quando a operação é retroativa.
- A moeda do ativo é imutável depois da primeira operação.

## [0.5.0] - 2026-11-05

Quinta release: hábitos (Fase 4).

### Added

- Migração `004_habits.sql` com `habits`, `habit_triggers` e `habit_logs`, com
  índices, constraints de agenda e unicidade `(habit_id, log_date)`.
- `GET/POST /api/v1/habits`, `GET/PATCH/DELETE /api/v1/habits/{id}` e
  `POST /api/v1/habits/{id}/reorder`.
- `POST/GET /api/v1/habits/{id}/logs` e `DELETE /api/v1/habits/{id}/logs/{logId}`,
  com upsert idempotente por dia e restauração de logs removidos.
- `GET /api/v1/habits/{id}/streak` e `GET /api/v1/habits/{id}/calendar`, com
  `?date=` opcional para avaliação determinística no passado.
- `GET/POST /api/v1/habit-triggers`, `PATCH/DELETE /api/v1/habit-triggers/{id}`.
- Hábitos bons e ruins com frequência diária, semanal ou personalizada por dias
  ISO (segunda = 1 … domingo = 7).
- Cálculo de streak que ignora dias não agendados, atravessa virada de mês e
  ano bissexto sem depender de fuso/DST e não quebra o dia corrente de um
  hábito bom antes de ele terminar.
- Calendário fechado com estados `completed`, `missed`, `pending` e
  `not_scheduled`, limitado a 366 dias.
- Empilhamento de hábitos com pai, limite de 5 níveis, detecção de ciclos e
  desativação recursiva da subárvore.
- Gatilhos de substituição que ligam um hábito ruim a um hábito bom, com soft
  delete e vínculo opcional no log (`triggerId`/`replacementUsed`).
- Utilidade de data `isoWeekday`.
- Testes unitários de streak/calendário e de `isoWeekday` e 8 testes de
  integração de hábitos (114 testes no total).
- ADRs 016–017 sobre agenda/streak e gatilhos/empilhamento.

### Changed

- `src/app.ts` monta `HabitsRepository`/`HabitsService` e protege
  `/api/v1/habits` e `/api/v1/habit-triggers` com `requireAuth`.
- Operações multi-tabela de hábitos (edição com cascata, remoção e reordenação)
  rodam em transação.
- OpenAPI ganhou a tag `Habits` com todas as rotas de hábitos, logs, streak,
  calendário e gatilhos.
- README, `AGENTS.md` e `docs/DECISIONS.md` atualizados para a Fase 4.

### Security

- Hábitos, logs e gatilhos são sempre escopados pelo `user_id` da sessão;
  acesso cruzado retorna `NOT_FOUND`.
- Registros futuros ou anteriores à criação do hábito são rejeitados, e o tipo
  do hábito é imutável depois que existem logs.
- A substituição de gatilho exige hábito bom ativo distinto do hábito ruim.

## [0.4.0] - 2026-11-05

Quarta release: planejamento (Fase 3).

### Added

- Migração `003_planning.sql` com `recurring_transactions`,
  `recurring_occurrences`, `budgets`, `goals` e `goal_contributions`, além da
  coluna `transactions.recurring_transaction_id`, com índices e constraints.
- `GET/POST /api/v1/recurring`, `GET/PATCH/DELETE /api/v1/recurring/{id}`,
  `GET /api/v1/recurring/upcoming` e `POST /api/v1/recurring/{id}/run-now`.
- Recorrências diárias, semanais, mensais e anuais com intervalo configurável,
  dia-alvo preservado entre meses e término por data.
- Ocorrências idempotentes por `(recurring_transaction_id, occurrence_date)`,
  com catch-up no boot e limite de 500 ocorrências por recorrência por execução.
- `GET/POST /api/v1/budgets`, `GET/PATCH/DELETE /api/v1/budgets/{id}` e
  `GET /api/v1/budgets/status`.
- Orçamentos mensais, anuais e personalizados, com consumo da subárvore inteira
  da categoria, `alert_threshold` configurável e limiares fixos 80/90/100.
- `GET/POST /api/v1/goals`, `GET/PATCH/DELETE /api/v1/goals/{id}`,
  `GET /api/v1/goals/{id}/progress`, `POST /api/v1/goals/{id}/contributions` e
  `DELETE /api/v1/goals/{id}/contributions/{contributionId}`.
- Metas com contribuições, progresso, conclusão automática ao atingir o alvo e
  reversão para `active` ao remover contribuição ou elevar o alvo.
- Utilidades de datas `addMonthsWithDay`, `addDays`, `monthBounds`,
  `yearBounds`, `daysBetween` e `dayOfMonth`.
- Testes unitários das novas utilidades de data e 6 testes de integração de
  planejamento (93 testes no total).
- ADRs 013–015 sobre ocorrências idempotentes, consumo de orçamento e
  contribuições de meta.

### Changed

- Transações passam a expor `recurringTransactionId` na API e no repositório.
- `src/app.ts` monta os módulos de recorrências, orçamentos e metas atrás de
  `requireAuth`.
- `src/main.ts` executa o catch-up de recorrências vencidas antes de aceitar
  tráfego.
- OpenAPI ganhou as tags `Recurring`, `Budgets` e `Goals`.
- README, `AGENTS.md` e `docs/DECISIONS.md` atualizados para a Fase 3.

### Security

- Recorrências, orçamentos e metas são sempre escopados pelo `user_id` da
  sessão; acesso cruzado retorna `NOT_FOUND`.
- Moeda de recorrência precisa coincidir com a da conta; moeda de meta é
  imutável após contribuições.
- Categorias de orçamento são validadas como despesa ativa do próprio usuário.

## [0.3.0] - 2026-11-05

Terceira release: finanças (Fase 2).

### Added

- Migração `002_finance.sql` com `accounts`, `credit_card_details`,
  `categories`, `transactions` e `credit_card_transactions`, com índices e
  constraints de integridade.
- `GET/POST /api/v1/accounts`, `GET/PATCH/DELETE /api/v1/accounts/{id}`,
  `GET /api/v1/accounts/{id}/balance` e
  `GET /api/v1/accounts/{id}/transactions`.
- Contas com moeda herdada da preferência do usuário, cartão de crédito com
  fechamento, vencimento, limite e limite disponível calculado.
- `GET/POST /api/v1/categories`, `GET /api/v1/categories/tree` e
  `GET/PATCH/DELETE /api/v1/categories/{id}`.
- Árvore de categorias com validação de tipo do pai, prevenção de ciclos e
  desativação recursiva da subárvore.
- `GET/POST /api/v1/transactions`, `GET/PATCH/DELETE /api/v1/transactions/{id}`,
  `POST /api/v1/transactions/{id}/clear`, `POST /api/v1/transactions/transfer`
  e `GET /api/v1/transactions/summary`.
- Transferências atômicas com duas pernas assinadas e `transfer_group_id`.
- Parcelamentos em cartão de crédito com divisão exata de centavos, datas
  ajustadas ao fim do mês e remoção do grupo inteiro.
- Resumo por moeda e categoria, excluindo transferências.
- Soft delete de transações via `deleted_at`, com remoção em cascata de
  transferências e parcelamentos.
- Filtros e paginação (`limit`/`offset`, máximo 100) no extrato.
- Testes unitários de datas de negócio e 14 testes de integração de finanças
  (82 testes no total).
- ADRs 010–012 sobre transferências, parcelamentos e imutabilidade de moeda.

### Changed

- `src/app.ts` monta os módulos de contas, categorias e transações atrás de
  `requireAuth`.
- OpenAPI ganhou as tags `Accounts`, `Categories` e `Transactions`.
- README e `AGENTS.md` atualizados para a Fase 2.

### Security

- Toda query financeira é escopada pelo `user_id` da sessão; nenhuma rota
  aceita `userId` do cliente.
- Valores monetários são inteiros em minor units e validados na borda.

## [0.2.0] - 2026-11-05

Segunda release: identidade e autenticação (Fase 1).

### Added

- `POST /api/v1/auth/register`, `/login`, `/refresh` e `/logout`.
- `GET /api/v1/auth/csrf` para bootstrap do token CSRF.
- Access token JWT HS256 em cookie `vb_access` (HttpOnly, SameSite=Lax, 15 min).
- Refresh token opaco de 32 bytes em cookie `vb_refresh` (HttpOnly, Path
  `/api/v1/auth`, 30 dias), com rotação de uso único.
- Detecção de reuso de refresh: revoga a família inteira e registra
  `auth_events.type = reuse_detected`.
- Logout revoga a sessão, limpa cookies e invalida o access token de imediato.
- CSRF double-submit (`vb_csrf` + `X-CSRF-Token`) e validação de
  `Origin`/`Sec-Fetch-Site`.
- Rate limit de janela deslizante por IP e por e-mail, com headers
  `X-RateLimit-*` e `Retry-After`.
- Hash Argon2id com parâmetros configuráveis e hash fictício para e-mails
  inexistentes (tempo de resposta uniforme).
- `GET/PATCH /api/v1/me`, `PATCH /api/v1/me/preferences`,
  `GET /api/v1/me/sessions` e `DELETE /api/v1/me/sessions/{id}`.
- Auditoria em `auth_events` para login, falha, refresh, logout e reuso.
- Security scheme `cookieAuth` no OpenAPI e rotas protegidas documentadas.
- Testes unitários de JWT, tokens e rate limiter; testes HTTP do fluxo
  completo de autenticação (62 testes no total).

### Changed

- `RATE_LIMIT_AUTH_MAX` e `RATE_LIMIT_WINDOW` adicionados à configuração.
- README e `AGENTS.md` atualizados para a Fase 1.

### Security

- Cookies `Secure` em produção e `SameSite=Lax` em todos os ambientes.
- Respostas de login não revelam se o e-mail existe.
- Rotas mutáveis exigem CSRF mesmo para clientes não-browser.

## [0.1.0] - 2026-11-05

Primeira release: fundação da API (Fase 0).

### Added

- Bootstrap Deno 2.9 + TypeScript strict + Hono 4 + Zod 4 + `@hono/zod-openapi`.
- Configuração de ambiente validada com Zod em `src/config.ts`, única leitora de
  `Deno.env`; falha no boot em caso de valores inválidos e exige `JWT_SECRET` em
  produção.
- Logger JSON com redação de senhas, tokens, cookies e chaves de API.
- Taxonomia de erros (`AppError`) e envelope de erro
  `{ error: { code, message, details?, requestId } }`.
- Middlewares de `X-Request-Id`, log de requisição, limite de corpo (1 MB),
  headers de segurança e CORS restrito a `APP_ORIGIN`.
- Conexão SQLite com `better-sqlite3`, pragmas (`foreign_keys`, `busy_timeout`,
  `synchronous`, WAL) e transações.
- Integração com `sqlite-vector`, com resolução do binário em três níveis
  (`VECTOR_EXTENSION_PATH`, pacote npm da plataforma, fallback em `bin/`).
- Runner de migrações forward-only com checksum SHA-256, transação por migração
  e detecção de checksum divergente.
- Migração `001_core.sql`: perfis, credenciais, preferências, sessões e eventos
  de autenticação.
- Factory `createApp({ db, config, logger })` sem singleton global e sem efeitos
  colaterais de I/O.
- Rotas `GET /health`, `GET /ready`, `GET /api/v1/openapi.json` (OpenAPI 3.1) e
  `GET /api/docs` (Swagger UI).
- CLIs `db:migrate`, `db:reset` e `db:backup` (`VACUUM INTO`).
- Encerramento gracioso em `SIGINT`/`SIGTERM`, com checkpoint do WAL.
- Suíte de testes (unitários e de integração) com SQLite real em diretório
  temporário.
- Dockerfile multi-stage, não-root, com volume `/app/data` e healthcheck;
  `.dockerignore` e workflow de CI.
- Documentação: `README.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md` e
  `docs/DEPLOY.md`.
- Binários do `sqlite-vector` 1.2.0 para Linux (x86_64/arm64, glibc/musl),
  com licença Apache-2.0.

### Changed

- Projeto reescrito do zero a partir de `reference_only/` (somente leitura),
  preservando o domínio e corrigindo as dívidas técnicas do legado.
- Dinheiro passa a usar inteiro de menor unidade (`amount_minor`) +
  `currency_code`, em vez de `REAL`.
- Banco injetado por dependência, substituindo o singleton `getDb()`.
- Importações de Hono unificadas em `npm:hono` para evitar duplicidade de tipos
  com `@hono/zod-openapi`.

### Security

- Cookies `HttpOnly`/`SameSite=Lax` e rotação de refresh com detecção de reuso
  ficam preparados no schema para a Fase 1.
- Nenhum segredo possui valor padrão em produção; em desenvolvimento um segredo
  efêmero é gerado no boot com aviso explícito.
- Erros 5xx não expõem stack trace nem detalhes internos.

<!--
Ao definir o repositório remoto, adicione os links de comparação:

[Unreleased]: https://github.com/ORG/REPO/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ORG/REPO/releases/tag/v0.1.0
-->
