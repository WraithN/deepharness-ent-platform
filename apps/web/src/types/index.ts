export interface User {
  id: string;
  name: string;
  avatar?: string;
  role: 'admin' | 'developer' | 'designer' | 'pm' | 'tester';
  joinedAt: string;
}

export interface Tenant {
  id: string;
  name: string;
  logo?: string;
  description?: string;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  category: string;
  tags?: string[];
  downloads: number;
  rating: number;
  installed: boolean;
  icon?: string;
  phase?: string;
}

export interface Prompt {
  id: string;
  name: string;
  description: string;
  useCase: string;
  usageCount: number;
  addedToSpace: boolean;
  content?: string;
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
  meegoProject: string;
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
  tenantId: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceMember {
  workspaceId: string;
  userId: string;
  role: 'admin' | 'user';
  subRole?: 'developer' | 'tester' | 'pm' | 'designer';
  joinedAt: string;
}

export interface DemandProject {
  id: string;
  workspaceId: string;
  platform: string;
  externalKey: string;
  name: string;
  config?: Record<string, unknown>;
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

export interface WorkspaceRepository {
  id: string;
  workspaceId: string;
  projectId?: string;
  name: string;
  url: string;
  type: 'dev' | 'test' | 'case' | 'product';
  defaultBranch?: string;
  previewUrl?: string;
  branches?: string[];
  createdAt: string;
  updatedAt: string;
}
