# 🎮 Gaming Backend API

REST API desenvolvida com **NestJS e TypeScript** para gerenciamento de usuários, jogos e sessões de jogo.

Este projeto de portfólio tem como objetivo explorar conceitos de desenvolvimento backend, arquitetura modular, persistência de dados, relacionamentos entre entidades, validação de dados, testes automatizados e documentação de APIs.

## 🚀 Tecnologias

- **Node.js**
- **TypeScript**
- **NestJS**
- **PostgreSQL**
- **MikroORM**
- **Docker**
- **Swagger / OpenAPI**
- **class-validator**
- **Jest**
- **Git e GitHub**

## ✨ Funcionalidades

### 👤 Users

- Criar usuários
- Listar usuários
- Buscar usuário por ID
- Atualizar usuários
- Remover usuários
- Validar dados de entrada

### 🎮 Games

- Criar jogos
- Listar jogos
- Buscar jogo por ID
- Atualizar jogos
- Remover jogos
- Filtrar jogos por nome, gênero e plataforma
- Paginar resultados com parâmetros de página e limite
- Validar dados de entrada

### 🕹️ Game Sessions

- Criar sessões de jogo
- Listar sessões de jogo
- Buscar sessão por ID
- Relacionar sessões com usuários
- Relacionar sessões com jogos

## 🏗️ Arquitetura

O projeto utiliza a arquitetura modular do NestJS, organizando responsabilidades em módulos, controllers, services, DTOs e entidades.

```text
src/
├── users/
│   ├── dto/
│   ├── entities/
│   ├── users.controller.ts
│   ├── users.service.ts
│   └── users.module.ts
│
├── games/
│   ├── dto/
│   ├── entities/
│   ├── games.controller.ts
│   ├── games.service.ts
│   └── games.module.ts
│
├── game-sessions/
│   ├── dto/
│   ├── entities/
│   ├── game-sessions.controller.ts
│   ├── game-sessions.service.ts
│   └── game-sessions.module.ts
│
├── app.module.ts
└── main.ts
```

## 🔗 Relacionamentos

As sessões de jogo utilizam o MikroORM para relacionar usuários e jogos.

```text
User 1 ─────── N GameSession N ─────── 1 Game
```

Cada sessão está associada a um usuário e a um jogo.

## 🐳 Como executar o projeto

### Pré-requisitos

- Node.js e npm
- Docker Desktop

### 1. Clone o repositório

```bash
git clone https://github.com/GuiRodrigues77/gaming-backend-api.git
cd gaming-backend-api
```

### 2. Instale as dependências

```bash
npm install
```

### 3. Inicie o banco de dados

Com o Docker Desktop em execução, utilize:

```bash
docker compose up -d
```

### 4. Execute as migrations

```bash
npx mikro-orm migration:up
```

### 5. Inicie a aplicação

```bash
npm run start:dev
```

Por padrão, a API estará disponível em:

`http://localhost:3000`

> Verifique a configuração local do banco de dados antes de iniciar a aplicação.

## 📚 Documentação da API

A API possui documentação interativa com Swagger / OpenAPI.

Com a aplicação em execução, acesse:

`http://localhost:3000/api`

A documentação permite visualizar os endpoints disponíveis e testar requisições diretamente pelo navegador.

## 🔌 Endpoints

### Users

| Método | Endpoint | Descrição |
|---|---|---|
| GET | `/users` | Lista usuários |
| GET | `/users/:id` | Busca usuário por ID |
| POST | `/users` | Cria usuário |
| PATCH | `/users/:id` | Atualiza usuário |
| DELETE | `/users/:id` | Remove usuário |

### Games

| Método | Endpoint | Descrição |
|---|---|---|
| GET | `/games` | Lista jogos |
| GET | `/games/:id` | Busca jogo por ID |
| POST | `/games` | Cria jogo |
| PATCH | `/games/:id` | Atualiza jogo |
| DELETE | `/games/:id` | Remove jogo |

### Game Sessions

| Método | Endpoint | Descrição |
|---|---|---|
| GET | `/game-sessions` | Lista sessões |
| GET | `/game-sessions/:id` | Busca sessão por ID |
| POST | `/game-sessions` | Cria sessão |

## 🔎 Paginação e filtros de jogos

O endpoint `GET /games` permite consultar jogos com paginação e filtros.

Exemplos de requisições:

```http
GET /games?page=1&limit=5
GET /games?name=Cyber
GET /games?genre=Action&platform=PC
GET /games?page=1&limit=10&name=Cyber&genre=Action&platform=PC
```

Parâmetros disponíveis:

| Parâmetro | Descrição |
|---|---|
| `page` | Número da página |
| `limit` | Quantidade de resultados por página |
| `name` | Filtra pelo nome do jogo |
| `genre` | Filtra pelo gênero |
| `platform` | Filtra pela plataforma |

A resposta da listagem paginada inclui metadados como total de registros, página atual, limite e total de páginas.

## ✅ Validação de dados

A API utiliza `class-validator` e `ValidationPipe` para validar dados recebidos nas requisições.

Exemplo de payload para criação de uma sessão de jogo:

```json
{
  "userId": 1,
  "gameId": 1,
  "durationMinutes": 45,
  "startedAt": "2026-10-06T20:00:00.000Z"
}
```

O payload deve respeitar os campos e os tipos definidos no DTO da sessão.

## 🗄️ Banco de dados

O projeto utiliza PostgreSQL para persistência de dados e Docker para execução do banco no ambiente local.

Configuração local documentada:

```text
Database: gaming_db
User: gaming_user
Port: 5432
```

As alterações no modelo de dados são gerenciadas por meio de migrations do MikroORM.

## 🧪 Testes e build

Execute os testes automatizados:

```bash
npm test -- --runInBand
```

Compile o projeto:

```bash
npm run build
```

No estado atual do projeto, os testes executados passaram: **7 suítes e 9 testes aprovados**. A compilação também foi concluída sem erros.

## 🎯 Objetivos de aprendizado

Este projeto explora conceitos e práticas de desenvolvimento backend, incluindo:

- Construção de APIs REST
- Arquitetura modular com NestJS
- Desenvolvimento com TypeScript
- Persistência de dados com PostgreSQL e MikroORM
- Relacionamentos entre entidades
- Paginação e filtros
- Validação de dados
- Migrations
- Docker
- Documentação com Swagger
- Testes automatizados com Jest
- Versionamento com Git

## 👨‍💻 Autor

**Guilherme Rodrigues Gabriel**

Computer Engineering Student | Backend Development

- GitHub: [GuiRodrigues77](https://github.com/GuiRodrigues77)
- Projeto: [gaming-backend-api](https://github.com/GuiRodrigues77/gaming-backend-api)
