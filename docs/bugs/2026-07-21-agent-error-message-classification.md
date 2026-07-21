# 模型错误信息细化

## 现象
Agent 运行出错时，用户看到的信息过于笼统：
- `RUN_ERROR` 事件：直接展示原始错误消息 `运行出错：${errorMsg}`，未做分类引导
- `RUN_FINISHED` 无输出时：统一提示"模型未返回任何内容，请检查模型配置、网络或账户余额后重试"
- `session.error` 的 payload 在 opencode-plugin mapper 中直接以完整 JSON 字符串 (`payload.to_string()`) 作为错误消息传递，导致前端显示丑陋的 JSON 文本
- 用户无法从错误信息中直接判断是 API Key 问题、余额不足、网络问题还是模型配置问题

## 根因
1. **opencode-plugin `mapper.rs`**：`session.error` 事件映射时，使用 `payload.to_string()` 将整个原始 JSON 作为错误消息，未提取 `message` 字段
2. **前端 `use-ag-ui-chat.ts`**：`RUN_ERROR` 处理器中直接拼接 `运行出错：${errorMsg}`，未对错误消息按类型进行分类和用户引导

## 解决方案

### 1. opencode-plugin mapper.rs — 提取真实错误消息
新增 `extract_error_message()` 函数，从 `session.error` payload 中按优先级提取：
1. `error.message` — 嵌套的具体错误消息
2. `message` — 顶层错误消息
3. `error` 字符串值
4. 完整 JSON 原文（兜底）

### 2. 前端 use-ag-ui-chat.ts — 错误分类引导
新增 `classifyAgentError()` 函数，根据错误消息中的关键词进行分类，提供针对性的用户操作指引：

| 关键词 | 分类引导 |
|--------|---------|
| API Key / 密钥 / unauthorized / 401 | API 密钥无效或已过期，检查 API Key 与 Base URL |
| quota / 余额 / insufficient / billing | 账户余额不足或配额已用完，需充值 |
| rate limit / 429 / 限流 | 请求频率过高被限流，稍后重试 |
| timeout / 超时 / ETIMEDOUT | 模型响应超时，检查网络或服务状态 |
| connect / 网络 / refused / unreachable | 无法连接模型服务，检查 Base URL |
| overloaded / busy / 503 / 502 | 模型服务繁忙或过载，稍后重试 |
| model not found / 404 | 模型不可用或名称错误，检查模型配置 |

分类匹配时展示格式：
```
运行出错：{具体分类引导}

原始错误：{原始错误信息}
```
