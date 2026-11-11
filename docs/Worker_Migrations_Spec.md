# Especificação Técnica — Extração do Worker para Processo Independente

**Projeto:** Viva Bem Enhanced  
**Componente:** Event Intelligence Engine (EIE)  
**Versão da especificação:** 1.0.0  
**Status:** Proposta para implementação  
**Runtime:** Deno 2.x / TypeScript  
**Persistência:** SQLite / better-sqlite3  
**Arquitetura:** Modular Monolith com Worker independente  
**Prioridade:** Evolução arquitetural e isolamento operacional

---

# 1. Objetivo

Esta especificação define os requisitos técnicos e funcionais para extrair o Worker atualmente integrado ao processo principal da aplicação Viva Bem, transformando-o em um processo independente.

A extração deve preservar os mecanismos existentes do Event Intelligence Engine (EIE), especialmente a Transactional Outbox, o processamento de eventos, a integração com provedores de inteligência artificial, os mecanismos de retry e a persistência dos resultados.

A nova implementação deverá permitir que a API e o Worker tenham ciclos de vida independentes, compartilhando a infraestrutura de persistência sem compartilhar estado de memória.

A API continuará responsável pela recepção de requisições, validação dos contratos HTTP, execução das regras de negócio e publicação transacional de eventos.

O Worker assumirá exclusivamente a responsabilidade pelo consumo, processamento e confirmação dos eventos persistidos na Outbox.

A separação deverá permitir:

- Inicialização independente dos processos.
- Reinicialização do Worker sem interromper a API.
- Atualização e manutenção independentes.
- Recuperação de eventos após encerramento inesperado.
- Controle explícito da concorrência.
- Escalabilidade futura por replicação de Workers.
- Substituição futura da infraestrutura de persistência sem reescrever os handlers de domínio.

**Diretriz principal:** a extração não deverá introduzir uma nova arquitetura de mensageria nem substituir prematuramente o SQLite. O banco de dados continuará sendo o mecanismo de coordenação entre os processos nesta etapa.

# 2. Escopo

## 2.1. Incluído

A implementação deverá contemplar:

1. Separação do bootstrap da API e do Worker.
2. Compartilhamento controlado dos módulos de aplicação e infraestrutura.
3. Inicialização independente do processo de processamento.
4. Gerenciamento do ciclo de vida do Worker.
5. Aquisição atômica de eventos na Outbox.
6. Gerenciamento de leases e identificação do proprietário do processamento.
7. Recuperação de eventos abandonados.
8. Confirmação e liberação de eventos.
9. Política de retentativas com backoff exponencial e jitter.
10. Tratamento de falhas permanentes e Dead Letter.
11. Idempotência dos efeitos produzidos pelos handlers.
12. Encerramento gracioso.
13. Logging estruturado e métricas operacionais.
14. Testes unitários, integração, concorrência e recuperação.
15. Configuração independente por variáveis de ambiente.
16. Execução independente em Docker e ambiente de desenvolvimento.

## 2.2. Fora do escopo

Não fazem parte desta implementação:

- Migração imediata do SQLite para PostgreSQL.
- Introdução de Redis, RabbitMQ, Kafka ou outro broker.
- Implementação de microsserviços.
- Orquestração Kubernetes.
- Distribuição do banco SQLite entre máquinas.
- Implementação de múltiplos provedores de IA.
- Reescrita das regras de negócio dos módulos existentes.
- Introdução de processamento paralelo ilimitado.

Essas possibilidades devem permanecer compatíveis com os contratos arquiteturais, mas não devem aumentar a complexidade operacional da primeira implementação.

# 3. Arquitetura de destino

A arquitetura deverá separar os pontos de entrada sem duplicar regras de negócio.

```text
                     VIVA BEM
                        |
              +---------+---------+
              |                   |
           API PROCESS         WORKER PROCESS
              |                   |
           Hono / HTTP          Worker Runtime
              |                   |
         Controllers          Event Processor
              |                   |
         Application           Handlers
              |                   |
              +---------+---------+
                        |
                 SHARED DOMAIN
                  SERVICES
                        |
                 INFRASTRUCTURE
                        |
                   SQLite DB
                        |
                TRANSACTIONAL
                    OUTBOX
```

A API e o Worker serão executáveis independentes.

Ambos poderão utilizar os mesmos serviços, contratos, repositórios e componentes de infraestrutura, desde que respeitadas suas respectivas responsabilidades.

A API não deverá iniciar automaticamente o loop de processamento da Outbox.

O Worker não deverá inicializar o servidor HTTP da aplicação, carregar rotas ou assumir responsabilidades de autenticação de requisições.

A infraestrutura compartilhada deverá ser fornecida por composição de dependências, evitando singletons globais ou dependências implícitas do processo principal.

# 4. Organização dos módulos

A organização deverá respeitar a estrutura existente do projeto, evitando movimentações desnecessárias.

A seguinte disposição representa a organização lógica desejada:

```text
src/
├── api/
│   └── main.ts
│
├── worker/
│   ├── main.ts
│   ├── worker.ts
│   ├── worker-config.ts
│   ├── worker-context.ts
│   └── handlers/
│       ├── financial-insight.ts
│       ├── security-event.ts
│       └── notification.ts
│
├── application/
│   ├── events/
│   │   ├── event-processor.ts
│   │   ├── event-registry.ts
│   │   └── event-contracts.ts
│   │
│   └── ...
│
├── infrastructure/
│   ├── outbox/
│   │   ├── outbox-repository.ts
│   │   └── sqlite-outbox-repository.ts
│   │
│   ├── database/
│   └── ai/
│
└── modules/
    └── ...
```

Os nomes e a localização definitivos deverão respeitar as convenções já estabelecidas no repositório.

A extração deverá privilegiar reutilização de componentes existentes, e não duplicação ou criação de novos repositórios com responsabilidades equivalentes.

## 4.1. Entry points

Deverão existir dois pontos de entrada independentes:

**API:** responsável pelo bootstrap HTTP, configuração do servidor e registro dos middlewares e rotas.

**Worker:** responsável pelo carregamento da configuração operacional, inicialização das dependências, registro dos handlers e execução do ciclo de consumo da Outbox.

O bootstrap do Worker deverá ser independente do bootstrap HTTP.

# 5. Transactional Outbox

A Transactional Outbox continuará sendo a fonte persistente dos eventos aguardando processamento.

A publicação de um evento deverá acontecer na mesma transação SQLite que confirma a operação de domínio que o originou.

Por exemplo, ao registrar uma movimentação financeira:

1. A API valida a requisição.
2. A operação de domínio é executada.
3. O registro financeiro é persistido.
4. O evento correspondente é inserido na Outbox.
5. A transação é confirmada.
6. A API responde ao cliente.

Se a transação falhar, nem a movimentação nem o evento deverão permanecer parcialmente persistidos.

A API não deverá depender da disponibilidade do Worker para confirmar uma operação financeira.

## 5.1. Compatibilidade de schema

Antes de modificar a estrutura atual da Outbox, deverá ser realizada uma inspeção do schema existente e de todas as operações de publicação, aquisição e confirmação.

A migração deverá preservar:

- Identificadores dos eventos.
- Tipos de eventos.
- Payloads existentes.
- Histórico de tentativas.
- Dados necessários para auditoria.
- Compatibilidade com os registros ainda pendentes.

Não deverá ser criada uma segunda tabela de eventos apenas para acomodar o novo processo.

Caso sejam necessárias novas colunas, elas deverão ser introduzidas por migração incremental.

## 5.2. Estado dos eventos

A máquina de estados lógica deverá contemplar:

| Estado | Descrição |
|---|---|
| `pending` | Evento aguardando processamento |
| `processing` | Evento adquirido por um Worker |
| `completed` | Processamento confirmado |
| `dead_letter` | Evento que excedeu a política de tentativas ou apresentou falha permanente |

As transições deverão ser explícitas:

```text
pending
   |
   v
processing
   |
   +---- sucesso --------> completed
   |
   +---- erro transitório -> pending
   |
   +---- falha permanente -> dead_letter

processing
   |
   +---- lease expirado --> processamento recuperável
```

A recuperação de um lease expirado deverá permitir que o evento seja adquirido novamente sem depender de intervenção manual.

# 6. Aquisição e gerenciamento de eventos

## 6.1. Claim atômico

A aquisição de um evento deverá ser atômica.

É proibido utilizar uma sequência desprotegida de SELECT seguido de UPDATE, pois isso permitiria que dois Workers adquirissem simultaneamente o mesmo registro.

A implementação deverá utilizar uma operação atômica compatível com a versão do SQLite utilizada pelo projeto, preferencialmente `UPDATE ... RETURNING`, com controle transacional adequado.

O processo de aquisição deverá:

1. Identificar um evento pendente cujo horário de disponibilidade tenha sido atingido ou um evento cujo lease esteja expirado.
2. Atualizar seu estado para `processing`.
3. Registrar o identificador do Worker responsável.
4. Registrar o momento da aquisição.
5. Estabelecer o vencimento do lease.
6. Gerar um identificador exclusivo da concessão.
7. Incrementar o contador de tentativas.
8. Retornar os dados necessários ao processamento.

A aquisição deverá ocorrer com uma transação curta, liberando imediatamente o bloqueio de escrita antes da execução do handler.

Nenhuma chamada de IA, requisição HTTP externa ou operação demorada poderá ocorrer dentro da transação de aquisição.

## 6.2. Lease

O lease representa uma concessão temporária de processamento.

A posse do evento não deverá ser determinada exclusivamente pelo identificador do Worker.

Cada aquisição deverá possuir um token de concessão exclusivo, denominado `lease_token`.

O token deverá ser alterado sempre que um evento for adquirido novamente.

As operações de confirmação, renovação ou liberação deverão validar simultaneamente:

- Identificador do evento.
- Estado atual.
- Identificador do proprietário.
- Token da concessão.

Isso impedirá que uma instância antiga confirme um evento que já tenha sido recuperado por outra instância.

## 6.3. Renovação de lease

Eventos com execução demorada deverão permitir renovação da concessão.

O Worker deverá renovar o lease periodicamente enquanto possuir o evento e estiver executando um processamento válido.

A renovação deverá utilizar uma atualização condicional baseada no `lease_token`.

Caso a renovação não consiga atualizar o registro, o Worker deverá considerar que perdeu a posse do evento.

Nesse caso, deverá interromper o processamento sempre que tecnicamente possível e não poderá confirmar o evento utilizando uma concessão anterior.

A renovação não poderá ser tratada como substituto da idempotência.

# 7. Processamento dos eventos

O processamento deverá ocorrer fora das transações de aquisição.

O Event Processor será responsável por localizar o handler correspondente ao tipo e à versão do evento.

O registro de handlers deverá utilizar uma estrutura tipada e explícita.

Cada handler deverá declarar:

- Tipo de evento suportado.
- Versão de schema aceita.
- Validador do payload.
- Responsabilidade de processamento.
- Política de falha aplicável.
- Dependências necessárias.

O payload deverá ser validado antes de ser entregue ao handler.

Eventos desconhecidos, schemas incompatíveis ou dados inválidos deverão ser classificados como falhas permanentes quando não houver possibilidade razoável de recuperação.

Os handlers deverão evitar conhecimento sobre o mecanismo de transporte utilizado para entregar o evento.

Isso permitirá, futuramente, substituir o mecanismo de consumo sem reescrever as regras de domínio.

## 7.1. Execução determinística e IA

Os cálculos financeiros deverão permanecer sob responsabilidade dos serviços determinísticos da aplicação.

O Worker poderá construir contextos financeiros, solicitar inferências e executar ferramentas controladas, mas não deverá conceder ao modelo acesso irrestrito ao banco.

A arquitetura deverá preservar a separação:

```text
Context Builder
      |
      v
Dados determinísticos
      |
      v
AI Provider
      |
      v
Structured Output
      |
      v
Schema Validation
      |
      v
Policy Validation
      |
      v
Tool Executor
      |
      v
Persistência controlada
```

O processo não deverá confiar em parâmetros, identificadores de usuário ou permissões produzidos pelo modelo sem validação independente.

Descrições de transações, observações de hábitos e outros conteúdos fornecidos pelo usuário deverão ser tratados como dados não confiáveis.

## 7.2. Limite transacional dos handlers

Chamadas externas, inferências e operações potencialmente demoradas não deverão manter transações SQLite abertas.

Sempre que possível, o processamento deverá separar:

1. Preparação do resultado.
2. Execução externa ou inferência.
3. Validação do resultado.
4. Persistência dos efeitos.
5. Confirmação do evento.

Quando os efeitos e a confirmação puderem ser realizados na mesma transação SQLite, ambos deverão ser confirmados atomicamente.

Quando houver efeitos externos, deverão ser utilizados identificadores idempotentes e mecanismos adequados de deduplicação.

Não deverá ser afirmada semântica de execução exatamente uma vez.

O contrato operacional será de entrega pelo menos uma vez, com efeitos idempotentes.

# 8. Idempotência

Todos os handlers deverão ser desenvolvidos considerando a possibilidade de receber o mesmo evento mais de uma vez.

A idempotência deverá ser garantida na camada de persistência sempre que possível.

Exemplo: a criação de um insight deverá utilizar uma chave de deduplicação baseada no evento de origem.

Uma restrição UNIQUE no banco deverá impedir a criação de registros equivalentes em execuções repetidas.

Uma verificação prévia em código, isoladamente, não será considerada garantia suficiente contra condições de corrida.

Os efeitos externos deverão utilizar mecanismos de idempotência oferecidos pelo provedor ou uma estratégia de deduplicação persistente.

A repetição de um evento não poderá provocar:

- Insights duplicados.
- Notificações duplicadas.
- Alterações financeiras repetidas.
- Execução repetida de ações administrativas.
- Reprocessamento indevido de conquistas.

# 9. Política de falhas e retentativas

O Worker deverá distinguir erros transitórios de erros permanentes.

**Erros transitórios:**

- Indisponibilidade temporária do provedor de IA.
- Timeout de requisição.
- Falha temporária de rede.
- Bloqueio temporário de banco.
- Limite de requisições do provedor.
- Falha temporária de infraestrutura.

**Erros permanentes:**

- Tipo de evento não suportado.
- Schema incompatível sem migração disponível.
- Payload inválido.
- Violação permanente de regra de negócio.
- Operação não autorizada.
- Configuração obrigatória ausente.

Erros permanentes deverão ser direcionados à Dead Letter sem retentativas inúteis.

Erros transitórios deverão utilizar backoff exponencial com jitter.

A fórmula de referência será:

```text
delay = min(
    base_delay * 2^attempt,
    max_delay
)

final_delay = delay + random_jitter
```

Quando um provedor externo fornecer um intervalo de espera explícito, como `Retry-After`, ele deverá ser considerado pela política de retentativas.

O limite máximo de tentativas deverá ser configurável, respeitando a política existente do EIE.

Os registros de falha deverão preservar informações suficientes para diagnóstico, sem armazenar indiscriminadamente tokens, segredos, prompts ou dados financeiros pessoais.

# 10. Dead Letter e reprocessamento

Eventos que excederem o limite de tentativas deverão deixar de participar do consumo automático.

A Dead Letter deverá preservar:

- Identificador original.
- Tipo de evento.
- Payload ou referência persistida.
- Número de tentativas.
- Último erro classificado.
- Data da última execução.
- Identificação do processamento anterior.

O reprocessamento manual deverá ser uma operação explícita e auditável.

A implementação deverá considerar a diferença entre repetir uma entrega e realizar um replay intencional.

Quando um replay for solicitado, deverá ser possível rastrear a relação entre o evento original e a nova execução.

O mecanismo de replay não poderá ignorar as garantias de idempotência.

# 11. Ciclo de vida do Worker

O Worker deverá possuir um ciclo de vida independente.

As seguintes operações deverão ser suportadas:

- Inicialização.
- Execução contínua.
- Espera por novos eventos.
- Aquisição de eventos.
- Processamento.
- Recuperação de falhas.
- Encerramento gracioso.

O processo não deverá permanecer em loop ocupado quando não existirem eventos disponíveis.

O intervalo de polling deverá ser configurável.

## 11.1. Encerramento gracioso

Ao receber SIGTERM ou SIGINT, o Worker deverá:

1. Interromper novas aquisições.
2. Aguardar as tarefas em andamento por um período configurado.
3. Continuar renovando leases enquanto tarefas ainda forem consideradas válidas.
4. Encerrar recursos e conexões de forma ordenada.
5. Caso o processamento não possa terminar, interromper a execução quando possível e permitir recuperação posterior do evento.

O Worker não deverá confirmar um evento incompleto apenas para finalizar o encerramento.

## 11.2. Recuperação após encerramento inesperado

Se o processo for encerrado abruptamente, os eventos em processamento deverão permanecer recuperáveis.

A recuperação deverá ocorrer por meio da expiração do lease.

Nenhuma intervenção manual poderá ser necessária para recuperar eventos que tenham sido abandonados por uma instância encerrada.

# 12. Configuração

A configuração do Worker deverá ser independente da configuração HTTP, embora ambas possam compartilhar parâmetros de infraestrutura.

Variáveis propostas:

| Variável | Descrição | Referência inicial |
|---|---|---:|
| `WORKER_ID` | Identificador da instância | Gerado na inicialização |
| `WORKER_POLL_INTERVAL_MS` | Intervalo de polling | 1000 |
| `WORKER_LEASE_MS` | Duração inicial do lease | 60000 |
| `WORKER_HEARTBEAT_MS` | Frequência de renovação | 15000 |
| `WORKER_MAX_ATTEMPTS` | Limite de tentativas | 5 |
| `WORKER_CONCURRENCY` | Processamentos simultâneos | 1 |
| `WORKER_SHUTDOWN_GRACE_MS` | Prazo de encerramento | 30000 |

Os valores são referências iniciais, devendo ser ajustados conforme o tempo de processamento observado e as políticas atuais do EIE.

As configurações deverão ser validadas antes da inicialização.

A configuração deverá impedir combinações incoerentes, como heartbeat maior que o lease.

O sistema de configuração também deverá garantir que o processamento do Worker possa operar sem credenciais desnecessárias da API HTTP.

# 13. Persistência e concorrência SQLite

Nesta etapa, API e Worker compartilharão o mesmo arquivo SQLite, desde que executados no mesmo host e sobre um sistema de arquivos local compatível.

Cada processo deverá possuir sua própria conexão com o banco.

Não deverá existir compartilhamento de objetos de conexão ou estado de memória entre os processos.

O banco deverá preservar as configurações operacionais necessárias:

- WAL.
- Foreign keys habilitadas.
- Busy timeout.
- Transações curtas.
- Índices apropriados para consultas de aquisição e recuperação.

A aquisição deverá ocorrer em transações curtas.

As chamadas de IA e operações externas deverão ocorrer fora de transações de escrita.

A concorrência inicial do Worker deverá ser limitada a uma execução por vez.

A ampliação da concorrência dependerá de medições reais de desempenho e do comportamento das operações de escrita.

O arquivo de banco, juntamente com seus arquivos auxiliares WAL e SHM, deverá permanecer no mesmo volume persistente local.

Não deverá ser utilizado compartilhamento do arquivo SQLite entre máquinas por NFS ou mecanismo equivalente.

# 14. Segurança e isolamento

O Worker deverá operar com o princípio de privilégio mínimo.

Não deverá possuir permissões HTTP, credenciais de autenticação ou chaves de sessão que não sejam necessárias ao processamento.

Quando possível, suas permissões de rede deverão ser limitadas aos serviços utilizados, como o provedor de IA.

O Worker deverá respeitar o isolamento de dados por usuário.

Toda consulta que envolva informações pessoais ou financeiras deverá considerar o escopo de propriedade do evento e as regras de autorização correspondentes.

O `user_id` presente em um evento deverá ser validado como referência de contexto, e não como autorização automática para executar operações.

Ações administrativas, financeiras ou de impacto elevado deverão passar pelas políticas de autorização independentes do LLM.

Payloads e logs não deverão expor informações financeiras completas ou credenciais.

# 15. Observabilidade

O Worker deverá produzir logs estruturados.

Os registros deverão permitir correlacionar:

- Instância do Worker.
- Identificador do evento.
- Tipo do evento.
- Tentativa atual.
- Duração do processamento.
- Resultado.
- Classificação da falha.
- Identificador de correlação.

Métricas mínimas:

| Métrica | Finalidade |
|---|---|
| `pending_count` | Eventos aguardando processamento |
| `processing_count` | Eventos atualmente adquiridos |
| `completed_count` | Eventos concluídos |
| `dead_letter_count` | Eventos em falha definitiva |
| `oldest_pending_age` | Idade do evento pendente mais antigo |
| `processing_duration` | Tempo de processamento |
| `retry_count` | Frequência de retentativas |
| `lease_expiration_count` | Quantidade de leases expirados |

O processo deverá disponibilizar sinais suficientes para que o supervisor operacional identifique encerramentos, travamentos e ausência prolongada de progresso.

Não é obrigatório introduzir um endpoint HTTP próprio nesta etapa. Logging estruturado, heartbeat persistente quando necessário e supervisão do processo são suficientes para a primeira implantação.

# 16. Execução independente

Deverão existir comandos separados para execução da API e do Worker.

Exemplo conceitual:

```json
{
  "tasks": {
    "start": "deno run ... src/api/main.ts",
    "worker": "deno run ... src/worker/main.ts"
  }
}
```

As permissões Deno deverão ser limitadas conforme as necessidades específicas de cada processo.

O Worker deverá utilizar a mesma imagem de aplicação ou uma imagem derivada que contenha as mesmas dependências e módulos de infraestrutura necessários.

## 16.1. Docker Compose

A implantação deverá utilizar dois serviços independentes, compartilhando o mesmo volume persistente:

```yaml
services:
  api:
    build: .
    command: deno task start
    restart: unless-stopped
    volumes:
      - viva-data:/app/data

  worker:
    build: .
    command: deno task worker
    restart: unless-stopped
    environment:
      WORKER_ID: worker-01
    volumes:
      - viva-data:/app/data

volumes:
  viva-data:
```

O exemplo deverá ser adaptado aos caminhos, usuário, configuração e permissões reais da aplicação.

A aplicação deverá garantir que ambos os processos utilizem exatamente o mesmo arquivo de banco.

O Worker deverá reiniciar independentemente da API.

A disponibilidade da API não deverá depender da disponibilidade do Worker.

# 17. Plano de migração

A migração deverá ser incremental para reduzir riscos e preservar o comportamento atual.

## Fase 1 — Auditoria do Worker atual

Antes de qualquer modificação:

- Identificar o bootstrap atual do Worker.
- Localizar todos os handlers registrados.
- Mapear repositórios e dependências utilizados.
- Identificar a implementação de claim e confirmação.
- Verificar os estados atuais da Outbox.
- Identificar os mecanismos existentes de retry e recuperação.
- Mapear os pontos de acoplamento com o processo HTTP.

**Critério de conclusão:** todos os pontos de integração e responsabilidades do Worker estão documentados.

## Fase 2 — Extração das dependências

Separar a composição de dependências compartilhadas do bootstrap HTTP.

Os handlers existentes deverão ser preservados.

O Worker deverá receber as dependências necessárias por injeção de dependências.

**Critério de conclusão:** o motor de processamento pode ser inicializado sem criar um servidor HTTP.

## Fase 3 — Implementação do novo bootstrap

Criar o novo entry point do Worker.

Implementar carregamento de configurações, registro dos handlers, conexão independente ao banco, sinais de encerramento e início do loop.

**Critério de conclusão:** o Worker executa independentemente em ambiente de desenvolvimento.

## Fase 4 — Consolidação da Outbox

Implementar ou adaptar:

- Claim atômico.
- Lease e lease token.
- Renovação.
- Confirmação condicional.
- Recuperação de eventos abandonados.
- Backoff.
- Dead Letter.
- Idempotência.

**Critério de conclusão:** as operações do ciclo de vida dos eventos são seguras para múltiplos processos no mesmo banco.

## Fase 5 — Testes de integração e falhas

Executar os testes definidos nesta especificação.

**Critério de conclusão:** nenhum cenário crítico de recuperação ou concorrência apresenta perda indevida de eventos ou duplicação de efeitos.

## Fase 6 — Desacoplamento do bootstrap HTTP

Remover a inicialização do Worker do processo da API.

O processo HTTP deverá continuar publicando eventos normalmente, independentemente da execução do consumidor.

**Critério de conclusão:** API operacional com Worker parado e eventos sendo acumulados corretamente na Outbox.

## Fase 7 — Implantação e observação

Implantar os dois processos separadamente.

Monitorar backlog, tempo de processamento, erros, retries e recuperação.

**Critério de conclusão:** o Worker independente processa os eventos reais sem interromper a utilização normal da aplicação.

# 18. Estratégia de transição e rollback

Durante a migração, não deverão existir dois consumidores independentes operando com mecanismos incompatíveis de aquisição.

A transição deverá seguir:

1. Realizar backup consistente do banco.
2. Aplicar as migrações necessárias.
3. Preparar a nova versão do Worker.
4. Interromper o consumidor integrado à API.
5. Confirmar que não existem tarefas sendo executadas pelo consumidor antigo.
6. Iniciar o Worker independente.
7. Verificar o processamento dos eventos pendentes.
8. Confirmar o funcionamento dos fluxos normais da API.

A migração deverá preservar todos os eventos pendentes.

Em caso de falha, o Worker independente deverá ser interrompido antes de qualquer tentativa de reativar o consumidor antigo.

O rollback deverá utilizar uma versão do consumidor compatível com o estado atual da Outbox.

Não deverão ser realizadas operações destrutivas de migração enquanto a nova arquitetura não estiver validada.

# 19. Estratégia de testes

A implementação deverá possuir testes unitários, de integração e de recuperação.

## 19.1. Testes unitários

- Seleção correta de handlers.
- Validação de payloads.
- Classificação de erros.
- Cálculo de backoff.
- Política de tentativas.
- Geração de tokens de concessão.
- Validação das configurações.
- Tratamento de encerramento.

## 19.2. Testes de integração

- Claim de evento pendente.
- Confirmação de evento.
- Liberação para retry.
- Encaminhamento para Dead Letter.
- Renovação do lease.
- Recuperação de evento abandonado.
- Idempotência de resultados.
- Compatibilidade com migrações.
- Funcionamento com dois processos conectados ao mesmo SQLite.

## 19.3. Testes de concorrência

Deverão ser executados cenários com pelo menos dois Workers concorrentes.

Os testes deverão verificar:

- Aquisição simultânea de eventos diferentes.
- Impossibilidade de dois Workers possuírem simultaneamente uma concessão válida do mesmo evento.
- Rejeição de confirmação com lease token antigo.
- Comportamento durante expiração de lease.
- Recuperação após encerramento forçado.
- Ausência de corrupção do banco.
- Tratamento de `SQLITE_BUSY`.

## 19.4. Testes de falhas operacionais

Simular:

1. API ativa e Worker desligado.
2. Worker desligado durante inferência.
3. Ollama indisponível.
4. Timeout do provedor de IA.
5. Banco temporariamente ocupado.
6. Evento com payload inválido.
7. Encerramento por SIGTERM.
8. Encerramento forçado por SIGKILL.
9. Reinicialização do Worker.
10. Repetição do processamento de um evento já efetivado.

## 19.5. Critérios de aceitação

A migração somente será considerada concluída quando:

- A API inicializar sem iniciar o consumidor da Outbox.
- O Worker puder iniciar independentemente.
- Eventos continuarem sendo publicados durante a indisponibilidade do Worker.
- Eventos pendentes forem processados após sua inicialização.
- Eventos abandonados forem recuperados automaticamente.
- A confirmação respeitar o token de concessão.
- Efeitos dos handlers forem idempotentes.
- Nenhuma operação do LLM ocorrer dentro de uma transação SQLite de escrita.
- Dois Workers não produzirem efeitos duplicados sobre o mesmo evento.
- O encerramento gracioso respeitar o estado do processamento.
- O banco permanecer consistente após reinicializações.
- A API permanecer funcional durante a interrupção do Worker.

# 20. Padrões de implementação

A implementação deverá respeitar as convenções existentes do Viva Bem.

Requisitos:

- TypeScript strict.
- Proibição de `any` implícito.
- Tipagem explícita das interfaces públicas.
- Injeção de dependências.
- Separação entre domínio, aplicação e infraestrutura.
- Sem estado global compartilhado entre processos.
- Tratamento explícito de erros.
- JSDoc nas interfaces e funções públicas relevantes, com `@param`, `@returns`, `@throws` e `@example` quando aplicável.
- `deno fmt --check`.
- `deno lint`.
- `deno check`.
- Testes automatizados.
- Atualização do changelog.
- Atualização da documentação arquitetural.
- Migrações versionadas e reversibilidade operacional documentada.

Nenhuma dependência adicional deverá ser introduzida sem justificativa técnica.

O Worker deverá permanecer pequeno e especializado. Não deverá incorporar lógica HTTP, regras financeiras ou mecanismos de autorização que pertencem a outros módulos.

# 21. Evolução futura

A arquitetura deverá preservar a possibilidade de evolução para um ambiente distribuído.

A migração futura poderá envolver:

- PostgreSQL como persistência compartilhada.
- Workers em múltiplas máquinas.
- Aquisição utilizando `FOR UPDATE SKIP LOCKED`.
- Broker externo, quando justificado.
- Rate limiting distribuído.
- Provedores de IA executados em processos especializados.
- Concorrência configurável e escalonamento por tipo de evento.

Essa evolução deverá ocorrer sem reescrever os contratos de domínio e os handlers.

O mecanismo de consumo deverá permanecer separado dos serviços de negócio.

A extração atual não deverá presumir que a infraestrutura será distribuída imediatamente.

# 22. Definição de pronto

A extração do Worker será considerada concluída quando a aplicação operar com dois processos independentes, compartilhando a mesma persistência SQLite, sem depender do ciclo de vida um do outro.

A Outbox deverá continuar garantindo a persistência dos eventos, enquanto o Worker deverá garantir consumo recuperável, confirmação condicional e execução idempotente.

A implementação deverá demonstrar comportamento previsível diante de falhas, encerramentos inesperados, concorrência e indisponibilidade temporária dos provedores externos.

O resultado esperado é uma arquitetura na qual o processamento assíncrono seja uma unidade operacional independente, preservando a simplicidade do monólito modular e preparando o Viva Bem para uma futura evolução horizontal.

---

**Diretriz final para implementação:**

A migração deve extrair o Worker existente, não reconstruir o EIE. Preserve contratos, handlers e regras de domínio que já funcionam. Modifique somente as fronteiras necessárias para separar os processos e fortalecer as garantias de aquisição, execução, recuperação e confirmação.