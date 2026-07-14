# DeepHarness Enterprise Platform

**[中文](#zh)** | **[English](#en)** | **[日本語](#ja)** | **[Français](#fr)**

---

## <a id="zh"></a>中文

Turborepo monorepo，包含统一的 Go 后端与 React TypeScript 前端。

### 架构

```
.
├── apps/                          # 可部署应用
│   ├── dh-frontend/               # React + Vite + TypeScript 前端
│   ├── agent-runtime/             # Agent 运行时封装（目标 Rust，当前为 Go 占位）
│   ├── dh-backend/                # DeepHarness 统一后端（端口 8080）
│   │   ├── config/                # 环境配置加载
│   │   ├── constants/             # 全局常量
│   │   ├── agent/                 # Agent 客户端、会话、编排器
│   │   │   ├── agui/              # AG-UI 协议类型与 SSE 缓冲
│   │   │   │   └── buffer/        # SSEBuffer 接口 + 内存/Redis 实现
│   │   │   ├── chat/              # Session/Message 领域模型与存储
│   │   │   ├── client/            # 到 gatewayd 的 HTTP+SSE 客户端
│   │   │   └── orchestrator/      # Agent 会话编排
│   │   ├── gateway/               # HTTP 路由、处理器、中间件、服务器
│   │   │   ├── handler/           # AGUI、会话、文件、指令处理器
│   │   │   ├── middleware/        # CORS、认证、请求日志
│   │   │   └── server/            # 服务器组装与路由注册
│   │   ├── domain/                # 业务领域模块
│   │   │   ├── identity/          # 用户认证与管理
│   │   │   ├── project/           # 项目管理
│   │   │   ├── workitem/          # 需求、缺陷、测试用例
│   │   │   ├── pragent/           # PR 评审 Agent
│   │   │   └── audit/             # 审计日志
│   │   └── tests/test-agent       # Agent Client 本地测试工具
│   └── mock/                      # 本地 Agent SSE mock（独立模块）
├── packages/                      # 共享库
│   ├── ui/                        # 共享 React UI 组件
│   ├── api-types/                 # 共享 API TypeScript 类型
│   ├── go-sdk/                    # 共享 Go SDK（DDD 领域 + 基础设施抽象）
│   │   ├── domain/                # 领域模型（identity、project、workitem、agent、audit）
│   │   ├── infrastructure/        # 基础设施抽象（git、workitem-tracker、pr-agent、llm、postgres）
│   │   └── common/                # 通用工具
│   └── config/                    # 共享配置（tsconfig、eslint presets）
├── infra/                         # 基础设施代码
│   ├── database/                  # 数据库迁移脚本
│   ├── k8s/                       # Kubernetes 清单
│   ├── helm/                      # Helm Charts
│   └── docker/                    # Dockerfile 与 compose 文件
├── turbo.json                     # Turborepo 配置
├── pnpm-workspace.yaml            # pnpm workspaces
├── go.work                        # Go workspace
└── package.json                   # 根 workspace
```

### 环境要求

- [Node.js](https://nodejs.org/) (v20+)
- [pnpm](https://pnpm.io/) (v9.15.5)
- [Go](https://go.dev/) (v1.22+)

### 快速开始

安装依赖：

```bash
pnpm install
```

开发模式运行所有服务：

```bash
pnpm dev
```

单独运行某个服务：

```bash
# 前端
pnpm --filter @repo/dh-frontend dev

# DH Backend
pnpm --filter @repo/dh-backend dev
```

### 构建

构建所有应用：

```bash
pnpm build
```

### 可用脚本

| 命令 | 说明 |
|------|------|
| `pnpm dev` | 开发模式启动所有应用 |
| `pnpm build` | 构建所有应用 |
| `pnpm lint` | 对所有应用执行 lint |
| `pnpm check-types` | 对所有应用执行类型检查 |
| `pnpm test` | 运行所有测试 |

### 数据库（PostgreSQL）

本项目以 **PostgreSQL 15** 作为主数据库。

使用 Docker Compose 启动本地 PostgreSQL：

```bash
docker compose -f infra/docker/compose.postgres.yml up -d
```

Go 服务默认连接信息：

| 变量 | 值 |
|------|-----|
| `DB_HOST` | `127.0.0.1` |
| `DB_PORT` | `5433`（宿主机）/ `5432`（容器） |
| `DB_USER` | `deepharness` |
| `DB_PASSWORD` | `deepharness` |
| `DB_NAME` | `deepharness` |

Schema 文件位于 `infra/database/`，首次启动 PostgreSQL 容器时会自动挂载。

当未设置 `DB_HOST` 时，`apps/dh-backend` 会优雅降级为内存 mock 数据，因此不启动数据库也能运行 `pnpm dev`。

### SSE 缓冲（事件缓存与崩溃恢复）

后端对 AG-UI SSE 事件与运行级检查点进行缓冲，以支持：

1. **前端断线重连回放** — 浏览器运行中掉线后，重连时重放缓冲事件。
2. **崩溃恢复** — 服务运行中崩溃时，检查点保存的运行状态（reasoning / text / tool-call 片段）会在下次加载会话历史时恢复为完整的助手消息。

### 技术栈

- **前端**：React 18、Vite、TypeScript、Tailwind CSS、shadcn/ui
- **后端**：Go 1.22、标准库 `net/http`、统一的 `dh-backend` 模块
- **数据库**：PostgreSQL 15
- **缓存/缓冲**：Redis（可选，用于 SSE 事件缓存与崩溃恢复）
- **Monorepo**：Turborepo、pnpm workspaces、Go workspaces

---

## <a id="en"></a>English

A Turborepo monorepo with a unified Go backend and a React TypeScript frontend.

### Architecture

```
.
├── apps/                          # Deployable applications
│   ├── dh-frontend/               # React + Vite + TypeScript frontend
│   ├── agent-runtime/             # Agent runtime wrapper (Rust target, currently Go stub)
│   ├── dh-backend/                # Unified DeepHarness backend (port 8080)
│   │   ├── config/                # Environment config loader
│   │   ├── constants/             # Global constants
│   │   ├── agent/                 # Agent client, chat, orchestrator
│   │   │   ├── agui/              # AG-UI protocol types and SSE buffer
│   │   │   │   └── buffer/        # SSEBuffer interface + memory/redis impl
│   │   │   ├── chat/              # Session/Message domain models and storage
│   │   │   ├── client/            # HTTP+SSE client to gatewayd
│   │   │   └── orchestrator/      # Agent session orchestration
│   │   ├── gateway/               # HTTP routes, handlers, middleware, server
│   │   │   ├── handler/           # AGUI, session, file, command handlers
│   │   │   ├── middleware/        # CORS, auth, request logging
│   │   │   └── server/            # Server assembly and route registration
│   │   ├── domain/                # Business domain modules
│   │   │   ├── identity/          # User authentication and management
│   │   │   ├── project/           # Project management
│   │   │   ├── workitem/          # Requirements, defects, test cases
│   │   │   ├── pragent/           # PR review agent
│   │   │   └── audit/             # Audit logging
│   │   └── tests/test-agent       # Agent Client local test tool
│   └── mock/                      # Local Agent SSE mock (independent module)
├── packages/                      # Shared libraries
│   ├── ui/                        # Shared React UI components
│   ├── api-types/                 # Shared API TypeScript types
│   ├── go-sdk/                    # Shared Go SDK (DDD domain + infrastructure abstractions)
│   │   ├── domain/                # Domain models (identity, project, workitem, agent, audit)
│   │   ├── infrastructure/        # Infrastructure abstractions (git, workitem-tracker, pr-agent, llm, postgres)
│   │   └── common/                # Common utilities
│   └── config/                    # Shared config (tsconfig, eslint presets)
├── infra/                         # Infrastructure code
│   ├── database/                  # Database migration scripts
│   ├── k8s/                       # Kubernetes manifests
│   ├── helm/                      # Helm charts
│   └── docker/                    # Dockerfiles and compose files
├── turbo.json                     # Turborepo configuration
├── pnpm-workspace.yaml            # pnpm workspaces
├── go.work                        # Go workspace
└── package.json                   # Root workspace
```

### Prerequisites

- [Node.js](https://nodejs.org/) (v20+)
- [pnpm](https://pnpm.io/) (v9.15.5)
- [Go](https://go.dev/) (v1.22+)

### Getting Started

Install dependencies:

```bash
pnpm install
```

Run all services in development mode:

```bash
pnpm dev
```

Or run individually:

```bash
# Frontend
pnpm --filter @repo/dh-frontend dev

# DH Backend
pnpm --filter @repo/dh-backend dev
```

### Build

Build all applications:

```bash
pnpm build
```

### Available Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start all apps in development mode |
| `pnpm build` | Build all apps |
| `pnpm lint` | Lint all apps |
| `pnpm check-types` | Type-check all apps |
| `pnpm test` | Run all tests |

### Database (PostgreSQL)

This project uses **PostgreSQL 15** as the primary database.

Start a local PostgreSQL instance with Docker Compose:

```bash
docker compose -f infra/docker/compose.postgres.yml up -d
```

Default connection (used by Go services):

| Variable | Value |
|----------|-------|
| `DB_HOST` | `127.0.0.1` |
| `DB_PORT` | `5433` (host) / `5432` (container) |
| `DB_USER` | `deepharness` |
| `DB_PASSWORD` | `deepharness` |
| `DB_NAME` | `deepharness` |

Schema files are located in `infra/database/` and are automatically mounted into the PostgreSQL container on first startup.

`apps/dh-backend` gracefully falls back to in-memory mock data when `DB_HOST` is not set, so `pnpm dev` works without a running database.

### SSE Buffer (Event Cache & Crash Recovery)

The backend buffers AG-UI SSE events and run-level checkpoints to support:

1. **Frontend reconnection replay** — if the browser disconnects mid-run, buffered events are replayed on reconnect.
2. **Crash recovery** — if the server crashes mid-run, checkpointed run state (reasoning / text / tool-call parts) is persisted as a completed assistant message on the next session history load.

### Technologies

- **Frontend**: React 18, Vite, TypeScript, Tailwind CSS, shadcn/ui
- **Backend**: Go 1.22, standard library `net/http`, unified `dh-backend` module
- **Database**: PostgreSQL 15
- **Cache/Buffer**: Redis (optional, for SSE event cache and crash recovery)
- **Monorepo**: Turborepo, pnpm workspaces, Go workspaces

---

## <a id="ja"></a>日本語

Turborepo ベースの monorepo。統一された Go バックエンドと React TypeScript フロントエンドを含みます。

### アーキテクチャ

```
.
├── apps/                          # デプロイ可能なアプリケーション
│   ├── dh-frontend/               # React + Vite + TypeScript フロントエンド
│   ├── agent-runtime/             # Agent ランタイム ラッパー（最終目標 Rust、現在は Go スタブ）
│   ├── dh-backend/                # 統合 DeepHarness バックエンド（ポート 8080）
│   │   ├── config/                # 環境設定ローダー
│   │   ├── constants/             # グローバル定数
│   │   ├── agent/                 # Agent クライアント、チャット、オーケストレーター
│   │   │   ├── agui/              # AG-UI プロトコル型と SSE バッファ
│   │   │   │   └── buffer/        # SSEBuffer インターフェース + メモリ/Redis 実装
│   │   │   ├── chat/              # Session/Message ドメインモデルとストレージ
│   │   │   ├── client/            # gatewayd への HTTP+SSE クライアント
│   │   │   └── orchestrator/      # Agent セッション オーケストレーション
│   │   ├── gateway/               # HTTP ルート、ハンドラー、ミドルウェア、サーバー
│   │   │   ├── handler/           # AGUI、セッション、ファイル、コマンド ハンドラー
│   │   │   ├── middleware/        # CORS、認証、リクエスト ロギング
│   │   │   └── server/            # サーバー組み立てとルート登録
│   │   ├── domain/                # ビジネス ドメイン モジュール
│   │   │   ├── identity/          # ユーザー認証と管理
│   │   │   ├── project/           # プロジェクト管理
│   │   │   ├── workitem/          # 要件、不具合、テストケース
│   │   │   ├── pragent/           # PR レビュー Agent
│   │   │   └── audit/             # 監査ログ
│   │   └── tests/test-agent       # Agent Client ローカル テスト ツール
│   └── mock/                      # ローカル Agent SSE mock（独立モジュール）
├── packages/                      # 共有ライブラリ
│   ├── ui/                        # 共有 React UI コンポーネント
│   ├── api-types/                 # 共有 API TypeScript 型
│   ├── go-sdk/                    # 共有 Go SDK（DDD ドメイン + インフラストラクチャ抽象）
│   │   ├── domain/                # ドメインモデル（identity、project、workitem、agent、audit）
│   │   ├── infrastructure/        # インフラストラクチャ抽象（git、workitem-tracker、pr-agent、llm、postgres）
│   │   └── common/                # 共通ユーティリティ
│   └── config/                    # 共有設定（tsconfig、eslint presets）
├── infra/                         # インフラストラクチャ コード
│   ├── database/                  # データベース移行スクリプト
│   ├── k8s/                       # Kubernetes マニフェスト
│   ├── helm/                      # Helm チャート
│   └── docker/                    # Dockerfile と compose ファイル
├── turbo.json                     # Turborepo 設定
├── pnpm-workspace.yaml            # pnpm workspaces
├── go.work                        # Go workspace
└── package.json                   # ルート workspace
```

### 前提条件

- [Node.js](https://nodejs.org/) (v20+)
- [pnpm](https://pnpm.io/) (v9.15.5)
- [Go](https://go.dev/) (v1.22+)

### クイックスタート

依存関係をインストール：

```bash
pnpm install
```

開発モードですべてのサービスを起動：

```bash
pnpm dev
```

個別に実行：

```bash
# フロントエンド
pnpm --filter @repo/dh-frontend dev

# DH Backend
pnpm --filter @repo/dh-backend dev
```

### ビルド

すべてのアプリケーションをビルド：

```bash
pnpm build
```

### 利用可能なスクリプト

| コマンド | 説明 |
|---------|------|
| `pnpm dev` | すべてのアプリを開発モードで起動 |
| `pnpm build` | すべてのアプリをビルド |
| `pnpm lint` | すべてのアプリを lint |
| `pnpm check-types` | すべてのアプリを型チェック |
| `pnpm test` | すべてのテストを実行 |

### データベース（PostgreSQL）

本プロジェクトは主データベースとして **PostgreSQL 15** を使用します。

Docker Compose でローカルの PostgreSQL を起動：

```bash
docker compose -f infra/docker/compose.postgres.yml up -d
```

Go サービスのデフォルト接続情報：

| 変数 | 値 |
|------|-----|
| `DB_HOST` | `127.0.0.1` |
| `DB_PORT` | `5433`（ホスト）/ `5432`（コンテナ） |
| `DB_USER` | `deepharness` |
| `DB_PASSWORD` | `deepharness` |
| `DB_NAME` | `deepharness` |

Schema ファイルは `infra/database/` にあり、初回起動時に PostgreSQL コンテナに自動マウントされます。

`DB_HOST` が未設定の場合、`apps/dh-backend` はメモリ内 mock データに優雅にフォールバックするため、データベースなしでも `pnpm dev` を実行できます。

### SSE バッファ（イベントキャッシュとクラッシュリカバリ）

バックエンドは AG-UI SSE イベントと実行レベルのチェックポイントをバッファリングします：

1. **フロントエンドの再接続再生** — 実行中にブラウザが切断しても、再接続時にバッファリングされたイベントを再生します。
2. **クラッシュリカバリ** — 実行中にサーバーがクラッシュしても、次回のセッション履歴読み込み時にチェックポイント状態が完了したアシスタントメッセージとして復元されます。

### 技術スタック

- **フロントエンド**：React 18、Vite、TypeScript、Tailwind CSS、shadcn/ui
- **バックエンド**：Go 1.22、標準ライブラリ `net/http`、統合 `dh-backend` モジュール
- **データベース**：PostgreSQL 15
- **キャッシュ/バッファ**：Redis（SSE イベントキャッシュとクラッシュリカバリ用、オプション）
- **Monorepo**：Turborepo、pnpm workspaces、Go workspaces

---

## <a id="fr"></a>Français

Un monorepo Turborepo avec un backend unifié en Go et un frontend React TypeScript.

### Architecture

```
.
├── apps/                          # Applications déployables
│   ├── dh-frontend/               # Frontend React + Vite + TypeScript
│   ├── agent-runtime/             # Wrapper du runtime Agent (cible Rust, stub Go actuellement)
│   ├── dh-backend/                # Backend unifié DeepHarness (port 8080)
│   │   ├── config/                # Chargeur de configuration d'environnement
│   │   ├── constants/             # Constantes globales
│   │   ├── agent/                 # Client Agent, chat, orchestrateur
│   │   │   ├── agui/              # Types du protocole AG-UI et buffer SSE
│   │   │   │   └── buffer/        # Interface SSEBuffer + implémentations mémoire/redis
│   │   │   ├── chat/              # Modèles de domaine Session/Message et stockage
│   │   │   ├── client/            # Client HTTP+SSE vers gatewayd
│   │   │   └── orchestrator/      # Orchestration des sessions Agent
│   │   ├── gateway/               # Routes HTTP, handlers, middleware, serveur
│   │   │   ├── handler/           # Handlers AGUI, session, fichier, commande
│   │   │   ├── middleware/        # CORS, auth, journalisation des requêtes
│   │   │   └── server/            # Assemblage du serveur et enregistrement des routes
│   │   ├── domain/                # Modules métier
│   │   │   ├── identity/          # Authentification et gestion des utilisateurs
│   │   │   ├── project/           # Gestion de projet
│   │   │   ├── workitem/          # Exigences, défauts, cas de test
│   │   │   ├── pragent/           # Agent de revue de PR
│   │   │   └── audit/             # Journal d'audit
│   │   └── tests/test-agent       # Outil de test local Agent Client
│   └── mock/                      # Mock SSE Agent local (module indépendant)
├── packages/                      # Bibliothèques partagées
│   ├── ui/                        # Composants React UI partagés
│   ├── api-types/                 # Types TypeScript d'API partagés
│   ├── go-sdk/                    # SDK Go partagé (domaine DDD + abstractions d'infrastructure)
│   │   ├── domain/                # Modèles de domaine (identity, project, workitem, agent, audit)
│   │   ├── infrastructure/        # Abstractions d'infrastructure (git, workitem-tracker, pr-agent, llm, postgres)
│   │   └── common/                # Utilitaires communs
│   └── config/                    # Configuration partagée (tsconfig, presets eslint)
├── infra/                         # Code d'infrastructure
│   ├── database/                  # Scripts de migration de base de données
│   ├── k8s/                       # Manifestes Kubernetes
│   ├── helm/                      # Charts Helm
│   └── docker/                    # Dockerfiles et fichiers compose
├── turbo.json                     # Configuration Turborepo
├── pnpm-workspace.yaml            # Workspaces pnpm
├── go.work                        # Workspace Go
└── package.json                   # Workspace racine
```

### Prérequis

- [Node.js](https://nodejs.org/) (v20+)
- [pnpm](https://pnpm.io/) (v9.15.5)
- [Go](https://go.dev/) (v1.22+)

### Démarrage rapide

Installer les dépendances :

```bash
pnpm install
```

Lancer tous les services en mode développement :

```bash
pnpm dev
```

Ou lancer individuellement :

```bash
# Frontend
pnpm --filter @repo/dh-frontend dev

# DH Backend
pnpm --filter @repo/dh-backend dev
```

### Build

Builder toutes les applications :

```bash
pnpm build
```

### Scripts disponibles

| Commande | Description |
|----------|-------------|
| `pnpm dev` | Démarrer toutes les apps en mode développement |
| `pnpm build` | Builder toutes les apps |
| `pnpm lint` | Linter toutes les apps |
| `pnpm check-types` | Vérifier les types de toutes les apps |
| `pnpm test` | Exécuter tous les tests |

### Base de données (PostgreSQL)

Ce projet utilise **PostgreSQL 15** comme base de données principale.

Démarrer une instance PostgreSQL locale avec Docker Compose :

```bash
docker compose -f infra/docker/compose.postgres.yml up -d
```

Connexion par défaut (utilisée par les services Go) :

| Variable | Valeur |
|----------|--------|
| `DB_HOST` | `127.0.0.1` |
| `DB_PORT` | `5433` (hôte) / `5432` (conteneur) |
| `DB_USER` | `deepharness` |
| `DB_PASSWORD` | `deepharness` |
| `DB_NAME` | `deepharness` |

Les fichiers de schéma se trouvent dans `infra/database/` et sont automatiquement montés dans le conteneur PostgreSQL au premier démarrage.

`apps/dh-backend` bascule gracieusement vers des données mock en mémoire lorsque `DB_HOST` n'est pas défini, donc `pnpm dev` fonctionne sans base de données démarrée.

### Buffer SSE (cache d'événements et récupération après crash)

Le backend met en buffer les événements SSE AG-UI et les points de contrôle au niveau de l'exécution pour supporter :

1. **Rejeu de reconnexion du frontend** — si le navigateur se déconnecte en cours d'exécution, les événements mis en buffer sont rejoués à la reconnexion.
2. **Récupération après crash** — si le serveur crashe en cours d'exécution, l'état du point de contrôle (reasoning / text / tool-call) est persisté comme un message assistant complet au prochain chargement de l'historique de session.

### Technologies

- **Frontend** : React 18, Vite, TypeScript, Tailwind CSS, shadcn/ui
- **Backend** : Go 1.22, bibliothèque standard `net/http`, module unifié `dh-backend`
- **Base de données** : PostgreSQL 15
- **Cache/Buffer** : Redis (optionnel, pour le cache SSE et la récupération après crash)
- **Monorepo** : Turborepo, pnpm workspaces, Go workspaces
