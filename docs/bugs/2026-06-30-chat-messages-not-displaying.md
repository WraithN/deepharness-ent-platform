# 2026-06-30 Chat 输入后消息与 AI 回复均不展示

## 现象

在智能会话页面输入内容并发送后：

- 用户输入消息没有出现在聊天区域。
- AI 回复（包括占位 Loading）也没有展示。
- 控制台报错 `Plus is not defined`，导致 `<Chat>` 组件渲染崩溃。

## 根因

1. **缺少图标导入**：在 `apps/web/src/pages/Chat.tsx` 中新增“新增智能体”按钮使用了 `<Plus />` 图标，但没有从 `lucide-react` 中导入 `Plus`，页面初始化即抛出 `ReferenceError`，整个聊天组件无法正常工作。
2. **Run 状态未清理**：切换/新建智能体 tab 时会调用 `runtime.thread.reset()` 重置线程，但此前正在进行的 AI run 没有被取消，`isRunning` 状态会残留到新会话，导致新 tab 中的输入被加入排队队列而不是立即发送。
3. **会话配额累积**：关闭 tab 时未同步删除后端会话，本地反复测试后后端达到“max active sessions reached”（5 个），进一步导致新会话创建失败。

## 解决方案

1. 在 `Chat.tsx` 的 `lucide-react` 导入列表中补充 `Plus`。
2. 在 `useAgUiChat.ts` 的 `createSession` / `switchSession` 中，先调用 `runtime.thread.cancelRun()` 再 `reset()`，避免旧 run 状态污染新会话。
3. 在 `closeAgentTab` 中调用 `api.delete(`/v1/sessions/${tab.id}`)`，释放后端会话配额。
4. 通过 `pnpm.overrides` 锁定 `@assistant-ui/core` 与 `@assistant-ui/store` 版本，并清除 Vite 缓存、重启 dev server，消除浏览器中加载多份 `@assistant-ui/core` 的警告。

## 补充需求（同一次迭代）

### 1. 支持同类型/不同类型智能体多开，tab 显示唯一标识

- 将 `AgentTab` 扩展为 `{ pluginKey, title, sessionId, instanceId, status }`。
- 创建会话时前端把 `pluginKey` 传给后端；后端在 `gatewayd` 创建 thread 后，立即调用 `/sessions/{threadID}/agents` 挂载对应插件的 agent，获取 `instance_id` 并返回给前端。
- tab 标题显示为 `{agentLabel} · {instanceId 前 6 位}`，鼠标悬停显示完整 instanceId，实现同类型 agent 多开时的唯一区分。
- 最多仍保持 5 个 agent 会话，由 `MAX_AGENT_TABS` 控制。

### 2. 恢复“新建会话”和“历史会话”功能

- 在顶部 header 恢复“历史会话”下拉：展示 `/v1/sessions` 列表，支持搜索；点击已打开会话直接切换，未打开会话以当前 agent 类型新增 tab。
- 在顶部 header 恢复“新建会话”按钮：为当前选中的 agent 类型新增一个 tab。

### 3. 标题栏层级调整：智能体在上，会话在下

- 第一层标题栏：DeepHarness 助手、当前智能体标签、新增智能体入口。
- 第二层标题栏：智能体 tabs（切换不同智能体/不同实例）。
- 第三层标题栏：历史会话下拉、新建会话按钮、会话数量，表达“会话从属于当前智能体”的层级关系。

## 2026-06-30 追加：UI 状态指示与层级精简

### 变更

1. **一智能体一会话**：每个智能体 tab 同时只能持有一个当前会话。新建会话会替换该智能体的旧会话并删除后端旧 session；添加已存在的智能体时直接切换，不会重复创建 tab。
2. **智能体状态标识**：在每个智能体 tab 前增加彩色圆点。
   - 红色：连接失败或其他错误。
   - 灰色：当前没有活跃会话。
   - 黄色：会话正在运行（AI 正在输出）。
   - 绿色：有已完成的活跃会话，即最后一条 AI 输出在 1 小时内。
3. **双层标题栏**：
   - 第一层从左到右：助手标题、智能体 tabs、最右“新增智能体”按钮。
   - 第二层从左到右：当前会话标题（`agentLabel · instanceId 前 6 位`），最右“历史会话”下拉与“新建会话”按钮。
   - 去掉了独立的“当前智能体：xxx”文本和冗余的会话计数。
4. **后端记录插件信息**：后端创建会话时把 `pluginKey` 与 `instanceId` 写入 `session.Context`，历史会话列表可据此将历史 session 归类到对应智能体 tab。

## 验证结果

- `pnpm --filter @repo/web check-types` ✅
- `pnpm --filter @repo/web lint` ✅
- `pnpm --filter @repo/dh-backend lint`（含 `go vet ./...`）✅
- `pnpm build` ✅
- Playwright / Chromium 截图验证：
  - 默认 Claude Code tab 发送消息正常渲染。
  - 新增 Codex tab 发送消息正常渲染。
  - “新建会话”为当前 agent 替换 session。
  - “历史会话”下拉展示历史并可打开/切换。
  - tab 上展示 agent 唯一标识与状态圆点。
  - 标题栏按“助手标题 → 智能体 tabs → 新增智能体”和“当前会话标题 → 历史/新建会话”两层排布。
