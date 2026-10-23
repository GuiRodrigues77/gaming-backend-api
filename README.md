# Gaming Backend API — Distributed Wagering Processor

Serviço financeiro distribuído que processa transações de apostas (`BET`, `WIN`, `LOSS`, `REFUND`, `ROLLBACK`) vindas de múltiplos provedores de jogos, por **HTTP** e por **AWS SQS**.

O sistema permanece correto quando as mensagens são **duplicadas**, chegam **fora de ordem** ou são processadas **simultaneamente** por várias instâncias. As garantias principais (saldo nunca negativo, ledger imutável, saldo igual ao ledger, idempotência persistente) são aplicadas **no schema do PostgreSQL**, não só no código.

> As decisões de arquitetura, os trade-offs e as limitações conhecidas estão em [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## Stack

| Item | Escolha |
| --- | --- |
| Runtime, gerenciador de pacotes e test runner | Bun 1.x |
| Linguagem | TypeScript em modo estrito (`"strict": true`) |
| Framework | NestJS |
| Banco | PostgreSQL 16 |
| ORM | MikroORM (`EntitySchema`, `EntityManager.transactional()`, `LockMode`) |
| Dinheiro | `decimal.js` (string decimal com 2 casas; nunca `number`) |
| Mensageria | AWS SQS (FIFO) emulada pelo **MiniStack** |
| Métricas | `prom-client` (formato Prometheus) |
| Orquestração local | Docker Compose |

## Pré-requisitos

- [Bun](https://bun.sh) 1.x
- Docker com Docker Compose (o Docker precisa estar **aberto** antes de subir o ambiente)

## Como rodar

```bash
# 1. dependências
bun install

# 2. infraestrutura: PostgreSQL, MiniStack (SQS) e criação das filas
docker compose up -d

# 3. migrations (versionadas e reversíveis)
bunx mikro-orm migration:up

# 4. aplicação (SQS_ENDPOINT aponta para o emulador local)
SQS_ENDPOINT=http://localhost:4566 bun run start:dev
```

No **cmd do Windows** (sem espaço antes do `&&`):

```bat
set SQS_ENDPOINT=http://localhost:4566&& bun run start:dev
```

A API sobe em `http://localhost:3000` (variável `PORT`). A documentação Swagger fica em `http://localhost:3000/api`.

O `docker compose up -d` sobe três serviços:

| Serviço | Função |
| --- | --- |
| `postgres` | PostgreSQL 16 (`gaming_db`, porta 5432, volume `postgres_data`) |
| `ministack` | Emulador de AWS (SQS) na porta 4566, sem conta nem token |
| `sqs-init` | Roda uma vez e cria `wager-transactions.fifo`, `wager-transactions-dlq.fifo` (redrive após 5 recebimentos) e `wager-events.fifo` |

A conexão com o PostgreSQL usa os mesmos valores do `docker-compose.yml` (veja `mikro-orm.config.ts`).

Para desfazer a última migration: `bunx mikro-orm migration:down`.

### Variáveis de ambiente

| Variável | Padrão | Função |
| --- | --- | --- |
| `PORT` | `3000` | Porta HTTP |
| `SQS_ENDPOINT` | _(vazio)_ | Endpoint do emulador (`http://localhost:4566`). Vazio usa a AWS real e a cadeia padrão de credenciais |
| `AWS_REGION` | `us-east-1` | Região do SQS |
| `SQS_WAGER_QUEUE_NAME` | `wager-transactions.fifo` | Fila de **entrada** (pedidos de transação) |
| `SQS_WAGER_DLQ_NAME` | `wager-transactions-dlq.fifo` | DLQ da fila de entrada |
| `SQS_EVENTS_QUEUE_NAME` | `wager-events.fifo` | Fila de **saída** (eventos da outbox) |
| `WAGERING_WORKERS_ENABLED` | _(ligado)_ | `false` desliga os workers em segundo plano (outbox, consumer SQS e referências pendentes) |
| `LOG_FORMAT` | `json` | `text` usa o formato legível do Nest (útil em desenvolvimento) |

Com `SQS_ENDPOINT` definido, o cliente usa credenciais fictícias (`test`/`test`), válidas só para o emulador.

## API

Todos os erros seguem o formato `{ "statusCode", "error", "message", "details"? }`.

| Método e rota | Descrição |
| --- | --- |
| `POST /wallets` | Cria a wallet. Saldo inicial maior que zero gera a transação `OPENING` e o lançamento `CREDIT` na mesma transação SQL. Duplicada para o mesmo `playerId` e moeda: `409` |
| `GET /wallets/:walletId` | Consulta a wallet |
| `GET /wallets/:walletId/ledger?limit=50&cursor=...` | Ledger paginado, do mais novo para o mais antigo (`limit` de 1 a 100; cursor opaco e estável) |
| `POST /wallets/:walletId/reconciliation` | Compara o saldo guardado com a soma do ledger. Só reporta (log de erro e métrica), nunca corrige |
| `POST /wagering/transactions` | Submete uma transação. Header `Idempotency-Key` obrigatório; `X-Correlation-Id` opcional |
| `GET /wagering/transactions/:transactionId` | Consulta por id interno |
| `GET /providers/:providerId/wagering/transactions/:externalTransactionId` | Consulta pelo id do provedor |
| `GET /health/live` | Processo vivo |
| `GET /health/ready` | PostgreSQL e as três filas SQS alcançáveis |
| `GET /metrics` | Métricas em formato Prometheus |

Os endpoints de health e de métricas não exigem autenticação.

### Status HTTP de `POST /wagering/transactions`

| Situação | Status |
| --- | --- |
| `PROCESSED` | `200` |
| `REJECTED` (regra de negócio, com `failureCode`) | `422` |
| `PENDING` / `PENDING_REFERENCE` (aceita, processamento pendente) | `202` |
| Payload inválido | `400` |
| Conflito de idempotência | `409` |
| Falha transitória de infraestrutura | `503` com `Retry-After` |
| Erro inesperado | `500` (sem vazar detalhes) |

Reenviar a mesma operação devolve o **mesmo status** com `idempotentReplay: true`. O `GET` devolve `200` mesmo para uma transação `REJECTED`. A tabela completa e o `failureCode` de cada rejeição estão no `ARCHITECTURE.md`.

### Exemplo

```bash
curl -X POST http://localhost:3000/wallets \
  -H "Content-Type: application/json" \
  -d '{"playerId":"0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1","initialBalance":{"amount":"1000.00","currency":"BRL"}}'

curl -X POST http://localhost:3000/wagering/transactions \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: provider-a:transaction-123" \
  -d '{
    "providerId": "provider-a",
    "externalTransactionId": "transaction-123",
    "playerId": "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
    "walletId": "<ID DA WALLET CRIADA>",
    "roundId": "round-987",
    "gameId": "fortune-chimp",
    "kind": "BET",
    "money": { "amount": "25.00", "currency": "BRL" }
  }'
```

## Mensageria

**Entrada** (`wager-transactions.fifo`): o consumer lê mensagens `WagerTransactionRequested`, usa **o mesmo use case** da API HTTP e deduplica pelo inbox persistente `(consumerName, messageId)`.

```json
{
  "messageId": "msg-123",
  "type": "WagerTransactionRequested",
  "occurredAt": "2026-07-29T15:00:00.000Z",
  "data": {
    "providerId": "provider-a",
    "externalTransactionId": "transaction-123",
    "idempotencyKey": "provider-a:transaction-123",
    "playerId": "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
    "walletId": "<ID DA WALLET>",
    "roundId": "round-987",
    "gameId": "fortune-chimp",
    "kind": "BET",
    "money": { "amount": "25.00", "currency": "BRL" }
  }
}
```

Use o `walletId` como `MessageGroupId` (a FIFO preserva a ordem de cada carteira e processa carteiras diferentes em paralelo). O `ack` só acontece depois do commit; erros permanentes (mensagem malformada, conflito de payload) vão para a DLQ com o motivo nos atributos da mensagem.

**Saída** (`wager-events.fifo`): a outbox transacional publica `WagerTransactionProcessed`, `WagerTransactionRejected`, `WalletBalanceChanged` (somente quando o saldo muda) e `WagerTransactionPendingReference`. É uma fila separada da de entrada, para que o consumer nunca leia os próprios eventos.

## Testes

```bash
# unitários (não precisam de infraestrutura)
bun test

# integração com PostgreSQL real (docker compose up -d)
DATABASE_INTEGRATION=1 bun test wagering

# integração com PostgreSQL e MiniStack reais (inclui o consumer SQS)
DATABASE_INTEGRATION=1 SQS_INTEGRATION=1 bun test wagering

# 3 processos reais da aplicação compilada, com kill e reinício
bun run build
MULTI_INSTANCE_INTEGRATION=1 bun test multi-instance
```

No cmd do Windows: `set DATABASE_INTEGRATION=1&& set SQS_INTEGRATION=1&& bun test wagering`.

Os testes de integração usam PostgreSQL e SQS **reais** (sem mocks) e verificam, ao final, a invariante `saldo da wallet == saldo reconstruído pelo ledger`. O que eles cobrem:

- **Unidade:** `Money` (escala, entradas inválidas, conflito de moeda), invariantes da `Wallet`, regras de cada tipo de operação, hash de payload, máquina de estados da transação, parser e classificação de mensagens.
- **Integração:** migrations e constraints, atomicidade entre wallet, ledger, inbox e outbox, redelivery, publishers concorrentes, retry e DLQ, crash entre commit e ack.
- **Concorrência (paralelismo real):** a mesma aposta 50 vezes em paralelo gera um único débito; saldo 100 com duas apostas de 80 gera um `PROCESSED` e um `REJECTED`; wallets distintas em paralelo; vários workers e consumers sobre a mesma wallet; `REFUND` e `ROLLBACK` antes da referência.

O teste com 3 processos exige `bun run build` antes, porque sobe `dist/main.js` três vezes (portas 3101 a 3103) contra o mesmo banco e as mesmas filas.

## Observabilidade

- **Logs:** uma linha JSON por evento, com `correlationId`, `messageId`, `transactionId`, `walletId` e `providerId` quando existem. Nenhum log contém valores financeiros nem o payload completo.
- **Métricas** (`GET /metrics`): `wagering_transactions_total{status,kind}`, `wagering_duplicates_total{reason}`, `wagering_retries_total{component}`, `wagering_dlq_messages_total{reason}`, `wagering_lock_conflicts_total{type}`, `wagering_wallet_lock_wait_seconds`, `wagering_transaction_processing_seconds{outcome}`, `wagering_pending_reference_resolutions_total{outcome}`, `wagering_outbox_pending_messages` e `wagering_outbox_oldest_pending_age_seconds` (o lag da outbox). Cada instância expõe as suas; o coletor soma.
- **Health:** `/health/live` e `/health/ready`, separados.

## Estrutura

```
src/
  wagering/
    domain/            Money, Wallet, ledger, transação, eventos, outbox e inbox (sem framework)
    application/       use cases, portas (ports/) e regras de decisão (ack, retry, DLQ)
    infrastructure/
      persistence/     adaptadores MikroORM (records, mappers, unit of work)
      messaging/       adaptadores SQS (publisher, fila de entrada)
      workers/         outbox, consumer SQS e referências pendentes
      observability/   logger JSON e métricas Prometheus
    interface/http/    controllers, DTOs, filtro de erros e health
    testing/           helpers dos testes de integração
  migrations/          migrations MikroORM
docker-compose.yml     PostgreSQL, MiniStack e criação das filas
```

Os módulos `users`, `games` e `game-sessions` são anteriores ao desafio e não fazem parte do processador de apostas.

## Solução de problemas

- **`unable to get image`/erro de pipe no Docker:** o Docker Desktop não está aberto.
- **Eventos não saem ou `/health/ready` retorna 503:** confirme `SQS_ENDPOINT=http://localhost:4566` e que `docker compose logs sqs-init` termina com `filas prontas`.
- **Recriar as filas:** `docker compose run --rm sqs-init` (é idempotente).
- **`Trying to persist not discovered entity` ao rodar `bun dist/main.js` direto:** rode a aplicação pelos scripts do `package.json` (ou `node dist/main.js`). O teste com 3 processos também exige o Node no PATH.