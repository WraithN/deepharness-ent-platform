import React from 'react';
import { ProjectCode } from '@/pages/ProjectCode';

/** 研发空间工作台。
 *
 * 提供代码仓库浏览、文件树、diff、预览等研发工程能力。
 * 流程追踪已提取为独立的侧边栏入口（/personal/flow）。
 */
export const DevWorkspace: React.FC = () => {
  return (
    <div className="h-full flex flex-col">
      <ProjectCode />
    </div>
  );
};
