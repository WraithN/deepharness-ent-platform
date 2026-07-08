# 为所有列表加上分页器（除超管智能体列表）

## 现象

前端多个列表页面（技能市场、提示词市场、需求列表、智能评审、测试用例、虾班智守、设置页成员管理/智能体配置/代码仓库）一次性渲染全部数据，缺少分页器，当数据量增长时影响页面性能和用户体验。

## 根因

这些列表在初始开发时未集成分页功能，直接通过 `.map()` 渲染全部数据。虽然部分列表（如技能市场、提示词市场）通过请求 `pageSize=100` 限制了单次加载量，但前端仍一次性渲染所有条目，没有分页导航。超管的智能体列表（`AdminPage.tsx` 中的 `agentTypes` 表）因业务需求明确不需要分页。

## 解决方案

### 1. 新增通用客户端分页 Hook

创建 `src/hooks/use-client-pagination.ts`，封装分页状态管理逻辑：
- 支持 `pageSize`、`total`、`resetDeps`（筛选条件变化时重置到第 1 页）配置
- 自动钳制越界页码（数据减少时回到最后一页）
- 返回 `currentPage`、`totalPages`、`onPageChange`、`startIndex`、`endIndex`

### 2. 为以下 9 个列表添加分页器

| 列表 | 文件 | 每页数量 | 分页方式 |
|------|------|----------|----------|
| 技能市场 | `pages/SkillMarket.tsx` | 12 | 客户端 |
| 提示词市场 | `pages/PromptMarket.tsx` | 12 | 客户端 |
| 需求列表（列表视图） | `pages/Requirements.tsx` | 10 | 客户端 |
| PR 评审记录 | `pages/SmartReview.tsx` | 10 | 客户端 |
| 测试用例需求列表 | `pages/SmartTest.tsx` | 10 | 客户端 |
| 虾班智守列表 | `pages/PersonalAssistantPage.tsx` | 12 | 客户端 |
| 设置 - 成员管理 | `pages/Settings.tsx` | 10 | 客户端 |
| 设置 - 智能体配置 | `pages/Settings.tsx` | 10 | 客户端 |
| 设置 - 代码仓库 | `pages/Settings.tsx` | 10 | 客户端 |

每个列表的实现模式一致：
1. 使用 `useClientPagination` hook 获取分页状态
2. 通过 `slice(startIndex, endIndex)` 获取当前页数据
3. 渲染当前页数据而非全量数据
4. 在列表底部添加 `PaginationBar` 组件
5. 搜索/筛选条件变化时自动重置到第 1 页

### 3. 特殊处理

- **需求列表**：仅在列表视图添加分页，看板视图保持原有全量渲染（看板按状态分列展示）
- **代码仓库**：新增仓库时自动跳转到新仓库所在页（末页），确保用户可见
- **测试用例**：分页器放置在左侧面板卡片底部（`CardContent` 外、`Card` 内），不随内容滚动

### 4. 排除项

超管智能体列表（`AdminPage.tsx` → `/admin/config` → 智能体设置 tab）按要求不添加分页。

### 验证

- `npx tsc --noEmit -p tsconfig.check.json`：0 errors
- `npx biome lint`：无 lint 错误
- `pnpm build`：全部 6 个包构建成功
- 前端 dev server（port 8889）和后端（port 8080）均正常响应 HTTP 200
