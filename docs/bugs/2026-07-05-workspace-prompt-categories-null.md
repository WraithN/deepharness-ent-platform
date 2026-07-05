# 工作空间提示词未分类时返回 `categories: null`

## 现象

在调用 `GET /api/v1/workspaces/{id}/prompts` 或 `GET /api/v1/workspaces/{id}/prompts/{promptId}` 时，如果某个提示词没有关联任何分类，接口返回的 `categories` 字段为 `null`：

```json
{
  "id": "...",
  "name": "AI 测试提示词4",
  "categories": null
}
```

前端 `WorkspacePrompt` 类型声明 `categories` 为 `PromptCategory[]`，`null` 会导致 `.map()` 等数组操作抛出异常，或在 UI 上无法正确显示“未分类”状态。

## 根因

`DBWorkspacePromptService.List` 与 `get` 在加载分类时，通过 `listCategoriesForPrompts` 拿到 `map[string][]PromptCategory`。对于没有关联分类的提示词，从 map 中取值会返回 `nil`（Go 的 map 缺失键默认值），代码直接将该 `nil` 赋值给 `Categories`：

```go
prompts[i].Categories = categoriesMap[prompts[i].ID]
```

虽然服务中新建对象时设置了 `Categories: []PromptCategory{}`，但在后续填充关联数据时被覆盖成了 `nil`，最终 JSON 序列化为 `null`。

## 解决方案

在 `apps/dh-backend/domain/workspace/service/prompt_service.go` 中：

1. `List` 填充分类时，判断 map 中是否存在该提示词：
   - 存在则使用取出的分类列表；
   - 不存在则保留空切片 `[]PromptCategory{}`。
2. `get` 方法同样只在 map 中存在对应分类时才赋值，否则保持空切片。

修复后，无分类提示词返回稳定的空数组：

```json
{
  "id": "...",
  "name": "AI 测试提示词4",
  "categories": []
}
```

## 验证

- 后端：`go vet ./...` 无警告，`go build` 成功。
- 通过 curl 调用 `/workspaces/ws-default/prompts`，无分类提示词返回 `categories: []`。
- 前端空间设置 → 提示词配置页面可正常展示卡片和“未分类”标签，点击卡片弹窗无异常。
