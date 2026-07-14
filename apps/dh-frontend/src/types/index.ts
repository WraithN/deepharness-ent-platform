import type { RepoType } from '@/lib/api-types';
import type { PlatformRole, SpaceRole, SubRole } from '@/lib/role-constants';

export interface PaginatedList<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface User {
  id: string;
  name: string;
  avatar?: string;
  platformRole: PlatformRole;
  subRole?: SubRole;
  joinedAt: string;
}

export interface Tenant {
  id: string;
  displayId: string;
  name: string;
  agentConfigLocked: boolean;
  lockedAgentKeys: string[];
  allowedAgentKeys: string[];
  defaultAgentConfigs?: Record<string, WorkspaceAgentConfig>;
  createdAt: string;
}

export interface TenantMember {
  id: string;
  name: string;
  email: string;
  platformRole: string;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  category: string;
  /** 多分类链接（team_skill_category_links），为空时回退展示 category 单分类 */
  categoryIds?: string[];
  tags?: string[];
  downloads: number;
  rating: number;
  installed: boolean;
  icon?: string;
  phase?: string;
  status?: PromptStatus;
  createdAt?: string;
  updatedAt?: string;
}

export interface SkillCategory {
  id: string;
  name: string;
  builtin: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export type PromptStatus = 'pending_review' | 'on_shelf' | 'off_shelf' | 'rejected';

export interface Prompt {
  id: string;
  name: string;
  description: string;
  useCase: string;
  /** 多分类链接（team_prompt_category_links），为空时回退展示 useCase */
  categoryIds?: string[];
  usageCount: number;
  addedToSpace?: boolean;
  content?: string;
  status?: PromptStatus;
  createdBy?: string;
  createdByName?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface PromptCategory {
  id: string;
  workspaceId: string;
  name: string;
  isBuiltin?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TeamPromptCategory {
  id: string;
  name: string;
  builtin: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CategoryDistribution {
  category: string;
  count: number;
}

export interface StatusDistribution {
  status: string;
  count: number;
}

export interface TopSkill {
  id: string;
  name: string;
  category: string;
  downloads: number;
  rating: number;
}

export interface TopPrompt {
  id: string;
  name: string;
  useCase: string;
  usageCount: number;
}

export interface SkillStats {
  total: number;
  installedCount: number;
  categoryDistribution: CategoryDistribution[];
  topSkills: TopSkill[];
}

export interface PromptStats {
  total: number;
  onShelfCount: number;
  categoryDistribution: CategoryDistribution[];
  statusDistribution: StatusDistribution[];
  topPrompts: TopPrompt[];
}

export interface WorkspacePrompt {
  id: string;
  workspaceId: string;
  libraryPromptId?: string;
  categories: PromptCategory[];
  name: string;
  description: string;
  content: string;
  useCase: string;
  usageCount: number;
  isCustom: boolean;
  addedToSpace: boolean;
  enabled: boolean;
  createdBy?: string;
  createdByName?: string;
  sharedPromptId?: string;
  shareStatus?: PromptStatus;
  createdAt: string;
  updatedAt: string;
}

export type RequirementStatus = 'backlog' | 'todo' | 'in-progress' | 'done';

export interface Requirement {
  id: string;
  title: string;
  description?: string;
  status: RequirementStatus;
  assigneeId?: string;
  createdAt: string;
  meegoSyncStatus?: 'synced' | 'pending' | 'failed';
}

export interface DashboardStats {
  codeCommits: { date: string; count: number }[];
  sessions: { date: string; count: number }[];
  requirementsCompleted: { date: string; count: number }[];
}

export interface SettingsConfig {
  /** 需求管理平台的项目标识（Meego 项目 ID / Jira 项目 Key / PingCode 项目 ID）。 */
  reqProjectId: string;
  gitlabUrl: string;
  codingStandard: string;
  designStandard: string;
  agentConfig: {
    agentName: 'opencode' | 'claude code';
    modelSource: 'builtin' | 'custom';
    model: string;
    temperature: number;
    baseUrl?: string;
    apiKey?: string;
  };
}

export interface Workspace {
  id: string;
  displayId: string;
  tenantId: string;
  name: string;
  description?: string;
  agentConfigLocked: boolean;
  lockedAgentKeys: string[];
  allowedAgentKeys: string[];
  defaultAgentConfigs?: Record<string, WorkspaceAgentConfig>;
  createdAt: string;
  updatedAt: string;
}

export interface AgentPolicy {
  agentConfigLocked: boolean;
  lockedAgentKeys: string[];
  allowedAgentKeys: string[];
  defaultAgentConfigs?: Record<string, WorkspaceAgentConfig>;
}

export interface WorkspaceMember {
  workspaceId: string;
  userId: string;
  displayId: string;
  name: string;
  email: string;
  platformRole: PlatformRole;
  role: SpaceRole;
  subRole?: SubRole;
  joinedAt: string;
}

export interface WorkitemProject {
  id: string;
  workspaceId: string;
  platform: string;
  externalKey: string;
  name: string;
  config?: Record<string, unknown>;
}

/** 需求管理平台元信息（后端 config.yaml workitem.platforms 配置驱动）。 */
export interface WorkitemPlatform {
  key: string;
  name: string;
  needsProjectId: boolean;
  projectIdPlaceholder: string;
}

export interface WorkspaceStandard {
  id: string;
  workspaceId: string;
  repositoryId?: string;
  type: 'coding' | 'design' | 'engineering';
  name: string;
  content: string;
}

export interface WorkspaceCICD {
  id: string;
  workspaceId: string;
  triggerBranches: string;
  webhookUrl: string;
  script: string;
}

export interface WorkspaceAgent {
  id: string;
  workspaceId: string;
  name: string;
  role: string;
  description?: string;
  config?: Record<string, unknown>;
  isDefault: boolean;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentType {
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  builtin: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AdvancedAgentConfig {
  maxTokens?: number;
  contextWindow?: number;
  topP?: number;
  topK?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  extra?: Record<string, unknown>;
}

export interface WorkspaceAgentConfig {
  id: string;
  workspaceId: string;
  agentKey: string;
  name: string;
  description: string;
  enabled: boolean;
  model: string;
  modelSource: 'builtin' | 'custom';
  baseUrl: string;
  apiKey: string;
  temperature?: number;
  advancedConfig?: AdvancedAgentConfig;
  createdAt: string;
  updatedAt: string;
}

export interface AvailableAgent {
  agentKey: string;
  name: string;
  description: string;
  model: string;
}

export interface WorkspaceRepository {
  id: string;
  workspaceId: string;
  name: string;
  url: string;
  type: RepoType;
  defaultBranch?: string;
  sshKey?: string;
  localPath?: string;
  cloneStatus: 'pending' | 'cloning' | 'cloned' | 'failed';
  lastSyncAt?: string;
  errorMessage?: string;
  config?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
