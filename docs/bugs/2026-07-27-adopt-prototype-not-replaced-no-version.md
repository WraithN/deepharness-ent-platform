# 2026-07-27 采纳原型到产品空间未替换内容且未生成版本

## 现象

在聊天中点击原型预览面板的「采纳到产品空间」按钮后：

1. 产品空间中对应原型文件的内容没有被替换为新生成的内容。
2. 产品空间条目的 `current_version` 没有递增，版本历史保持不变（例如始终显示「共 0 版」）。
3. 当该原型已关联需求时，也没有生成新的「产品设计版本」。

复现场景：同一个需求多次生成原型并点击采纳，产品空间只保留了第一次导入的内容，后续采纳均无效。

## 根因

后端 `apps/dh-backend/domain/productspace/service/db_service.go` 中的 `ImportPrototype` 方法在遍历磁盘原型文件时，遇到数据库中已存在的相对路径会直接 `return nil` 跳过：

```go
if _, ok := existing[relPath]; ok {
    return nil
}
```

这导致：

- 已存在的原型文件不会被更新为磁盘上的最新生成内容。
- 由于不更新，`product_docs.current_version` 不会递增，`product_doc_versions` 也不会产生新的历史快照。
- handler 层返回的 `importedIDs` 为空，因此 `workitem_design_versions` 也不会被创建。

## 解决方案

1. 在 `ImportPrototype` 中查询已存在条目时同时读取 `id` 与 `relative_path`，建立 `relative_path -> id` 映射。
2. 遍历文件时若文件已存在，调用新提取的 `updatePrototypeContentByID` 方法：
   - 比较新旧文件内容，如果相同则跳过（避免无意义版本）。
   - 如果内容不同，则备份当前文件到 `versions/` 目录、写入新内容、在 `product_doc_versions` 插入快照，并将 `product_docs.current_version` 加 1。
3. 将原有 `UpdateContent` 中的原型更新逻辑抽取为 `updatePrototypeContentTx`，供 `UpdateContent` 与 `updatePrototypeContentByID` 复用，避免重复代码。
4. 更新后的条目 ID 也加入 `affectedIDs` 返回给 handler，确保关联需求和生成设计版本的逻辑仍然生效。
5. 当没有任何新增或更新时，返回空列表，避免创建无意义的设计版本。

验证：

- `go build ./...` 通过。
- `go vet ./...` 通过。
- `pnpm build` 通过（前端构建成功，后端二进制构建成功）。

涉及文件：

- `apps/dh-backend/domain/productspace/service/db_service.go`
