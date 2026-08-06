import React, { useMemo } from 'react';
import { Code2, ClipboardCheck, Palette } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { SUB_ROLE } from '@/lib/role-constants';
import { ProductWorkspace, type ExtraTab } from '@/components/workspace/ProductWorkspace';
import { DevWorkspace } from '@/components/workspace/DevWorkspace';
import { DesignWorkspace } from '@/components/workspace/DesignWorkspace';
import { TestCaseDesign } from '@/components/workspace/TestCaseDesign';

/**
 * 个人工作台入口页。
 *
 * 所有角色统一使用 ProductWorkspace，顶部 Tab 为：
 * - 需求追踪（始终显示）
 * - 需求设计（PM 角色）
 * - 工程代码（研发角色）
 * - 用例设计（测试角色）
 * - UI设计（UI设计师角色）
 *
 * 用户拥有多个角色时，对应 Tab 同时展示。
 */
export const PersonalSpace: React.FC = () => {
  const { membership } = useAuth();
  const subRoles = membership?.subRoles?.length ? membership.subRoles : [SUB_ROLE.DEVELOPER];

  const showDesignTab = subRoles.includes(SUB_ROLE.PM);

  const extraTabs = useMemo<ExtraTab[]>(() => {
    const tabs: ExtraTab[] = [];
    if (subRoles.includes(SUB_ROLE.DEVELOPER)) {
      tabs.push({ key: 'code', label: '工程代码', icon: Code2, render: () => <DevWorkspace /> });
    }
    if (subRoles.includes(SUB_ROLE.TESTER)) {
      tabs.push({ key: 'testcase', label: '用例设计', icon: ClipboardCheck, render: () => <TestCaseDesign /> });
    }
    if (subRoles.includes(SUB_ROLE.DESIGNER)) {
      tabs.push({ key: 'ui', label: 'UI设计', icon: Palette, render: () => <DesignWorkspace /> });
    }
    return tabs;
  }, [subRoles]);

  return <ProductWorkspace showDesignTab={showDesignTab} extraTabs={extraTabs} />;
};
