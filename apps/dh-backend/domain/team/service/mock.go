package service

import (
	"errors"
	"time"

	"github.com/google/uuid"
)

// MockTeamService 是 TeamService 的内存实现，用于无 MySQL 的本地开发。
type MockTeamService struct {
	skills  []Skill
	prompts []Prompt
}

// NewMockTeamService 创建内存实现的团队服务。
func NewMockTeamService() *MockTeamService {
	return &MockTeamService{
		skills: []Skill{
			{ID: "skill-001", Name: "代码补全专家", Description: "智能上下文代码补全", Category: "编码开发", Tags: []string{"代码", "效率"}, Downloads: 12500, Rating: 4.8, Installed: true, Icon: "Code2", Phase: "代码开发"},
			{ID: "skill-002", Name: "代码重构助手", Description: "自动识别坏味道并重构", Category: "代码审查", Tags: []string{"重构", "质量"}, Downloads: 8300, Rating: 4.6, Installed: true, Icon: "Code2", Phase: "代码开发"},
			{ID: "skill-003", Name: "UI转代码", Description: "上传设计稿自动生成前端代码", Category: "UI设计", Tags: []string{"UI", "前端"}, Downloads: 21000, Rating: 4.9, Installed: false, Icon: "Box", Phase: "UI设计"},
			{ID: "skill-004", Name: "API测试生成器", Description: "根据接口文档生成测试用例", Category: "测试验证", Tags: []string{"测试", "API"}, Downloads: 5400, Rating: 4.5, Installed: false, Icon: "CheckCircle", Phase: "测试编写"},
			{ID: "skill-005", Name: "PRD生成专家", Description: "根据需求描述生成结构化PRD文档", Category: "需求设计", Tags: []string{"PRD", "文档"}, Downloads: 9800, Rating: 4.7, Installed: false, Icon: "ListTodo", Phase: "需求设计"},
			{ID: "skill-006", Name: "数据库优化助手", Description: "分析SQL性能并提供优化建议", Category: "架构方案", Tags: []string{"数据库", "性能"}, Downloads: 7200, Rating: 4.4, Installed: false, Icon: "Code2", Phase: "代码开发"},
			{ID: "skill-007", Name: "Jest自动化测试", Description: "为前端代码生成Jest单元测试", Category: "测试验证", Tags: []string{"Jest", "前端测试"}, Downloads: 11000, Rating: 4.6, Installed: false, Icon: "CheckCircle", Phase: "测试编写"},
			{ID: "skill-008", Name: "预发布巡检助手", Description: "在发布前自动检查常见风险点", Category: "预发布验证", Tags: []string{"发布", "检查"}, Downloads: 4500, Rating: 4.3, Installed: false, Icon: "UploadCloud", Phase: "需求上线"},
			{ID: "skill-009", Name: "自动化部署", Description: "将完成的代码提交并部署上线", Category: "预发布验证", Tags: []string{"部署", "上线"}, Downloads: 8800, Rating: 4.5, Installed: false, Icon: "UploadCloud", Phase: "需求上线"},
			{ID: "skill-010", Name: "需求设计", Description: "通过对话梳理并生成结构化需求文档", Category: "需求设计", Tags: []string{"需求", "文档"}, Downloads: 15000, Rating: 4.7, Installed: true, Icon: "ListTodo", Phase: "需求设计"},
		},
		prompts: []Prompt{
			{ID: "prompt-001", Name: "编写PRD文档模板", Description: "提供组件描述，生成带TypeScript和Tailwind的React组件", Content: "请作为产品经理，根据以下需求生成一份结构化的PRD文档，包含：1. 背景与目标 2. 用户场景 3. 功能详情 4. 业务流程图 5. 数据埋点要求。当前需求：", UseCase: "需求设计", UsageCount: 45000, AddedToSpace: true},
			{ID: "prompt-002", Name: "竞品分析框架", Description: "将复杂的代码段转换为易懂的自然语言解释", Content: "请帮我对【功能模块】进行竞品分析，主要对比对象包括：... 比较维度应包含用户体验、功能完整度、商业模式等。", UseCase: "需求设计", UsageCount: 32000, AddedToSpace: true},
			{ID: "prompt-003", Name: "React组件生成标准", Description: "根据业务需求生成SQL建表语句", Content: "请生成一个React组件，要求：使用TypeScript，TailwindCSS进行样式编写，遵循响应式设计，分离逻辑与视图，并添加适当的JSDoc注释。", UseCase: "前端开发", UsageCount: 28000, AddedToSpace: false},
			{ID: "prompt-004", Name: "Go API 接口规范", Description: "为指定函数编写单元测试", Content: "实现一个RESTful API端点，语言为Go，使用Gin框架。要求包含参数验证、统一的错误处理封装、以及完整的Swagger注释。", UseCase: "后端开发", UsageCount: 19000, AddedToSpace: false},
		},
	}
}

func (m *MockTeamService) ListSkills() ([]Skill, error) {
	return append([]Skill{}, m.skills...), nil
}

func (m *MockTeamService) CreateSkill(req CreateSkillRequest) (Skill, error) {
	skill := Skill{
		ID:          uuid.New().String(),
		Name:        req.Name,
		Description: req.Description,
		Category:    req.Category,
		Tags:        parseTagsInput(req.Tags),
		Downloads:   0,
		Rating:      req.Rating,
		Installed:   true,
		Icon:        defaultIcon(req.Icon),
		Phase:       defaultPhase(req.Phase),
		CreatedAt:   time.Now().UTC(),
		UpdatedAt:   time.Now().UTC(),
	}
	if skill.Rating == 0 {
		skill.Rating = 5.0
	}
	m.skills = append([]Skill{skill}, m.skills...)
	return skill, nil
}

func (m *MockTeamService) UpdateSkill(id string, req UpdateSkillRequest) (Skill, error) {
	for i, s := range m.skills {
		if s.ID == id {
			if req.Installed != nil {
				m.skills[i].Installed = *req.Installed
			}
			return m.skills[i], nil
		}
	}
	return Skill{}, errors.New("skill not found")
}

func (m *MockTeamService) DeleteSkill(id string) error {
	for i, s := range m.skills {
		if s.ID == id {
			m.skills = append(m.skills[:i], m.skills[i+1:]...)
			return nil
		}
	}
	return errors.New("skill not found")
}

func (m *MockTeamService) ListPrompts() ([]Prompt, error) {
	return append([]Prompt{}, m.prompts...), nil
}

func (m *MockTeamService) CreatePrompt(req CreatePromptRequest) (Prompt, error) {
	prompt := Prompt{
		ID:           uuid.New().String(),
		Name:         req.Name,
		Description:  req.Description,
		Content:      req.Content,
		UseCase:      req.UseCase,
		UsageCount:   0,
		AddedToSpace: true,
		CreatedAt:    time.Now().UTC(),
		UpdatedAt:    time.Now().UTC(),
	}
	m.prompts = append([]Prompt{prompt}, m.prompts...)
	return prompt, nil
}

func (m *MockTeamService) UpdatePrompt(id string, req UpdatePromptRequest) (Prompt, error) {
	for i, p := range m.prompts {
		if p.ID == id {
			if req.AddedToSpace != nil {
				m.prompts[i].AddedToSpace = *req.AddedToSpace
			}
			return m.prompts[i], nil
		}
	}
	return Prompt{}, errors.New("prompt not found")
}

func (m *MockTeamService) DeletePrompt(id string) error {
	for i, p := range m.prompts {
		if p.ID == id {
			m.prompts = append(m.prompts[:i], m.prompts[i+1:]...)
			return nil
		}
	}
	return errors.New("prompt not found")
}
