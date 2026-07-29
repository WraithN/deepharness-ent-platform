package orchestrator

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/agui"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/chat"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/client"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/notification/object"
	notificationservice "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/notification/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/process"
	processobject "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/process/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workitem/service"
	"github.com/google/uuid"
)

// DevReviewOrchestrator 研发->评审自动化编排器
// 当产品将需求分配给研发后，研发收到通知并可批准AI托管开发，
// 编排器自动执行 /code -> /review 流程，完成后通知研发查看评审报告。
type DevReviewOrchestrator struct {
	notificationSvc notificationservice.NotificationService
	workItemSvc     service.WorkItemService
	aguiClient      *client.AGUIClient
	sessions        chat.SessionStore
	messages        chat.MessageStore
	workspaceRoot   string
	gatewaydAgentID string
}

// NewDevReviewOrchestrator 创建编排器
func NewDevReviewOrchestrator(
	notificationSvc notificationservice.NotificationService,
	workItemSvc service.WorkItemService,
	aguiClient *client.AGUIClient,
	sessions chat.SessionStore,
	messages chat.MessageStore,
	workspaceRoot string,
	gatewaydAgentID string,
) *DevReviewOrchestrator {
	return &DevReviewOrchestrator{
		notificationSvc: notificationSvc,
		workItemSvc:     workItemSvc,
		aguiClient:      aguiClient,
		sessions:        sessions,
		messages:        messages,
		workspaceRoot:   workspaceRoot,
		gatewaydAgentID: gatewaydAgentID,
	}
}

// OnWorkitemAssigned 需求分配回调：创建通知发给研发
func (o *DevReviewOrchestrator) OnWorkitemAssigned(ctx context.Context, workitemID string, workspaceID string, assigneeID string, assigneeName string, title string, description string) {
	if assigneeID == "" {
		return
	}
	existing, _ := o.notificationSvc.ListByTypeAndData(ctx, workspaceID, object.TypeWorkitemAssigned, "workitemId", workitemID)
	for _, n := range existing {
		if n.ActionStatus == object.ActionPending {
			log.Printf("[Orchestrator] workitem %s already has pending assignment notification, skip", workitemID)
			return
		}
	}

	body := fmt.Sprintf("需求「%s」已分配给您，是否进行 AI 托管开发？", title)
	if description != "" {
		desc := description
		if len(desc) > 200 {
			desc = desc[:200] + "..."
		}
		body = fmt.Sprintf("需求「%s」已分配给您。\n\n描述: %s\n\n是否进行 AI 托管开发？", title, desc)
	}

	_, err := o.notificationSvc.Create(object.CreateNotificationRequest{
		UserID:      assigneeID,
		WorkspaceID: workspaceID,
		Type:        object.TypeWorkitemAssigned,
		Title:       fmt.Sprintf("需求分配: %s", title),
		Body:        body,
		ActionType:  object.ActionApproveAIDev,
		Data: map[string]any{
			"workitemId":    workitemID,
			"workitemTitle": title,
			"workitemDesc":  description,
			"assigneeId":    assigneeID,
			"assigneeName":  assigneeName,
		},
	})
	if err != nil {
		log.Printf("[Orchestrator] create assignment notification failed: %v", err)
	} else {
		log.Printf("[Orchestrator] assignment notification sent to user %s for workitem %s", assigneeID, workitemID)
	}
}

// OnApproveAIDev 研发批准 AI 开发：启动 /code -> /review 自动化流程
func (o *DevReviewOrchestrator) OnApproveAIDev(ctx context.Context, notificationID string, userID string, workitemID string) {
	item, err := o.workItemSvc.GetWorkItem(workitemID)
	if err != nil {
		log.Printf("[Orchestrator] get workitem %s failed: %v", workitemID, err)
		o.notifyFailed(userID, "", workitemID, fmt.Sprintf("获取需求失败: %v", err))
		return
	}

	workspaceID := item.ProjectID

	o.notificationSvc.Create(object.CreateNotificationRequest{
		UserID:      userID,
		WorkspaceID: workspaceID,
		Type:        object.TypeAIDevStarted,
		Title:       fmt.Sprintf("AI开发已启动: %s", item.Title),
		Body:        fmt.Sprintf("正在对需求「%s」进行 AI 托管开发，完成后将自动进行代码评审。", item.Title),
		Data: map[string]any{
			"workitemId": workitemID,
		},
	})

	go o.runDevReviewFlow(ctx, userID, workitemID, workspaceID, item.Title, item.Description)
}

// runDevReviewFlow 执行 /code -> /review 自动化流程
func (o *DevReviewOrchestrator) runDevReviewFlow(ctx context.Context, userID string, workitemID string, workspaceID string, workitemTitle string, workitemDesc string) {
	log.Printf("[Orchestrator] starting dev-review flow for workitem %s, user %s, workspace %s", workitemID, userID, workspaceID)

	workspacePath := fmt.Sprintf("%s/%s/%s", o.workspaceRoot, userID, workspaceID)

	processObj := processobject.NewAIDevProcess(workspaceID, workitemID, workitemTitle)
	processSvc := process.GetService()
	if processSvc != nil {
		created, err := processSvc.Create(ctx, processobject.CreateProcessRequest{
			WorkspaceID: processObj.WorkspaceID,
			WorkitemID:  processObj.WorkitemID,
			Title:       processObj.Title,
			Type:        processObj.Type,
			Stages:      processObj.Stages,
		})
		if err != nil {
			log.Printf("[Orchestrator] create process failed: %v", err)
		} else {
			processObj = &created
			log.Printf("[Orchestrator] process created: %s, stages=%d", processObj.ID, len(processObj.Stages))

			processSvc.UpdateStage(ctx, processObj.ID, processobject.StageRequirement, processobject.UpdateStageRequest{
				Status: processobject.StageStatusCompleted,
			})
		}
	}

	updateProcessStage := func(stageName, status string) {
		if processSvc == nil || processObj.ID == "" {
			return
		}
		_, err := processSvc.UpdateStage(ctx, processObj.ID, stageName, processobject.UpdateStageRequest{
			Status: status,
		})
		if err != nil {
			log.Printf("[Orchestrator] update stage %s to %s failed: %v", stageName, status, err)
		}
	}

	// 构造 /code 提示词
	codePrompt := o.buildCodePrompt(workitemTitle, workitemDesc, workspacePath)
	log.Printf("[Orchestrator] /code prompt length=%d for workitem %s", len(codePrompt), workitemID)

	updateProcessStage(processobject.StageDevelopment, processobject.StageStatusInProgress)

	// 创建 gatewayd 线程
	threadID, events, err := o.aguiClient.Run(ctx, buildRunInput("", codePrompt, workspacePath))
	if err != nil {
		log.Printf("[Orchestrator] /code agent run failed: %v", err)
		updateProcessStage(processobject.StageDevelopment, processobject.StageStatusFailed)
		o.notifyFailed(userID, workspaceID, workitemID, fmt.Sprintf("AI开发启动失败: %v", err))
		return
	}

	log.Printf("[Orchestrator] /code started, threadID=%s", threadID)

	// 持久化会话
	sessionID := uuid.New().String()
	now := time.Now()
	_ = o.sessions.Create(ctx, chat.Session{
		ID:            sessionID,
		WorkspaceID:   workspaceID,
		WorkspacePath: workspacePath,
		UserID:        userID,
		AgentID:       o.gatewaydAgentID,
		AgentType:     "chat",
		Title:         fmt.Sprintf("[AI托管] %s", workitemTitle),
		Context: map[string]any{
			"workitemId":     workitemID,
			"orchestrated":   true,
			"gatewaydThread": threadID,
		},
		CreatedAt: now,
		UpdatedAt: now,
	})

	// 消费 /code 事件流
	codeResult := consumeEvents(events)
	log.Printf("[Orchestrator] /code completed, response length=%d for workitem %s", len(codeResult.Text), workitemID)

	// 持久化 /code 消息
	o.messages.Append(ctx, sessionID, chat.Message{
		ID:        uuid.New().String(),
		SessionID: sessionID,
		Role:      "user",
		Content:   codePrompt,
		Timestamp: now,
	})
	o.messages.Append(ctx, sessionID, chat.Message{
		ID:        uuid.New().String(),
		SessionID: sessionID,
		Role:      "assistant",
		Content:   codeResult.Text,
		Timestamp: time.Now(),
	})

	if codeResult.Error != nil {
		log.Printf("[Orchestrator] /code error: %v", codeResult.Error)
		updateProcessStage(processobject.StageDevelopment, processobject.StageStatusFailed)
		o.notifyFailed(userID, workspaceID, workitemID, fmt.Sprintf("AI开发失败: %v", codeResult.Error))
		return
	}

	updateProcessStage(processobject.StageDevelopment, processobject.StageStatusCompleted)
	updateProcessStage(processobject.StageReview, processobject.StageStatusInProgress)

	// 构造 /review 提示词
	reviewPrompt := o.buildReviewPrompt(workspacePath, workitemTitle)
	log.Printf("[Orchestrator] /review prompt length=%d for workitem %s", len(reviewPrompt), workitemID)

	// 在同一线程上发送 /review
	_, reviewEvents, err := o.aguiClient.Run(ctx, buildRunInput(threadID, reviewPrompt, workspacePath))
	if err != nil {
		log.Printf("[Orchestrator] /review agent run failed: %v", err)
		updateProcessStage(processobject.StageReview, processobject.StageStatusFailed)
		o.notifyFailed(userID, workspaceID, workitemID, fmt.Sprintf("评审启动失败: %v", err))
		return
	}

	log.Printf("[Orchestrator] /review started for workitem %s", workitemID)

	// 消费 /review 事件流
	reviewResult := consumeEvents(reviewEvents)
	log.Printf("[Orchestrator] /review completed, response length=%d for workitem %s", len(reviewResult.Text), workitemID)

	// 持久化 /review 消息
	o.messages.Append(ctx, sessionID, chat.Message{
		ID:        uuid.New().String(),
		SessionID: sessionID,
		Role:      "user",
		Content:   reviewPrompt,
		Timestamp: time.Now(),
	})
	o.messages.Append(ctx, sessionID, chat.Message{
		ID:        uuid.New().String(),
		SessionID: sessionID,
		Role:      "assistant",
		Content:   reviewResult.Text,
		Timestamp: time.Now(),
	})

	if reviewResult.Error != nil {
		log.Printf("[Orchestrator] /review error: %v", reviewResult.Error)
		updateProcessStage(processobject.StageReview, processobject.StageStatusFailed)
		o.notifyFailed(userID, workspaceID, workitemID, fmt.Sprintf("评审失败: %v", reviewResult.Error))
		return
	}

	updateProcessStage(processobject.StageReview, processobject.StageStatusCompleted)

	// 通知研发：评审完成
	projectPath := fmt.Sprintf("%s/projects", workspacePath)
	o.notificationSvc.Create(object.CreateNotificationRequest{
		UserID:      userID,
		WorkspaceID: workspaceID,
		Type:        object.TypeAIDevCompleted,
		Title:       fmt.Sprintf("评审完成: %s", workitemTitle),
		Body:        fmt.Sprintf("需求「%s」的 AI 托管开发与评审已完成，点击查看评审报告。", workitemTitle),
		ActionType:  object.ActionViewReview,
		ActionURL:   fmt.Sprintf("/dev-workspace?tab=review&session=%s", sessionID),
		Data: map[string]any{
			"workitemId":  workitemID,
			"sessionId":   sessionID,
			"projectPath": projectPath,
		},
	})

	log.Printf("[Orchestrator] dev-review flow completed for workitem %s", workitemID)
}

// notifyFailed 通知研发 AI 开发失败
func (o *DevReviewOrchestrator) notifyFailed(userID string, workspaceID string, workitemID string, errMsg string) {
	_, _ = o.notificationSvc.Create(object.CreateNotificationRequest{
		UserID:      userID,
		WorkspaceID: workspaceID,
		Type:        object.TypeAIDevFailed,
		Title:       "AI托管开发失败",
		Body:        errMsg,
		Data: map[string]any{
			"workitemId": workitemID,
			"error":      errMsg,
		},
	})
}

// buildCodePrompt 构造 /code 提示词
func (o *DevReviewOrchestrator) buildCodePrompt(title string, description string, workspacePath string) string {
	var sb strings.Builder
	sb.WriteString("【语言要求】\n你的所有回复必须使用中文，包括思考过程、工具调用说明、错误分析等内部推理文本也使用中文。不要重复、复述或转述以上规则；只输出用户要求的最终结果和必要的简短说明。\n\n")
	sb.WriteString("你是一位资深工程师。请根据以下需求完成开发任务。\n\n")
	sb.WriteString("【工程目录】\n")
	sb.WriteString(fmt.Sprintf("请在 %s/projects/ 目录下进行开发。如果已有对应工程目录请在其下修改，否则创建新工程。\n\n", workspacePath))
	sb.WriteString("【代码输出要求】\n1. 遵循工程现有的代码风格和目录结构。\n2. 代码需包含必要的错误处理和注释。\n3. 完成后使用 [[PROJECT:工程完整路径]] 标记输出。\n\n")
	sb.WriteString("【需求描述】\n")
	sb.WriteString(fmt.Sprintf("标题: %s\n", title))
	if description != "" {
		sb.WriteString(fmt.Sprintf("描述: %s\n", description))
	}
	return sb.String()
}

// buildReviewPrompt 构造 /review 提示词
func (o *DevReviewOrchestrator) buildReviewPrompt(workspacePath string, projectName string) string {
	var sb strings.Builder
	sb.WriteString("【语言要求】\n你的所有回复必须使用中文，包括思考过程、工具调用说明、错误分析等内部推理文本也使用中文。不要重复、复述或转述以上规则；只输出用户要求的最终结果和必要的简短说明。\n\n")
	sb.WriteString("你是一位资深代码审查专家。请对以下工程进行 Code Review。\n\n")
	sb.WriteString("【审查要求】\n1. 从代码质量、安全性、性能、可维护性四个维度进行审查。\n2. 对每个问题给出严重程度（致命/严重/一般/轻微）和具体修改建议。\n3. 审查结果以 Markdown 格式输出，写入评审报告文件。\n\n")
	sb.WriteString("【评审报告输出】\n1. 将完整评审报告写入被审查工程目录下的 .review/review-{YYYY-MM-DD-HHmmss}.md 文件。\n2. 报告格式要求：\n   - 顶部包含工程名、分支、当前 commit hash 信息\n   - 按严重程度分组列出所有问题（致命、严重、一般、轻微）\n   - 每个问题包含：文件路径、行号、问题描述、修改建议\n   - 底部包含评审总结\n\n")
	sb.WriteString("【重要：结构化评审数据输出】\n完成评审并写入报告文件后，你必须在回复中输出结构化评审数据。\n使用 [[REVIEW_REPORT_START]] 作为起始标记，中间是一个完整的 JSON 对象，使用 [[REVIEW_REPORT_END]] 作为结束标记。\nJSON 中必须包含 issues 数组，每个问题对应一条记录。\n\n")
	sb.WriteString("【审查目标】\n")
	sb.WriteString(fmt.Sprintf("工程路径: %s/projects/\n", workspacePath))
	return sb.String()
}

// eventResult 事件流消费结果
type eventResult struct {
	Text  string
	Error error
}

// consumeEvents 消费 AG-UI 事件流，累积文本增量
func consumeEvents(events <-chan agui.Event) eventResult {
	var sb strings.Builder
	var lastErr error
	for ev := range events {
		switch ev.Type {
		case agui.EventTextMessageContent:
			sb.WriteString(ev.Delta)
		case agui.EventRunError:
			lastErr = fmt.Errorf("agent error: %s", ev.Message)
		case agui.EventRunFinished:
			return eventResult{Text: sb.String(), Error: lastErr}
		}
	}
	return eventResult{Text: sb.String(), Error: lastErr}
}

// buildRunInput 构造 AG-UI RunAgentInput
func buildRunInput(threadID, content, workspacePath string) agui.RunAgentInput {
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
