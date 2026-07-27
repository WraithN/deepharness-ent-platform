# 原型工作台面板遮挡与 /proto-make 原型卡片缺失

## 一、/proto-make 末尾原型预览卡片缺失

### 现象
执行 `/proto-make` 生成原型后，会话末尾未出现可点击预览的「工程卡片」，用户无法直接预览原型。表现为「会话没有输出完整的内容」。

### 根因
`/proto-make` 指令模板要求 agent 在回复末尾输出 `[[PROJECT:绝对路径]]` 标记，前端 `AssistantMessage` 据此渲染 `ProjectCard`（含「预览页面」按钮，走 `LivePreview` 启动 dev server）。

经排查链路：
- 前端 `projectPaths` 从 text 部件提取 `[[PROJECT:...]]`，`ProjectCard` 仅在 `projectPaths.length > 0` 时渲染；
- 后端 `persistRunAssistant` 通过 `runTextBuilder` 完整累积 `TEXT_MESSAGE_CONTENT` delta 并持久化，字段名（`text`）与前端 `StoredContentPart` 一致，排除持久化丢失与字段不匹配；
- 文本折叠不影响卡片渲染（卡片在文本块之外提取）。

实际根因：agent（coding agent）在执行完工具调用（写文件 + build）后，最终 text 回复未输出 `[[PROJECT:...]]` 标记（或仅输出在 thinking/reasoning 中），导致前端提取不到标记，卡片不出现。这是 agent 行为不稳定问题，难以仅靠提示词约束彻底解决。

### 解决方案
在 dh-backend 的 AGUIHandler 中增加 `/proto-make` 兜底机制（`apps/dh-backend/gateway/handler/agui.go`）：

1. 新增 `scanRecentPrototypeProjects(workspacePath, since)`：扫描 `{WORKSPACE_PATH}/products/prototypes/` 下修改时间不早于 run 开始时间的工程目录（按时间倒序），仅识别本次 run 期间新建的工程，避免误判历史工程。
2. 新增 `buildProtoProjectMarker(projects)`：构造 `[[PROJECT:绝对路径]]` 标记文本。
3. 新增闭包 `emitProtoFallbackMarker`：在 `RUN_FINISHED` 时，若 `intentCommand == "/proto-make"` 且累积文本不含 `[[PROJECT:`，则扫描产物目录，合成 `TEXT_MESSAGE_CONTENT` 事件经 `processEvent` 累积到 runState 并通过 `writeEvent` 发给前端，随后 `persistRunAssistant` 持久化。

这样无论 agent 是否输出标记，只要本次 run 新建了原型工程目录，前端实时流与历史恢复都能看到原型预览卡片。同时保留诊断日志，便于追踪 agent 实际输出情况。

### 验证
- `go vet ./...` / `go build ./...` 通过；
- 待真实环境执行 `/proto-make` 验证卡片出现。

---

## 二、产品空间原型管理界面版本/批注面板遮挡文件列表

### 现象
产品空间「原型」管理界面（`PrototypeWorkspace`）右侧栏中，版本历史与批注评论面板采用固定 `h-[30%]` 高度且 `shrink-0`，当版本/批注较多时会占据大量空间，遮挡上方页面文件列表，且无法滚动查看被遮挡内容。

### 根因
右侧栏 `aside` 为 `flex flex-col`，`PageTreePanel`（页面树）为 `flex-1`，`VersionsPanel` 与 `CommentsPanel` 各占 `h-[30%] min-h-[180px] shrink-0`。版本/批注内容多时，两个固定高度面板挤压页面树，导致文件列表被遮挡且无独立滚动。

### 解决方案
改造 `apps/dh-frontend/src/components/workspace/PrototypeWorkspace.tsx`：

1. **可折叠面板**：`VersionsPanel` 与 `CommentsPanel` 改用 `Collapsible`（Radix），标题栏点击展开/收起。版本默认收起（少用），批注默认展开（常用）。
2. **独立滚动条**：各面板展开内容区使用固定高度（`VERSIONS_PANEL_CONTENT_HEIGHT=200` / `COMMENTS_PANEL_CONTENT_HEIGHT=220`）+ `ScrollArea`，内部独立滚动，不再挤压页面树。
3. **页面滚动条**：`aside` 增加 `overflow-y-auto`；页面树区设 `minHeight: 260px`，当三区总高超出视口时整个右侧栏可滚动。
4. **标题栏数量**：版本/批注标题栏以 badge 形式展示当前数量（`{versions.length}` / `{comments.length}`）。
5. **批注序号**：批注列表项按添加顺序编号（最早为 1，最新为 N），在头像右上角以琥珀色角标显示，与列表顺序（最新在上）对应。
6. **批注弹窗加大**：`AnnotationDialog` 由 `sm:max-w-md` 调整为 `sm:max-w-2xl`，输入框由 `min-h-[80px]` 加大为 `min-h-[140px]`，选中元素文本改为 `break-words` 完整展示。
7. **点击批注定位**：
   - 前端：批注列表项可点击，触发 `handleLocateComment` 向 iframe `postMessage` `dh-focus-marker`（携带批注 id）。
   - 前端 `toFrameMarkers` 增加 `id` 字段随 marker 下发。
   - 后端 `apps/dh-backend/domain/productspace/handler.go` 标注脚本：`renderMarkers` 为 marker 添加 `data-comment-id`；新增 `focusMarker(id)` 函数处理 `dh-focus-marker` 消息，滚动到对应标记并触发 `dh-marker-focus` 闪烁高亮动画（2.2s）。

### 验证
- `tsc --noEmit -p tsconfig.check.json` 通过（0 errors）；
- `biome lint` 通过；
- `go vet` / `go build` 通过；
- 待重启后于原型管理界面验证：折叠/展开、滚动、数量展示、批注序号、点击定位、弹窗尺寸。

---

## 三、补充调整：批注标记数字化与同元素单批注约束

### 现象
- 画布上的批注标记为纯红点，无法与批注列表的序号对应，定位时不直观。
- 同一元素可被重复添加多条批注，产生冗余标记。

### 根因
- 后端 `renderMarkers` 仅渲染 12px 红点，未携带/展示序号；前端 `toFrameMarkers` 未传递序号。
- 标注点击事件处理未校验目标元素是否已有批注，同一 `selector` 可重复添加。

### 解决方案
1. **标记数字化**：前端 `toFrameMarkers` 为每个 marker 计算与批注列表一致的序号（`seq = total - idx`，最早为 1），随 marker 下发；后端 `renderMarkers` 将 marker 由 12px 红点改为 22px 圆形徽标，居中显示序号（白色加粗），与批注列表序号一一对应。
2. **同元素单批注**：前端 `dh-annotate-click` 事件处理在弹出批注对话框前，检查 `comments` 中是否已存在相同 `selector` 的批注，若存在则 toast 提示并阻止添加；`useEffect` 依赖改为 `[comments]` 以读取最新批注列表。

### 验证
- `tsc --noEmit` / `biome lint` / `go vet` / `go build` 均通过；服务重启健康检查 200。
- 待原型界面验证：标记数字与列表序号一致、同一元素重复点击被拦截提示。
