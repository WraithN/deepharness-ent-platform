# 2026-07-21 — OpenCode 僵尸进程与端口残留导致"正在连接个人助手"卡住

## 现象
- 前端会话页面上"正在连接个人助手"阶段卡住，永远不进入"思考中"。
- `RUN_STARTED` SSE 事件从未到达前端。
- `ss -tnp` 确认：Backend → Gatewayd 127.0.0.1:2346 的 HTTP POST 长时间保持 ESTABLISHED，直到 120s 超时断开。
- Gatewayd 重启后出现 `<defunct>` 状态的 opencode 僵尸进程。
- `ps aux | grep opencode` 发现 4 个旧 opencode 进程占用 3001–3004 端口。

## 根因
三层问题叠加：

### 1. Gatewayd 重启时未清理旧 opencode 子进程
`start-dev.sh` 只杀 2345/2346 端口的 gatewayd 进程，不杀 opencode 子进程（3001-3050）。旧 opencode 进程在 gatewayd 重启后仍存活并监听原端口。

### 2. `start_opencode_with_retry` 健康检查误判
新 gatewayd spawn 新的 `opencode serve --port 3001`，但端口已被旧进程占用，新进程无法绑定。健康检查 `GET /health` 打到了旧 opencode 上返回 OK，gatewayd 误以为是自己的进程启动成功。新旧 workspace 不一致导致旧 opencode 处理新消息时行为异常。

### 3. 子进程未 `wait()` 导致僵尸
`OpencodeInstance::stop()`、`reset_and_restart()`、`start_opencode_with_retry()` 中均只调用 `child.start_kill()` 而未调用 `child.wait()`。子进程退出后父进程未回收，形成僵尸。

## 解决方案
三处修改（`apps/gatewayd/crates/opencode-plugin/src/instance.rs` + `scripts/start-dev.sh`）：

### 1. `start_opencode_with_retry` — 验证子进程存活
健康检查通过后，用 `child.try_wait()` 验证子进程是否仍运行：
- `Ok(None)` → 子进程仍在，健康检查确实对的是自己的进程
- `Ok(Some(status))` → 子进程已退出，健康检查对的是旧进程 → 重试下一端口

### 2. 三步新增 `wait()` 避免僵尸
- `OpencodeInstance::stop()`: `start_kill()` → `wait()`
- `reset_and_restart()`: `start_kill()` → `wait()`
- `start_opencode_with_retry` 失败/重试分支: `start_kill()` → `wait()`

### 3. `start-dev.sh` 启动清理
在 gatewayd 启动前，遍历端口 3001-3050 执行 `kill_port`，清理旧 opencode 残留。

## 验证
- 重启后 3001-3004 端口空闲，无旧 opencode 进程
- 无 gatewayd 下属 opencode 僵尸进程
- 前端 200、Backend 200、Gatewayd health OK、Agent Stub 运行正常
