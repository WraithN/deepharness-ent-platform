# personal-stub 管理面改造：管理 + 上报链路统一走 personal-stub

## 现象

原架构中 personal-stub 与 gatewayd 虽共部署在同一容器，但两者无任何关系：
1. dh-backend 跨网络直接调 gatewayd admin API（健康/绑定/休眠/唤醒），personal-stub 对 gatewayd 毫无感知
2. gatewayd 直接向 dh-backend 上报运行时状态，不经过 personal-stub
3. K8s Pod 中只有 gatewayd 单容器，无 personal-stub sidecar

## 根因

provisioner 体系初版实现时，personal-stub 仅设计为文件/git/npm 操作服务，未承担同容器"本地管理者"角色。管理面和上报面均绕过 personal-stub 直连 gatewayd/dh-backend，导致职责不清、personal-stub 的同容器优势未被利用。

## 解决方案

### 三面分离架构

| 面 | 路径 | 说明 |
|----|------|------|
| **会话面** | dh-backend -> gatewayd (直连) | AI 对话、SSE、WS、session 管理（不变） |
| **管理面** | dh-backend -> personal-stub -> gatewayd | 容器生命周期：健康/绑定/休眠/唤醒 |
| **上报面** | gatewayd -> personal-stub -> dh-backend | 运行时状态上报中继 |

### personal-stub 新增管理面端点

新增 `gateway/handler/container.go`，6 个端点：

| 端点 | 行为 |
|------|------|
| `GET /api/v1/container/health` | 调 gatewayd `/admin/health` + 返回组合状态 |
| `POST /api/v1/container/bind` | 代理到 gatewayd `/admin/bind` |
| `POST /api/v1/container/unbind` | 代理到 gatewayd `/admin/unbind` |
| `POST /api/v1/container/sleep` | 代理到 gatewayd `/admin/sleep` |
| `POST /api/v1/container/wake` | 代理到 gatewayd `/admin/wake` |
| `POST /api/v1/container/report` | 接收 gatewayd 上报，转发到 dh-backend |

配置新增：`gatewayd.admin_url`、`dh_backend.url`、`dh_backend.runtime_bearer_token`、`dh_backend.runtime_id`

### dh-backend 管理调用切换

- `GatewaydAdminClient` -> `ContainerAdminClient`，路径从 `/admin/*` 改为 `/api/v1/container/*`
- directhost 模式：管理面 URL 从 `localhost:{adminPort}` 改为 `localhost:{stubPort}`
- k8s provider：新增 `podStubURL(pod)`，bind/sleep/wake 调用全部从 `podAdminURL` 改为 `podStubURL`

### K8s Pod 模板更新

- 新增 personal-stub sidecar 容器（`stubContainerName = "personal-stub"`），共用 PVC 卷
- readinessProbe 从探测 gatewayd `/admin/health:2346` 改为探测 personal-stub `/api/v1/container/health:8090`
- 新增 `stub_image` 配置项

### 验证结果

- `go build` / `go vet` 全部通过（dh-backend + personal-stub + go-sdk）
- `pnpm build` 7/7 通过
- 开发环境全部启动成功
- `GET /api/v1/container/health` 返回 `{"gatewayd":"ok","personalStub":"ok"}`
- `POST /api/v1/container/sleep` / `wake` / `report` 均正常响应
