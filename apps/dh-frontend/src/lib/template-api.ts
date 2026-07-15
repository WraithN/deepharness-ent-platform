import { api } from './api';
import type { DocTemplate, TemplateCategory } from '@/types';

/** 模板 API 基础路径。 */
const TEMPLATES_API_PATH = '/v1/templates';

/** 每个分类下允许创建的最大模板数量。 */
export const MAX_TEMPLATES_PER_CATEGORY = 20;

/** 各分类展示名称。 */
export const TEMPLATE_CATEGORY_LABELS: Record<TemplateCategory, string> = {
  product: '产品规范模板',
  design: '设计规范模板',
  development: '研发规范模板',
};

export interface CreateTemplateRequest {
  key: string;
  label: string;
  content: string;
}

export interface UpdateTemplateRequest {
  label?: string;
  content?: string;
}

export interface ReorderTemplatesRequest {
  keys: string[];
}

export interface PublishTemplateRequest {
  published: boolean;
}

export const templateApi = {
  list: (category: TemplateCategory, publishedOnly = false) => {
    const params = new URLSearchParams({ category });
    if (publishedOnly) {
      params.set('published', 'true');
    }
    return api.get<DocTemplate[]>(`${TEMPLATES_API_PATH}?${params.toString()}`);
  },

  create: (category: TemplateCategory, template: CreateTemplateRequest) =>
    api.post<DocTemplate>(TEMPLATES_API_PATH, { category, ...template }),

  update: (category: TemplateCategory, key: string, partial: UpdateTemplateRequest) =>
    api.put<DocTemplate>(
      `${TEMPLATES_API_PATH}/${encodeURIComponent(key)}?category=${encodeURIComponent(category)}`,
      partial,
    ),

  delete: (category: TemplateCategory, key: string) =>
    api.delete<void>(
      `${TEMPLATES_API_PATH}/${encodeURIComponent(key)}?category=${encodeURIComponent(category)}`,
    ),

  reorder: (category: TemplateCategory, keys: string[]) =>
    api.put<void>(
      `${TEMPLATES_API_PATH}/order?category=${encodeURIComponent(category)}`,
      { keys } satisfies ReorderTemplatesRequest,
    ),

  publish: (category: TemplateCategory, key: string, published: boolean) =>
    api.put<void>(
      `${TEMPLATES_API_PATH}/${encodeURIComponent(key)}/publish?category=${encodeURIComponent(category)}`,
      { published } satisfies PublishTemplateRequest,
    ),
};
