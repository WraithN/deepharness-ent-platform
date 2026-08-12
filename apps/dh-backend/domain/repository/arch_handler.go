package repository

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/handler"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/middleware"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/stubclient"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/repository"
	"gopkg.in/yaml.v3"
)

// 架构库目录名常量（与 arch-repo-analysis skill 的产出结构保持一致）。
const (
	archDomainsDir  = "domains"
	archServicesDir = "services"
	archRulesDir    = "rules"
	archYamlExt     = ".yaml"
	domainRulesFile = "domain-dependency-rules.yaml"
	archProjectView = "project"
	archServiceView = "service"
	archDDDView     = "ddd"
)

// archDomainDef 架构库 domains/xxx-domain.yaml 的结构（仅取架构图展示所需字段）。
type archDomainDef struct {
	DomainKey      string   `yaml:"domainKey"`
	DomainName     string   `yaml:"domainName"`
	OwnerTeam      string   `yaml:"ownerTeam"`
	Description    string   `yaml:"description"`
	BusinessScope  []string `yaml:"businessScope"`
	AggregateRoots []string `yaml:"aggregateRoots"`
	OwnedDatabases []string `yaml:"ownedDatabases"`
	AntiPatterns   []string `yaml:"antiPatterns"`
}

// archServiceDep 服务依赖项：syncCall 用 targetService，MQ 用 topicKey。
type archServiceDep struct {
	TargetService string `yaml:"targetService"`
	Reason        string `yaml:"reason"`
	TopicKey      string `yaml:"topicKey"`
}

// archServiceDef 架构库 services/xxx-service.yaml 的结构。
type archServiceDef struct {
	ServiceKey   string `yaml:"serviceKey"`
	ServiceName  string `yaml:"serviceName"`
	Domain       string `yaml:"domain"`
	OwnerTeam    string `yaml:"ownerTeam"`
	ServiceLevel string `yaml:"serviceLevel"`
	Description  string `yaml:"description"`
	Capabilities []struct {
		CapabilityKey string `yaml:"capabilityKey"`
		Name          string `yaml:"name"`
		Description   string `yaml:"description"`
	} `yaml:"capabilities"`
	Dependencies struct {
		SyncCall     []archServiceDep `yaml:"syncCall"`
		AsyncProduce []archServiceDep `yaml:"asyncProduce"`
		AsyncConsume []archServiceDep `yaml:"asyncConsume"`
	} `yaml:"dependencies"`
	Database struct {
		OwnDB          string   `yaml:"ownDB"`
		AllowedReadDB  []string `yaml:"allowedReadDB"`
		AllowedWriteDB []string `yaml:"allowedWriteDB"`
	} `yaml:"database"`
	ForbiddenDependencies []string `yaml:"forbiddenDependencies"`
	ForbiddenDBAccess     []string `yaml:"forbiddenDBAccess"`
	Tags                  []string `yaml:"tags"`
}

// archDomainRules 架构库 rules/domain-dependency-rules.yaml 的 matrix 结构。
type archDomainRules struct {
	Matrix map[string]struct {
		AllowSyncCall       []string `yaml:"allowSyncCall"`
		ForbidSyncCall      []string `yaml:"forbidSyncCall"`
		AllowEventSubscribe []string `yaml:"allowEventSubscribe"`
	} `yaml:"matrix"`
}

// ── 响应结构 ──

// 节点/边类型常量：前端据此着色与过滤。
const (
	archNodeKindRepo    = "repo"
	archNodeKindService = "service"
	archNodeKindDomain  = "domain"
	archNodeKindInfra   = "infra"

	archEdgeKindRPC = "rpc"
	archEdgeKindMQ  = "mq"
	archEdgeKindDB  = "db"
)

// 基础组件识别标签：命中任一即归为基础组件（灰色节点）。
var infraTags = []string{"infra", "基础组件", "base-infra", "infrastructure"}

type archNode struct {
	ID           string            `json:"id"`
	Label        string            `json:"label"`
	Kind         string            `json:"kind"`
	BusinessLine string            `json:"businessLine,omitempty"`
	Meta         map[string]string `json:"meta,omitempty"`
}

type archEdge struct {
	Source string `json:"source"`
	Target string `json:"target"`
	Label  string `json:"label"`
	Kind   string `json:"kind"`
}

type archView struct {
	Nodes []archNode `json:"nodes"`
	Edges []archEdge `json:"edges"`
}

type archDomainOption struct {
	Key  string `json:"key"`
	Name string `json:"name"`
}

// archGraphResponse 是 GET /arch/graph 的统一响应：
// configured=false 表示空间未配置架构库；cloned=false 表示架构库尚未同步到当前用户目录。
type archGraphResponse struct {
	Configured bool                 `json:"configured"`
	Cloned     bool                 `json:"cloned"`
	RepoID     string               `json:"repoId,omitempty"`
	RepoName   string               `json:"repoName,omitempty"`
	Views      map[string]*archView `json:"views,omitempty"`
	Domains    []archDomainOption   `json:"domains,omitempty"`
	Warnings   []string             `json:"warnings,omitempty"`
}

// ArchGraph 处理 GET /api/v1/workspaces/{id}/arch/graph。
// 读取当前用户目录下架构库（type=arch）的 YAML 元数据，构建三视图架构图数据。
// 架构合规：文件读取经 stubclient 委托 personal-stub，不直接访问文件系统。
func ArchGraph(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		handler.WriteJSONError(w, http.StatusMethodNotAllowed, handler.ErrCodeGeneral, "method not allowed")
		return
	}
	workspaceID, ok := handler.PathValueOr404(w, r, "id")
	if !ok {
		return
	}
	userID, _ := middleware.UserIDFromContext(r.Context())

	repo, found, err := findArchRepo(workspaceID)
	if err != nil {
		handler.HandleServiceError(w, err, "workspace not found", "failed to list repositories")
		return
	}
	resp := &archGraphResponse{Configured: found}
	if !found {
		handler.SetJSONHeader(w)
		json.NewEncoder(w).Encode(resp)
		return
	}
	resp.RepoID = repo.ID
	resp.RepoName = repo.Name

	localPath := resolveUserLocalPathStatic(repo, userID)
	resp.Cloned = isArchRepoCloned(r.Context(), repo, localPath)
	if !resp.Cloned {
		handler.SetJSONHeader(w)
		json.NewEncoder(w).Encode(resp)
		return
	}

	resp.Views, resp.Domains, resp.Warnings = buildArchGraph(r.Context(), localPath)
	handler.SetJSONHeader(w)
	json.NewEncoder(w).Encode(resp)
}

// findArchRepo 返回工作空间内第一个架构库（type=arch）。
func findArchRepo(workspaceID string) (repository.Repository, bool, error) {
	repos, err := defaultService.List(workspaceID)
	if err != nil {
		return repository.Repository{}, false, err
	}
	for _, repo := range repos {
		if repo.Type == repository.RepoTypeArch {
			return repo, true, nil
		}
	}
	return repository.Repository{}, false, nil
}

// isArchRepoCloned 判定架构库在当前用户目录下是否已克隆。
func isArchRepoCloned(ctx context.Context, repo repository.Repository, localPath string) bool {
	if localPath == "" || repo.CloneStatus != repository.CloneStatusCloned {
		return false
	}
	sc := stubclient.FromContext(ctx)
	if sc == nil {
		return false
	}
	fi, err := sc.FileInfo(ctx, localPath)
	return err == nil && fi.Exists && fi.IsDir
}

// readArchYamlFiles 读取架构库某子目录下的全部 .yaml 文件（文件名 -> 内容）。
// 目录不存在时返回空 map，不视为错误（架构库可能尚未生成该目录）。
func readArchYamlFiles(ctx context.Context, repoPath, subdir string) (map[string]string, []string) {
	files := map[string]string{}
	var warnings []string
	sc := stubclient.FromContext(ctx)
	if sc == nil {
		return files, []string{"personal-stub 客户端不可用"}
	}
	dir := filepath.Join(repoPath, subdir)
	entries, err := sc.ListDir(ctx, dir)
	if err != nil {
		return files, nil
	}
	for _, entry := range entries {
		if entry.IsDir || !strings.HasSuffix(entry.Name, archYamlExt) {
			continue
		}
		content, readErr := sc.ReadFile(ctx, filepath.Join(dir, entry.Name))
		if readErr != nil {
			warnings = append(warnings, subdir+"/"+entry.Name+" 读取失败")
			continue
		}
		files[entry.Name] = content
	}
	return files, warnings
}

// parseYamlFile 解析单个 YAML 文件；失败时记录 warning 并跳过（不阻断整体出图）。
func parseYamlFile[T any](fileName, content string, out *T, warnings *[]string) bool {
	if err := yaml.Unmarshal([]byte(content), out); err != nil {
		log.Printf("[ArchGraph] parse %s failed: %v", fileName, err)
		*warnings = append(*warnings, fileName+" 解析失败，已跳过")
		return false
	}
	return true
}

// loadArchDomains 读取并解析架构库 domains/ 下全部领域定义。
func loadArchDomains(ctx context.Context, repoPath string) ([]archDomainDef, []string) {
	files, warnings := readArchYamlFiles(ctx, repoPath, archDomainsDir)
	domains := make([]archDomainDef, 0, len(files))
	for name, content := range files {
		var def archDomainDef
		if parseYamlFile(archDomainsDir+"/"+name, content, &def, &warnings) && def.DomainKey != "" {
			domains = append(domains, def)
		}
	}
	return domains, warnings
}

// loadArchServices 读取并解析架构库 services/ 下全部微服务元数据。
func loadArchServices(ctx context.Context, repoPath string) ([]archServiceDef, []string) {
	files, warnings := readArchYamlFiles(ctx, repoPath, archServicesDir)
	services := make([]archServiceDef, 0, len(files))
	for name, content := range files {
		var def archServiceDef
		if parseYamlFile(archServicesDir+"/"+name, content, &def, &warnings) && def.ServiceKey != "" {
			services = append(services, def)
		}
	}
	return services, warnings
}

// loadArchDomainRules 读取架构库 rules/domain-dependency-rules.yaml（可选，不存在返回 nil）。
func loadArchDomainRules(ctx context.Context, repoPath string) (*archDomainRules, []string) {
	sc := stubclient.FromContext(ctx)
	if sc == nil {
		return nil, nil
	}
	content, err := sc.ReadFile(ctx, filepath.Join(repoPath, archRulesDir, domainRulesFile))
	if err != nil {
		return nil, nil
	}
	var rules archDomainRules
	var warnings []string
	if !parseYamlFile(archRulesDir+"/"+domainRulesFile, content, &rules, &warnings) {
		return nil, warnings
	}
	return &rules, warnings
}
