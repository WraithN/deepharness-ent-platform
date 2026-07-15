# Aurora 极光主题替换设计文档

> 日期：2026-07-13  
> 范围：`apps/dh-frontend` 全局浅色/深色主题  
> 决策：完全替换原有配色，沿用现有 shadcn token 名，同步调整组件硬编码颜色。

---

## 1. 目标与范围

### 1.1 目标
- 将前端整体视觉从「浅色商务蓝 + Dracula 紫」切换为 **Aurora 极光主题**。
- 暗色主题不再使用纯黑/高饱和紫，改为深空蓝灰分层 + 极光蓝主色。
- 亮色主题从纯白改为清爽蓝灰系，降低长时间使用疲劳。

### 1.2 范围
- **全局 CSS 变量**：`apps/dh-frontend/src/index.css` 中 `:root` 与 `.dark` 的全部 token。
- **Tailwind 配置**：`tailwind.config.js` 颜色键已绑定 CSS 变量，原则上不新增键。
- **自定义工具类**：`.soft-shadow`、`.claude-card`、`.tech-border`、`.markdown-preview`、`.tree-dir`、`WangEditor` 适配。
- **组件硬编码颜色**：`CodeBlock`、`VersionHistoryMode`、`AdminDashboard`、`ProjectCode` 等写死色值统一回归 Aurora 语义色。
- **设计文档**：同步更新 `DESIGN.md` 色彩系统章节。

---

## 2. 设计决策

| 决策项 | 选择 | 说明 |
|--------|------|------|
| token 命名 | 沿用现有 shadcn 变量名 | 改动最小，Tailwind 映射无需调整 |
| 暗色主色 | 极光蓝 `#3B82F6` | 不再保留 Dracula 紫 `#BD93F9`；紫色仅用于渐变点缀 |
| 紫色用途 | 主按钮/Logo 渐变 | `linear-gradient(90deg, #3B82F6, #8B5CF6)` |
| 状态色 | 绿/橙/红保持 Aurora 色值 | success `#10B981`、warning `#F59E0B`、destructive `#EF4444` |
| 边框风格 | 柔和半透明 | 浅色用 `#E2E8F0`，深色用 `rgba(148,163,184,0.16)` |

---

## 3. Token 映射

### 3.1 浅色主题（`:root`）

| Token | 色值 | HSL | Aurora 语义 |
|-------|------|-----|-------------|
| `--background` | `#F8FAFC` | `210 40% 98%` | `--bg-main` |
| `--foreground` | `#1E293B` | `217 33% 17%` | `--text-primary` |
| `--card` | `#FFFFFF` | `0 0% 100%` | `--bg-card` |
| `--card-foreground` | `#1E293B` | `217 33% 17%` | `--text-primary` |
| `--popover` | `#FFFFFF` | `0 0% 100%` | `--bg-card` |
| `--popover-foreground` | `#1E293B` | `217 33% 17%` | `--text-primary` |
| `--primary` | `#3B82F6` | `217 91% 60%` | `--brand-blue` |
| `--primary-foreground` | `#FFFFFF` | `0 0% 100%` | 主色上文字 |
| `--secondary` | `#F1F5F9` | `210 40% 96%` | `--bg-deep` |
| `--secondary-foreground` | `#475569` | `215 19% 35%` | `--text-secondary` |
| `--muted` | `#F1F5F9` | `210 40% 96%` | `--bg-deep` |
| `--muted-foreground` | `#64748B` | `215 16% 47%` | `--text-muted` |
| `--accent` | `#EFF6FF` | `214 100% 97%` | `--bg-elevated` |
| `--accent-foreground` | `#3B82F6` | `217 91% 60%` | `--brand-blue` |
| `--destructive` | `#EF4444` | `0 84% 60%` | `--brand-red` |
| `--destructive-foreground` | `#FFFFFF` | `0 0% 100%` | 危险色上文字 |
| `--border` | `#E2E8F0` | `214 32% 91%` | `--border-soft` |
| `--input` | `#E2E8F0` | `214 32% 91%` | `--border-soft` |
| `--ring` | `#3B82F6` | `217 91% 60%` | `--brand-blue` |
| `--sidebar-background` | `#F1F5F9` | `210 40% 96%` | `--bg-deep` |
| `--sidebar-foreground` | `#475569` | `215 19% 35%` | `--text-secondary` |
| `--sidebar-primary` | `#3B82F6` | `217 91% 60%` | `--brand-blue` |
| `--sidebar-primary-foreground` | `#FFFFFF` | `0 0% 100%` | 主色上文字 |
| `--sidebar-accent` | `#FFFFFF` | `0 0% 100%` | `--bg-card`（激活菜单背景） |
| `--sidebar-accent-foreground` | `#1E293B` | `217 33% 17%` | `--text-primary` |
| `--sidebar-border` | `#E2E8F0` | `214 32% 91%` | `--border-soft` |
| `--sidebar-ring` | `#3B82F6` | `217 91% 60%` | `--brand-blue` |
| `--success` | `#10B981` | `160 84% 39%` | `--brand-green` |
| `--warning` | `#F59E0B` | `38 92% 50%` | `--brand-orange` |
| `--info` | `#3B82F6` | `217 91% 60%` | `--brand-blue` |
| `--chart-1` | `#3B82F6` | `217 91% 60%` | 主色 |
| `--chart-2` | `#8B5CF6` | `258 90% 66%` | 极光紫 |
| `--chart-3` | `#10B981` | `160 84% 39%` | 成功绿 |
| `--chart-4` | `#F59E0B` | `38 92% 50%` | 警告橙 |
| `--chart-5` | `#EF4444` | `0 84% 60%` | 危险红 |

### 3.2 深色主题（`.dark`）

| Token | 色值 | HSL | Aurora 语义 |
|-------|------|-----|-------------|
| `--background` | `#1E293B` | `217 33% 17%` | `--bg-main` |
| `--foreground` | `#F1F5F9` | `210 40% 96%` | `--text-primary` |
| `--card` | `#2A374B` | `216 28% 23%` | `--bg-card` |
| `--card-foreground` | `#F1F5F9` | `210 40% 96%` | `--text-primary` |
| `--popover` | `#2A374B` | `216 28% 23%` | `--bg-card` |
| `--popover-foreground` | `#F1F5F9` | `210 40% 96%` | `--text-primary` |
| `--primary` | `#3B82F6` | `217 91% 60%` | `--brand-blue` |
| `--primary-foreground` | `#0F172A` | `222 47% 11%` | 深色主色上文字 |
| `--secondary` | `#2A374B` | `216 28% 23%` | `--bg-card` |
| `--secondary-foreground` | `#CBD5E1` | `213 27% 84%` | `--text-secondary` |
| `--muted` | `#334155` | `215 25% 27%` | `--bg-hover` |
| `--muted-foreground` | `#94A3B8` | `215 20% 65%` | `--text-tertiary` |
| `--accent` | `#3E4C65` | `218 24% 32%` | `--bg-elevated` |
| `--accent-foreground` | `#F1F5F9` | `210 40% 96%` | `--text-primary` |
| `--destructive` | `#EF4444` | `0 84% 60%` | `--brand-red` |
| `--destructive-foreground` | `#FFFFFF` | `0 0% 100%` | 危险色上文字 |
| `--border` | `rgba(148,163,184,0.16)` | `215 20% 65% / 0.16` | `--border-soft` |
| `--input` | `rgba(148,163,184,0.16)` | `215 20% 65% / 0.16` | `--border-soft` |
| `--ring` | `#3B82F6` | `217 91% 60%` | `--brand-blue` |
| `--sidebar-background` | `#0F172A` | `222 47% 11%` | `--bg-deep` |
| `--sidebar-foreground` | `#94A3B8` | `215 20% 65%` | `--text-tertiary` |
| `--sidebar-primary` | `#3B82F6` | `217 91% 60%` | `--brand-blue` |
| `--sidebar-primary-foreground` | `#0F172A` | `222 47% 11%` | 深色主色上文字 |
| `--sidebar-accent` | `#2A374B` | `216 28% 23%` | `--bg-card` |
| `--sidebar-accent-foreground` | `#F1F5F9` | `210 40% 96%` | `--text-primary` |
| `--sidebar-border` | `rgba(148,163,184,0.16)` | `215 20% 65% / 0.16` | `--border-soft` |
| `--sidebar-ring` | `#3B82F6` | `217 91% 60%` | `--brand-blue` |
| `--success` | `#10B981` | `160 84% 39%` | `--brand-green` |
| `--warning` | `#F59E0B` | `38 92% 50%` | `--brand-orange` |
| `--info` | `#3B82F6` | `217 91% 60%` | `--brand-blue` |
| `--chart-1` | `#3B82F6` | `217 91% 60%` | 主色 |
| `--chart-2` | `#8B5CF6` | `258 90% 66%` | 极光紫 |
| `--chart-3` | `#10B981` | `160 84% 39%` | 成功绿 |
| `--chart-4` | `#F59E0B` | `38 92% 50%` | 警告橙 |
| `--chart-5` | `#EF4444` | `0 84% 60%` | 危险红 |

### 3.3 渐变与阴影

```css
:root {
  --gradient-primary: linear-gradient(90deg, #3B82F6 0%, #8B5CF6 100%);
  --gradient-card: linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(248,250,253,0.95) 100%);
  --gradient-background: linear-gradient(180deg, #F8FAFC 0%, #F1F5F9 100%);
  --shadow-card: 0 4px 14px rgba(15, 23, 42, 0.08);
  --shadow-hover: 0 4px 12px rgba(15, 23, 42, 0.12);
}

.dark {
  --gradient-card: linear-gradient(180deg, rgba(42,55,75,0.98) 0%, rgba(30,41,59,0.95) 100%);
  --gradient-background: linear-gradient(180deg, #1E293B 0%, #0F172A 100%);
  --shadow-card: 0 4px 12px rgba(0, 0, 0, 0.18);
  --shadow-hover: 0 4px 12px rgba(0, 0, 0, 0.28);
}
```

---

## 4. 自定义工具类调整

### 4.1 `.soft-shadow`
- 浅色：`0 4px 20px -2px rgba(15,23,42,0.05), 0 0 3px rgba(15,23,42,0.02)`
- 深色：`0 4px 20px -2px rgba(0,0,0,0.3), 0 0 3px rgba(0,0,0,0.2)`

### 4.2 `.claude-card`
- 浅色：从 `#FFFFFF` 渐变到 `#F8FAFC`，边框使用 `rgba(59,130,246,0.04)`。
- 深色：从 `#2A374B` 渐变到 `#1E293B`，边框使用 `rgba(148,163,184,0.08)`。

### 4.3 `.tech-border`
- 浅色：边框 `rgba(59,130,246,0.15)`，外发光 `rgba(59,130,246,0.05)`。
- 深色：边框 `rgba(59,130,246,0.2)`，外发光 `rgba(59,130,246,0.08)`。

### 4.4 `.markdown-preview`
- `h1` 渐变：`#3B82F6 → #8B5CF6`（浅色），`#3B82F6 → #60A5FA`（深色，保持可读）。
- `h2` 左边框使用 `primary`。
- 引用块背景 `muted/50`，左边框 `primary/50`。
- 表格表头渐变使用 `primary → brand-purple`（浅色）或 `primary → info`（深色）。
- 行内代码背景 `primary/8`，文字 `primary`（浅色）；深色改为 `primary/12`。

### 4.5 `.markdown-preview pre.tree-dir`
- 浅色：背景 `#F8FAFC`，左边框 `primary`。
- 深色：背景 `#0F172A/60`，左边框 `primary`。

### 4.6 `WangEditor` 暗色适配
- 工具栏图标颜色改为 `foreground`。
- hover 背景改为 `bg-hover`（`#334155`）。
- 编辑区背景改为 `bg-deep`（`#0F172A`），文字 `foreground`。

---

## 5. 组件硬编码颜色替换

### 5.1 `components/CodeBlock.tsx`
当前写死了 VS Code 风格的 `#1e1e1e` / `#333` / `#d4d4d4`。替换规则：
- 暗色代码块容器背景 → `--bg-deep`（`#0F172A`）
- 头部背景 → `--bg-card`（`#2A374B`）
- 边框 → `--border`
- 文字 → `--foreground` / `--muted-foreground`
- 按钮 hover → `--bg-hover`
- 语法高亮本身（Prism）可保留原有 token 色，只调整外壳。

### 5.2 `components/workspace/VersionHistoryMode.tsx`
Diff 色替换：
- `addedBackground` → `hsl(var(--success) / 0.12)`
- `addedColor` → `hsl(var(--success))`
- `removedBackground` → `hsl(var(--destructive) / 0.12)`
- `removedColor` → `hsl(var(--destructive))`
- `wordAddedBackground` → `hsl(var(--success) / 0.22)`
- `wordRemovedBackground` → `hsl(var(--destructive) / 0.22)`
- 图例色块同步替换。

### 5.3 `pages/AdminDashboard.tsx`
- 图表网格线 → `stroke: hsl(var(--border))`
- 坐标轴文字 → `fill: hsl(var(--muted-foreground))`
- Tooltip 阴影保持通用阴影。
- 柱图 fill：
  - 下载量 → `var(--primary)` `#3B82F6`
  - 统计数量 → `var(--success)` `#10B981`
  - 使用次数 → `var(--chart-2)` `#8B5CF6`
- `COLORS` 常量更新为 Aurora 品牌色序列：`#3B82F6, #10B981, #F59E0B, #8B5CF6, #EF4444, #EC4899, #06B6D4`。

### 5.4 `pages/ProjectCode.tsx` 架构图
- 节点渐变色统一为 Aurora 品牌色：蓝/绿/紫/橙/粉/青/灰/玫瑰。
- 暗色节点 fill 不再使用 Tailwind 的 `blue-950` 等，改用对应深底色（如 `fill: hsl(var(--background))`，stroke 用品牌色）。
- 发光滤镜颜色改为 `primary`。

### 5.5 其他零散硬编码
- `pages/Chat.tsx` 中聊天区背景 `bg-[#f8f9fa] dark:bg-card/30` 改为 `bg-background`。
- `pages/PersonalAssistantPage.tsx` 中 `bg-[#4a72d4]/20` 改为 `bg-primary/20`。
- 所有仅用于布局缩进的 `style={{ paddingLeft: ... }}` 不受影响。

---

## 6. DESIGN.md 同步更新

更新 `/home/nan/deepharness/deepharness-ent-platform/DESIGN.md`：
- 替换「色彩系统」2.1 / 2.2 的色值表为 Aurora 映射。
- 更新「图表色」为 Aurora 序列。
- 更新「设计哲学」中 Dracula 描述为 Aurora 极光科技风。
- 在「变更记录」新增一行：2026-07-13 全局主题替换为 Aurora 极光配色。

---

## 7. 验收标准

- [ ] `apps/dh-frontend/src/index.css` 中所有 token 已按上表替换。
- [ ] `pnpm check-types` 无 TypeScript 错误。
- [ ] `pnpm build` 成功，无新增 warning。
- [ ] 浏览器中切换浅色/深色模式，侧边栏、卡片、表格、按钮、输入框、弹窗均呈现 Aurora 色系。
- [ ] CodeBlock、Diff、Dashboard 图表、ProjectCode 架构图不再出现原有 Dracula / 旧商务蓝突兀色块。
- [ ] `DESIGN.md` 色彩系统章节与代码一致。
