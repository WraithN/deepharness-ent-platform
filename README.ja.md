# DeepHarness Enterprise Platform

[中文](./README.md) | [English](./README.en.md) | [Français](./README.fr.md)

開発チーム向けのマルチテナント AI 支援コーディングプラットフォーム。

## 機能一覧

- **マルチロール インテリジェント チャット**：プロダクトマネージャー、開発者、テスター、デザイナーなどをサポート。スラッシュコマンド、プロンプト、スキル、コードリポジトリ、タスクカード、`@ドキュメント` 引用などをアトミック入力ブロックとして提供
- **プロダクトスペース**：プロダクトドキュメント（Markdown 3 モードエディタ + ディレクトリツリー + バージョン履歴 + 共有コメント）、要件カンバン、インタラクティブ プロトタイプ、バージョン履歴
- **開発スペース**：コード プロジェクト、コード グラフ、スマート レビュー、スマート テスト、コーディング/デザイン規約（AGENTS.md / DESIGN.md）のインテリジェント生成
- **スキル & プロンプト マーケット**：マーケット閲覧、コピーして使用、スーパー管理者によるレビューと分類管理、ワークスペース独自プロンプト
- **作業項目管理**：要件、不具合、テストケースのライフサイクル管理。Jira / Meego / PingCode などとの連携
- **リポジトリ管理**：Git リポジトリ設定、クローン/同期、ユーザー プロジェクト ディレクトリ マッピング
- **ダッシュボード**：スキル、プロンプト、セッション、作業項目などの多次元統計
- **高信頼 Agent ランタイム**：AG-UI SSE イベント バッファリング、再接続再生、クラッシュリカバリ、マルチ Agent セッション オーケストレーション

## 製品紹介

### インテリジェント チャット

![インテリジェント チャット](./docs/screenshots/chat.png)

### 管理者スキル管理

![管理者スキル管理](./docs/screenshots/admin-skills.png)

### 管理者プロンプト管理

![管理者プロンプト管理](./docs/screenshots/admin-prompts.png)

## アーキテクチャ

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
