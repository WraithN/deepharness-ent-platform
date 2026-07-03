import React from 'react';
import { ListTodo, CheckCircle } from 'lucide-react';

export interface TaskItemData {
  id: string;
  title: string;
  status: string;
}

interface TaskListViewProps {
  tasks: TaskItemData[];
}

export const TaskListView: React.FC<TaskListViewProps> = ({ tasks }) => {
  return (
    <div className="rounded-xl border border-border/50 bg-muted/30 p-3 space-y-2">
      <div className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
        <ListTodo className="h-3.5 w-3.5" />
        任务列表
      </div>
      {tasks.map(task => {
        const isDone = task.status === 'completed';
        const isActive = task.status === 'in_progress';
        return (
          <div key={task.id} className={`flex items-center gap-2 text-sm ${isDone ? 'text-muted-foreground' : 'text-foreground'}`}>
            <div className={`h-4 w-4 rounded border flex items-center justify-center shrink-0 ${isDone ? 'bg-green-500 border-green-500' : isActive ? 'border-amber-400' : 'border-muted-foreground/30'}`}>
              {isDone && <CheckCircle className="h-3 w-3 text-white" />}
              {isActive && <div className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />}
            </div>
            <span className={isDone ? 'line-through' : ''}>{task.title}</span>
            {isActive && <span className="text-[10px] text-amber-500 ml-auto">进行中</span>}
            {isDone && <span className="text-[10px] text-green-500 ml-auto">已完成</span>}
          </div>
        );
      })}
    </div>
  );
};
