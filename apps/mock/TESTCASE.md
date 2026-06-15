# Agent Mock 测试用例

> Agent Mock Service (port 19090) 支持以下场景的 SSE 流式响应测试。
> 在前端聊天框输入对应关键词即可触发不同场景。

---

## 1. 简单文本回复 (simple)

**触发关键词**：任意不包含其他场景关键词的输入

**用户输入示例**：
```
你好
介绍一下你自己
今天天气怎么样
```

**预期效果**：
- 单条 text 流式输出
- 回复内容包含用户原始消息的回显

---

## 2. Thinking 思考过程 (thinking)

**触发关键词**：`think`, `思考`, `推理`, `分析`

**用户输入示例**：
```
分析一下这个问题
think about this
请推理一下解决方案
```

**预期效果**：
- 先输出 reasoning 块（折叠/可展开）
- 再输出最终 text 回复
- 显示多步思考过程

---

## 3. 通用工具调用 (tool_use)

**触发关键词**：`tool`, `file`, `read`, `搜索`, `查找`

**用户输入示例**：
```
帮我搜索一下相关文件
读取项目配置
tool use test
```

**预期效果**：
- text 引导语
- tool_use (read_file) pending 状态
- tool_result completed 状态，返回文件内容
- 最终 text 总结

---

## 4. 读代码文件 (read_code)

**触发关键词**：`读代码`, `read code`, `查看代码`, 包含"代码"+"读/看"

**用户输入示例**：
```
读一下 Button 组件的代码
read code from components
查看代码文件
```

**预期效果**：
- text 引导语
- tool_use (read_file) 读取 Button.tsx
- tool_result 返回完整 React 组件代码
- text 分析总结代码设计亮点

---

## 5. 写代码文件 (write_code)

**触发关键词**：`写代码`, `write code`, `create file`, `新建文件`, `生成代码`

**用户输入示例**：
```
帮我写一个 Modal 组件
write code for a dialog
新建一个工具函数文件
生成代码实现登录功能
```

**预期效果**：
- text 引导语
- tool_use (write_file) 写入 Modal.tsx
- tool_result 返回写入成功信息
- text 展示写入的完整代码
- text 总结组件特性

---

## 6. 读 Markdown 文件 (read_markdown)

**触发关键词**：`读md`, `读markdown`, `read markdown`, `读文档`, `读readme`

**用户输入示例**：
```
读一下 API 文档
read markdown file
查看 README
读文档
```

**预期效果**：
- text 引导语
- tool_use (read_file) 读取 API.md
- tool_result 返回 Markdown 文档内容（含表格）
- text 分析总结文档结构

---

## 7. 写 Markdown 文件 (write_markdown)

**触发关键词**：`写md`, `写markdown`, `write markdown`, `写文档`, `写readme`

**用户输入示例**：
```
帮我写一份项目 README
write markdown documentation
写文档介绍项目
写 readme
```

**预期效果**：
- text 引导语
- tool_use (write_file) 写入 README.md
- tool_result 返回写入成功信息
- text 展示写入的完整 Markdown 内容
- text 总结文档结构

---

## 8. 上下文压缩 (context_compression)

**触发关键词**：`压缩`, `compress`, `context compression`, 包含"上下文"+"压缩"

**用户输入示例**：
```
压缩一下上下文
context compression
上下文太长了，压缩一下
```

**预期效果**：
- text 提示超出 token 限制
- context_compression 块显示摘要内容
- text 恢复对话继续

---

## 9. 多步骤任务 (multi_step)

**触发关键词**：`多步骤`, `multi step`, `步骤`, `plan`, `规划`, `执行多个`

**用户输入示例**：
```
帮我执行多步骤任务
multi step workflow
规划一下项目初始化步骤
执行多个操作：读配置、装依赖、写代码
```

**预期效果**：
- text 步骤规划引导
- 步骤 1: tool_use read_file (package.json)
- 步骤 2: tool_use execute_command (npm install)
- 步骤 3: tool_use write_file (api.ts)
- text 最终总结所有步骤完成情况

---

## 10. 工具调用超时 (tool_timeout)

**触发关键词**：`超时`, `timeout`, `慢`, `slow`

**用户输入示例**：
```
执行一个慢查询
slow database query
timeout test
查询大数据表
```

**预期效果**：
- text 引导语
- tool_use (execute_command) pending 状态
- 多次进度提示（查询执行中...）
- tool_result timeout 状态，返回超时错误
- text 给出优化建议

---

## 11. 网络错误重试 (network_retry)

**触发关键词**：`重试`, `retry`, `网络`, `network`, `断网`, `失败`

**用户输入示例**：
```
调用一个不稳定的外部 API
network retry test
网络错误重试
断网后恢复
```

**预期效果**：
- text 引导语
- 第 1 次 tool_use fetch_url → failed (ECONNREFUSED)
- text 显示重试中
- 第 2 次 tool_use fetch_url → failed (ETIMEDOUT)
- text 显示再次重试
- 第 3 次 tool_use fetch_url → completed，返回 API 数据
- text 总结重试过程和最终结果

---

## 12. 错误场景 (error)

**触发关键词**：`错误`, `error`

**用户输入示例**：
```
模拟一个错误
error test
故意出错
```

**预期效果**：
- session.error 事件
- 显示错误消息和错误码

---

## 快速测试命令

```bash
# 测试简单文本
curl -N -X POST http://localhost:19090/session/test-123/prompt \
  -H "Content-Type: application/json" \
  -d '{"parts":[{"type":"text","text":"你好"}]}'

# 测试读代码
curl -N -X POST http://localhost:19090/session/test-123/prompt \
  -H "Content-Type: application/json" \
  -d '{"parts":[{"type":"text","text":"读一下代码"}]}'

# 测试多步骤
curl -N -X POST http://localhost:19090/session/test-123/prompt \
  -H "Content-Type: application/json" \
  -d '{"parts":[{"type":"text","text":"多步骤任务"}]}'
```

## 前端测试方式

在 Chat 页面输入框中输入上述**用户输入示例**中的任意一条，即可触发对应场景。
