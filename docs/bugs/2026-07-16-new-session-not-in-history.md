# 2026-07-16 新建会话后未同步到历史会话列表

## 现象

在智能会话页面使用 OpenCode 创建新会话并发送消息后，点击「新会话」按钮，左侧「历史会话」下拉中没有出现刚创建的会话。必须刷新页面或切换菜单重新进入后，历史列表才会更新。

## 根因

`Chat.tsx` 中加载历史会话的 `useEffect` 只在组件挂载时执行一次（依赖 `availableAgentOptions`）。创建/新增/关闭会话等操作完成后，没有主动重新拉取历史列表，导致 UI 与后端状态不同步。

## 解决方案

- 将历史会话加载逻辑提取为 `loadHistory` 回调。
- 在以下操作成功后主动调用 `loadHistory()`：
  - `handleNewSession`（新建当前智能体会话）
  - `addAgentTab`（新增智能体 tab）
  - `closeAgentTab`（关闭并删除会话）
- 组件挂载时仍通过 `useEffect` 调用 `loadHistory()` 进行初始加载。

## 验证结果

- `pnpm check-types` 通过，`pnpm build` 通过。
- 前端 dev 服务无需重启，刷新 `/chat` 后：
  - 新建会话发送消息并点击「新会话」按钮，历史会话下拉应立即出现刚结束的会话。
  - 新增智能体 tab、关闭 tab 后，历史列表也会同步刷新。
