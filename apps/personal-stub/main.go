package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/personal-stub/config"
	"github.com/deepharness/deepharness-ent-platform/apps/personal-stub/gateway/handler"
	"github.com/deepharness/deepharness-ent-platform/apps/personal-stub/gateway/server"
	"gopkg.in/yaml.v3"
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

	// 全局安装 Comet Classic skill（幂等，同步阻塞，安装期间向 dh-backend 上报初始化状态）。
	// 装到 ~/.config/opencode/skills/，该 personal-stub 管理的所有 gatewayd/opencode serve 复用。
	// 必须在 gatewayd 启动前完成，确保 opencode 启动时能找到 comet skill。
	initCometGlobal(cfg.DHBackendURL, cfg.DHBackendRuntimeToken, cfg.DHBackendRuntimeID, cfg.DHPlatformUserID)

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
	// 注意：实际启动放在 HTTP server 监听之后（见文件末尾），确保 gatewayd 启动早期
	// 通过 DH_PLATFORM_URL 拉取 crawler MCP 配置时 personal-stub HTTP server 已 ready，
	// 否则会出现 "No MCP servers configured" 导致 agent 缺少 crawler:web_scrape 工具。

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

	// 先 net.Listen 抢端口并开始监听，再启动 gatewayd 子进程。
	// gatewayd 启动早期会通过 DH_PLATFORM_URL 拉取 crawler MCP 配置（GET /api/v1/admin/services/crawler），
	// 若 personal-stub HTTP server 未 ready，拉取会失败导致 MCP 工具缺失（No MCP servers configured）。
	ln, err := net.Listen("tcp", ":"+cfg.Port)
	if err != nil {
		log.Fatalf("Server failed to listen: %v", err)
	}
	go func() {
		if err := http.Serve(ln, srv); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server failed: %v", err)
		}
	}()

	// HTTP server 已开始监听，可安全启动 gatewayd（它会回调 personal-stub 拉 crawler 配置）。
	if gatewaydMgr.Enabled() && !gatewaydMgr.IsMultiMode() {
		if err := gatewaydMgr.StartSingle(); err != nil {
			log.Printf("[GatewaydManager] failed to start gatewayd: %v", err)
		}
	}

	// 阻塞主 goroutine，等待信号退出。
	select {}
}

// comet init 相关常量。
const (
	// cometCLIBinName 是 comet CLI 的可执行文件名。
	cometCLIBinName = "comet"
	// cometSkillMarkerRel 是 comet-classic skill 标记文件相对 home 的路径，用于判断是否已安装。
	cometSkillMarkerRel = ".config/opencode/skills/comet-classic/SKILL.md"
	// cometConfigRel 是 comet 全局配置文件相对 home 的路径。
	cometConfigRel = ".comet/config.yaml"
	// cometClassicSectionKey 是 comet 配置中 classic 工作流所在的配置段键名。
	cometClassicSectionKey = "classic"
	// cometLanguageKey 是 classic 配置段中的语言键名。
	cometLanguageKey = "language"
	// cometClassicLanguage 强制 classic 流程使用的中文语言值，保证 agent 全程用中文提问。
	cometClassicLanguage = "zh-CN"
	// cometConfigDirPerm 是 .comet 配置目录的权限位。
	cometConfigDirPerm = 0o755
	// cometConfigFilePerm 是 comet 配置文件的权限位。
	cometConfigFilePerm = 0o644
	// cometDecisionPointDocRel 是 comet 决策点协议文档相对 home 的路径。
	cometDecisionPointDocRel = ".config/opencode/skills/comet/reference/decision-point.md"
	// cometLegacyQuestionToolName 是决策点协议上游版本中的结构化提问工具名
	//（Claude Code 风格），在 opencode 环境中不存在。
	cometLegacyQuestionToolName = "AskUserQuestion"
	// cometOpencodeQuestionToolName 是 opencode 环境中真实的结构化提问工具名。
	cometOpencodeQuestionToolName = "question"
)

// comet init 状态上报相关常量。
const (
	// cometInitStatusChecking 是检查 SDD 环境时的状态消息。
	cometInitStatusChecking = "正在检查 SDD 支持环境"
	// cometInitStatusInstalling 是安装 SDD 支持时的状态消息。
	cometInitStatusInstalling = "正在安装 SDD 支持"
	// cometInitStatusDone 是安装完成时的状态消息。
	cometInitStatusDone = "SDD 支持安装完成"
	// cometInitStatusReady 是已安装跳过时的状态消息。
	cometInitStatusReady = "SDD 支持已就绪"
	// cometReportTimeout 是状态上报 HTTP 请求超时时间。
	cometReportTimeout = 5 * time.Second
)

// initCometGlobal 在全局 scope 安装 Comet Classic 工作流 skill 到 opencode。
// 幂等：已安装则跳过；comet CLI 不可用时仅告警不阻塞启动。
// 装到 ~/.config/opencode/skills/，该 personal-stub 管理的所有 gatewayd/opencode serve 复用，
// 与 workspace 解耦，符合"容器级一次 init、多 workspace 复用"的部署架构。
//
// 同步阻塞执行：安装完成前不启动 gatewayd，确保 opencode 启动时 comet skill 已就绪。
// 安装期间通过 HTTP 上报 init_status 到 dh-backend，前端可实时展示初始化进度。
func initCometGlobal(dhBackendURL, runtimeToken, runtimeID, userID string) {
	home, err := os.UserHomeDir()
	if err != nil {
		log.Printf("[Comet] cannot resolve home dir, skip global init: %v", err)
		return
	}

	// 无论本次是否新装 skill，都先确保全局 comet 配置为中文（幂等）。
	ensureCometClassicLanguage(home)
	// 同理，每次启动都确保决策点协议使用本环境真实的结构化提问工具名（幂等）。
	ensureCometQuestionToolName(home)

	// comet-classic skill 已存在则跳过安装（幂等）。
	marker := filepath.Join(home, cometSkillMarkerRel)
	if _, err := os.Stat(marker); err == nil {
		log.Printf("[Comet] global skills already installed, skip init")
		reportInitStatus(dhBackendURL, runtimeToken, runtimeID, userID, "running", cometInitStatusReady)
		return
	}

	// 检查 comet CLI 是否可用。
	if _, err := exec.LookPath(cometCLIBinName); err != nil {
		log.Printf("[Comet] comet CLI not found in PATH, skip global init (install @rpamis/comet to enable comet flow)")
		return
	}

	// 上报安装中状态。
	reportInitStatus(dhBackendURL, runtimeToken, runtimeID, userID, "initializing", cometInitStatusInstalling)
	log.Printf("[Comet] installing global Comet Classic skills for opencode...")

	cmd := exec.Command(cometCLIBinName, "init",
		"--scope", "global",
		"--platform", "opencode",
		"--workflow", "classic",
		"--yes", "--language", "zh")
	cmd.Env = os.Environ()
	out, err := cmd.CombinedOutput()
	if err != nil {
		errMsg := fmt.Sprintf("SDD 支持安装失败: %v", err)
		log.Printf("[Comet] global init failed: %v, output: %s", err, string(out))
		reportInitStatus(dhBackendURL, runtimeToken, runtimeID, userID, "error", errMsg)
		return
	}

	log.Printf("[Comet] global init done: %s", string(out))
	// comet init 生成的全局配置语言未必是中文，强制确保 classic.language 为 zh-CN。
	ensureCometClassicLanguage(home)
	// 新装后同样补齐决策点协议的工具名补丁。
	ensureCometQuestionToolName(home)

	// 上报安装完成，清除 init_status。
	reportInitStatus(dhBackendURL, runtimeToken, runtimeID, userID, "running", cometInitStatusDone)
}

// reportInitStatus 向 dh-backend 上报运行时初始化状态。
// status 为 "initializing"（安装中）、"running"（正常/完成）或 "error"（失败）。
// initMsg 为展示给用户的状态消息，为空时清除已有初始化状态。
// 上报失败仅打日志，不阻塞 personal-stub 启动流程。
func reportInitStatus(dhBackendURL, runtimeToken, runtimeID, userID, status, initMsg string) {
	if dhBackendURL == "" || runtimeID == "" {
		log.Printf("[Comet] skip report init status: dhBackendURL or runtimeID empty")
		return
	}

	reportURL := fmt.Sprintf("%s/api/v1/agent-runtimes/%s/status", dhBackendURL, runtimeID)
	now := time.Now().UTC()
	body := map[string]any{
		"status":      status,
		"init_status": initMsg,
		"user_id":     userID,
		"reported_at": now.Format(time.RFC3339),
	}
	bodyJSON, err := json.Marshal(body)
	if err != nil {
		log.Printf("[Comet] marshal init status report failed: %v", err)
		return
	}

	req, err := http.NewRequest(http.MethodPost, reportURL, bytes.NewReader(bodyJSON))
	if err != nil {
		log.Printf("[Comet] create init status request failed: %v", err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	if runtimeToken != "" {
		req.Header.Set("Authorization", "Bearer "+runtimeToken)
	}

	client := &http.Client{Timeout: cometReportTimeout}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("[Comet] report init status failed (status=%s msg=%s): %v", status, initMsg, err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		log.Printf("[Comet] report init status got HTTP %d (status=%s msg=%s)", resp.StatusCode, status, initMsg)
	} else {
		log.Printf("[Comet] reported init status: %s - %s", status, initMsg)
	}
}

// ensureCometClassicLanguage 确保 ~/.comet/config.yaml 中 classic.language 为 zh-CN。
// 背景：comet classic 流程的提问/输出语言由该配置决定，comet init 可能生成非中文配置。
// 行为约定：
//   - 文件不存在则创建（仅含 classic.language 一项）；
//   - 文件已存在则保留其它所有配置，仅设置/更新 classic.language；
//   - 幂等：值已正确时不重写文件，重复执行不会重复追加配置；
//   - 配置损坏（YAML 解析失败）时不擅自覆盖，仅告警，避免破坏已有配置。
//
// 失败仅打日志不阻塞启动，与 initCometGlobal 的容错策略一致。
func ensureCometClassicLanguage(home string) {
	configPath := filepath.Join(home, cometConfigRel)

	// 读出现有配置；文件不存在时按空配置处理，后续走创建流程。
	root := map[string]any{}
	data, err := os.ReadFile(configPath)
	switch {
	case err == nil && len(data) > 0:
		if unmarshalErr := yaml.Unmarshal(data, &root); unmarshalErr != nil {
			log.Printf("[Comet] parse %s failed, skip language override: %v", configPath, unmarshalErr)
			return
		}
	case err != nil && !os.IsNotExist(err):
		log.Printf("[Comet] read %s failed, skip language override: %v", configPath, err)
		return
	}
	if root == nil {
		// 空文件或纯注释文件经 Unmarshal 后 root 仍为 nil，需重建避免后续赋值 panic。
		root = map[string]any{}
	}

	// classic 段缺失或类型异常（如被写成标量）时重建为 map，其余顶层键保持不变。
	classic, ok := root[cometClassicSectionKey].(map[string]any)
	if !ok {
		classic = map[string]any{}
		root[cometClassicSectionKey] = classic
	}
	if classic[cometLanguageKey] == cometClassicLanguage {
		// 已是目标语言，无需重写文件（幂等）。
		return
	}
	classic[cometLanguageKey] = cometClassicLanguage

	out, err := yaml.Marshal(root)
	if err != nil {
		log.Printf("[Comet] marshal comet config failed: %v", err)
		return
	}
	if err := os.MkdirAll(filepath.Dir(configPath), cometConfigDirPerm); err != nil {
		log.Printf("[Comet] create comet config dir failed: %v", err)
		return
	}
	if err := os.WriteFile(configPath, out, cometConfigFilePerm); err != nil {
		log.Printf("[Comet] write %s failed: %v", configPath, err)
		return
	}
	log.Printf("[Comet] ensured %s.%s=%s in %s", cometClassicSectionKey, cometLanguageKey, cometClassicLanguage, configPath)
}

// ensureCometQuestionToolName 确保 comet 决策点协议文档使用本环境真实的结构化提问工具名。
// 背景：上游 `comet/reference/decision-point.md` 约定"存在 `AskUserQuestion` 时优先使用，
// 不可用则本会话所有决策点降级为纯文本提问"。但 opencode 没有 `AskUserQuestion` 工具
// （对应物叫 `question`），模型按协议字面判定结构化提问不可用并全程降级为纯文本，
// 前端因收不到 agent.question 事件而无法渲染提问弹层。
// 行为约定：
//   - 文件不存在（skill 未安装）时直接跳过，新装后由 init 成功路径补调；
//   - 将文档中所有 `AskUserQuestion` 字面量替换为 `question`；
//   - 幂等：不含旧工具名时不重写文件（可能是已打补丁或上游已修复，均无需动作）；
//   - 读/写失败仅打日志不阻塞启动，与 ensureCometClassicLanguage 的容错策略一致；
//   - comet update 会覆盖该文档，本函数在 personal-stub 每次启动时重复执行以重新打补丁。
func ensureCometQuestionToolName(home string) {
	docPath := filepath.Join(home, cometDecisionPointDocRel)
	data, err := os.ReadFile(docPath)
	if err != nil {
		if !os.IsNotExist(err) {
			log.Printf("[Comet] read %s failed, skip tool-name patch: %v", docPath, err)
		}
		return
	}
	content := string(data)
	if !strings.Contains(content, cometLegacyQuestionToolName) {
		// 无需补丁（幂等）：已打补丁或上游版本已变更。
		return
	}
	patched := strings.ReplaceAll(content, cometLegacyQuestionToolName, cometOpencodeQuestionToolName)
	// WriteFile 对已存在文件保留其原有权限位，perm 参数仅在建新文件时生效。
	if err := os.WriteFile(docPath, []byte(patched), cometConfigFilePerm); err != nil {
		log.Printf("[Comet] write %s failed, skip tool-name patch: %v", docPath, err)
		return
	}
	log.Printf("[Comet] patched question tool name (%s -> %s) in %s",
		cometLegacyQuestionToolName, cometOpencodeQuestionToolName, docPath)
}
