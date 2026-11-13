# Decisões de arquitetura (ADRs curtos)

O plano canônico, com o racional completo, está em [`PLAN.md`](PLAN.md).

## ADR-001 — Dinheiro em inteiro de menor unidade

**Decisão:** `amount_minor INTEGER` + `currency_code TEXT`. **Motivo:** `REAL` introduz erro de
ponto flutuante em somas financeiras. **Consequência:** toda conversão para exibição acontece na
borda.

## ADR-002 — SQL puro + repositórios tipados

**Decisão:** sem ORM. **Motivo:** controle explícito de índices, transações e queries escopadas por
usuário; menos mágica em um domínio financeiro. **Consequência:** mapeamento manual `snake_case` ↔
`camelCase`.

## ADR-003 — Injeção de dependências em vez de singleton

**Decisão:** `createApp({ db, config, logger })`. **Motivo:** testes isolados e ausência de estado
global. **Consequência:** nenhum módulo pode importar um `getDb()`.

## ADR-004 — Migrações forward-only com checksum

**Decisão:** migrações numeradas, imutáveis, com checksum e transação. **Motivo:** evitar drift
entre ambientes e detectar edição de migração aplicada. **Consequência:** mudanças destrutivas
exigem expand/contract e MAJOR.

## ADR-005 — API versionada com envelope

**Decisão:** `/api/v1`, sucesso `{ data, meta }`, erro `{ error }`, OpenAPI 3.1. **Motivo:**
contrato explícito e evolução sem quebrar clientes. **Consequência:** remoção/renomeação exige
`/api/v2`.

## ADR-006 — Outbox transacional para eventos de IA

**Decisão:** gravar eventos em `event_outbox` na mesma transação do domínio. **Motivo:** eventos
fire-and-forget podem ser perdidos. **Consequência:** worker com claim/lease, backoff e dead-letter.

## ADR-007 — Refresh token opaco rotativo com detecção de reuso

**Decisão:** access JWT curto + refresh opaco de uso único; reuso revoga a família inteira.
**Motivo:** limitar o impacto de vazamento de refresh token. **Consequência:** tabela
`user_sessions` com `token_family_id` e `rotated_from`.

## ADR-008 — sqlite-vector com fallback embutido

**Decisão:** carregar a extensão via `VECTOR_EXTENSION_PATH`, pacote npm da plataforma ou binário em
`bin/sqlite-vector/`. **Motivo:** o Deno nem sempre instala as dependências opcionais por
plataforma; o Docker precisa funcionar de forma reprodutível. **Consequência:** binários versionados
no repositório (Apache-2.0).

## ADR-009 — IA opt-in e desligada por padrão

**Decisão:** `AI_ENABLED=false`; nenhuma chamada externa sem configuração e consentimento.
**Motivo:** dados financeiros são sensíveis. **Consequência:** a API funciona normalmente sem
worker/provider.

## ADR-010 — Transferências como duas pernas assinadas

**Decisão:** cada transferência gera duas linhas em `transactions` com `type = 'transfer'` e o mesmo
`transfer_group_id`; a saída é negativa e a entrada positiva. **Motivo:** o saldo da conta passa a
ser a soma direta de `amount_minor`, sem precisar de junções ou casos especiais por tipo.
**Consequência:** resumos ignoram `type = 'transfer'` para não inflar receitas e despesas;
editar/remover uma perna afeta o grupo inteiro.

## ADR-011 — Parcelamentos agrupados e divisão determinística

**Decisão:** um parcelamento cria N transações ligadas por
`credit_card_transactions.installment_group_id`; os centavos restantes vão para as primeiras
parcelas e cada data é `addMonthsClamped` a partir da primeira. **Motivo:** manter o total exato em
centavos e evitar datas inválidas como 31 de fevereiro. **Consequência:** parcelas não podem ter
valor/data editados individualmente; remover uma parcela remove o grupo inteiro (soft delete).

## ADR-012 — Moeda da conta imutável após a primeira transação

**Decisão:** `currency_code` da conta pode ser alterado apenas enquanto não existirem transações.
**Motivo:** misturar moedas no mesmo livro-razão quebraria somas e resumos. **Consequência:**
transferências entre moedas diferentes são rejeitadas nesta fase; conversão cambial fica para uma
fase futura.

## ADR-013 — Ocorrências de recorrência idempotentes

**Decisão:** cada materialização grava uma transação e uma linha em `recurring_occurrences`, com
unique em `(recurring_transaction_id, occurrence_date)`; a transação usa o mesmo `db.transaction`.
**Motivo:** catch-up no boot, `run-now` e reprocessamentos não podem duplicar lançamentos.
**Consequência:** o avanço de `next_occurrence` é monotônico e o catch-up é limitado a 500
ocorrências por recorrência em cada execução.

## ADR-014 — Orçamento soma a subárvore da categoria

**Decisão:** o consumo usa CTE recursiva sobre as categorias filhas; o nível combina o
`alert_threshold` configurável com os limiares fixos 80/90/100. **Motivo:** orçamentos de categoria
pai precisam cobrir gastos lançados nas filhas, e os alertas devem ser previsíveis para a UI.
**Consequência:** mover uma transação para outra subárvore altera o consumo; categorias de
receita/transferência não são aceitas em orçamentos.

## ADR-015 — Contribuições de meta com soft delete e status automático

**Decisão:** contribuições são registradas em `goal_contributions` e removidas com `deleted_at`; o
status vira `completed` ao atingir o alvo e volta a `active` quando o total cai abaixo dele.
**Motivo:** preservar histórico e evitar que uma remoção acidental apague dados do usuário.
**Consequência:** a moeda da meta é imutável após a primeira contribuição e `DELETE /goals/{id}`
apenas cancela a meta.

## ADR-016 — Agenda de hábitos em dias ISO e streak em UTC

**Decisão:** a agenda usa `frequency_type` (`daily`, `weekly`, `custom`) e `days_of_week` como array
JSON de dias ISO (1 = segunda … 7 = domingo). O streak é calculado sobre datas de negócio com
aritmética UTC, pulando dias não agendados e sem quebrar o dia corrente de um hábito bom.
**Motivo:** fusos e horário de verão não podem deslocar o dia de negócio nem quebrar streaks;
armazenar dias em JSON mantém a agenda compacta. **Consequência:** `daily` não aceita dias, `weekly`
exige exatamente um e `custom` exige ao menos um; o cálculo é puro e testável sem relógio real.

## ADR-017 — Gatilhos de substituição com soft delete

**Decisão:** `habit_triggers` liga um hábito ruim a um hábito bom de substituição e é removido com
`deleted_at`; desativar uma subárvore de hábitos remove em cascata os gatilhos relacionados.
**Motivo:** preservar histórico de recaídas e substituições sem expor gatilhos de hábitos inativos.
**Consequência:** o hábito ruim é imutável no update do gatilho e a substituição precisa ser um
hábito bom ativo distinto.

## ADR-018 — Custo médio ponderado com dinheiro inteiro

**Decisão:** `investment_transactions.quantity` é `REAL` (ativos fracionários), mas preços, taxas e
todos os totais monetários são inteiros em minor units. O custo médio é ponderado: compras somam
preço + taxas à base de custo, vendas removem a fração proporcional e realizam
`bruto - taxas - custo removido`. **Motivo:** o domínio permite frações de ação/cripto, mas usar
float para dinheiro reintroduziria o erro de arredondamento que a reescrita eliminou.
**Consequência:** o cálculo é uma função pura (`investments.performance.ts`), testável sem banco, e
qualquer venda acima da posição é rejeitada antes do insert.

## ADR-019 — Cotação explícita e carteira parcialmente avaliada

**Decisão:** `investment_quotes` guarda o histórico de preços e a cotação mais recente (por
`quoted_at`, `created_at`, `rowid`) valoriza a posição. O P&L não realizado e o valor de mercado são
`null` enquanto não houver cotação. **Motivo:** a API não depende de um provedor de mercado nesta
fase; o usuário pode registrar cotações manualmente e a UI distingue posição sem preço.
**Consequência:** `GET /investments/portfolio` soma apenas posições valorizadas e marca
`valuationComplete = false` quando existe posição aberta sem cotação.

## ADR-020 — Moeda imutável e soft delete do ativo

**Decisão:** a moeda do ativo é imutável depois da primeira operação e o ativo é removido com
`deleted_at`; o ticker é único por usuário apenas entre ativos vivos (case-insensitive). **Motivo:**
misturar moedas na mesma posição quebraria custo médio e P&L, e apagar operações destruiria
histórico do usuário. **Consequência:** recadastrar um ticker removido é permitido, mas as operações
antigas continuam preservadas e escopadas ao usuário; a conta usada em uma operação precisa
pertencer ao usuário e ter a mesma moeda do ativo.

## ADR-021 — Critérios de conquista em DSL declarativa

**Decisão:** cada conquista referencia uma regra do catálogo declarativo (`criteria_rule`) e
parâmetros JSON (`criteria_params`). A DSL cobre contagem, existência, soma, máximo, grupos,
streaks, intervalos e condições compostas; datasets, colunas e ordenações vêm de listas fechadas e
são validados por regex antes de entrar no SQL. **Motivo:** substituir dezenas de avaliadores
bespoke por um motor único, testável e auditável, mantendo as 106 regras legadas sem SQL solto no
service. **Consequência:** adicionar uma métrica exige uma nova primitiva na DSL ou um novo dataset
— não um `SELECT` específico de conquista; parâmetros variáveis, como o dia da semana, ficam no
registro da conquista.

## ADR-022 — Avaliação preguiçosa e pós-mutação com desbloqueio idempotente

**Decisão:** o progresso é recalculado nas leituras de `/achievements/me*` e, após uma mutação
autenticada bem-sucedida, por um middleware que roda fora da transação da regra. Uma conquista já
desbloqueada não é reavaliada; o motor faz até três passadas para que conquistas de meta reajam a
desbloqueios da mesma execução. **Motivo:** o motor não pode acoplar cada service ao catálogo, nem
perder desbloqueios quando o usuário não abre a tela; a idempotência evita notificações duplicadas e
mantém `unlocked_at` estável. **Consequência:** falhas na avaliação são logadas e não quebram a
mutação já respondida; `user_achievements (user_id, achievement_id)` é a barreira final contra
duplicidade.

## ADR-023 — Notificações escopadas e deduplicadas por título

**Decisão:** notificações são gravadas com `user_id` da sessão, categoria e severidade fechadas; o
desbloqueio usa o título estável `Conquista desbloqueada: <título>` para não notificar duas vezes.
Toda leitura ou escrita é filtrada por `user_id`. **Motivo:** notificações são dados privados e o
motor pode rodar repetidamente; escopo e chave natural eliminam vazamento entre usuários e ruído.
**Consequência:** notificação de outro usuário responde `NOT_FOUND`, e a contagem de não lidas e o
`read-all` nunca atravessam o escopo da sessão.

## ADR-024 — Claim do outbox por `UPDATE ... RETURNING`

**Decisão:** o worker reivindica um evento com um único `UPDATE event_outbox ... RETURNING *`,
incrementando `attempts` no próprio claim, em vez de abrir uma transação explícita com
`BEGIN IMMEDIATE`. **Motivo:** o `UPDATE` é atômico no SQLite e evita uma transação extra por
evento; incrementar no claim também impede que duas instâncias processem o mesmo evento após um
lease expirado. **Consequência:** o limite de tentativas é `AI_MAX_RETRIES + 1`; eventos travados
são recuperados por `locked_at` antes de cada ciclo e vão direto para dead-letter quando as
tentativas já acabaram.

## ADR-025 — Provider abstrato e executor de tools síncrono

**Decisão:** o processor conhece apenas a interface `AiProvider` (OpenAI-compatible ou Ollama). As
tools podem devolver `AiToolResult` de forma síncrona ou `Promise`, já que a maioria só grava
notificação/insight. **Motivo:** um provider fake determinístico permite testar o pipeline sem rede,
e tornar toda tool `async` artificialmente só adicionaria ruído. **Consequência:** o executor
continua sendo assíncrono por causa do provider, mas uma tool síncrona não precisa de `await`; o
adaptador escolhido é definido por `AI_PROVIDER`.

## ADR-026 — LLM sem SQL, com whitelist de tools e redação de PII

**Decisão:** o modelo só pode sugerir chamadas para ferramentas registradas; o executor valida
schema, confiança, cooldown, duplicidade e risco antes de executar, e audita tudo em
`ai_action_logs`. Ferramentas de risco alto exigem confiança ≥ 0.9. Todo contexto passa por redação
de PII antes de sair para o provider. **Motivo:** o LLM não é confiável para executar SQL ou decidir
sozinho sobre dados financeiros; a whitelist limita o dano de uma resposta malformada ou maliciosa.
**Consequência:** nomes desconhecidos são apenas auditados e ignorados; nenhum texto do modelo entra
em uma query.

## ADR-027 — Embeddings assíncronos com fallback textual

**Decisão:** a indexação é enfileirada como `embedding.requested` e processada pelo worker;
`vector_init` acontece de forma preguiçosa na primeira conexão com IA habilitada. A busca usa
similaridade vetorial escopada por usuário e cai para `LIKE` em título/mensagem quando não há
embedding. **Motivo:** gerar embeddings no caminho HTTP aumentaria a latência e falharia quando o
provider estivesse indisponível; o fallback mantém a busca útil durante a indexação inicial.
**Consequência:** um insight recém-criado pode aparecer pela busca textual antes de estar
vetorizado; trocar o modelo exige reindexação.

## ADR-028 — Correlação determinística disparada por volume

**Decisão:** padrões cross-domain (`habit_spending_link` e `weekend_spending_peak`) são calculados
em SQL a partir de janelas de 30 dias. O scheduler só enfileira `correlation.check` quando o número
de eventos concluídos desde a última execução atinge `AI_CORRELATION_THRESHOLD`, e marca a execução
mesmo quando não encontra padrão. **Motivo:** avaliar todos os dados a cada transação seria caro e
geraria ruído; o LLM deve apenas resumir números já calculados. **Consequência:** a correlação é
eventual e por volume, não em tempo real; um usuário com pouco movimento pode demorar a receber o
primeiro insight.

## ADR-029 — Dedupe de importação por hash escopado na conta

**Decisão:** cada linha importada recebe um `import_hash` SHA-256. Quando o arquivo traz `FITID`, a
chave é `external|accountId|FITID`; sem ele, é
`content|accountId|data|tipo|valor|descrição normalizada`. A conta sempre entra na chave e
`transactions.import_hash` tem unicidade parcial por conta entre linhas vivas. **Motivo:** o `FITID`
é a identidade oficial do OFX, mas arquivos CSV nem sempre trazem um; o fallback por conteúdo mantém
a importação útil. Incluir a conta evita que o mesmo extrato em duas contas seja tratado como
duplicado. **Consequência:** duas linhas legitimamente idênticas no mesmo arquivo/Conta (dois cafés
no mesmo dia e valor) são deduplicadas; o usuário pode lançar a segunda manualmente. Reimportar o
mesmo arquivo não cria nada.

## ADR-030 — Preview e commit com o mesmo parser e commit idempotente

**Decisão:** `POST /import/preview` e `POST /import/commit` compartilham o mesmo parser e a mesma
função de hash. O commit grava com `INSERT ... ON CONFLICT DO NOTHING`, dentro de uma transação, e
publica `finance.transaction.imported` no outbox na mesma transação. **Motivo:** duplicar a lógica
de parsing faria o preview divergir do commit; o `ON CONFLICT` garante idempotência mesmo se dois
commits concorrentes passarem pela checagem prévia. **Consequência:** o commit pode reportar
`skipped` maior que o preview; o preview limita a 500 linhas por resposta, mas os totais sempre
cobrem o arquivo inteiro.

## ADR-031 — Exportação com JSON completo e CSV de transações

**Decisão:** `GET /export?format=json` devolve todas as entidades do usuário em camelCase;
`format=csv` exporta apenas transações vivas com nome da conta e da categoria. Hashes de
senha/refresh token e vetores de embedding nunca são incluídos. **Motivo:** JSON é o formato de
portabilidade e backup; CSV é o formato que planilhas e outros apps de finanças consomem. Segredos
não pertencem ao bundle do usuário. **Consequência:** o JSON pode ser grande para usuários antigos;
uma futura exportação parcial exige novo parâmetro, não mudança no formato padrão.

## ADR-032 — Vínculo familiar como par único e resumo agregado

**Decisão:** `family_links` guarda um único registro por par não ordenado (`ux_family_links_pair`) e
um usuário só pode ter um vínculo pendente ou ativo por vez. Recusar ou revogar e convidar de novo
reabre a mesma linha. O resumo do parceiro expõe apenas totais do mês corrente por moeda e contagens
agregadas. **Motivo:** histórico duplicado de convites não agrega valor e complica a listagem;
compartilhar transações individuais seria uma exposição de dados maior do que o caso de uso pede.
**Consequência:** não é possível manter vínculos com várias pessoas ao mesmo tempo; se isso for
necessário, a unicidade precisa migrar para `(user_id, partner_id)` com uma nova regra de negócio.

## ADR-033 — Manutenção apaga só dados operacionais

**Decisão:** um job em processo roda no boot e a cada 24h e remove apenas sessões expiradas, eventos
de outbox concluídos com mais de 30 dias, bloqueios de IP vencidos e embeddings cujo insight de
origem não existe. Dados de domínio do usuário nunca são apagados. A migração `009_hardening.sql`
adiciona um índice por `expires_at` e um índice parcial de limpeza do outbox. **Motivo:** sessões e
eventos terminais crescem para sempre em uma instância SQLite única; sem limpeza, o banco e os
índices degradam. Apagar dados de domínio violaria a regra de soft delete. **Consequência:** o job é
best-effort: falha é logada e a próxima execução tenta de novo. A retenção de eventos é uma
constante de código; se auditoria exigir mais, ela precisa ser configurável e documentada.

## ADR-034 — Deploy em um comando com Compose e backup por `VACUUM INTO`

**Decisão:** a raiz ganha `compose.yaml` com build, volumes de dados e backups, healthcheck,
shutdown gracioso e segredos vindos do ambiente. O backup é feito por `VACUUM INTO` em um módulo
compartilhado entre a CLI e os testes. O CI roda testes com cobertura, publica LCOV e builda a
imagem. **Motivo:** o deploy manual dependia de uma sequência longa de comandos e o backup por cópia
de arquivo é inconsistente com WAL ativo. **Consequência:** o host precisa de Docker Compose v2; o
SQLite continua single-writer, então o deploy assume uma instância. Restore exige parar a stack e
remover `-wal`/`-shm`.

## ADR-035 — Worker do EIE como processo independente

**Decisão:** o consumidor do outbox sai da API e vira o entry point `src/worker/main.ts`
(`deno task worker`). API e worker são processos separados que compartilham apenas o arquivo SQLite;
a API continua dona do schema e o worker falha no boot (`assertSchemaCurrent`) se houver migração
pendente ou checksum divergente. A outbox ganha lease explícito com token, estado terminal
`dead_letter` e replay manual auditado (`deno task outbox:replay`). As configurações novas
`WORKER_*` têm fallback para `AI_*`.

**Motivo:** um provider lento ou um loop de retry não deve bloquear requisições HTTP nem exigir
restart da API. O lease com token protege contra duas instâncias confirmando o mesmo evento, e o
replay auditado substitui a intervenção manual direto no banco. Manter `src/main.ts` como entry
point da API (em vez de mover para `src/api/main.ts`) evita reestruturar um repositório grande só
para acomodar a separação.

**Consequência:** o deploy precisa de um segundo processo (`profiles: ["ai"]` no Compose) apontando
para o mesmo volume. A entrega continua sendo pelo menos uma vez: handlers precisam ser idempotentes
(daí o `dedupe_key` em insights e notificações). O worker não abandona o status `failed` legado de
imediato — `010_worker.sql` mantém o valor no CHECK para permitir rollback de imagem — mas nenhum
código novo o produz. SQLite continua single-writer: o worker não é uma forma de escalar escrita
horizontalmente, apenas de isolar o consumo da IA.

## ADR-036 — Idempotência só depois da autenticação

**Decisão:** o middleware de idempotência é registrado por grupo autenticado, sempre depois do
`requireAuth`, e nunca em `/api/v1/*` global. Rotas públicas de autenticação (register, login,
logout, refresh) não participam da idempotência; CSRF, Origin e rate limit continuam valendo. Os
padrões usam apenas `/*` porque no Hono `/x/*` também casa com `/x` (registrar os dois executa a
idempotência duas vezes e colide na chave primária).

**Motivo:** a idempotência precisa de `userId` para escopar a chave. Aplicada antes da autenticação,
ela rejeitava com 401 qualquer requisição pública que trouxesse `Idempotency-Key` (o cliente web
envia automaticamente).

**Consequência:** um replay de login/registro não é deduplicado — o que é o comportamento correto,
já que essas rotas não são mutações idempotentes de recursos do usuário. Qualquer grupo autenticado
novo precisa declarar seu caminho na lista compartilhada `protectedPaths` em `src/app.ts`.

## ADR-037 — Imutabilidade de tags publicadas

**Decisão:** tags Git e de imagem no formato `X.Y.Z` são imutáveis depois de publicadas. Correções
saem em um patch novo (`1.0.1`, `1.0.2`, ...) com tag e build próprios; `latest` é a única tag móvel
e só avança junto com a versão mais recente.

**Motivo:** sobrescrever uma tag quebra reprodutibilidade, invalida caches de registry e impede
saber qual código está em produção. O `1.0.0` foi sobrescrito uma vez antes desta regra; o caminho
formal passou a ser o `1.0.1`.

**Consequência:** cada release exige bump no `deno.json`, seção no `CHANGELOG.md`, commit
`chore(release)`, tag anotada e push das imagens com a tag nova. Rollback aponta para uma tag antiga
intacta, nunca para um rebuild da mesma tag.

## ADR-038 — Push pela própria fila de notificações

**Decisão:** a entrega de Web Push usa a linha de `notifications` como fila, com `push_state`
(`pending|sent|skipped|failed`), `push_attempts` e claim/lease
(`push_claim_token`/`push_claim_expires_at`). Não existe evento próprio na outbox e nenhum dos
pontos que criam notificação conhece push. O worker entrega em processo próprio, independente de
`AI_ENABLED`.

**Motivo:** criar um evento por notificação exigiria mudar todos os call sites e duplicar o
registro; a notificação já é o agregado que precisa ser entregue. Claim/lease na própria tabela
dispensa transação distribuída e permite vários workers sem entrega duplicada enquanto o lease vale.

**Consequência:** a notificação pode chegar à central e falhar no push sem quebrar a transação de
negócio. `404`/`410` do serviço de push revogam a assinatura; falhas transitórias voltam para
`pending` até `PUSH_MAX_ATTEMPTS` e depois viram `failed`. O worker só roda com `AI_ENABLED` ou
`PUSH_ENABLED`; com os dois desligados ele registra `worker_disabled` e encerra.

## ADR-039 — Chaves VAPID no ambiente, nunca no banco

**Decisão:** o par VAPID é configurado por `PUSH_VAPID_PUBLIC_KEY`/ `PUSH_VAPID_PRIVATE_KEY` (JWK EC
P-256) e validado no boot; `deno task
push:keys` gera o par. A API expõe apenas o ponto público e o
worker usa o privado para assinar. Nada é persistido no SQLite.

**Motivo:** a chave privada é segredo de instalação, não dado de usuário; o banco entra em backup e
pode ser exportado, o ambiente não. A validação de boot converte um erro de configuração em falha
explícita, em vez de 401 silencioso no primeiro envio.

**Consequência:** trocar o par invalida as assinaturas existentes (o navegador renegocia ao reabrir
o app). `PUSH_ENABLED=true` exige as três variáveis juntas — chave sem sujeito produziria recusa do
serviço de push só em produção.

## ADR-040 — Background Sync híbrido e sem refresh no service worker

**Decisão:** mutações offline são gravadas em IndexedDB com `Idempotency-Key` e snapshot do CSRF.
Quando há aba aberta, o service worker apenas pede que a página reproduza a fila; sem aba, ele tenta
com o snapshot e aborta em `401`/`403`. O service worker nunca chama `/auth/refresh`.

**Motivo:** refresh é de uso único e reuso revoga a família inteira de tokens. Duas renovações
concorrentes (aba + worker) derrubariam a sessão do usuário. O service worker também não lê cookies
HttpOnly, então não consegue montar o `X-CSRF-Token` sozinho.

**Consequência:** em navegadores sem Background Sync a fila espera o próximo `online` com o app
aberto; um CSRF rotacionado sem aba aberta adia o replay em vez de arriscar a sessão. A idempotência
no servidor mantém o reenvio seguro.

## ADR-041 — Resolução de IP do cliente por peer confiável + posição fixa

**Decisão:** `X-Forwarded-For` só é lido quando o peer TCP imediato está em `TRUSTED_PROXY_CIDRS`. O
IP do cliente é o `chain.length - TRUSTED_PROXY_HOPS` (default: último item).

**Motivo:** Impede spoofing por clientes diretos e por clientes em faixas privadas compartilhadas
(Tailscale). Posição fixa não é controlável pelo atacante; walking por CIDR seria.

**Consequência:** Operadores atrás de ingress adicional (Tailscale/Umbrel) devem configurar
`TRUSTED_PROXY_HOPS=2` (ou mais) para obter o IP real por usuário. Documentado em `docs/DEPLOY.md`.

## ADR-042 — Allowlist de hosts no endpoint de push (anti-SSRF)

**Decisão:** `PUSH_ENDPOINT_HOSTS` define hosts permitidos; validação na inscrição e no dispatcher
(defesa em profundidade). Bloqueia `http:`, credenciais, IPs literais, hosts fora da lista.

**Motivo:** Qualquer usuário autenticado podia transformar o worker em scanner de rede interna.

**Consequência:** Novos provedores de push exigem atualização da allowlist via env. Subdomínios de
hosts permitidos são aceitos automaticamente (sufixo com fronteira de ponto).

## ADR-043 — CSP por rota no Nginx com herança única

**Decisão:** Um único `add_header` no bloco `server` + `map $uri $content_security_policy` no
contexto `http`. Locations proxiadas usam `proxy_hide_header` para remover headers duplicados do
upstream.

**Motivo:** CSP única quebrava Swagger UI; headers duplicados em `/api/*` e `/health`. HSTS
precisava cobrir o SPA raiz.

**Consequência:** Mudanças de CSP exigem editar o `map` no nginx.conf; não há `add_header` locais
que desativem a herança.

## ADR-044 — Fila offline escopada por usuário (IndexedDB v2)

**Decisão:** DB version 2 com `userId` por entrada, índice `byUserId`, meta store com `activeUserId`
persistido. Replay só do dono; logout limpa a fila do usuário; entradas v1 (sem dono) descartadas no
upgrade (fail-closed).

**Motivo:** Fila v1 era global — troca de conta no mesmo navegador reproduzia mutações da conta
anterior.

**Consequência:** Service worker exige `activeUserId` persistido; sem dono, não reproduz nada.
