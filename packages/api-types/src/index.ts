/**
 * 前后端共享 API 类型定义
 */

export interface ApiResponse<T> {
  code: number
  message: string
  data: T
}

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

export interface UserDTO {
  id: string
  name: string
  email: string
  role: "superadmin" | "admin" | "user"
  tenantId: string
}

export interface TenantDTO {
  id: string
  name: string
}

export type RepoType = "dev" | "test" | "case" | "product"

export interface ProjectDTO {
  id: string
  name: string
  gitUrl: string
  repoType: RepoType
}

export interface RepositoryDTO {
  id: string
  projectId: string
  name: string
  url: string
  type: RepoType
  defaultBranch: string
  previewUrl?: string
  branches?: string[]
}

export interface BranchDTO {
  name: string
  isDefault: boolean
  lastCommit?: string
  updatedAt?: string
}

export interface FileNodeDTO {
  name: string
  path: string
  type: "file" | "folder"
  children?: FileNodeDTO[]
}

export interface FileContentDTO {
  path: string
  name: string
  content: string
  language: string
  encoding: string
  size: number
  lastCommit?: string
}

export interface WorkItemDTO {
  id: string
  tenantId?: string
  projectId?: string
  type: "requirement" | "defect" | "case"
  title: string
  description: string
  status: string
  priority: "low" | "medium" | "high"
  assigneeId?: string
  reporter?: string
  source?: string
  externalId?: string
  createdAt: string
  updatedAt?: string
  severity?: "critical" | "high" | "medium" | "low"
  steps?: string[]
}

// ── Personal Assistant（虾班智守）──
export type LobsterRole =
  | "测试虾"
  | "运维虾"
  | "设计虾"
  | "开发虾"
  | "产品虾"
  | "运营虾"

export interface PersonalAssistantDTO {
  id: string
  name: string
  role: LobsterRole
  description: string
  creatorId: string
  creatorName: string
  isMine: boolean
  avatarUrl?: string
  createdAt: string
  updatedAt?: string
}

export interface CreatePersonalAssistantRequest {
  name: string
  role: LobsterRole
  description?: string
}

export interface PersonalAssistantSessionDTO {
  id: string
  assistantId: string
  title: string
  messageCount: number
  createdAt: string
  updatedAt: string
}

export interface PersonalAssistantMessageDTO {
  id: string
  sessionId: string
  role: "user" | "assistant" | "system"
  type: "text"
  content: string
  createdAt: string
}

export interface AgentSessionDTO {
  id: string
  messages: Array<{
    role: "user" | "assistant" | "system"
    content: string
  }>
}
