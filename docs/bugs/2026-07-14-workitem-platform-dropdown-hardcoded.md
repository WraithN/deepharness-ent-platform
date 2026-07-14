# 需求管理平台下拉框未读取 config.yaml 配置

## 现象

空间设置「基础配置 → 需求管理平台」下拉框硬编码 Meego/Jira/PingCode 三个选项，而后端 `config.yaml` 的 `workitem.platforms` 只配置了 meego 和 jira，PingCode 并未启用却展示在选项中；且项目 ID 输入框仅对 meego 展示，选择 Jira 时无法填写项目标识。

## 根因

1. 前端 `Settings.tsx` 将平台选项写死为三个 `SelectItem`，未消费后端已加载的 `WorkitemPlatformWhitelist`（该配置此前仅加载到 `cfg`，无任何接口暴露）。
2. 项目 ID 输入框的展示条件写死为 `reqPlatform === 'meego'`。

## 解决方案

1. 后端新增 `GET /api/v1/workitem-platforms`（`domain/workitem/platforms.go`）：将 config 中的平台 key 映射为带元信息的列表（名称、是否需要项目 ID、占位提示），未注册平台按 key 兜底。
2. 平台元信息注册表基于调研结论：Jira（项目 Key/数字 ID）与 PingCode（`/v1/pjm/projects/{project_id}`）均有项目级标识，三个平台均标记 `needsProjectId: true`。
3. 前端下拉选项改为接口数据驱动（失败时回退内置三平台列表），项目 ID 输入框按选中平台的 `needsProjectId` 展示并使用平台专属占位提示；`settings.meegoProject` 重命名为 `reqProjectId`（语义泛化，仍存 `WorkitemProject.externalKey`，无 DB 变更）。

## 验证结果

- curl：`GET /api/v1/workitem-platforms` 返回 `[meego, jira]` 两项，与 config.yaml 一致。
- e2e（Playwright）：下拉框仅展示 Meego/Jira；选择 Jira 后出现项目 ID 输入框，占位为「输入 Jira 项目 Key（如 PROJ）...」。
- `go vet` 0 warnings、`tsc -p tsconfig.check.json` 0 errors、biome 无问题、`pnpm build` 6/6 成功。
