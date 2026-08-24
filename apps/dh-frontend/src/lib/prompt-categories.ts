// 系统内置提示词分类，顺序即展示顺序。
export const BUILTIN_PROMPT_CATEGORY_NAMES = [
  '通用',
  '代码开发',
  '需求分析',
  '产品设计',
  '测试',
  '运维',
  '文档',
] as const;

// 「未分类」是前端内置语义分类，表示未关联任何分类的提示词（categories 为空）。
export const UNCATEGORIZED_PROMPT_CATEGORY_NAME = '未分类';

// 判断分类名称是否为系统内置。
export function isBuiltinPromptCategoryName(name: string): boolean {
  return BUILTIN_PROMPT_CATEGORY_NAMES.includes(name as typeof BUILTIN_PROMPT_CATEGORY_NAMES[number]);
}

// 把内置分类排在前面，自定义按原顺序跟随。
export function sortPromptCategoriesByBuiltin<T extends { name: string; isBuiltin?: boolean }>(
  categories: T[],
): T[] {
  return [...categories].sort((a, b) => {
    const aBuiltin = a.isBuiltin || isBuiltinPromptCategoryName(a.name);
    const bBuiltin = b.isBuiltin || isBuiltinPromptCategoryName(b.name);
    if (aBuiltin && !bBuiltin) return -1;
    if (!aBuiltin && bBuiltin) return 1;
    return 0;
  });
}
