# DeepHarness Enterprise Platform

[中文](./README.md) | [English](./README.en.md) | [日本語](./README.ja.md)

Une plateforme de codage assistée par IA multi-locataire pour les équipes de développement.

## Fonctionnalités

- **Chat intelligent multi-rôles** : prend en charge les chefs de produit, les développeurs, les testeurs et les designers avec des commandes slash, des prompts, des skills, des dépôts de code, des cartes de tâches et des références `@doc` sous forme de blocs atomiques
- **Espace produit** : documents produit (éditeur Markdown à trois modes + arborescence + historique des versions + commentaires partagés), kanban des exigences, prototypes interactifs, historique des versions
- **Espace développement** : projets de code, graphe de code, revue intelligente, test intelligent, génération intelligente des standards coding/design (AGENTS.md / DESIGN.md)
- **Marché des skills & prompts** : parcours du marché, copier pour utiliser, révision et gestion des catégories par le super-admin, prompts personnalisés d'espace de travail
- **Gestion des éléments de travail** : cycle de vie complet des exigences, défauts et cas de test, avec des intégrations telles que Jira / Meego / PingCode
- **Gestion des dépôts** : configuration des dépôts Git, clone/synchronisation, mapping des répertoires de projet utilisateur
- **Tableau de bord** : statistiques multidimensionnelles pour les skills, prompts, sessions et éléments de travail
- **Runtime Agent haute fiabilité** : buffer d'événements SSE AG-UI, rejeu de reconnexion, récupération après crash, orchestration de sessions multi-agents

## Présentation du produit

### Chat intelligent

![Chat intelligent](./docs/screenshots/chat.png)

### Gestion des skills administrateur

![Gestion des skills administrateur](./docs/screenshots/admin-skills.png)

### Gestion des prompts administrateur

![Gestion des prompts administrateur](./docs/screenshots/admin-prompts.png)

## Architecture

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
