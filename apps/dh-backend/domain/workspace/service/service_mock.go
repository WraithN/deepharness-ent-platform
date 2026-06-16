package service

import (
	"errors"
	"sort"
	"sync"
	"time"

	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/agent"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/workspace"
	"github.com/google/uuid"
)

const (
	errWorkspaceNotFound       = "workspace not found"
	errMemberNotFound          = "member not found"
	errWorkitemProjectNotFound = "workitem project not found"
	errAgentNotFound           = "agent not found"
	errStandardNotFound        = "standard not found"
	errCICDNotFound            = "cicd not found"
	errDefaultAgentNotFound    = "default agent not found"
)

// MockWorkspaceService 是 WorkspaceService 的内存实现，用于无 MySQL 的本地开发环境。
type MockWorkspaceService struct {
	mu               sync.RWMutex
	workspaces       map[string]workspace.Workspace
	members          map[string][]workspace.Member
	workitemProjects map[string]workspace.WorkitemProject
	agents           map[string][]agent.Agent
	standards        map[string][]workspace.Standard
	cicd             map[string]workspace.CICD
}

// NewMockWorkspaceService 创建内存工作空间服务，并填充默认种子数据。
func NewMockWorkspaceService() *MockWorkspaceService {
	s := &MockWorkspaceService{
		workspaces:       make(map[string]workspace.Workspace),
		members:          make(map[string][]workspace.Member),
		workitemProjects: make(map[string]workspace.WorkitemProject),
		agents:           make(map[string][]agent.Agent),
		standards:        make(map[string][]workspace.Standard),
		cicd:             make(map[string]workspace.CICD),
	}
	s.seed()
	return s
}

// seed 初始化一个默认工作空间，包含成员、Agent、规范与 CI/CD 配置，
// 用于本地开发服务器启动后即有内容可浏览。
func (s *MockWorkspaceService) seed() {
	now := time.Now().UTC()
	wsID := "ws-default"
	userID := "user-1"

	s.workspaces[wsID] = workspace.Workspace{
		ID:          wsID,
		TenantID:    "tenant-1",
		Name:        "Default Workspace",
		Description: "Seed workspace for local development",
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	s.members[wsID] = []workspace.Member{{
		WorkspaceID: wsID,
		UserID:      userID,
		Role:        MemberRoleAdmin,
		SubRole:     MemberSubRolePM,
		JoinedAt:    now,
	}}

	agentID := "agent-default"
	s.agents[wsID] = []agent.Agent{{
		ID:              agentID,
		WorkspaceID:     wsID,
		Name:            "Default Agent",
		Role:            "assistant",
		Description:     "Seed agent for local development",
		Config:          map[string]any{"model": "gpt-4"},
		IsDefault:       true,
		CreatedByUserID: userID,
		CreatedAt:       now,
		UpdatedAt:       now,
	}}

	s.standards[wsID] = []workspace.Standard{{
		ID:           "std-default",
		WorkspaceID:  wsID,
		RepositoryID: "",
		Type:         "coding",
		Name:         "Default Coding Standard",
		Content:      "Use clear naming, keep functions small, and add tests.",
		CreatedAt:    now,
		UpdatedAt:    now,
	}}

	s.cicd[wsID] = workspace.CICD{
		ID:              "cicd-default",
		WorkspaceID:     wsID,
		TriggerBranches: "main",
		WebhookURL:      "https://example.com/webhook",
		Script:          "echo 'seed build'",
		CreatedAt:       now,
		UpdatedAt:       now,
	}
}

func (s *MockWorkspaceService) workspaceExists(id string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	_, ok := s.workspaces[id]
	return ok
}

// CreateWorkspace 创建新工作空间，并将所有者加入成员表。
func (s *MockWorkspaceService) CreateWorkspace(tenantID, name, description, ownerUserID string) (workspace.Workspace, error) {
	now := time.Now().UTC()
	ws := workspace.Workspace{
		ID:          uuid.NewString(),
		TenantID:    tenantID,
		Name:        name,
		Description: description,
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	s.workspaces[ws.ID] = ws
	s.members[ws.ID] = append(s.members[ws.ID], workspace.Member{
		WorkspaceID: ws.ID,
		UserID:      ownerUserID,
		Role:        MemberRoleAdmin,
		SubRole:     MemberSubRolePM,
		JoinedAt:    now,
	})

	return ws, nil
}

// GetWorkspace 按 ID 查询工作空间。
func (s *MockWorkspaceService) GetWorkspace(id string) (workspace.Workspace, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	ws, ok := s.workspaces[id]
	if !ok {
		return workspace.Workspace{}, errors.New(errWorkspaceNotFound)
	}
	return ws, nil
}

// ListWorkspaces 返回工作空间列表，支持按租户过滤。
func (s *MockWorkspaceService) ListWorkspaces(tenantID string) ([]workspace.Workspace, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	result := make([]workspace.Workspace, 0, len(s.workspaces))
	for _, ws := range s.workspaces {
		if tenantID != "" && ws.TenantID != tenantID {
			continue
		}
		result = append(result, ws)
	}

	sort.Slice(result, func(i, j int) bool {
		return result[i].CreatedAt.After(result[j].CreatedAt)
	})
	return result, nil
}

// AddMember 向工作空间添加成员。
func (s *MockWorkspaceService) AddMember(workspaceID, userID, role, subRole string) error {
	if !s.workspaceExists(workspaceID) {
		return errors.New(errWorkspaceNotFound)
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	s.members[workspaceID] = append(s.members[workspaceID], workspace.Member{
		WorkspaceID: workspaceID,
		UserID:      userID,
		Role:        role,
		SubRole:     subRole,
		JoinedAt:    time.Now().UTC(),
	})
	return nil
}

// ListMembers 返回工作空间成员列表。
func (s *MockWorkspaceService) ListMembers(workspaceID string) ([]workspace.Member, error) {
	if !s.workspaceExists(workspaceID) {
		return nil, errors.New(errWorkspaceNotFound)
	}

	s.mu.RLock()
	defer s.mu.RUnlock()

	members := s.members[workspaceID]
	result := make([]workspace.Member, len(members))
	copy(result, members)
	return result, nil
}

// RemoveMember 移除工作空间成员。
func (s *MockWorkspaceService) RemoveMember(workspaceID, userID string) error {
	if !s.workspaceExists(workspaceID) {
		return errors.New(errWorkspaceNotFound)
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	members := s.members[workspaceID]
	for i, m := range members {
		if m.UserID == userID {
			s.members[workspaceID] = append(members[:i], members[i+1:]...)
			return nil
		}
	}
	return errors.New(errMemberNotFound)
}

// SetWorkitemProject 设置工作空间的工作项项目。
func (s *MockWorkspaceService) SetWorkitemProject(workspaceID string, req WorkitemProjectRequest) (workspace.WorkitemProject, error) {
	if !s.workspaceExists(workspaceID) {
		return workspace.WorkitemProject{}, errors.New(errWorkspaceNotFound)
	}

	now := time.Now().UTC()
	wp := workspace.WorkitemProject{
		ID:          uuid.NewString(),
		WorkspaceID: workspaceID,
		Platform:    req.Platform,
		ExternalKey: req.ExternalKey,
		Name:        req.Name,
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	// 如果已存在则保留原 ID，仅更新字段。
	if existing, ok := s.workitemProjects[workspaceID]; ok {
		wp.ID = existing.ID
		wp.CreatedAt = existing.CreatedAt
	}
	s.workitemProjects[workspaceID] = wp

	return wp, nil
}

// GetWorkitemProject 获取工作空间的工作项项目。
func (s *MockWorkspaceService) GetWorkitemProject(workspaceID string) (workspace.WorkitemProject, error) {
	if !s.workspaceExists(workspaceID) {
		return workspace.WorkitemProject{}, errors.New(errWorkspaceNotFound)
	}

	s.mu.RLock()
	defer s.mu.RUnlock()

	wp, ok := s.workitemProjects[workspaceID]
	if !ok {
		return workspace.WorkitemProject{}, errors.New(errWorkitemProjectNotFound)
	}
	return wp, nil
}

// ListAgents 返回工作空间下的 Agent 列表。
func (s *MockWorkspaceService) ListAgents(workspaceID string) ([]agent.Agent, error) {
	if !s.workspaceExists(workspaceID) {
		return nil, errors.New(errWorkspaceNotFound)
	}

	s.mu.RLock()
	defer s.mu.RUnlock()

	agents := s.agents[workspaceID]
	result := make([]agent.Agent, len(agents))
	copy(result, agents)
	return result, nil
}

// CreateAgent 在工作空间下创建 Agent，必要时清空原有默认 Agent。
func (s *MockWorkspaceService) CreateAgent(workspaceID string, req AgentRequest) (agent.Agent, error) {
	if !s.workspaceExists(workspaceID) {
		return agent.Agent{}, errors.New(errWorkspaceNotFound)
	}

	now := time.Now().UTC()
	a := agent.Agent{
		ID:          uuid.NewString(),
		WorkspaceID: workspaceID,
		Name:        req.Name,
		Role:        req.Role,
		Description: req.Description,
		Config:      req.Config,
		IsDefault:   req.IsDefault,
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if req.IsDefault {
		for i := range s.agents[workspaceID] {
			s.agents[workspaceID][i].IsDefault = false
		}
	}

	s.agents[workspaceID] = append(s.agents[workspaceID], a)
	return a, nil
}

// GetDefaultAgent 返回工作空间的默认 Agent。
func (s *MockWorkspaceService) GetDefaultAgent(workspaceID string) (agent.Agent, error) {
	if !s.workspaceExists(workspaceID) {
		return agent.Agent{}, errors.New(errWorkspaceNotFound)
	}

	s.mu.RLock()
	defer s.mu.RUnlock()

	for _, a := range s.agents[workspaceID] {
		if a.IsDefault {
			return a, nil
		}
	}
	return agent.Agent{}, errors.New(errDefaultAgentNotFound)
}

// ListStandards 返回工作空间下的规范列表，支持按仓库过滤。
func (s *MockWorkspaceService) ListStandards(workspaceID string, repoID string) ([]workspace.Standard, error) {
	if !s.workspaceExists(workspaceID) {
		return nil, errors.New(errWorkspaceNotFound)
	}

	s.mu.RLock()
	defer s.mu.RUnlock()

	result := make([]workspace.Standard, 0)
	for _, st := range s.standards[workspaceID] {
		if repoID != "" && st.RepositoryID != repoID {
			continue
		}
		result = append(result, st)
	}

	sort.Slice(result, func(i, j int) bool {
		return result[i].CreatedAt.After(result[j].CreatedAt)
	})
	return result, nil
}

// SaveStandard 保存规范，若提供 ID 则更新，否则新增。
func (s *MockWorkspaceService) SaveStandard(workspaceID string, req StandardRequest) (workspace.Standard, error) {
	if !s.workspaceExists(workspaceID) {
		return workspace.Standard{}, errors.New(errWorkspaceNotFound)
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now().UTC()
	if req.ID != "" {
		for i, st := range s.standards[workspaceID] {
			if st.ID == req.ID {
				st.RepositoryID = req.RepositoryID
				st.Type = req.Type
				st.Name = req.Name
				st.Content = req.Content
				st.UpdatedAt = now
				s.standards[workspaceID][i] = st
				return st, nil
			}
		}
		return workspace.Standard{}, errors.New(errStandardNotFound)
	}

	st := workspace.Standard{
		ID:           uuid.NewString(),
		WorkspaceID:  workspaceID,
		RepositoryID: req.RepositoryID,
		Type:         req.Type,
		Name:         req.Name,
		Content:      req.Content,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	s.standards[workspaceID] = append(s.standards[workspaceID], st)
	return st, nil
}

// DeleteStandard 删除工作空间下的规范。
func (s *MockWorkspaceService) DeleteStandard(workspaceID, standardID string) error {
	if !s.workspaceExists(workspaceID) {
		return errors.New(errWorkspaceNotFound)
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	standards := s.standards[workspaceID]
	for i, st := range standards {
		if st.ID == standardID {
			s.standards[workspaceID] = append(standards[:i], standards[i+1:]...)
			return nil
		}
	}
	return errors.New(errStandardNotFound)
}

// GetCICD 获取工作空间的 CI/CD 配置。
func (s *MockWorkspaceService) GetCICD(workspaceID string) (workspace.CICD, error) {
	if !s.workspaceExists(workspaceID) {
		return workspace.CICD{}, errors.New(errWorkspaceNotFound)
	}

	s.mu.RLock()
	defer s.mu.RUnlock()

	c, ok := s.cicd[workspaceID]
	if !ok {
		return workspace.CICD{}, errors.New(errCICDNotFound)
	}
	return c, nil
}

// SaveCICD 保存工作空间的 CI/CD 配置。
func (s *MockWorkspaceService) SaveCICD(workspaceID string, req CICDRequest) (workspace.CICD, error) {
	if !s.workspaceExists(workspaceID) {
		return workspace.CICD{}, errors.New(errWorkspaceNotFound)
	}

	now := time.Now().UTC()
	c := workspace.CICD{
		ID:              uuid.NewString(),
		WorkspaceID:     workspaceID,
		TriggerBranches: req.TriggerBranches,
		WebhookURL:      req.WebhookURL,
		Script:          req.Script,
		CreatedAt:       now,
		UpdatedAt:       now,
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	// 如果已存在则保留原 ID，仅更新字段。
	if existing, ok := s.cicd[workspaceID]; ok {
		c.ID = existing.ID
		c.CreatedAt = existing.CreatedAt
	}
	s.cicd[workspaceID] = c

	return c, nil
}
