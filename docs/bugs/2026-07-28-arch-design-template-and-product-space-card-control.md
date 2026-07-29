# /arch-design 模板与产品空间卡片控制修复

## 现象

1. **`/arch-design` 指令问题**：之前为修复"复用历史工程"问题加入了强制 `question` 询问步骤，
   导致指令流程被阻断——用户希望根据输入的工程和需求直接生成技术方案文档（含架构图、时序图、
   接口等），而不是先被询问设计方式。

2. **非产品指令出现"采纳到产品空间"卡片**：`FileAttachmentCard` 对所有 Markdown 文件都显示
   "采纳到产品空间"按钮，不区分指令类型。`/code`、`/debug`、`/review` 等非产品指令产出的
   `.md` 文件（如 README、tech-spec）也会出现采纳按钮，不符合预期。

3. **一个指令产出多个卡片**：`/code` 等指令同时输出 `[[PROJECT:...]]` 和 `[[FILE:...]]` 标记时，
   会同时渲染工程卡片和文件附件卡片，违反"每指令单结果卡片"原则。

## 根因

### 1. `/arch-design` 模板过度设计

上一轮修复（`2026-07-28-arch-design-reuses-historical-project.md`）为防止 LLM 复用历史会话
中的代码库，加入了强制 `question` 工具调用步骤。但用户实际需求是：选了工程就基于工程设计，
没选就基于需求从零设计，不需要额外询问。`question` 步骤反而阻断了正常流程。

### 2. "采纳到产品空间"按钮判定过于宽泛

`FileAttachmentCard.tsx:163` 仅以 `isMarkdown`（文件扩展名为 `.md`/`.markdown`）作为显示
采纳按钮的条件。产品空间文件（PRD、原型、调研报告等）与非产品文件（README、tech-spec 等）
都会触发按钮显示。

`InlineFilePreview.tsx:324` 同样仅以 `isMarkdown` 判定。

### 3. 卡片去重逻辑不完整

`AssistantMessage.tsx:326-330` 的去重仅以"是否出现原型卡片"为依据屏蔽普通工程/文件卡片，
未覆盖"普通工程卡片+文件附件同时出现"的场景。`/code` 指令输出 `[[PROJECT:.../projects/my-app]]`
+ `[[FILE:.../projects/my-app/README.md]]` 时，两张卡片同时渲染。

## 解决方案

### 修复1：简化 `/arch-design` 模板

`apps/dh-backend/config/commands.yaml` + `command_config_defaults.go`：

- 移除强制 `question` 询问步骤
- 保留"严禁复用历史会话中的代码库"规则
- 简化分流：已选库 -> 基于工程设计；未选库 -> 基于需求从零设计，无需询问
- 强化文档要求：架构图和时序图标注"必须使用 Mermaid 语法绘制"，接口设计明确包含请求方法、
  路径、参数、响应格式

### 修复2：新增 `isProductSpaceFile` 工具函数

`apps/dh-frontend/src/lib/utils.ts`：

```ts
export function isProductSpaceFile(path: string): boolean {
  return path.includes('/products/prototypes/') || path.includes('/products-jobs/');
}
```

产品空间目录：`products/prototypes/`（原型工程）和 `products-jobs/`（产品文档）。
只有这两个目录下的文件才是产品空间文件，才允许"采纳到产品空间"。

### 修复3：FileAttachmentCard / InlineFilePreview 仅产品空间文件显示采纳按钮

- `FileAttachmentCard.tsx`：`canAdoptToProductSpace = isMarkdown && isProductSpaceFile(path)`，
  采纳按钮和采纳状态查询均以此为条件
- `InlineFilePreview.tsx`：同上

### 修复4：AssistantMessage 工程卡片抑制工程内文件附件

`AssistantMessage.tsx`：在现有原型去重逻辑之后，新增工程目录去重：

```ts
const hasNormalProjectCards = normalProjectPaths.length > 0;
const nonProjectFileAttachments = hasNormalProjectCards
  ? nonPrototypeFileAttachments.filter(path =>
      isProductSpaceFile(path) ||
      !normalProjectPaths.some(projPath => path === projPath || path.startsWith(`${projPath}/`))
    )
  : nonPrototypeFileAttachments;
```

有工程卡片时，属于该工程目录下的文件附件被抑制（已由 ProjectCard 代表）；
产品空间文件（`products-jobs/`）始终保留为独立卡片。

### 验证

- `pnpm --filter @repo/dh-frontend run check-types`：0 errors
- `pnpm --filter @repo/dh-frontend run lint`（biome）：Checked 186 files, No fixes applied
- `go vet ./...`（dh-backend）：0 warnings
- `pnpm build`：6/6 successful
- 后端 API 确认 `/arch-design` 模板：无 question 步骤、含禁止复用历史规则、含 Mermaid 架构图/
  时序图/接口设计要求
- 前端 + 后端服务正常启动（HTTP 200）

### 补充修复：/arch-design 输出目录移出 products-jobs

**问题**：`/arch-design` 未选工程时文件写入 `products-jobs/arch-design/`，命中 `isProductSpaceFile`
的 `products-jobs/` 判断，仍会显示"采纳到产品空间"按钮。

**根因**：`/arch-design` 是唯一写入 `products-jobs/` 但不属于产品指令的命令。路径方案无法区分
"产品指令"和"写入 products-jobs 的非产品指令"。

**修复**：将 `/arch-design` 未选工程时的输出目录从 `{WORKSPACE_PATH}/projects/products-jobs/arch-design/`
改为 `{WORKSPACE_PATH}/projects/arch-design/`（在 `projects/` 下但不在 `products-jobs/` 下）。
这样 `isProductSpaceFile` 返回 false，不显示采纳按钮。

同步修改 `commands.yaml` 与 `command_config_defaults.go`。
