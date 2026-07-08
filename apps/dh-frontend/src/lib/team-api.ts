import { api } from './api';
import type { Skill, Prompt, PaginatedList, SkillCategory, TeamPromptCategory, SkillStats, PromptStats } from '@/types';

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
  // 技能
  listSkills: (page = 1, pageSize = 10) =>
    api.get<PaginatedList<Skill>>(`/v1/team/skills?page=${page}&pageSize=${pageSize}`),
  createSkill: (req: CreateSkillRequest) => api.post<Skill>('/v1/team/skills', req),
  updateSkillInstalled: (id: string, installed: boolean) =>
    api.patch<Skill>(`/v1/team/skills/${id}`, { installed }),
  deleteSkill: (id: string) => api.delete<void>(`/v1/team/skills/${id}`),

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

  // 技能分类
  listSkillCategories: () => api.get<SkillCategory[]>('/v1/team/skill-categories'),
  createSkillCategory: (name: string) => api.post<SkillCategory>('/v1/team/skill-categories', { name }),
  deleteSkillCategory: (id: string) => api.delete<void>(`/v1/team/skill-categories/${id}`),

  // 提示词分类
  listPromptCategories: () => api.get<TeamPromptCategory[]>('/v1/team/prompt-categories'),
  createPromptCategory: (name: string) => api.post<TeamPromptCategory>('/v1/team/prompt-categories', { name }),
  deletePromptCategory: (id: string) => api.delete<void>(`/v1/team/prompt-categories/${id}`),

  // 大盘统计
  getSkillStats: () => api.get<SkillStats>('/v1/team/skills/stats'),
  getPromptStats: () => api.get<PromptStats>('/v1/team/prompts/stats'),
};
