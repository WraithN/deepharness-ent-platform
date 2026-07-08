import React from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { SUB_ROLE } from '@/lib/role-constants';
import { ProductWorkspace } from '@/components/workspace/ProductWorkspace';
import { DesignWorkspace } from '@/components/workspace/DesignWorkspace';
import { DevWorkspace } from '@/components/workspace/DevWorkspace';

/**
 * 个人空间入口页。
 *
 * 根据当前用户的职能子角色分发到不同的工作空间视图：
 * - pm        → 产品空间（文档 / 看板 / 原型 / 版本历史）
 * - designer  → 设计空间（原型 / 设计资源）
 * - 其他角色  → 研发空间（代码 / 图谱 / 评审 / 文档 / 预览 / 详情）
 */
export const PersonalSpace: React.FC = () => {
  const { membership } = useAuth();
  const subRole = membership?.subRole;

  if (subRole === SUB_ROLE.PM) {
    return <ProductWorkspace />;
  }

  if (subRole === SUB_ROLE.DESIGNER) {
    return <DesignWorkspace />;
  }

  return <DevWorkspace />;
};
