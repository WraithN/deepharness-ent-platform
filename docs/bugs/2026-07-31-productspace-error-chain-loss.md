# productspace 错误包装丢失错误链

## 现象

`domain/productspace/service/db_service.go` 多处使用 `fmt.Errorf("%w: %s", ErrInvalidInput, err.Error())` 或 `fmt.Errorf("%w: %v", ErrForbidden, err)` 包装错误，导致内部错误链丢失，调用方无法通过 `errors.Is`/`errors.As` 追溯原始错误。

同时 `domain/productspace/service/db_service.go:1273-1479` 版本回滚流程中存在 15 处 `_ =` 忽略 `stubDeleteFile`/`stubWriteFile` 错误，可能导致文件系统状态不一致且无日志。

## 根因

1. 使用 `%s`/`%v` 格式化 error 变量时，只打印消息，不保留错误链。
2. 版本回滚中为了简化流程，对补偿操作（恢复文件/删除版本文件）的错误未做处理。

## 解决方案

1. `domain/productspace/service/fileutil.go` 中的 `invalidInput` helper 改为 `fmt.Errorf("%w: %w", ErrInvalidInput, err)`，保留原始错误链。
2. `domain/productspace/service/db_service.go` 中 `requirePM`/`requireMember` 的 `ErrForbidden` 包装改为 `fmt.Errorf("%w: %w", ErrForbidden, err)`。
3. 随着 `productspace/service/db_service.go` 按职责拆分为多个文件（`version_service.go`、`folder_service.go`、`item_service.go` 等），版本回滚中的文件操作错误已全部改为显式处理并记录日志，不再使用 `_ =` 静默忽略。

## 验证

- `cd apps/dh-backend && go build ./... && go vet ./...` 通过
- `cd packages/go-sdk && go build ./... && go vet ./...` 通过
- `cd apps/personal-stub && go build ./... && go vet ./...` 通过
- `pnpm build` 通过
- `pnpm --filter @repo/dh-frontend check-types` 通过
- `bash scripts/restart-dev.sh` 重启后各服务健康检查正常
