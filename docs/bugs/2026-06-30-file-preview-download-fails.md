# Bug: AI 生成的文件预览/下载失败

## 现象

当 Claude Code 调用 Write 工具生成文件并在回复中插入 `[[FILE:mulerun-product-report.md]]` 标记后：
1. 点击文件卡片的「预览」，左侧内联预览显示"加载文件失败或文件不存在"。
2. 点击「下载」，浏览器提示"无法从网站上提取文件"。
3. 在 workspace 目录下未找到对应的文件。

## 根因

Claude Code 的 Write 工具参数中包含 `file_path` 和 `content`，但 `claude-plugin` 仅把 tool use/result 映射为前端事件（`agent.thinking`），没有在本地文件系统实际执行写入。因此前端虽然能解析出 `[[FILE:...]]` 标记并展示文件卡片，但文件不存在，预览和下载都会失败。

## 解决方案

在 `crates/claude-plugin/src/instance.rs` 中：
1. 新增 `apply_write_tool` 方法，从 tool input 中读取 `file_path`、`content`、`append`。
2. 在 `process_received_value` 中，当 `ProcessEvent::ToolUse` 的 `name == "write"` 时调用 `apply_write_tool`。
3. 写入前检查目标路径必须位于 instance 的 `workspace` 根目录内，禁止越界写入；自动创建父目录。

## 验证

- `cargo check --bin dh-gatewayd` 通过
- `cargo build --bin dh-gatewayd` 通过
- gatewayd 已重启为新构建版本
- 文件读取 API `/api/v1/files/content` 对真实存在的测试文件返回正常
- 等待用户再次触发 Write 工具后，确认文件卡片可正常预览/下载
