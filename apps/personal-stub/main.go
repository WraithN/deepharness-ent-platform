package main

import (
	"log"
	"net/http"

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

	srv := server.New(cfg)

	log.Printf("Personal Stub starting on port %s", cfg.Port)
	if err := http.ListenAndServe(":"+cfg.Port, srv); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
