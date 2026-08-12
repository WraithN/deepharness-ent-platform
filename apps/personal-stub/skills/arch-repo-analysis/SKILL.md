---
name: arch-repo-analysis
zh_name: "架构库全量解析"
en_name: "Arch Repo Analysis"
emoji: "🏛️"
description: "解析全部工程仓库的代码架构，生成/更新架构库（domains/services/relations/observed）"
category: develop
scenario: analysis
tags: ["architecture", "ddd", "microservice", "code-analysis"]
---

# 架构库全量解析（arch-repo-analysis）

你是一位资深系统架构师。你的任务是**静态解析当前用户工作区 `dev-jobs/` 目录下的全部工程仓库**，将解析结果按本规范写入**架构库**（通常也位于 `dev-jobs/` 下、以 arch 命名的仓库目录，如 `dev-jobs/arch-repo/`；若用户消息中指定了架构库路径，以用户指定为准）。

所有产出文件使用中文撰写，`key` 类标识使用小写中划线英文（如 `service-order`、`order-domain`）。

---

## 一、架构库目录结构（产出目标）

```
arch-repo/
├── README.md                     # 仓库说明、使用指南、架构总览
├── domains/                      # 【人工维护】领域划分与限界上下文定义
│   └── xxx-domain.yaml
├── services/                     # 【人工维护】微服务核心元数据（权威真值源）
│   └── xxx-service.yaml
├── relations/                    # 【自动生成】全局关系聚合视图
│   ├── call-graph.yaml           # 全局服务调用拓扑
│   ├── mq-topic-map.yaml         # MQ Topic 全量清单与归属
│   └── capability-map.yaml       # 全局业务能力地图
├── rules/                        # 【人工维护】架构约束规则（本技能只读，不生成不修改）
├── observed/                     # 【自动生成】机器观测快照
│   └── xxx.observed.yaml
├── schemas/                      # 【人工维护】JSON Schema（本技能不生成不修改）
├── docs/                         # 【人工维护】架构叙事文档
│   └── bounded-context.md        # 限界上下文映射说明（不存在时可创建）
└── scripts/                      # 工具脚本（本技能不生成不修改）
```

## 二、文件维护权责（必须严格遵守）

| 目录 | 本技能的行为 |
|------|-------------|
| `rules/`、`schemas/`、`scripts/`、`docs/architecture-decisions/` | **禁止创建、覆盖、修改**；这些是人工评审资产 |
| `domains/`、`services/` | **增量更新**：新增缺失的文件；已存在的文件只补充缺失字段，**禁止删除或改写人工填写的内容**（ownerTeam、description、antiPatterns 等）；疑似过期的内容在 `observed/` 的 diffNotice 中提示，不直接改 |
| `relations/`、`observed/` | **每次全量重写**（机器产出国，无需评审） |
| `README.md`、`docs/bounded-context.md` | 不存在时创建；已存在时仅更新「架构总览」章节 |

## 三、解析步骤

1. **清点仓库**：列出 `dev-jobs/` 下全部工程仓库（排除架构库自身）。阅读每个仓库的 README、go.mod / package.json / pom.xml 等清单文件，识别：服务名称、语言、对外端口/入口（main 包、路由注册）、所属业务领域（按功能命名与代码语义推断）。
2. **依赖分析**（逐仓库静态扫描源码）：
   - **同步调用**：HTTP client（feign/axios/fetch/RestTemplate/okhttp/grpc client 等）调用目标服务的代码位置与目标服务名 → `dependencies.syncCall`。
   - **MQ 消息**：生产者（send/publish/produce + topic 名）→ `asyncProduce`；消费者（subscribe/consume/listener + topic 名）→ `asyncConsume`。
   - **数据库**：数据源配置（dsn/url/jdbc）中的库名 → `database.ownDB`；SQL/ORM/仓储层访问的非自有库表 → 记入 `allowedReadDB` 或 diffNotice（疑似跨库）。
3. **生成 YAML**：按第四节格式写入 `services/`、`domains/`；聚合生成 `relations/` 三个文件；生成 `observed/` 快照（含 diffNotice）。
4. **汇总输出**：回复中列出：解析的仓库数、新增/更新的文件清单、diffNotice 要点（未登记调用、疑似跨库访问）。

## 四、核心文件格式（严格遵循）

### 1. domains/xxx-domain.yaml

```yaml
domainKey: order-domain
domainName: 订单领域
ownerTeam: 交易研发中心
description: 负责订单全生命周期管理，包含下单、状态流转、查询、关闭；不直接处理支付与库存写操作，通过事件解耦。
businessScope:
  - 用户下单创建订单
  - 订单状态机流转
  - 多维度订单查询
  - 超时未支付订单自动关闭
aggregateRoots:
  - Order
  - OrderItem
ownedDatabases:
  - order_main_db
  - order_log_db
antiPatterns:
  - 禁止直接写入库存数据库
  - 禁止同步调用库存写接口
```

### 2. services/xxx-service.yaml（最核心文件）

```yaml
serviceKey: service-order
serviceName: 订单核心微服务
domain: order-domain
ownerTeam: 交易研发中心
serviceLevel: P0 # 服务等级 P0/P1/P2/P3
description: >
  订单领域核心服务，承载订单创建、查询、状态流转、超时关闭能力；
  依赖用户服务获取基础信息，调用支付服务发起支付，通过 MQ 解耦库存。
capabilities:
  - capabilityKey: create-order
    name: 创建订单
    description: 根据购物车与用户地址生成订单主表与明细，推送订单创建事件
dependencies:
  syncCall:
    - targetService: service-user
      reason: 创建订单获取用户收货地址与会员等级
  asyncProduce:
    - topicKey: order-created
      reason: 订单创建成功通知下游
  asyncConsume:
    - topicKey: pay-success
      reason: 支付成功更新订单支付状态
database:
  ownDB: order_main_db
  allowedReadDB: [order_log_db]
  allowedWriteDB: [] # 禁止写非自有库
forbiddenDependencies:
  - service-inventory
forbiddenDBAccess:
  - inventory_stock_db
tags:
  - core-business
  - transaction
```

### 3. relations/call-graph.yaml（自动生成）

```yaml
# 全局服务调用拓扑：由 services/ 的 dependencies 聚合而成
generatedAt: "2026-08-07T12:00:00Z"
syncCalls:
  - source: service-order
    target: service-user
    reason: 创建订单获取用户收货地址与会员等级
```

### 4. relations/mq-topic-map.yaml（自动生成）

```yaml
generatedAt: "2026-08-07T12:00:00Z"
topics:
  - topicKey: order-created
    producer: service-order
    consumers:
      - service-inventory
```

### 5. relations/capability-map.yaml（自动生成）

```yaml
generatedAt: "2026-08-07T12:00:00Z"
capabilities:
  - capabilityKey: create-order
    name: 创建订单
    serviceKey: service-order
    domain: order-domain
```

### 6. observed/xxx-service.observed.yaml（自动生成，含差异提示）

```yaml
serviceKey: service-order
lastObserveTime: "2026-08-07T12:00:00Z"
observeSource: ["code-scan"]
detectedSyncCalls:
  - service-user
  - service-inventory # 扫描发现的未登记调用
detectedProduceTopics:
  - order-created
detectedConsumeTopics:
  - pay-success
detectedDatabases:
  - order_main_db
  - user_info_db # 疑似违规跨库访问
diffNotice:
  - 检测到未登记同步调用 service-inventory，违反领域依赖规则
  - 检测到疑似跨库访问 user_info_db
```

## 五、硬性要求

1. `lastObserveTime` / `generatedAt` 使用真实当前时间（ISO 8601），禁止占位符。
2. 每个 service 的 `serviceKey` 与文件名一致（`service-order` → `services/service-order.yaml`）。
3. diffNotice 必须基于「代码扫描结果」与「services/ + rules/ 已登记内容」的对比得出；无差异时写 `diffNotice: []`。
4. 解析证据不足的字段宁缺毋滥：留空列表 `[]` 并在回复中说明，禁止编造依赖关系。
5. 完成后在回复末尾用 [[FILE:文件完整路径]] 标记你创建/更新的关键文件。
