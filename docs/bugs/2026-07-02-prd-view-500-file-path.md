# PRD 页面访问时 500 错误

## 现象
访问 PRD 需求分析页面（`/prd`）时，浏览器 DevTools 报告 `Failed to load resource: the server responded with a status of 500 (Internal Server Error)`，页面无法正常加载 PRD 文件内容和列表。

## 根因
两个问题叠加：

1. **后端进程意外退出**：`go run` 在后台运行不稳定，进程死亡导致所有 API 返回 500（连接拒绝）。
2. **文件路径为绝对路径**：`PrdView.tsx` 中 `filePath` 以 `/` 开头（如 `/prds/test.md`），后端 `safeFilePath()` 将其当作文件系统绝对路径处理，但 `/prds/` 不在 `filesRoot`（`/home/nan/test`）下，导致 `isPathAllowed` 返回 403 Forbidden。

## 解决方案
1. 使用 `nohup` 启动后端进程保证稳定性。
2. `PrdView.tsx:116` 去掉 `filePath` 前导 `/`，改为相对路径（`prds/test.md`），后端会通过 `filepath.Join(filesRoot, path)` 正确解析到工作区根目录下。
