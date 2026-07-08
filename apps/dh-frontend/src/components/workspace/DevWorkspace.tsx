import React from 'react';
import { ProjectCode } from '@/pages/ProjectCode';

/**
 * 研发空间工作台。
 *
 * 本期先直接复用 ProjectCode 组件，保证现有研发能力不变。
 * 后续按阶段 5 逐步拆分内部视图，避免 2040 行大组件继续膨胀。
 */
export const DevWorkspace: React.FC = () => {
  return <ProjectCode />;
};
