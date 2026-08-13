package repository

import (
	"context"
	"encoding/json"
	"path/filepath"
	"strings"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/stubclient"
)

// ── L1/L2/Overview 数据结构 ──

// librariesData 对应架构库 libraries.yaml（L1 开发库层）。
type librariesData struct {
	Libraries    []ArchLibrary       `yaml:"libraries"`
	Dependencies []ArchLibDependency `yaml:"dependencies"`
	Warnings     []string            `yaml:"warnings"`
	ParsedAt     string              `yaml:"parsedAt"`
}

// ArchLibrary 单个开发库节点。
type ArchLibrary struct {
	Key       string   `yaml:"key" json:"key"`
	Name      string   `yaml:"name" json:"name"`
	Path      string   `yaml:"path" json:"path"`
	Languages []string `yaml:"languages" json:"languages"`
	Summary   string   `yaml:"summary" json:"summary"`
}

// ArchLibDependency 开发库间依赖边。
type ArchLibDependency struct {
	From        string `yaml:"from" json:"from"`
	To          string `yaml:"to" json:"to"`
	Kind        string `yaml:"kind" json:"kind"`
	Description string `yaml:"description" json:"description"`
}

// modulesData 对应 modules/<lib>.yaml（L2 模块层）。
type modulesData struct {
	Modules      []ArchModule           `yaml:"modules"`
	Dependencies []ArchModuleDependency `yaml:"dependencies"`
}

// ArchModule 单个模块节点。
type ArchModule struct {
	Key       string `yaml:"key" json:"key"`
	Name      string `yaml:"name" json:"name"`
	Path      string `yaml:"path" json:"path"`
	Summary   string `yaml:"summary" json:"summary"`
	FileCount int    `yaml:"fileCount" json:"fileCount"`
}

// ArchModuleDependency 模块间依赖边。
type ArchModuleDependency struct {
	From string `yaml:"from" json:"from"`
	To   string `yaml:"to" json:"to"`
	Kind string `yaml:"kind" json:"kind"`
}

// ArchOverview 开发库介绍页内容（overviews/<lib>.yaml）。
type ArchOverview struct {
	Key          string   `yaml:"key" json:"key"`
	Name         string   `yaml:"name" json:"name"`
	Positioning  string   `yaml:"positioning" json:"positioning"`
	Architecture string   `yaml:"architecture" json:"architecture"`
	TechStack    []string `yaml:"techStack" json:"techStack"`
	CoreModules  []struct {
		Key  string `yaml:"key" json:"key"`
		Role string `yaml:"role" json:"role"`
	} `yaml:"coreModules" json:"coreModules"`
}

// ── knowledge-graph.json 结构（L3 类/函数视图）──

// kgGraph 对应 understand 产出的 knowledge-graph.json 结构（仅取画布所需字段）。
type kgGraph struct {
	Nodes []kgNode `json:"nodes"`
	Edges []kgEdge `json:"edges"`
}

// kgNode 知识图谱节点：type 为 file/function/class。
type kgNode struct {
	ID         string   `json:"id"`
	Type       string   `json:"type"`
	Name       string   `json:"name"`
	Summary    string   `json:"summary"`
	FilePath   string   `json:"filePath"`
	LineRange  string   `json:"lineRange"`
	Complexity string   `json:"complexity"`
	Tags       []string `json:"tags"`
}

// kgEdge 知识图谱边：kind 为 calls/imports/contains/inherits/depends_on。
type kgEdge struct {
	Source string `json:"source"`
	Target string `json:"target"`
	Kind   string `json:"kind"`
}

// ── 单文件 YAML 读取辅助 ──

// readArchYAMLFile 读取架构库内单个 YAML 文件并解析；文件不存在返回 (false, nil)。
// 复用 parseYamlFile：解析失败时记录 warning 并返回 false，不阻断整体出图。
func readArchYAMLFile[T any](ctx context.Context, repoPath, relPath string, out *T) (bool, []string) {
	sc := stubclient.FromContext(ctx)
	if sc == nil {
		return false, []string{"personal-stub 客户端不可用"}
	}
	content, err := sc.ReadFile(ctx, filepath.Join(repoPath, relPath))
	if err != nil {
		return false, nil // 文件不存在视为未解析，非错误
	}
	var warnings []string
	if !parseYamlFile(relPath, content, out, &warnings) {
		return false, warnings
	}
	return true, warnings
}

// loadLibraries 读取架构库根目录的 libraries.yaml（L1 开发库层）。
func loadLibraries(ctx context.Context, repoPath string) (*librariesData, []string) {
	var data librariesData
	ok, warnings := readArchYAMLFile(ctx, repoPath, archLibrariesFile, &data)
	if !ok {
		return nil, warnings
	}
	return &data, warnings
}

// loadModules 读取架构库 modules/<lib>.yaml（L2 模块层）。
func loadModules(ctx context.Context, repoPath, libKey string) (*modulesData, []string) {
	var data modulesData
	rel := filepath.Join(archModulesDir, libKey+archYamlExt)
	ok, warnings := readArchYAMLFile(ctx, repoPath, rel, &data)
	if !ok {
		return nil, warnings
	}
	return &data, warnings
}

// loadOverview 读取架构库 overviews/<lib>.yaml（开发库介绍页）。
// 文件不存在时返回 (nil, nil)，不视为错误。
func loadOverview(ctx context.Context, repoPath, libKey string) (*ArchOverview, error) {
	var data ArchOverview
	rel := filepath.Join(archOverviewsDir, libKey+archYamlExt)
	ok, _ := readArchYAMLFile(ctx, repoPath, rel, &data)
	if !ok {
		return nil, nil
	}
	return &data, nil
}

// ── L3 类视图：knowledge-graph.json 按 module path 过滤 ──

// kgNodeTypes 为知识图谱中可纳入类视图的节点类型白名单。
var kgNodeTypes = map[string]bool{
	"file":     true,
	"function": true,
	"class":    true,
}

// filterClassView 是 loadClassView 的纯过滤逻辑（便于单测）：
// 仅保留 file/function/class 类型且 filePath 命中前缀的节点；
// 边仅当两端节点均存活时保留。prefix 为空表示不过滤路径。
func filterClassView(kg kgGraph, prefix string) *archView {
	prefix = filepath.ToSlash(prefix)
	nodeIDs := map[string]bool{}
	var nodes []archNode
	for _, n := range kg.Nodes {
		// 类型白名单过滤：非 file/function/class 节点跳过（如 config 节点）。
		if !kgNodeTypes[n.Type] {
			continue
		}
		// 路径前缀过滤：prefix 非空时要求 filePath 落在模块路径下。
		if prefix != "" && !strings.HasPrefix(filepath.ToSlash(n.FilePath), prefix) {
			continue
		}
		nodeIDs[n.ID] = true
		nodes = append(nodes, archNode{
			ID: n.ID, Label: n.Name, Kind: n.Type,
			Meta: map[string]string{
				"summary":    n.Summary,
				"filePath":   n.FilePath,
				"lineRange":  n.LineRange,
				"complexity": n.Complexity,
			},
		})
	}
	// 边过滤：仅保留两端节点均在过滤后集合内的边，剔除悬空边。
	var edges []archEdge
	for _, e := range kg.Edges {
		if !nodeIDs[e.Source] || !nodeIDs[e.Target] {
			continue
		}
		edges = append(edges, archEdge{Source: e.Source, Target: e.Target, Label: e.Kind, Kind: e.Kind})
	}
	return &archView{Nodes: nodes, Edges: edges}
}

// loadClassView 读取开发库 knowledge-graph.json，按 module path 前缀过滤节点与边。
// modulePathPrefix 为模块在开发库内的相对路径前缀（如 "gateway/"）。
func loadClassView(ctx context.Context, kgPath, modulePathPrefix string) (*archView, []string) {
	sc := stubclient.FromContext(ctx)
	if sc == nil {
		return nil, []string{"personal-stub 客户端不可用"}
	}
	content, err := sc.ReadFile(ctx, kgPath)
	if err != nil {
		return nil, []string{"knowledge-graph.json 读取失败: " + err.Error()}
	}
	var kg kgGraph
	if err := json.Unmarshal([]byte(content), &kg); err != nil {
		return nil, []string{"knowledge-graph.json 解析失败: " + err.Error()}
	}
	return filterClassView(kg, modulePathPrefix), nil
}
