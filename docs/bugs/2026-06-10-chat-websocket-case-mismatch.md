# 现象

前端聊天页面发送消息后，只能看到用户自己的消息，完全看不到 AI 的回复。聊天界面没有任何错误提示，但 AI 回复区域始终空白。

影响范围：Chat.tsx 页面的 WebSocket 消息接收与渲染逻辑。

# 根因

后端 API Gateway 使用 Go 的 `json.Marshal` 序列化 `domain.BrokerEvent` 结构体，该结构体字段为大写（`Type`、`Payload`、`Error`），且没有 `json` 标签指定小写别名。因此 WebSocket 消息格式为：

```json
{"Type":"message","Payload":{"ID":"...","Role":"assistant","Content":"..."}}
```

而前端 Chat.tsx 的 `ws.onmessage` 处理代码检查的是小写字段：

```typescript
if (data.type === 'message' && data.payload) {
  const msg = data.payload;
  // ...
}
```

由于 JavaScript 对象属性名大小写敏感，`data.type` 和 `data.payload` 均为 `undefined`，导致所有后端推送的消息被静默丢弃，永远不会进入 `setMessages` 更新流程。

# 解决方案

修改 `apps/web/src/pages/Chat.tsx` 的 WebSocket `onmessage` 处理逻辑，使其同时兼容后端大写字段名和可能的小写字段名：

```typescript
const evType = data.Type || data.type;
const payload = data.Payload || data.payload;
if (evType === 'message' && payload) {
  const msg = payload;
  setMessages(prev => [...prev, {
    id: msg.ID || msg.id || Date.now().toString(),
    role: msg.Role || msg.role || 'assistant',
    content: msg.Content || msg.content || '',
    type: msg.Type || msg.type || 'text',
    artifact: msg.Metadata?.artifact || msg.metadata?.artifact,
  }]);
}
```

验证结果：
1. 使用测试脚本模拟前端完整 WebSocket 交互，成功接收并解析了后端推送的全部 69 条 SSE 流式消息。
2. 前端 `pnpm build` 构建成功。
3. TypeScript `tsc --noEmit` 类型检查通过。
4. Go `go vet ./...` 检查通过。
