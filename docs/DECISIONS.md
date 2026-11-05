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
