import { api } from './api';

/** 平台级功能开关。 */
export interface FeatureFlag {
  flagKey: string;
  enabled: boolean;
  updatedAt: string;
}

/** comet_flow 开关标识，与后端 handler.FlagKeyCometFlow 对应。 */
export const COMET_FLOW_FLAG_KEY = 'comet_flow';

export const featureFlagApi = {
  list: () => api.get<FeatureFlag[]>('/v1/platform/feature-flags'),
  update: (key: string, enabled: boolean) =>
    api.put<FeatureFlag>(`/v1/platform/feature-flags/${key}`, { enabled }),
};
