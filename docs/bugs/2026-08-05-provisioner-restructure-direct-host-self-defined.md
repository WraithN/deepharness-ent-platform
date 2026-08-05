# Provisioner 架构重构：mock -> direct-host + 新增 self-defined

## 现象

原 provisioner 体系存在以下问题：

1. **命名不当**：本地开发供给器命名为 `mock`，语义不清晰，实际它是基于固定主机列表的直接部署模式。
2. **配置扁平混杂**：`ProvisionerConfig` 将 K8s 专属字段（namespace/image/resource_active 等）与 direct-host 专属字段（mock_hosts）平铺在同一层级，难以区分哪些字段适用于哪种模式。
3. **缺少自定义扩展**：仅有 `mock` 和 `k8s` 两种供给器，无法对接自研调度系统。
4. **类型选择逻辑重复**：`factory.go` 和 `server.go` 各有一个 switch 语句选择供给器类型，容易不一致。
5. **容器池适配不对称**：`MockContainerPool` 完全忽略 `AgentProvisioner`，`K8sContainerPool` 全权委托，设计不统一。

## 根因

provisioner 体系在初版实现时以快速验证为目标，mock 命名反映的是"临时模拟"意图，但随着平台演进该模式已成为正式的本地开发供给方式。配置结构未随功能扩展进行分层重构，导致不同模式参数混在同一层级。缺少对外部供给器的抽象接口，无法接入自研调度系统。

## 解决方案

### 1. 重命名 mock -> direct-host

- `config.ProvisionerTypeMock = "mock"` -> `ProvisionerTypeDirectHost = "direct-host"`
- `apps/dh-backend/agent/provisioner/mock/` -> `apps/dh-backend/agent/provisioner/directhost/`
- `MockContainerPool` -> `DirectHostContainerPool`
- `mock_hosts` 配置项 -> `direct_host.hosts`
- 实例 ID 前缀 `mock-agent-*` -> `direct-host-agent-*`

### 2. 新增 self-defined 供给器

新增 `apps/dh-backend/agent/provisioner/selfdefined/provider.go`，通过 HTTP API 对接自定义外部供给器：

- 所有 `AgentProvisioner` 接口方法转换为 HTTP 调用
- 支持 Bearer Token 认证
- 配置项：`endpoint` / `token` / `timeout` / `stub_port`
- REST API 契约：`POST /provision`、`POST /sleep`、`POST /wake`、`DELETE /destroy`、`GET /status`、`GET /find-by-user`、`POST /warm-pool/ensure`、`GET /warm-pool/status`

### 3. 配置分层重构

`ProvisionerConfig` 拆分为公共字段 + 三个类型专属子配置：

```yaml
agent_provisioner:
  type: "direct-host"       # direct-host | k8s | self-defined
  # 公共配置
  warm_pool_min: 2
  warm_pool_max: 10
  idle_timeout: "15m"
  # direct-host 专属
  direct_host: { hosts, agent_port, admin_port, stub_port }
  # k8s 专属
  k8s: { namespace, image, agent_port, admin_port, stub_port, shared_pvc_name, ... }
  # self-defined 专属
  self_defined: { endpoint, token, timeout, stub_port }
```

### 4. 基类接口设计

`AgentProvisioner` 接口（`packages/go-sdk/domain/agent/provisioner.go`）作为基类，新增 `Name() string` 方法用于供给器类型识别。三种实现均继承此接口：

| 方法 | 说明 |
|------|------|
| `Name() string` | 返回供给器类型名称 |
| `Provision(ctx, req)` | 分配 Agent 实例 |
| `Sleep(ctx, instanceID)` | 休眠实例 |
| `Wake(ctx, instanceID)` | 唤醒实例 |
| `Destroy(ctx, instanceID)` | 销毁实例 |
| `Status(ctx, instanceID)` | 查询实例状态 |
| `FindByUser(ctx, wsID, userID)` | 按用户查找实例 |
| `WarmPoolEnsure(ctx, min)` | 确保暖池最低数量 |
| `WarmPoolStatus(ctx)` | 查询暖池状态 |

### 5. 统一工厂 + 通用容器池

- `factory.go` 新增 `NewContainerPool(cfg, prov)` 统一容器池创建，消除 `server.go` 中的重复 switch。
- 原 `k8s_pool.go` 的 `K8sContainerPool` 替换为通用 `agentProvisionerPool`（`agent_pool.go`），适用于任何 `AgentProvisioner`，被 k8s 和 self-defined 共用，消除重复逻辑。

### 6. 验证结果

- `go build ./...` 通过（0 errors）
- `go vet ./...` 通过（0 warnings）
- `config.yaml` 已更新为分层结构
- `README.md` 已同步更新
