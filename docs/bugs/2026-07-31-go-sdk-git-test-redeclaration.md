# packages/go-sdk/infrastructure/repository/tests/git_test.go 重声明编译错误

## 现象

运行 `cd packages/go-sdk && go vet ./...` 时失败：

```
# github.com/deepharness/deepharness-ent-platform/packages/go-sdk/infrastructure/repository/tests
vet: infrastructure/repository/tests/git_test.go:57:6: no new variables on left side of :=
```

该错误导致 `apps/dh-backend` 接口拆分后的全仓库验证无法通过。

## 根因

`TestCloneWithInvalidSSHKey` 函数第 52 行已使用 `c, err := repository.NewGitClient(...)` 声明了 `err` 变量，第 57 行又使用 `err := c.Clone(...)` 试图重新声明 `err`，但 `:=` 右侧没有新变量，导致编译错误。

## 解决方案

将第 57 行的 `err := c.Clone(...)` 改为 `err = c.Clone(...)`，复用已声明的 `err` 变量。

验证结果：

```bash
cd /home/nan/deepharness/deepharness-ent-platform/packages/go-sdk && go build ./... && go vet ./...
# 通过
```
