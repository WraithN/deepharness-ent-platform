# 产品流程前后端映射差异与并行 Fork/Join 重构

## 现象

产品需求设计流程后端实际执行节点（9 个）与前端设计（11 阶段 + 并行分叉）不一致：

- 后端缺失 `product_breakdown`、`product_ai_draft_review`、`product_ai_gateway` 三个节点。
- PRD 与原型生成为顺序执行（proto 依赖 PRD），前端设计为并行（均依赖 draft）。
- `ProductProtoReviewNode` 节点类型误标 AI（实际人工复核）。
- 驳回路由错误：`proto_review` reject 回 PRDWrite（应回 Draft）；`final_review` reject 回 PRDWrite（应回 ProtoReview）。
- 跳过原型时无 `skipped` 状态标记。
- 前端 `process-api.ts` 残留孤儿常量 `PRODUCT_AI_PROTO_REVIEW`（后端无对应阶段），前后端阶段映射不一致。

影响：前端流程图展示与后端实际执行不符，用户看到的阶段流转与真实行为不一致；原型与 PRD 无法并行，耗时翻倍；并发更新阶段状态存在竞态风险。

## 根因

1. 后端 `flows/product_flow.go` 节点序列未与 `domain/process/object/types.go` 的 `NewProductProcess` 11 阶段定义同步演进，缺少 3 个节点。
2. 引擎 `core/flow.go` 仅有顺序执行能力，无 fork/join 原语，无法表达并行分叉。
3. `ProductProtoReviewNode` 构造时误用 `NodeTypeAI`，但其 Input/Processor 为人工复核行为。
4. 各 review 节点的 `NextNode` reject 目标在迭代中未随设计调整。
5. `ProcessServiceImpl.UpdateStage` 为非原子 read-modify-write，无锁，无法支持并行分支并发更新。
6. 前端阶段常量 `PRODUCT_AI_PROTO_REVIEW` 在历史上遗留，未被清理，导致前后端映射出现冗余项。

## 解决方案

1. 新增 `core.ParallelNode` 复合并行原语：分支用 `FlowContext` 值拷贝隔离 `SessionID/ThreadID`，goroutine 并行执行，join 后合并结果；条件分支支持 `Skip`/`OnSkip`（标记 `StageStatusSkipped`）。
2. 提取 `core.ExecuteNode` 包级函数供主循环与并行分支复用。
3. `ProcessServiceImpl` 新增 `sync.Mutex` 保护 `Create`/`UpdateStage` 的 read-modify-write。
4. 补齐 3 个 AI 节点（Breakdown/AIDraftReview/AIGateway）+ 3 个 prompt 模板。
5. 修正 5 个现有节点路由/类型/prompt 输入；research 改读 BreakdownResult，proto_make 改读 DraftResult。
6. 重写 `flows/product_flow.go` 为 11 节点 + ParallelNode（PRD || Proto 真并行）。
7. `ProductFinalReview` 节点类型改为 `StageTypeJudge`；新增 `StageStatusSkipped`。
8. 前端新增 `skipped` 状态渲染（FlowGraph + ProcessDetail + FlowTracking）+ final_review 驳回边；删除孤儿常量 `PRODUCT_AI_PROTO_REVIEW`。

验证：`go build`/`go vet` 全通过；`go test` 通过（仅 `config/tests TestLoad_Defaults` 存在预存的环境相关失败，与本次无关）；`tsc --noEmit` 0 errors；`pnpm lint` 通过；`pnpm build` 成功；开发环境重启后前后端均响应正常（后端 `/health` 返回 200 `{"status":"ok"}`，前端返回 200）。

> 附带修复：全量验证过程中发现两个预存的聊天组件类型错误（真实 bug，非本次引入）——
> `MessageMarkers.tsx` 原型根路径提取对 `Set<string>` 误用 `.push` 且字符串/数字混用、向 `ReviewReportCard` 传递已废弃的 `isPreviewActive` prop，以及 `MarkdownView.tsx` 的 tsc 推断问题，已一并修复以通过 `pnpm lint`。
