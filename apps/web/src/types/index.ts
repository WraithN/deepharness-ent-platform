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
