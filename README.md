# 🎮 Gaming Backend API

Backend REST desenvolvido com **NestJS e TypeScript** para uma plataforma de jogos.

O projeto foi desenvolvido como projeto de portfólio com foco em **desenvolvimento backend**, explorando arquitetura modular, APIs REST, persistência de dados, relacionamentos entre entidades, validação e documentação de APIs.

## 🚀 Tecnologias

* **Node.js**
* **TypeScript**
* **NestJS**
* **PostgreSQL**
* **MikroORM**
* **Docker**
* **Swagger / OpenAPI**
* **class-validator**
* **Git**

## 🏗️ Arquitetura

O projeto utiliza a arquitetura modular do NestJS, separando responsabilidades por domínio.

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

## 📌 Funcionalidades

### Users

* Criar usuário
* Listar usuários
* Buscar usuário por ID
* Atualizar usuário
* Remover usuário
* Validação de dados

### Games

* Criar jogo
* Listar jogos
* Buscar jogo por ID
* Atualizar jogo
* Remover jogo
* Validação de dados

### Game Sessions

* Criar sessão de jogo
* Listar sessões
* Buscar sessão por ID
* Relacionar sessão com usuário
* Relacionar sessão com jogo

## 🔗 Relacionamentos

As sessões de jogo possuem relacionamentos com usuários e jogos utilizando o MikroORM:

```text
User 1 ───────── N GameSession N ───────── 1 Game
```

Uma sessão pertence a um usuário e a um jogo.

## 🐳 Executando o projeto

### Pré-requisitos

* Node.js
* npm
* Docker Desktop

### 1. Clone o repositório

```bash
git clone https://github.com/GuiRodrigues77/gaming-backend-api.git
cd gaming-backend-api
```

### 2. Instale as dependências

```bash
npm install
```

### 3. Inicie o PostgreSQL com Docker

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

A API estará disponível em:

```text
http://localhost:3000
```

## 📚 Documentação da API

A documentação interativa foi criada utilizando Swagger.

Após iniciar a aplicação, acesse:

```text
http://localhost:3000/api
```

Por meio do Swagger é possível visualizar e testar os endpoints da API.

## 🔌 Principais endpoints

### Users

```text
GET    /users
GET    /users/:id
POST   /users
PATCH  /users/:id
DELETE /users/:id
```

### Games

```text
GET    /games
GET    /games/:id
POST   /games
PATCH  /games/:id
DELETE /games/:id
```

### Game Sessions

```text
GET  /game-sessions
GET  /game-sessions/:id
POST /game-sessions
```

## 🧪 Validação

A API utiliza `class-validator` e `ValidationPipe` para validar os dados recebidos nas requisições.

Exemplo de criação de uma sessão:

```json
{
  "userId": 1,
  "gameId": 1,
  "durationMinutes": 45,
  "startedAt": "2026-10-06T20:00:00.000Z"
}
```

## 🗄️ Banco de dados

O PostgreSQL é executado utilizando Docker.

Configuração utilizada no ambiente local:

```text
Database: gaming_db
User: gaming_user
Port: 5432
```

As alterações no modelo de dados são controladas utilizando **MikroORM Migrations**.

## 🎯 Objetivo do projeto

O projeto foi criado para praticar e demonstrar conhecimentos em desenvolvimento backend, incluindo:

* Desenvolvimento de APIs REST
* Arquitetura modular
* TypeScript
* NestJS
* PostgreSQL
* ORM e relacionamentos
* Docker
* Validação de dados
* Migrations
* Documentação de APIs

## 👨‍💻 Autor

**Guilherme Rodrigues Gabriel**

Computer Engineering student | Backend Developer

GitHub: https://github.com/GuiRodrigues77
