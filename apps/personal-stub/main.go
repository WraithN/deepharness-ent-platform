package main

import (
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"syscall"

	"github.com/deepharness/deepharness-ent-platform/apps/personal-stub/config"
	"github.com/deepharness/deepharness-ent-platform/apps/personal-stub/gateway/handler"
	"github.com/deepharness/deepharness-ent-platform/apps/personal-stub/gateway/server"
)

// SkillsFS 内嵌 92 个 html-anything SKILL.md 设计模板（见 skills_embed.go）。

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	handler.SetSkillsFS(SkillsFS)
	if err := handler.DeploySkills(cfg.WorkspaceRoot); err != nil {
		log.Printf("[Skills] deployment warning: %v", err)
	}

	// 全局安装 Comet Classic skill（幂等，异步，不阻塞启动）。
	// 装到 ~/.config/opencode/skills/，该 personal-stub 管理的所有 gatewayd/opencode serve 复用。
	initCometGlobal()

	// 初始化 gatewayd 进程管理器。
	// 若配置了 GATEWAYD_BIN，personal-stub 自动启动和管理 gatewayd 进程；
	// 否则回退到外部启动模式（使用 GATEWAYD_ADMIN_URL 指向外部已启动的 gatewayd）。
	platformURL := "http://localhost:" + cfg.Port
	gatewaydMgr := handler.NewGatewaydManager(
		cfg.GatewaydBin,
		handler.GatewaydMode(cfg.GatewaydMode),
		cfg.GatewaydAgentPort,
		cfg.GatewaydAdminPort,
		platformURL,
		cfg.DHBackendRuntimeToken,
		cfg.DHPlatformUserID,
		cfg.DHBackendRuntimeID,
		cfg.WorkspaceRoot,
	)
	handler.SetGatewaydManager(gatewaydMgr)

	// 1:1 模式：启动时创建 gatewayd 实例。
	// 1:N 模式：按需懒启动，不在此处创建。
	if gatewaydMgr.Enabled() && !gatewaydMgr.IsMultiMode() {
		if err := gatewaydMgr.StartSingle(); err != nil {
			log.Printf("[GatewaydManager] failed to start gatewayd: %v", err)
		}
	}

	srv := server.New(cfg)

	// 优雅关闭：收到信号时停止所有 gatewayd 进程。
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		<-sigCh
		log.Printf("[PersonalStub] shutting down, stopping gatewayd instances...")
		gatewaydMgr.StopAll()
		os.Exit(0)
	}()

	log.Printf("Personal Stub starting on port %s (gatewayd_bin=%s mode=%s)", cfg.Port, cfg.GatewaydBin, cfg.GatewaydMode)
	if err := http.ListenAndServe(":"+cfg.Port, srv); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}

// comet init 相关常量。
const (
	// cometCLIBinName 是 comet CLI 的可执行文件名。
	cometCLIBinName = "comet"
	// cometSkillMarkerRel 是 comet-classic skill 标记文件相对 home 的路径，用于判断是否已安装。
	cometSkillMarkerRel = ".config/opencode/skills/comet-classic/SKILL.md"
)

// initCometGlobal 在全局 scope 安装 Comet Classic 工作流 skill 到 opencode。
// 幂等：已安装则跳过；comet CLI 不可用时仅告警不阻塞启动。
// 装到 ~/.config/opencode/skills/，该 personal-stub 管理的所有 gatewayd/opencode serve 复用，
// 与 workspace 解耦，符合"容器级一次 init、多 workspace 复用"的部署架构。
func initCometGlobal() {
	home, err := os.UserHomeDir()
	if err != nil {
		log.Printf("[Comet] cannot resolve home dir, skip global init: %v", err)
		return
	}
	// comet-classic skill 已存在则跳过（幂等）。
	marker := filepath.Join(home, cometSkillMarkerRel)
	if _, err := os.Stat(marker); err == nil {
		log.Printf("[Comet] global skills already installed, skip init")
		return
	}
	// 检查 comet CLI 是否可用。
	if _, err := exec.LookPath(cometCLIBinName); err != nil {
		log.Printf("[Comet] comet CLI not found in PATH, skip global init (install @rpamis/comet to enable comet flow)")
		return
	}
	// 异步执行，不阻塞 personal-stub 启动。
	go func() {
		log.Printf("[Comet] installing global Comet Classic skills for opencode...")
		cmd := exec.Command(cometCLIBinName, "init",
			"--scope", "global",
			"--platform", "opencode",
			"--workflow", "classic",
			"--yes", "--language", "zh")
		cmd.Env = os.Environ()
		out, err := cmd.CombinedOutput()
		if err != nil {
			log.Printf("[Comet] global init failed: %v, output: %s", err, string(out))
			return
		}
		log.Printf("[Comet] global init done: %s", string(out))
	}()
}
