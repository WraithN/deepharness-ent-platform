import { api } from './api';
import type { Skill, Prompt } from '@/types';

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
  listSkills: () => api.get<Skill[]>('/v1/team/skills'),
  createSkill: (req: CreateSkillRequest) => api.post<Skill>('/v1/team/skills', req),
  updateSkillInstalled: (id: string, installed: boolean) =>
    api.patch<Skill>(`/v1/team/skills/${id}`, { installed }),
  deleteSkill: (id: string) => api.delete<void>(`/v1/team/skills/${id}`),

  // 提示词
  listPrompts: () => api.get<Prompt[]>('/v1/team/prompts'),
  createPrompt: (req: CreatePromptRequest) => api.post<Prompt>('/v1/team/prompts', req),
  updatePromptAdded: (id: string, addedToSpace: boolean) =>
    api.patch<Prompt>(`/v1/team/prompts/${id}`, { addedToSpace }),
  deletePrompt: (id: string) => api.delete<void>(`/v1/team/prompts/${id}`),
};
