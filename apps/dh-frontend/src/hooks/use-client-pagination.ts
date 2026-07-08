import * as React from 'react';

/** 客户端分页默认每页数量。 */
const DEFAULT_PAGE_SIZE = 10;

interface UseClientPaginationOptions {
  /** 每页数量，默认 10。 */
  pageSize?: number;
  /** 数据总条数。 */
  total: number;
  /** 当依赖项变化时重置到第 1 页（如搜索词、分类筛选）。 */
  resetDeps?: React.DependencyList;
}

interface UseClientPaginationResult {
  /** 当前页码（1-based）。 */
  currentPage: number;
  /** 总页数，至少为 1。 */
  totalPages: number;
  /** 每页数量。 */
  pageSize: number;
  /** 切换页码回调。 */
  onPageChange: (page: number) => void;
  /** 当前页在数组中的起始索引。 */
  startIndex: number;
  /** 当前页在数组中的结束索引（exclusive）。 */
  endIndex: number;
}

/**
 * 客户端分页 Hook：封装分页状态管理、页码重置与越界钳制逻辑。
 * 调用方通过 slice(startIndex, endIndex) 获取当前页数据。
 */
export function useClientPagination({
  pageSize = DEFAULT_PAGE_SIZE,
  total,
  resetDeps = [],
}: UseClientPaginationOptions): UseClientPaginationResult {
  const [currentPage, setCurrentPage] = React.useState(1);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // 当筛选条件变化时重置到第 1 页
  React.useEffect(() => {
    setCurrentPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, resetDeps);

  // 当数据减少导致当前页越界时，钳制到最后一页
  React.useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;

  return {
    currentPage,
    totalPages,
    pageSize,
    onPageChange: setCurrentPage,
    startIndex,
    endIndex,
  };
}
