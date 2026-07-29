# 评审报告卡片三项修复 + 统计增强 + 采纳导航加固

## 现象

1. `[[REVIEW_REPORT:json]]` 标记在对话文本中直接显示，未从可见内容中剥离
2. 点击评审报告卡片上的"预览"按钮，文件预览返回 404（URL 中 `path=review-2026-07-29-151000.md`，仅为文件名无目录前缀）
3. "采纳"按钮无法正确切换到工程页面的评审模式（类型错误 + 路径为空导致条件判断失败）
4. 评审报告卡片缺少问题严重级别详细统计

## 根因

1. `AssistantMessage.tsx` 的 `cleanText` 清理链中缺少对 `[[REVIEW_REPORT:{...}]]` 标记的正则替换
2. `resolveReportPath` 未处理纯文件名（无 `/`）的情况：agent 输出的 `reportPath` 为 `review-YYYY-MM-DD-HHmmss.md` 纯文件名时，函数直接返回原文件名不做解析
3. `ChatThreadProps` 缺少 `onReviewReportPreview`/`onReviewFix` + `ProjectCode` useEffect 要求 `navState.repoPath` 非空才切换模式（agent 可能输出空 `projectPath`）
4. 卡片仅显示"致命/严重"合并计数，未按致命、严重、一般、轻微分别列出

## 解决方案

1. 在 `AssistantMessage.tsx` 中添加 `REVIEW_REPORT_MARKER_REGEX` 正则常量，在 `cleanText` 链中追加 `.replace()` 调用
2. 增强 `resolveReportPath` 函数：
   - 纯文件名（无 `/`）→ 拼接 `projectPath/.review/文件名`
   - `projects/{repoName}/...` → 提取后缀拼接到 projectPath
   - `{repoName}/...` → 提取后缀
   - 其他相对路径 → `projectPath/原始路径`
   - 绝对路径 → 原样返回
3. 修复 ChatThread 类型错误：`ChatThreadProps` 添加 `onReviewReportPreview` 和 `onReviewFix` 可选属性并透传
4. 巩固"采纳"导航：
   - 同时使用 `location.state` 和 URL search params（`?mode=review&repoPath=...&repoName=...&branch=...`）
   - 移除 `navState.repoPath` 强制要求，改为从 URL params 取 fallback
   - 添加 `console.log` 调试日志
5. 评审报告卡片统计增强：
   - 致命（红色）、严重（橙色）、一般（琥珀色）、轻微（蓝色）四级分别独立显示
   - 顶部显示总问题数 summary

## 影响范围

- `apps/dh-frontend/src/components/chat/AssistantMessage.tsx`：正则常量 + cleanText replace
- `apps/dh-frontend/src/components/chat/ReviewReportCard.tsx`：`resolveReportPath` 增强、统计 UI 重做、`handleAdopt` 使用 URL params
- `apps/dh-frontend/src/components/chat/ChatThread.tsx`：接口扩展 + props 透传
- `apps/dh-frontend/src/pages/ProjectCode.tsx`：useEffect 改为同时读 location.state + URL search params，移除 repoPath 强制要求
