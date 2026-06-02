/**
 * 版本相关 API
 */

import type { LatestVersionApiPayload, LatestVersionResponse } from '@/types';
import { normalizeLatestVersionResponse } from '@/utils/version';
import { apiClient } from './client';

export const versionApi = {
  checkLatest: async (): Promise<LatestVersionResponse> => {
    const payload = await apiClient.get<LatestVersionApiPayload>('/latest-version');
    return normalizeLatestVersionResponse(payload);
  },
};
