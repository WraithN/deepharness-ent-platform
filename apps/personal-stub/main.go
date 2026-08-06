package main

import (
	"log"
	"net/http"
	"os"
	"os/signal"
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
