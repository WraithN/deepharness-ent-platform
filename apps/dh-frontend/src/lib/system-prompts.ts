// 「系统」分类提示词：与斜杠指令绑定的内置提示词模板。
// 仅当输入框中存在绑定了系统提示词的指令时，提示词面板才展示「系统」分类。

/** 「系统」分类在提示词面板中的展示名称。 */
export const SYSTEM_PROMPT_CATEGORY_NAME = '系统';

/** 系统提示词：前端内置模板，不存库、不上报使用次数。 */
export interface SystemPrompt {
  id: string;
  name: string;
  description: string;
  /** 插入输入框的模板内容；{{参数名}} 会被渲染为可整体替换的参数块。 */
  content: string;
}

/** 指令 -> 系统提示词列表；未列出的指令没有系统提示词，不展示「系统」分类。 */
export const COMMAND_SYSTEM_PROMPTS: Record<string, SystemPrompt[]> = {
  '/prd-research': [
    {
      id: 'prd-research-by-name',
      name: '按产品名称调研',
      description: '输入要调研的产品名称',
      content: '调研产品：{{产品名称}}',
    },
    {
      id: 'prd-research-by-url',
      name: '按产品链接调研',
      description: '输入要调研的产品链接和登录 Cookie',
      content: '调研链接：{{产品链接}}\n登录Cookie：{{登录Cookie}}',
    },
  ],
};

/** 返回指令绑定的系统提示词；无绑定返回空数组。 */
export function getCommandSystemPrompts(cmd: string): SystemPrompt[] {
  return COMMAND_SYSTEM_PROMPTS[cmd] ?? [];
}
