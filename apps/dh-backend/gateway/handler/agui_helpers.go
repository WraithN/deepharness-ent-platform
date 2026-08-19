package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/agui"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/stubclient"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/pkg/idutil"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/common/workspacepath"
)

// scanRecentPrototypeProjects 扫描原型产物目录，返回修改时间不早于 since 的工程绝对路径（按时间倒序）。
// 用于 /proto-make 完成后兜底补全 [[PROJECT:...]] 标记：仅追加本次 run 期间创建/修改的工程目录，
// 避免把历史工程误判为本次产物。目录修改时间在新增/删除其内文件时会更新，足以识别新建工程。
func scanRecentPrototypeProjects(ctx context.Context, workspacePath string, since time.Time) []string {
	protoDir := filepath.Join(workspacePath, workspacepath.DirPMJobs, workspacepath.SubDirPrototypes)
	sc := stubclient.FromContext(ctx)
	if sc == nil {
		return nil
	}
	entries, err := sc.ListDir(ctx, protoDir)
	if err != nil {
		return nil
	}
	type dirInfo struct {
		path    string
		modTime time.Time
	}
	var dirs []dirInfo
	for _, e := range entries {
		if !e.IsDir {
			continue
		}
		entryPath := filepath.Join(protoDir, e.Name)
		fi, err := sc.FileInfo(ctx, entryPath)
		if err != nil {
			continue
		}
		modTime, err := time.Parse(time.RFC3339, fi.ModTime)
		if err != nil {
			continue
		}
		if modTime.Before(since) {
			continue
		}
		dirs = append(dirs, dirInfo{path: entryPath, modTime: modTime})
	}
	sort.Slice(dirs, func(i, j int) bool { return dirs[i].modTime.After(dirs[j].modTime) })
	result := make([]string, 0, len(dirs))
	for _, d := range dirs {
		result = append(result, d.path)
	}
	return result
}

// buildProtoProjectMarker 构造 [[PROJECT:...]] 标记文本，供前端渲染原型预览卡片。
func buildProtoProjectMarker(projects []string) string {
	var sb strings.Builder
	sb.WriteString("\n\n原型工程已生成，可点击下方卡片预览：\n")
	for _, p := range projects {
		sb.WriteString(fmt.Sprintf("[[PROJECT:%s]]\n", p))
	}
	return sb.String()
}

// removeToolCallID 从列表中移除第一个匹配的工具调用 ID，返回是否找到并移除。
func removeToolCallID(ids *[]string, target string) bool {
	for i, id := range *ids {
		if id == target {
			*ids = append((*ids)[:i], (*ids)[i+1:]...)
			return true
		}
	}
	return false
}

// cloneAGUIMessages 深拷贝 AG-UI 消息切片，避免 interceptCommands / applyIntentCommand
// 替换最后一条消息内容时污染原始用户输入的备份。
func cloneAGUIMessages(msgs []agui.Message) []agui.Message {
	out := make([]agui.Message, len(msgs))
	for i, m := range msgs {
		out[i] = m
		if m.Content != nil {
			out[i].Content = append(json.RawMessage(nil), m.Content...)
		}
		if m.ToolCalls != nil {
			out[i].ToolCalls = append(json.RawMessage(nil), m.ToolCalls...)
		}
	}
	return out
}

// generateMessageID 生成消息 ID。
func generateMessageID() string {
	return "msg-" + idutil.GenerateShortID()
}

// emitLongTaskFeedback 对长耗时指令发送合成进度反馈，避免前端长时间显示"思考中"。
// 收到第一个 SSE 事件后即发送，告诉用户任务已启动并正在执行。
func emitLongTaskFeedback(command, runID, sessionID string, writeEvent func(agui.Event) error) error {
	if command == "" || !LONG_TASK_COMMANDS[command] {
		return nil
	}
	label := map[string]string{
		"/proto-make":   "正在生成原型工程",
		"/code":         "正在编写代码",
		"/user-story":   "正在拆分用户故事",
		"/prd-write":    "正在撰写 PRD",
		"/prd-research": "正在进行产品调研",
		"/prd-analysis": "正在进行竞品信息分析",
		"/ui-kit":       "正在生成 UI 组件库规范",
		"/test-case":    "正在生成测试用例",
		"/auto-test":    "正在生成自动化脚本",
		"/unit-test":    "正在生成单元测试",
	}[command]
	if label == "" {
		label = "正在处理任务"
	}

	msgID := "feedback-" + runID[:8]
	ts := float64(time.Now().UnixMilli()) / 1000
	// 先发送一个独立的 thinking 内容，前端会把它渲染为 reasoning 部件。
	if err := writeEvent(agui.Event{
		Type:      agui.EventThinkingTextMessageContent,
		MessageID: msgID,
		Delta:     fmt.Sprintf("%s，可能需要一些时间，请稍候...", label),
		Timestamp: ts,
		ThreadID:  sessionID,
		RunID:     runID,
	}); err != nil {
		return err
	}
	return writeEvent(agui.Event{
		Type:      agui.EventThinkingEnd,
		MessageID: msgID,
		Timestamp: ts + 0.001,
		ThreadID:  sessionID,
		RunID:     runID,
	})
}
