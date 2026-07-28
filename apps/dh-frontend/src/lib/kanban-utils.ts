/**
 * 看板层级通用工具函数。
 * 用于产品空间看板、智能会话需求看板等需要展示父子需求层级的地方。
 */

/** 看板展示的最大需求层级深度（根需求为第 1 层）。 */
export const MAX_KANBAN_DEPTH = 4;

/** 看板显示模式。 */
export type KanbanViewMode = 'expand' | 'collapse';

/** 具备父子关系的最小卡片接口。 */
export interface HierarchicalCard {
  id: string;
  title: string;
  parentId?: string;
}

/** 获取直接子需求卡片。 */
export function getChildren<T extends HierarchicalCard>(cards: T[], parentId: string): T[] {
  return cards.filter(c => c.parentId === parentId);
}

/** 判断是否存在子需求。 */
export function hasChildren<T extends HierarchicalCard>(cards: T[], parentId: string): boolean {
  return cards.some(c => c.parentId === parentId);
}

/** 计算卡片在看板森林中的深度（根卡片深度为 0）。 */
export function getDepth<T extends HierarchicalCard>(cards: T[], id: string): number {
  const visited = new Set<string>();
  let depth = 0;
  let current = cards.find(c => c.id === id);
  while (current?.parentId) {
    if (visited.has(current.id)) break; // 防止循环引用
    visited.add(current.id);
    const parent = cards.find(c => c.id === current!.parentId);
    if (!parent) break;
    depth += 1;
    current = parent;
  }
  return depth;
}

/** 获取某卡片的所有后代 ID（包含子需求及其子需求，直到最大深度）。 */
export function getDescendantIds<T extends HierarchicalCard>(cards: T[], parentId: string): Set<string> {
  const result = new Set<string>();
  const queue = [parentId];
  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const children = getChildren(cards, currentId);
    for (const child of children) {
      if (result.has(child.id)) continue;
      result.add(child.id);
      // 限制最大深度，避免无限递归（虽然循环引用已被 id 去重兜底）。
      if (getDepth(cards, child.id) < MAX_KANBAN_DEPTH - 1) {
        queue.push(child.id);
      }
    }
  }
  return result;
}

/** 获取某卡片的所有祖先标题（从根到直接父需求）。 */
export function getAncestorTitles<T extends HierarchicalCard>(cards: T[], id: string): string[] {
  const titles: string[] = [];
  const visited = new Set<string>();
  let current = cards.find(c => c.id === id);
  while (current?.parentId) {
    if (visited.has(current.id)) break;
    visited.add(current.id);
    const parent = cards.find(c => c.id === current!.parentId);
    if (!parent) break;
    titles.unshift(parent.title);
    current = parent;
  }
  return titles;
}

/** 构建展开模式下的显示标题：深层需求展示为 "父 / 父 / 子"。 */
export function buildDisplayTitle<T extends HierarchicalCard>(cards: T[], id: string): string {
  const card = cards.find(c => c.id === id);
  if (!card) return '';
  const ancestors = getAncestorTitles(cards, id);
  return ancestors.length > 0 ? `${ancestors.join(' / ')} / ${card.title}` : card.title;
}

/** 获取所有根级卡片。 */
export function getRootCards<T extends HierarchicalCard>(cards: T[]): T[] {
  return cards.filter(c => !c.parentId);
}

/** 判断卡片是否允许继续拆分（层级不超过最大深度）。 */
export function canSplitMore<T extends HierarchicalCard>(cards: T[], id: string): boolean {
  return getDepth(cards, id) < MAX_KANBAN_DEPTH - 1;
}
