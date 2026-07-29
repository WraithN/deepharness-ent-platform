# /prd-write 采纳到产品空间后 PRD 不可见

## 现象

用户使用 `/prd-write` 指令生成 PRD 文档并点击"采纳到产品空间"后：
- 采纳按钮显示"已采纳到产品空间"（API 调用成功）
- 但在产品空间点击"需求看板"或"需求设计"时，看不到对应的 PRD 文档
- 数据库 `product_docs` 表中已有记录，但 `workitem_doc_links` 表中没有对应的关联

## 根因

采纳到产品空间需要两步操作：
1. **导入文档**：`ImportDoc` 将文件内容写入 `product_docs` 表
2. **创建关联**：`ImportDoc` handler 在 `workitemId` 非空时，调用 `CreateDocLink` 创建需求与文档的关联

问题出在第二步：`workitemId` 为空时跳过了关联创建。

`workitemId` 来源链：
```
Chat.tsx effectivePrototypeWorkitemId
  -> AssistantMessage.tsx workitemId prop
    -> resolvedWorkitemId (workitemId || 按标题匹配)
      -> FileAttachmentCard / PrototypeCard 的 workitemId prop
        -> productSpaceApi.importDoc(workspaceId, path, workitemId)
```

`effectivePrototypeWorkitemId` 的解析优先级：
1. `quotedCard?.id`（useState，发送消息后即被 `setQuotedCard(null)` 清除）
2. `resolveWorkitemIdByTitle(protoMakeRequirementTitle, requirements)`（按标题匹配）

**页面刷新后**：
- `quotedCard` 被重置为 null（useState 丢失）
- `protoMakeRequirementTitle` 也被重置（useState 丢失）
- 两个来源均为空 → `effectivePrototypeWorkitemId` 为 undefined → `workitemId` 为空 → 不创建 doc link

虽然消息历史中保存了 `quotedCard` 元数据（`message.metadata.custom.quotedCard`），但 `effectivePrototypeWorkitemId` 未从消息历史回溯。

## 解决方案

### 1. 新增 `findLatestQuotedReqFromMessages` 回溯函数
从 `messages` 数组倒序查找最近一条 `metadata.custom.quotedCard.type === 'req'` 的用户消息，返回 `{ id, title }`。

### 2. `effectivePrototypeWorkitemId` 增加第三层兜底
```
1. quotedCard?.id（当前引用卡片）
2. resolveWorkitemIdByTitle（按标题匹配）
3. fallbackQuotedReq?.id（从消息历史回溯）← 新增
```

### 3. 新增 `effectiveRequirementTitle` 替代直接传值
```
protoMakeRequirementTitle || quotedCard?.title || fallbackQuotedReq?.title
```
确保 `AssistantMessage` 的 `resolvedWorkitemId` 标题匹配兜底也有效。

### 4. `handleReqBreakdownSubmit` 增加通用回溯兜底
```
rootParentId = lastReqBreakdownRootId.current
  || quotedCard?.id
  || findReqBreakdownParentId(messages)     // 专门查找 /req-breakdown
  || fallbackQuotedReq?.id                   // 通用回溯 ← 新增
```

## 幂等性审查结果

| 采纳流程 | 幂等？ | 说明 |
|---------|--------|------|
| ImportDoc（文档/PRD） | 是 | `fetchItemByRelativePath` 检查已存在，存在则 `UpdateContent` |
| ImportPrototype（原型） | 是 | 按 `relative_path LIKE` 前缀查询已存在条目，存在则更新 |
| CreateDocLink（需求关联） | 是 | `ON CONFLICT (workitem_id, product_space_item_id) DO UPDATE` |
| CreateDesignVersion（设计版本） | 否 | 每次采纳创建新版本（可接受，记录历史） |
| ReqBreakdownSubmit（需求拆分） | 是 | 已创建的 workitemId 回写 JSON，提交时排除 |

## 验证结果
- TypeScript 编译通过
- Go 编译 + vet 通过
- 开发环境重启正常
