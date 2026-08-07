/**
 * 指令（slash command）共享类型与分类映射。
 * 由 Chat.tsx 与超级管理员「指令管理」页面共用，避免分类逻辑重复定义。
 */

/** 后端指令配置（从 GET /v1/commands 加载）。template 字段仅管理端使用。 */
export interface CommandConfig {
  cmd: string;
  label: string;
  desc: string;
  icon: string;
  allowTask: boolean;
  allowRepos: boolean;
  requireRepos: boolean;
  requireTask: boolean;
  maxRepos: number;
  /** 指令是否启用；禁用指令在会话页中展示为灰色且不可点击。 */
  enabled: boolean;
  /** 指令对应的提示词模板（管理端展示用，前端会话页不使用）。 */
  template?: string;
  /** Comet Classic 工作流模板；comet_flow 开关启用时替代 template。为空表示不接入 Comet。 */
  cometTemplate?: string;
  /** 是否为系统内置指令（来自 commands.yaml）；内置指令核心字段不可修改，仅可切换 enabled。 */
  isBuiltin: boolean;
}

/** 指令分类（用于按角色分组展示）；other 为未配置分类的兜底。 */
export type CommandCategory = 'product' | 'design' | 'dev' | 'test' | 'other';

/** 分类 -> 中文标签。 */
export const COMMAND_CATEGORY_LABELS: Record<CommandCategory, string> = {
  product: '产品',
  design: 'UI',
  dev: '研发',
  test: '测试',
  other: '其他',
};

/** 分类展示顺序。 */
export const COMMAND_CATEGORY_ORDER: CommandCategory[] = ['product', 'design', 'dev', 'test', 'other'];

/** 指令 -> 分类 的映射；未列出的指令归为「其他」。 */
export const COMMAND_CATEGORIES: Record<string, CommandCategory> = {
  '/code': 'dev',
  '/debug': 'dev',
  '/review': 'dev',
  '/unit-test': 'dev',
  '/refactor': 'dev',
  '/dev-doc': 'dev',
  '/arch-design': 'dev',
  '/test-case': 'test',
  '/auto-test': 'test',
  '/bug-analysis': 'test',
  '/test-report': 'test',
  '/proto-make': 'product',
  '/ui-spec': 'design',
  '/ui-design': 'design',
  '/ui-kit': 'design',
  '/design-review': 'design',
  '/design-token': 'design',
  '/prd-write': 'product',
  '/prd-research': 'product',
  '/prd-analysis': 'product',
  '/grill-me': 'product',
  '/req-breakdown': 'product',
  '/data-analysis': 'product',
};

/** 其他/未分类指令的标签。 */
export const COMMAND_CATEGORY_OTHER_LABEL = '其他';

/** 返回指令所属分类；未配置分类的指令归为 other。 */
export function getCommandCategory(cmd: string): CommandCategory {
  return COMMAND_CATEGORIES[cmd] ?? 'other';
}

/** 返回指令所属分类标签；未配置分类的指令返回「其他」。 */
export function getCommandCategoryLabel(cmd: string): string {
  return COMMAND_CATEGORY_LABELS[getCommandCategory(cmd)];
}
