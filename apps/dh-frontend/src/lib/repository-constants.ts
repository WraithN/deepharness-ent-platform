import type { RepoType } from '@/lib/api-types';

/** 仓库类型常量。前后端共用这些值，修改时必须同步 Go 侧 RepoType 常量。 */
export const REPO_TYPE_DEV: RepoType = 'dev';
export const REPO_TYPE_ARCH: RepoType = 'arch';
export const REPO_TYPE_PRODUCT: RepoType = 'product';
export const REPO_TYPE_CASE: RepoType = 'case';

/** 所有仓库类型列表。 */
export const REPO_TYPES: RepoType[] = [REPO_TYPE_DEV, REPO_TYPE_ARCH, REPO_TYPE_PRODUCT, REPO_TYPE_CASE];

/** 仓库类型中文展示名。 */
export const REPO_TYPE_LABELS: Record<RepoType, string> = {
  [REPO_TYPE_DEV]: '开发库',
  [REPO_TYPE_ARCH]: '架构库',
  [REPO_TYPE_PRODUCT]: '产品库',
  [REPO_TYPE_CASE]: '用例库',
};

/** 工程代码 Tab 中可选择的仓库类型。 */
export const ENGINEERING_REPO_TYPES: RepoType[] = [REPO_TYPE_DEV, REPO_TYPE_ARCH];
