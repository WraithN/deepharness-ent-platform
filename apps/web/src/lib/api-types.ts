/**
 * API 类型定义 — 对齐后端 DTO
 */

// ── WorkItem ──
export type WorkItemStatus =
  | "backlog"
  | "todo"
  | "in_progress"
  | "done"
  | "open"
  | "fixed"
  | "closed"
  | "draft"
  | "ready"
  | "passed"
  | "failed"
  | "blocked";

export type WorkItemPriority = "low" | "medium" | "high";

export type WorkItemSource =
  | "meego"
  | "pingcode"
  | "jira"
  | "azure_devops"
  | "github"
  | "internal";

export interface WorkItemDTO {
  id: string;
  tenantId: string;
  projectId: string;
  title: string;
  description: string;
  status: WorkItemStatus;
  priority: WorkItemPriority;
  assigneeId: string;
  reporter: string;
  source: WorkItemSource;
  externalId: string;
  createdAt: string;
  updatedAt: string;
}

// ── User ──
export type UserRole = "superadmin" | "admin" | "user";

export interface UserDTO {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  role: UserRole;
  createdAt: string;
}

// ── Project ──
export type RepoType = "dev" | "test" | "case" | "product";

export interface ProjectDTO {
  id: string;
  tenantId: string;
  name: string;
  gitUrl: string;
  repoType: RepoType;
  meegoKey: string;
  createdAt: string;
}

export interface RepositoryDTO {
  id: string;
  projectId: string;
  name: string;
  url: string;
  type: RepoType;
  defaultBranch: string;
  previewUrl?: string;
  branches?: string[];
}

export interface BranchDTO {
  name: string;
  isDefault: boolean;
  lastCommit?: string;
  updatedAt?: string;
}

export interface FileNodeDTO {
  name: string;
  path: string;
  type: "file" | "folder";
  children?: FileNodeDTO[];
}

export interface FileContentDTO {
  path: string;
  name: string;
  content: string;
  language: string;
  encoding: string;
  size: number;
  lastCommit?: string;
}

// ── Audit Event ──
export interface AuditEventDTO {
  id: string;
  tenantId: string;
  userId: string;
  action: string;
  resource: string;
  details: Record<string, unknown>;
  createdAt: string;
}

// ── PR Review ──
export interface ReviewIssueDTO {
  id: string;
  file: string;
  line: number;
  severity: string;
  message: string;
}

export interface ReviewResultDTO {
  id: string;
  repo: string;
  prId: number;
  title: string;
  summary: string;
  issues: ReviewIssueDTO[];
  createdAt: string;
}

// ── Agent Session ──
export interface AgentSessionDTO {
  id: string;
  title: string;
  agentType: string;
  model: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}
