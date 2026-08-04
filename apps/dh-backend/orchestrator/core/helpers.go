package core

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/agui"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/chat"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/stubclient"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/pkg/gitutil"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/repository"
	"github.com/google/uuid"
)

// EventResult 事件流消费结果
type EventResult struct {
	Text  string
	Error error
}

// ConsumeEvents 消费 AG-UI 事件流，累积文本增量直到完成
func ConsumeEvents(events <-chan agui.Event) EventResult {
	var sb strings.Builder
	var lastErr error
	for ev := range events {
		switch ev.Type {
		case agui.EventTextMessageContent:
			sb.WriteString(ev.Delta)
		case agui.EventRunError:
			lastErr = fmt.Errorf("agent error: %s", ev.Message)
		case agui.EventRunFinished:
			return EventResult{Text: sb.String(), Error: lastErr}
		}
	}
	return EventResult{Text: sb.String(), Error: lastErr}
}

// BuildRunInput 构造 AG-UI RunAgentInput
func BuildRunInput(threadID, content, workspacePath string) agui.RunAgentInput {
	return agui.RunAgentInput{
		ThreadID:       threadID,
		RunID:          uuid.New().String(),
		Messages:       []agui.Message{agui.UserMessage("", content)},
		State:          json.RawMessage(`{}`),
		Tools:          []agui.Tool{},
		Context:        []agui.ContextItem{},
		ForwardedProps: json.RawMessage(`{}`),
		Workspace:      workspacePath,
	}
}

// ScanProjectSummary 扫描 dev-jobs/ 目录，找到最近修改的工程并收集 git 统计信息
func ScanProjectSummary(workspacePath string) string {
	projectsDir := filepath.Join(workspacePath, repository.DirDevJobs)
	sc := stubclient.FromContext(context.Background())
	if sc == nil {
		return ""
	}
	ctx := context.Background()
	entries, err := sc.ListDir(ctx, projectsDir)
	if err != nil {
		return ""
	}

	var latestDir string
	var latestTime time.Time
	for _, entry := range entries {
		if !entry.IsDir || strings.HasPrefix(entry.Name, ".") {
			continue
		}
		entryPath := filepath.Join(projectsDir, entry.Name)
		fi, err := sc.FileInfo(ctx, entryPath)
		if err != nil {
			continue
		}
		modTime, err := time.Parse(time.RFC3339, fi.ModTime)
		if err != nil {
			continue
		}
		if modTime.After(latestTime) {
			latestTime = modTime
			latestDir = entryPath
		}
	}
	if latestDir == "" {
		return ""
	}

	projectName := filepath.Base(latestDir)
	summary := map[string]any{
		"projectName": projectName,
		"techStack":   []string{"React 18", "Vite", "TypeScript", "Tailwind CSS", "shadcn/ui"},
	}

	exists, err := sc.FileExists(ctx, filepath.Join(latestDir, ".git"))
	if err != nil || !exists {
		summary["committed"] = false
		b, _ := json.Marshal(summary)
		return string(b)
	}

	if branch := gitutil.ExecTrimmed(ctx, latestDir, "rev-parse", "--abbrev-ref", "HEAD"); branch != "" {
		summary["branch"] = branch
	}

	commitCountStr := gitutil.ExecTrimmed(ctx, latestDir, "rev-list", "--count", "HEAD")
	summary["committed"] = commitCountStr != "" && commitCountStr != "0"

	diffStat := gitutil.ExecTrimmed(ctx, latestDir, "diff", "--stat", "HEAD~1", "HEAD")
	if diffStat == "" {
		diffStat = gitutil.ExecTrimmed(ctx, latestDir, "show", "--stat", "--oneline", "HEAD")
	}

	filesChanged, linesAdded, linesDeleted := parseGitDiffStat(diffStat)
	summary["filesChanged"] = filesChanged
	summary["linesAdded"] = linesAdded
	summary["linesDeleted"] = linesDeleted

	b, _ := json.Marshal(summary)
	return string(b)
}

func parseGitDiffStat(stat string) (filesChanged, linesAdded, linesDeleted int) {
	lines := strings.Split(stat, "\n")
	for _, line := range lines {
		if strings.Contains(line, "file") && strings.Contains(line, "changed") {
			parts := strings.Split(line, ",")
			for _, part := range parts {
				part = strings.TrimSpace(part)
				if strings.Contains(part, "insertion") {
					fmt.Sscanf(part, "%d", &linesAdded)
				} else if strings.Contains(part, "deletion") {
					fmt.Sscanf(part, "%d", &linesDeleted)
				} else if strings.Contains(part, "file") {
					fmt.Sscanf(part, "%d", &filesChanged)
				}
			}
			break
		}
	}
	return
}

const FetchMessagesLimit = 5

// FetchLastAssistantMessage 从会话消息中获取最后一条 assistant 消息内容
func FetchLastAssistantMessage(fc *FlowContext, store chat.MessageStore) string {
	if fc.SessionID == "" {
		return ""
	}
	messages, err := store.GetHistory(fc.Ctx, fc.SessionID, FetchMessagesLimit)
	if err != nil {
		return ""
	}
	for i := len(messages) - 1; i >= 0; i-- {
		if messages[i].Role == "assistant" {
			return messages[i].Content
		}
	}
	return ""
}
