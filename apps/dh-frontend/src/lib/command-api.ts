import { api } from './api';
import type { CommandConfig } from './commands';

/** 创建/更新指令的请求体。cmd 仅创建时需要，更新时由路径参数指定。 */
export interface CommandRequest {
  cmd?: string;
  label: string;
  desc: string;
  icon: string;
  allowTask: boolean;
  allowRepos: boolean;
  requireRepos: boolean;
  requireTask: boolean;
  maxRepos: number;
  enabled: boolean;
  template: string;
  cometTemplate?: string;
}

/** 指令名以 / 开头，URL 路径参数中需省略前导 /，此函数统一处理。 */
const cmdToPath = (cmd: string) => cmd.replace(/^\//, '');

export const commandApi = {
  list: () => api.get<CommandConfig[]>('/v1/commands'),
  get: (cmd: string) => api.get<CommandConfig>(`/v1/commands/${cmdToPath(cmd)}`),
  create: (req: CommandRequest) => api.post<CommandConfig>('/v1/commands', req),
  update: (cmd: string, req: CommandRequest) => api.put<CommandConfig>(`/v1/commands/${cmdToPath(cmd)}`, req),
  delete: (cmd: string) => api.delete<void>(`/v1/commands/${cmdToPath(cmd)}`),
};
