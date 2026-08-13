# gatewayd 进程 cwd 继承 dh-backend 导致 opencode 找不到 comet skill

## 现象

用户在 dh-frontend 智能会话发 `/code` 指令后，agent 没有任何有效输出，session 在 5 分钟内卡死。

DB 里两次现场：
- `b89a3bf7-a307-480e-b261-4ccc2d6bea87`（17:40 创建，17:42 卡死，0 条 assistant 回复）
- `1a4371d2-8782-43e2-a746-d1eccc1bc1c1`（17:53 创建，17:58 卡死，1 条 assistant 回复）

agent 在浏览器展示给用户的内容：
> 用户要求我使用 skill 工具加载 comet-classic skill... comet-classic skill 不存在。让我检查可用的 skills 列表。从列表中我看到了几个与"openspec"相关的 skill，这些可能与 comet 经典工作流类似（open -> design -> build -> verify -> archive）。

agent 误用 openspec-* skill 硬套 comet 流程，输出不符合用户期望，再无后续回复。

影响：220 上所有 `/code`、`/debug`、`/review`、`/unit-test`、`/refactor`、`/req-breakdown`、`/arch-design` 这 7 个带 cometTemplate 的指令全部失灵。

## 根因

进程链继承的 cwd 是 `/home/deepharness-platform/apps/dh-backend/`，opencode 只从 cwd 找 skills，cwd 下没有 comet skill。

进程链：
```
pts/1 shell
└─ ./dist/dh-backend          cwd = /home/deepharness-platform/apps/dh-backend
   └─ personal-stub            cwd = 同上（继承）
      └─ dh-gatewayd           cwd = 同上（继承）
         └─ opencode           cwd = 同上（继承）
```

`personal-stub` 启动 `gatewayd` 时使用 `exec.Command(m.bin, ...)`，未设置 `cmd.Dir`，导致整条 dh-backend -> personal-stub -> gatewayd -> opencode 链路全部继承 dh-backend 的 cwd。

opencode 实际看到的 skills 来源：
- `dh-backend/.claude/skills/`（23 个）：openspec-* + devops-cli — 无 comet
- `dh-backend/.opencode/skills/`：不存在
- 用户工作区 `dev-jobs/test/.opencode/skills/comet-*/`：装好了但读不到

触发条件：`platform_feature_flags.comet_flow = true` + 用户发送 commands.yaml 中 7 个带 cometTemplate 字段的指令之一。

## 解决方案

在 `apps/personal-stub/gateway/handler/gatewayd_manager.go` 的 `startLocked` 方法中，为 `exec.Command` 设置 `cmd.Dir = m.workspaceRoot`。

修改前：
```go
cmd := exec.Command(m.bin,
    "--port", fmt.Sprintf("%d", agentPort),
    "--admin-port", fmt.Sprintf("%d", adminPort),
    "--attach", "opencode",
)
// cmd.Dir 未设置，继承父进程 cwd
```

修改后：
```go
cmd := exec.Command(m.bin,
    "--port", fmt.Sprintf("%d", agentPort),
    "--admin-port", fmt.Sprintf("%d", adminPort),
    "--attach", "opencode",
)
// 将 gatewayd（及其子进程 opencode）的工作目录设为用户工作区根目录
if m.workspaceRoot != "" {
    if info, err := os.Stat(m.workspaceRoot); err == nil && info.IsDir() {
        cmd.Dir = m.workspaceRoot
    } else {
        log.Printf("[GatewaydManager] WARNING: workspaceRoot %s not accessible, gatewayd will inherit parent cwd", m.workspaceRoot)
    }
}
```

效果：
- opencode 在用户工作区启动，自动从 `.opencode/skills/` 和 `.claude/skills/` 加载 comet skill
- 所有 comet 产物（`openspec/changes/`、`.comet/*.yaml`）也写进用户工作区，不污染 dh-backend 工程目录
- `cmd.Dir` 仅作用于 gatewayd 子进程，不影响 personal-stub 主进程
- multi-slot 模式下各 gatewayd 进程的 cwd 互不干扰（各进程独立设置 cmd.Dir）

验证：
- `go vet ./...` 通过，0 warnings
- `go build` 通过
- `pnpm build` 通过
- `pnpm check-types` 通过
