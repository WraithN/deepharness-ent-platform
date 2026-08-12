# 2026-08-11 工程卡片「查看 Diff / 查看工程 / 预览」全部不可用

## 现象

会话中的工程卡片（如 pefect-chinese-name）三个操作按钮全部"用不了"：

- **查看 Diff / 查看工程**：点击完全无反应——左侧预览面板不切换内容，dh-backend 日志中没有任何对应请求；
- **预览页面**：左侧面板打开但显示"该项目暂不支持页面预览 / 仅前端工程可启动 dev server 预览"，而该工程实际含有 Next.js 前端（`apps/web`）。

## 根因

两个独立缺陷叠加：

### 1. 主因（Diff/工程无反应）：Chat.tsx 误传 `previewOnly` 锁死预览模式

`apps/dh-frontend/src/pages/Chat.tsx` 渲染工程卡片的 `LivePreview` 时传了 `previewOnly`，而 `LivePreview` 内部 `activeMode = previewOnly ? 'preview' : effectiveMode`——**无论 prop 传入什么模式都强制锁定为 preview**。点击"查看 Diff"/"查看工程"虽正确更新了 `projectPreview.mode`（`diff`/`code`），但 `activeMode` 恒为 `preview`：不触发 `loadDiff`/`loadFileTree`（故无任何网络请求），面板内容不变，头部 Diff/代码/预览切换 Tab 也被 `{!previewOnly && ...}` 隐藏。用户观感即"点了没反应"。

`previewOnly` 的正确用例是 `ProjectCode.tsx` 的"预览模式"专用视图（保留未动）。

### 2. 预览误判：monorepo 前端检测只看根目录 package.json

`personal-stub` 的 `IsNodeFrontendProject` 只读取工程**根目录** package.json 的依赖。该工程是 turbo monorepo（根仅含 turbo/typescript），前端在 `apps/web`（Next.js），因此误判为非前端，`preview/start` 返回 `{"port":0,"isFrontend":false}`，前端展示"暂不支持预览"。

## 解决方案

### 1. 前端：`Chat.tsx` 移除工程卡片 LivePreview 的 `previewOnly`

恢复 Diff/代码/预览三模式切换与头部 Tab 显示。`ProjectCode.tsx` 的 `previewOnly` 为预览专用视图的正确用法，保持不变。

### 2. personal-stub：monorepo 前端目录定位

- `devserver_manager.go` 新增 `FindFrontendDir(projectPath) (string, bool)`：根 package.json 含前端依赖返回根目录；否则按常见 monorepo 布局下钻一层（`apps/*`、`packages/*`、`web/`、`frontend/`、`client/`，确定性顺序），返回第一个含前端依赖的子目录。依赖判定提取为 `hasFrontendDeps`（复用原逻辑），前端依赖清单提取为包级变量。
- `preview.go`：`PreviewStart` 在 `FindFrontendDir` 返回的**前端子目录**中启动 dev server（monorepo 根目录没有可运行的 dev 脚本）；新增 `resolveServerKey` 使 `PreviewStop`/`PreviewStatus` 用同一目录键换算，保证生命周期一致。单目录工程行为不变（返回根目录，向后兼容）。

### 验证结果

- 临时单测 3 用例（根即前端 / monorepo 下钻 apps/web / 非前端不命中）全部通过；按仓库惯例测试文件验收后已删除。
- `apps/personal-stub`：`go build ./... && go vet ./...` 0 warning；前端 `tsc` 检查 Chat.tsx 0 error（MessageMarkers.tsx 有 5 个**本次之前已存在**的存量 error，与本次改动无关，未处理）。
- 全链路重启后实测（带 auth 走 dh-backend → personal-stub 代理）：
  - `preview/start` → `{"port":4000,"isFrontend":true}`，dev server 在 `apps/web` 启动并就绪；
  - `preview/stop` → 204，`preview/status` → `{"port":0,"running":false}`，生命周期正确；
  - `projects/tree`、`projects/diff` → 200 正常返回数据。
- 浏览器侧预期：点击"查看 Diff"/"查看工程"面板正常切换并加载内容；"预览页面"可启动 dev server。

### 遗留说明（非平台问题）

该工程当前代码自身有类型错误（`apps/web/src/app/api/generate/route.ts`：OpenAI 客户端误用，agent 实施中产生的中间状态），Next.js 根页面返回 500。这是**工程自身代码状态**，与平台预览链路无关；待 agent 完成/修复该文件后页面即可正常渲染。

## 相关代码

- `apps/dh-frontend/src/pages/Chat.tsx` — 工程卡片 LivePreview 挂载点。
- `apps/dh-frontend/src/components/chat/LivePreview.tsx` — `previewOnly` 模式锁逻辑。
- `apps/personal-stub/gateway/handler/devserver_manager.go` — `FindFrontendDir` / `hasFrontendDeps`。
- `apps/personal-stub/gateway/handler/preview.go` — `PreviewStart` / `resolveServerKey`。
