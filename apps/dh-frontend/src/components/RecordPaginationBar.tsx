import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface RecordPaginationBarProps {
  /** 记录总条数 */
  total: number;
  /** 当前页码（1-based） */
  currentPage: number;
  /** 总页数（至少为 1） */
  totalPages: number;
  /** 切换页码回调 */
  onPageChange: (page: number) => void;
  className?: string;
}

/**
 * 记录型分页器：左侧「共 N 条记录，第 X/Y 页」，右侧 上一页/页码/下一页。
 * 与会话轨迹分页器样式一致，始终展示（无数据时显示 第 1/1 页）。
 */
export const RecordPaginationBar: React.FC<RecordPaginationBarProps> = ({
  total,
  currentPage,
  totalPages,
  onPageChange,
  className,
}) => {
  const pages = Math.max(1, totalPages);
  return (
    <div className={cn('mt-5 flex flex-wrap justify-between items-center gap-3 text-sm', className)}>
      <span className="text-muted-foreground">
        共 {total} 条记录，第 {currentPage}/{pages} 页
      </span>
      <div className="flex gap-1">
        <Button
          variant="outline"
          size="sm"
          className="h-9 px-3 text-sm rounded-md"
          disabled={currentPage <= 1}
          onClick={() => onPageChange(Math.max(1, currentPage - 1))}
        >
          上一页
        </Button>
        {Array.from({ length: pages }, (_, i) => i + 1).map(p => (
          <Button
            key={p}
            variant={currentPage === p ? 'default' : 'outline'}
            size="sm"
            className="h-9 min-w-9 px-3 text-sm rounded-md"
            onClick={() => onPageChange(p)}
          >
            {p}
          </Button>
        ))}
        <Button
          variant="outline"
          size="sm"
          className="h-9 px-3 text-sm rounded-md"
          disabled={currentPage >= pages}
          onClick={() => onPageChange(Math.min(pages, currentPage + 1))}
        >
          下一页
        </Button>
      </div>
    </div>
  );
};
