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

export interface ProjectDTO {
  id: string
  name: string
  gitUrl: string
  repoType: "dev" | "test"
}

export interface WorkItemDTO {
  id: string
  title: string
  description: string
  status: "todo" | "in_progress" | "done"
  priority: "low" | "medium" | "high"
  assigneeId?: string
}

export interface AgentSessionDTO {
  id: string
  messages: Array<{
    role: "user" | "assistant" | "system"
    content: string
  }>
}
