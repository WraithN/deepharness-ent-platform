import { api } from './api';
import type { UserProfileDTO } from './api-types';

export interface SaveProfileRequest {
  name: string;
  avatarUrl: string;
  description: string;
  sshKey: string;
}

export const profileApi = {
  get: () => api.get<UserProfileDTO>('/v1/identity/users/me/profile'),
  save: (req: SaveProfileRequest) =>
    api.put<UserProfileDTO>('/v1/identity/users/me/profile', req),
};
