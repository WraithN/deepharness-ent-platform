package project

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/project"
)

func Projects(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	projects := []project.Project{
		{ID: "p1", TenantID: "t1", Name: "DeepHarness Platform", GitURL: "https://gitlab.example.com/deepharness/platform", RepoType: project.RepoTypeDev, MeegoKey: "proj_aicoding_platform", CreatedAt: time.Date(2023, 1, 1, 0, 0, 0, 0, time.UTC)},
		{ID: "p2", TenantID: "t1", Name: "Meego 研发中心", GitURL: "https://gitlab.example.com/meego/rd", RepoType: project.RepoTypeDev, MeegoKey: "proj_meego_rd", CreatedAt: time.Date(2023, 3, 15, 0, 0, 0, 0, time.UTC)},
		{ID: "p3", TenantID: "t1", Name: "AI Agent Runtime", GitURL: "https://gitlab.example.com/agent/runtime", RepoType: project.RepoTypeTest, MeegoKey: "proj_agent_runtime", CreatedAt: time.Date(2023, 6, 1, 0, 0, 0, 0, time.UTC)},
	}
	json.NewEncoder(w).Encode(projects)
}
