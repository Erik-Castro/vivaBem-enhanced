# Decisões de arquitetura (ADRs curtos)

O plano canônico, com o racional completo, está em [`PLAN.md`](PLAN.md).

## ADR-001 — Dinheiro em inteiro de menor unidade

**Decisão:** `amount_minor INTEGER` + `currency_code TEXT`.
**Motivo:** `REAL` introduz erro de ponto flutuante em somas financeiras.
**Consequência:** toda conversão para exibição acontece na borda.

## ADR-002 — SQL puro + repositórios tipados

**Decisão:** sem ORM.
**Motivo:** controle explícito de índices, transações e queries escopadas por
usuário; menos mágica em um domínio financeiro.
**Consequência:** mapeamento manual `snake_case` ↔ `camelCase`.

## ADR-003 — Injeção de dependências em vez de singleton

**Decisão:** `createApp({ db, config, logger })`.
**Motivo:** testes isolados e ausência de estado global.
**Consequência:** nenhum módulo pode importar um `getDb()`.

## ADR-004 — Migrações forward-only com checksum

**Decisão:** migrações numeradas, imutáveis, com checksum e transação.
**Motivo:** evitar drift entre ambientes e detectar edição de migração aplicada.
**Consequência:** mudanças destrutivas exigem expand/contract e MAJOR.

## ADR-005 — API versionada com envelope

**Decisão:** `/api/v1`, sucesso `{ data, meta }`, erro `{ error }`, OpenAPI 3.1.
**Motivo:** contrato explícito e evolução sem quebrar clientes.
**Consequência:** remoção/renomeação exige `/api/v2`.

## ADR-006 — Outbox transacional para eventos de IA

**Decisão:** gravar eventos em `event_outbox` na mesma transação do domínio.
**Motivo:** eventos fire-and-forget podem ser perdidos.
**Consequência:** worker com claim/lease, backoff e dead-letter.

## ADR-007 — Refresh token opaco rotativo com detecção de reuso

**Decisão:** access JWT curto + refresh opaco de uso único; reuso revoga a
família inteira.
**Motivo:** limitar o impacto de vazamento de refresh token.
**Consequência:** tabela `user_sessions` com `token_family_id` e `rotated_from`.

## ADR-008 — sqlite-vector com fallback embutido

**Decisão:** carregar a extensão via `VECTOR_EXTENSION_PATH`, pacote npm da
plataforma ou binário em `bin/sqlite-vector/`.
**Motivo:** o Deno nem sempre instala as dependências opcionais por plataforma;
o Docker precisa funcionar de forma reprodutível.
**Consequência:** binários versionados no repositório (Apache-2.0).

## ADR-009 — IA opt-in e desligada por padrão

**Decisão:** `AI_ENABLED=false`; nenhuma chamada externa sem configuração e
consentimento.
**Motivo:** dados financeiros são sensíveis.
**Consequência:** a API funciona normalmente sem worker/provider.

## ADR-010 — Transferências como duas pernas assinadas

**Decisão:** cada transferência gera duas linhas em `transactions` com
`type = 'transfer'` e o mesmo `transfer_group_id`; a saída é negativa e a
entrada positiva.
**Motivo:** o saldo da conta passa a ser a soma direta de `amount_minor`, sem
precisar de junções ou casos especiais por tipo.
**Consequência:** resumos ignoram `type = 'transfer'` para não inflar receitas
e despesas; editar/remover uma perna afeta o grupo inteiro.

## ADR-011 — Parcelamentos agrupados e divisão determinística

**Decisão:** um parcelamento cria N transações ligadas por
`credit_card_transactions.installment_group_id`; os centavos restantes vão para
as primeiras parcelas e cada data é `addMonthsClamped` a partir da primeira.
**Motivo:** manter o total exato em centavos e evitar datas inválidas como
31 de fevereiro.
**Consequência:** parcelas não podem ter valor/data editados individualmente;
remover uma parcela remove o grupo inteiro (soft delete).

## ADR-012 — Moeda da conta imutável após a primeira transação

**Decisão:** `currency_code` da conta pode ser alterado apenas enquanto não
existirem transações.
**Motivo:** misturar moedas no mesmo livro-razão quebraria somas e resumos.
**Consequência:** transferências entre moedas diferentes são rejeitadas nesta
fase; conversão cambial fica para uma fase futura.

## ADR-013 — Ocorrências de recorrência idempotentes

**Decisão:** cada materialização grava uma transação e uma linha em
`recurring_occurrences`, com unique em
`(recurring_transaction_id, occurrence_date)`; a transação usa o mesmo
`db.transaction`.
**Motivo:** catch-up no boot, `run-now` e reprocessamentos não podem duplicar
lançamentos.
**Consequência:** o avanço de `next_occurrence` é monotônico e o catch-up é
limitado a 500 ocorrências por recorrência em cada execução.

## ADR-014 — Orçamento soma a subárvore da categoria

**Decisão:** o consumo usa CTE recursiva sobre as categorias filhas; o nível
combina o `alert_threshold` configurável com os limiares fixos 80/90/100.
**Motivo:** orçamentos de categoria pai precisam cobrir gastos lançados nas
filhas, e os alertas devem ser previsíveis para a UI.
**Consequência:** mover uma transação para outra subárvore altera o consumo;
categorias de receita/transferência não são aceitas em orçamentos.

## ADR-015 — Contribuições de meta com soft delete e status automático

**Decisão:** contribuições são registradas em `goal_contributions` e removidas
com `deleted_at`; o status vira `completed` ao atingir o alvo e volta a
`active` quando o total cai abaixo dele.
**Motivo:** preservar histórico e evitar que uma remoção acidental apague
dados do usuário.
**Consequência:** a moeda da meta é imutável após a primeira contribuição e
`DELETE /goals/{id}` apenas cancela a meta.

## ADR-016 — Agenda de hábitos em dias ISO e streak em UTC

**Decisão:** a agenda usa `frequency_type` (`daily`, `weekly`, `custom`) e
`days_of_week` como array JSON de dias ISO (1 = segunda … 7 = domingo). O streak
é calculado sobre datas de negócio com aritmética UTC, pulando dias não
agendados e sem quebrar o dia corrente de um hábito bom.
**Motivo:** fusos e horário de verão não podem deslocar o dia de negócio nem
quebrar streaks; armazenar dias em JSON mantém a agenda compacta.
**Consequência:** `daily` não aceita dias, `weekly` exige exatamente um e
`custom` exige ao menos um; o cálculo é puro e testável sem relógio real.

## ADR-017 — Gatilhos de substituição com soft delete

**Decisão:** `habit_triggers` liga um hábito ruim a um hábito bom de
substituição e é removido com `deleted_at`; desativar uma subárvore de hábitos
remove em cascata os gatilhos relacionados.
**Motivo:** preservar histórico de recaídas e substituições sem expor gatilhos
de hábitos inativos.
**Consequência:** o hábito ruim é imutável no update do gatilho e a
substituição precisa ser um hábito bom ativo distinto.

## ADR-018 — Custo médio ponderado com dinheiro inteiro

**Decisão:** `investment_transactions.quantity` é `REAL` (ativos fracionários),
mas preços, taxas e todos os totais monetários são inteiros em minor units. O
custo médio é ponderado: compras somam preço + taxas à base de custo, vendas
removem a fração proporcional e realizam `bruto - taxas - custo removido`.
**Motivo:** o domínio permite frações de ação/cripto, mas usar float para
dinheiro reintroduziria o erro de arredondamento que a reescrita eliminou.
**Consequência:** o cálculo é uma função pura (`investments.performance.ts`),
testável sem banco, e qualquer venda acima da posição é rejeitada antes do
insert.

## ADR-019 — Cotação explícita e carteira parcialmente avaliada

**Decisão:** `investment_quotes` guarda o histórico de preços e a cotação mais
recente (por `quoted_at`, `created_at`, `rowid`) valoriza a posição. O P&L não
realizado e o valor de mercado são `null` enquanto não houver cotação.
**Motivo:** a API não depende de um provedor de mercado nesta fase; o usuário
pode registrar cotações manualmente e a UI distingue posição sem preço.
**Consequência:** `GET /investments/portfolio` soma apenas posições
valorizadas e marca `valuationComplete = false` quando existe posição aberta
sem cotação.

## ADR-020 — Moeda imutável e soft delete do ativo

**Decisão:** a moeda do ativo é imutável depois da primeira operação e o ativo
é removido com `deleted_at`; o ticker é único por usuário apenas entre ativos
vivos (case-insensitive).
**Motivo:** misturar moedas na mesma posição quebraria custo médio e P&L, e
apagar operações destruiria histórico do usuário.
**Consequência:** recadastrar um ticker removido é permitido, mas as operações
antigas continuam preservadas e escopadas ao usuário; a conta usada em uma
operação precisa pertencer ao usuário e ter a mesma moeda do ativo.
