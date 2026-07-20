import type { PaginatedList, Prompt, PromptStats, Skill, SkillCategory, SkillStats, TeamPromptCategory } from '@/types';
import { api } from './api';

export interface CreateSkillRequest {
  name: string;
  description: string;
  category: string;
  tags?: string;
  icon?: string;
  phase?: string;
  rating?: number;
}

export interface CreatePromptRequest {
  name: string;
  description: string;
  content: string;
  useCase: string;
}

export const teamApi = {
  // 技能（按工作区隔离安装状态与可见范围）
  listSkills: (page = 1, pageSize = 10, workspaceId = '') =>
    api.get<PaginatedList<Skill>>(`/v1/team/skills?page=${page}&pageSize=${pageSize}&workspaceId=${encodeURIComponent(workspaceId)}`),
  createSkill: (req: CreateSkillRequest, workspaceId = '') =>
    api.post<Skill>(`/v1/team/skills?workspaceId=${encodeURIComponent(workspaceId)}`, req),
  updateSkillInstalled: (id: string, installed: boolean, workspaceId = '') =>
    api.patch<Skill>(`/v1/team/skills/${id}?workspaceId=${encodeURIComponent(workspaceId)}`, { installed }),
  deleteSkill: (id: string, workspaceId = '') =>
    api.delete<void>(`/v1/team/skills/${id}?workspaceId=${encodeURIComponent(workspaceId)}`),
  // 技能审核：approve 上架 / reject 拒绝 / unshelf 下架（仅超管）
  reviewSkill: (id: string, action: 'approve' | 'reject' | 'unshelf') =>
    api.post<Skill>(`/v1/team/skills/${id}/review`, { action }),
  // 技能多分类更新（替换语义，仅超管）
  updateSkillCategories: (id: string, categoryIds: string[]) =>
    api.put<Skill>(`/v1/team/skills/${id}/categories`, { categoryIds }),

  // 提示词
  listPrompts: (page = 1, pageSize = 10) =>
    api.get<PaginatedList<Prompt>>(`/v1/team/prompts?page=${page}&pageSize=${pageSize}`),
  createPrompt: (req: CreatePromptRequest) => api.post<Prompt>('/v1/team/prompts', req),
  updatePromptAdded: (id: string, addedToSpace: boolean) =>
    api.patch<Prompt>(`/v1/team/prompts/${id}`, { addedToSpace }),
  updatePrompt: (id: string, req: Partial<CreatePromptRequest>) =>
    api.patch<Prompt>(`/v1/team/prompts/${id}`, req),
  deletePrompt: (id: string) => api.delete<void>(`/v1/team/prompts/${id}`),
  reviewPrompt: (id: string, action: 'approve' | 'reject' | 'unshelf') =>
    api.post<Prompt>(`/v1/team/prompts/${id}/review`, { action }),
  // 复制使用上报：同一用户同一提示词每天只计数一次（后端去重）
  recordPromptUsage: (id: string) =>
    api.post<Prompt>(`/v1/team/prompts/${id}/use`),
  // 提示词多分类更新（替换语义，仅超管）
  updatePromptCategories: (id: string, categoryIds: string[]) =>
    api.put<Prompt>(`/v1/team/prompts/${id}/categories`, { categoryIds }),

  // 技能分类
  listSkillCategories: (workspaceId = '') =>
    api.get<SkillCategory[]>(`/v1/team/skill-categories?workspaceId=${encodeURIComponent(workspaceId)}`),
  createSkillCategory: (name: string, workspaceId = '') =>
    api.post<SkillCategory>(`/v1/team/skill-categories?workspaceId=${encodeURIComponent(workspaceId)}`, { name }),
  deleteSkillCategory: (id: string, workspaceId = '') =>
    api.delete<void>(`/v1/team/skill-categories/${id}?workspaceId=${encodeURIComponent(workspaceId)}`),

  // 提示词分类
  listPromptCategories: () => api.get<TeamPromptCategory[]>('/v1/team/prompt-categories'),
  createPromptCategory: (name: string) => api.post<TeamPromptCategory>('/v1/team/prompt-categories', { name }),
  deletePromptCategory: (id: string) => api.delete<void>(`/v1/team/prompt-categories/${id}`),

  // 大盘统计
  getSkillStats: (workspaceId = '') =>
    api.get<SkillStats>(`/v1/team/skills/stats?workspaceId=${encodeURIComponent(workspaceId)}`),
  getPromptStats: () => api.get<PromptStats>('/v1/team/prompts/stats'),
};
