# 错误类型判断使用字符串匹配，健壮性差

## 现象

代码中多处通过 `strings.Contains(err.Error(), "...")` 判断错误类型，依赖错误消息文本，容易因文案调整导致判断失效：

- `gateway/handler/common.go:57`：`strings.Contains(err.Error(), "not found")` 判断 404
- `domain/workspace/prompt_handler.go:155,230,311`：同上 + `"builtin category"`
- `domain/feishu/service/dispatcher.go:401`：`"already exist"`
- `domain/repository/service/db_service.go:1682`：`"nothing to commit"`

同时大量 service 层直接返回 `errors.New("... not found")` 等纯文本错误，`gateway/handler/common.go` 的 `HandleServiceError` 使用 `errors.Is(err, common.ErrNotFound)` 无法识别，导致资源不存在时错误地返回 500。

## 根因

1. 缺乏统一的哨兵错误（sentinel errors）。
2. 服务层返回的错误未用 `%w` 包装可识别的根因错误。
3. Handler 层做了字符串匹配这种脆弱判断。

## 解决方案

1. 在 `packages/go-sdk/common/errors.go` 定义共享哨兵错误：
   - `ErrNotFound`
   - `ErrAlreadyExists`
   - `ErrForbidden`
   - `ErrInvalidInput`
   - 并提供 `NotFoundErrorf`  helper，支持保留自定义消息且可被 `errors.Is` 识别。
2. 将 `gateway/handler/common.go` 中的字符串匹配改为 `errors.Is(err, common.ErrNotFound)`。
3. 批量将 service 层的 `errors.New("... not found")` 替换为 `common.NotFoundErrorf("... not found")`，使 `HandleServiceError` 能正确识别并返回 404。
4. 对飞书 dispatcher 的 session 重复创建场景，在 `agent/chat/session/postgres.go` 中检测 PostgreSQL 唯一冲突错误码 `23505`，返回 `fmt.Errorf("%w: ...", common.ErrAlreadyExists, ...)`，dispatcher 改为 `errors.Is(err, common.ErrAlreadyExists)` 判断。
5. 对仓库 GitCommit 的 "nothing to commit" 场景，定义 `service.ErrNoChangesToCommit` 哨兵错误，handler 使用 `errors.Is` 识别并返回 400。
6. 工作空间提示词分类的 `builtin category cannot be deleted` 等业务校验错误改为 `common.ErrForbidden` 包装，handler 使用 `errors.Is(err, common.ErrForbidden)` 判断。

## 验证

- `cd apps/dh-backend && go build ./... && go vet ./...` 通过
- `cd packages/go-sdk && go build ./... && go vet ./...` 通过
- `cd apps/personal-stub && go build ./... && go vet ./...` 通过
- `pnpm build` 通过
- `pnpm --filter @repo/dh-frontend check-types` 通过
- `bash scripts/restart-dev.sh` 重启后各服务健康检查正常
