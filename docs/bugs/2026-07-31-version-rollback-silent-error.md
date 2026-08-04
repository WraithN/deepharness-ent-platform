# 版本回滚操作静默忽略文件系统错误

## 现象

产品空间（ProductSpace）的版本回滚与补偿路径中，共 16 处 `stubDeleteFile` / `stubWriteFile` 调用使用 `_ =` 静默忽略了返回的错误。当事务提交失败或 `saveVersionAndUpdateTx` 失败后执行文件系统回滚补偿时，如果补偿操作本身也失败（如 personal-stub 不可用、磁盘满、权限不足），错误被完全吞掉，导致：

1. **文件系统状态不一致**：当前文件未恢复为旧内容、版本快照文件未删除，但数据库事务已回滚，形成"数据库已回滚但文件系统残留新状态"的不一致。
2. **无任何日志**：运维与开发人员无法从日志中察觉补偿失败，难以排查为何文件系统状态与预期不符。

涉及文件与分布：

| 文件 | 忽略错误数 | 场景 |
|------|-----------|------|
| `version_service.go` | 7 | `updatePrototypeContentTx` 写入失败/版本保存失败回滚；`updatePrototypeContentByID` 提交失败回滚；`RestoreVersion` 的 `rollbackFS` 闭包 |
| `folder_service.go` | 7 | `UpdateContent` 原型分支提交失败回滚；文档分支写入失败/版本保存失败/提交失败回滚；`DeleteFolder` 清理空版本目录 |
| `item_service.go` | 2 | `CreateItem` 写入初始文件失败回滚；提交失败回滚 |

## 根因

回滚补偿代码在编写时为了"不中断回滚流程"而使用 `_ =` 丢弃错误，但混淆了"不中断流程"与"不记录错误"两个概念。正确的做法是：补偿操作失败时仍继续执行后续补偿步骤（尽力恢复），但必须将失败记录到日志，以便排查文件系统不一致问题。

## 解决方案

### 1. 提取统一的日志辅助函数

在 `apps/dh-backend/domain/productspace/service/fileutil.go` 中新增两个辅助函数（遵循规则6「重复逻辑封装」与规则7「禁止魔法值」）：

```go
const rollbackLogTag = "[ProductSpace]"

func logRollbackDeleteErr(path string, err error) {
    log.Printf("%s version rollback delete failed for %s: %v", rollbackLogTag, path, err)
}

func logRollbackWriteErr(path string, err error) {
    log.Printf("%s version rollback write failed for %s: %v", rollbackLogTag, path, err)
}
```

### 2. 替换所有 `_ =` 为带日志的错误处理

将每处 `_ = stubDeleteFile(path)` 替换为：

```go
if rerr := stubDeleteFile(path); rerr != nil {
    logRollbackDeleteErr(path, rerr)
}
```

将每处 `_ = stubWriteFile(path, data)` 替换为：

```go
if rerr := stubWriteFile(path, data); rerr != nil {
    logRollbackWriteErr(path, rerr)
}
```

使用 `rerr`（rollback error）作为变量名，避免与外层 `err` 冲突。回滚流程不中断，仅记录日志。

### 3. 涉及文件

- `apps/dh-backend/domain/productspace/service/fileutil.go`：新增 `"log"` import、`rollbackLogTag` 常量与两个日志辅助函数。
- `apps/dh-backend/domain/productspace/service/version_service.go`：修复 7 处。
- `apps/dh-backend/domain/productspace/service/folder_service.go`：修复 7 处。
- `apps/dh-backend/domain/productspace/service/item_service.go`：修复 2 处。

### 验证结果

- `rg -n "_ = stub(DeleteFile|WriteFile)" apps/dh-backend/domain/productspace/service/` 返回空，确认 16 处全部修复。
- `go build ./domain/productspace/...` 通过，0 warnings。
- `go vet ./domain/productspace/...` 通过，0 warnings。
