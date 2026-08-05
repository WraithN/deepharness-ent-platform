# personal-stub 管理面改造方案

> 日期：2026-08-05
> 状态：实施中

## 1. 背景与问题

当前架构中，personal-stub 与 gatewayd 虽然共部署在同一容器/主机，但两者无任何关系：

- **管理面断裂**：dh-backend 跨网络直接调 gatewayd admin API（`/admin/health`、`/admin/bind`、`/admin/sleep`、`/admin/wake`），personal-stub 对 gatewayd 毫无感知。
- **上报面断裂**：gatewayd 直接向 dh-backend 上报运行时状态（`POST /api/v1/agent-runtimes/{id}/status`），不经过 personal-stub。
- **职责不清**：personal-stub 仅做文件/git/npm 操作，没有发挥同容器"本地管理者"的优势。

## 2. 目标架构

```
dh-backend (:8080)
  ├── AI 会话 (SSE/WS/session 管理) ──────> gatewayd:2346  (直连)
  ├── 容器管理 (健康/休眠/唤醒/绑定) ──────> personal-stub:8090 ─> gatewayd:2346 (本地代理)
  ├── 文件/工程/dev server ───────────────> personal-stub:8090  (不变)
  └── 运行时状态查询 <──────────────────── personal-stub:8090 <── gatewayd:2346 (上报中继)
```

三条面分离：
| 面 | 路径 | 说明 |
|----|------|------|
| **会话面** | dh-backend → gatewayd (直连) | AI 对话、SSE、WS、session 管理、MCP 工具调用 |
| **管理面** | dh-backend → personal-stub → gatewayd | 容器生命周期：健康检查、绑定、休眠、唤醒 |
| **上报面** | gatewayd → personal-stub → dh-backend | 运行时状态上报，personal-stub 可附加自身状态 |

## 3. 改动清单

### 3.1 personal-stub（新增管理面 + 上报中继）

**配置新增** (`config/config.go`)：
```yaml
gatewayd:
  admin_url: "http://localhost:2346"   # 同容器 gatewayd admin API
dh_backend:
  url: "http://localhost:8080"          # dh-backend 地址（用于上报中继）
  runtime_bearer_token: ""              # 上报 Bearer Token
  runtime_id: ""                        # 当前容器对应的 runtime ID
```

**新增端点** (`gateway/handler/container.go`)：

| 端点 | 方法 | 行为 |
|------|------|------|
| `/api/v1/container/health` | GET | 调 gatewayd `/admin/health` + 返回组合状态 |
| `/api/v1/container/bind` | POST | 代理到 gatewayd `/admin/bind` |
| `/api/v1/container/unbind` | POST | 代理到 gatewayd `/admin/unbind` |
| `/api/v1/container/sleep` | POST | 代理到 gatewayd `/admin/sleep` |
| `/api/v1/container/wake` | POST | 代理到 gatewayd `/admin/wake` |
| `/api/v1/container/report` | POST | 接收 gatewayd 状态上报，转发到 dh-backend |

### 3.2 dh-backend（管理调用切换到 personal-stub）

**`GatewaydAdminClient` → `ContainerAdminClient`**：
- 路径常量：`/admin/health` → `/api/v1/container/health`，其余同理
- 调用目标：从 `gatewayd:{adminPort}` 改为 `personal-stub:{stubPort}`

**k8s provider**：
- `podAdminURL(pod)` → `podStubURL(pod)`（端口从 adminPort 改为 stubPort）
- `bindWarmPod`/`Sleep`/`Wake`/`createUserPod` 中的 adminClient 调用 URL 全部指向 personal-stub

**k8s pod_template**：
- readinessProbe 从探测 gatewayd `/admin/health:2346` 改为探测 personal-stub `/api/v1/container/health:8090`
- 新增 personal-stub sidecar 容器（共用卷挂载、stub 端口暴露）
- 新增 `stub_image` 配置项

**config**：
- K8sConfig 新增 `StubImage` 字段
- directhost 模式不变（personal-stub 本地已在运行）

### 3.3 ContainerInfo（不变）

`ContainerInfo` 保留 `AdminPort` 字段——会话面仍需直连 gatewayd（`GatewaydAdminURL()` 用于 session/chat/events）。管理面通过 `StubPort` 走 personal-stub。

## 4. 接口定义

### personal-stub → gatewayd（本地代理，不变）

personal-stub 内部用 `http://localhost:2346/admin/*` 调 gatewayd，路径不变。

### dh-backend → personal-stub（管理面，新路径）

| dh-backend 调用 | personal-stub 端点 | 原 gatewayd 端点 |
|-----------------|-------------------|------------------|
| `GET {stubURL}/api/v1/container/health` | `/api/v1/container/health` | `GET /admin/health` |
| `POST {stubURL}/api/v1/container/bind` | `/api/v1/container/bind` | `POST /admin/bind` |
| `POST {stubURL}/api/v1/container/unbind` | `/api/v1/container/unbind` | `POST /admin/unbind` |
| `POST {stubURL}/api/v1/container/sleep` | `/api/v1/container/sleep` | `POST /admin/sleep` |
| `POST {stubURL}/api/v1/container/wake` | `/api/v1/container/wake` | `POST /admin/wake` |

### gatewayd → personal-stub → dh-backend（上报中继）

| gatewayd 调用 | personal-stub 端点 | personal-stub 转发到 dh-backend |
|---------------|-------------------|-------------------------------|
| `POST /api/v1/container/report` | `/api/v1/container/report` | `POST /api/v1/agent-runtimes/{id}/status` |

personal-stub 转发时附加自身状态（`personalStub: "ok"`），dh-backend 的 report 端点不变。

## 5. 迁移路径

本次一次性完成，不兼容变更仅在 K8s 模式下生效（需重新部署 Pod）：
1. personal-stub 新增管理端点（向后兼容）
2. dh-backend 管理调用切换到 personal-stub
3. K8s pod template 新增 personal-stub sidecar + 更新 readinessProbe
4. directhost 模式自动适配（personal-stub 本地已在运行）
