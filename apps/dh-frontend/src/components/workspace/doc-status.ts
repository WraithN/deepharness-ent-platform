/**
 * 产品文档状态展示常量（文档页目录树与版本历史页共用）。
 */
export const STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  published: '已定稿',
  archived: '已归档',
};

export const STATUS_VARIANT: Record<string, string> = {
  draft: 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200',
  published: 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200',
  archived: 'bg-slate-100 text-slate-700 hover:bg-slate-200',
};
