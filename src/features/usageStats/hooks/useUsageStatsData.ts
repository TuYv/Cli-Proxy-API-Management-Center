import { useCallback, useEffect, useRef, useState } from 'react';
import { accountsApi } from '@/services/api/accounts';
import { apiKeyUsageApi } from '@/services/api/apiKeyUsage';
import type { ClientAccount } from '@/types/account';
import type { ApiKeyUsageResponse } from '@/utils/recentRequests';
import {
  buildUsageQuery,
  buildUsageSummary,
  normalizeProviderCards,
  normalizeUsageRows,
  type UsageAccountRow,
  type UsageProviderCard,
  type UsageSummary,
  type UsageTimePreset,
} from '../utils';

interface UseUsageStatsDataOptions {
  enabled: boolean;
  preset: UsageTimePreset;
  fromValue: string;
  toValue: string;
}

interface UseUsageStatsDataResult {
  accounts: ClientAccount[];
  rows: UsageAccountRow[];
  providerCards: UsageProviderCard[];
  summary: UsageSummary;
  isLoading: boolean;
  isRefreshing: boolean;
  error: string;
  recentUsageError: string;
  lastUpdatedAt: number | null;
  refresh: () => Promise<void>;
}

const emptySummary: UsageSummary = {
  requests: 0,
  failures: 0,
  totalTokens: 0,
  activeAccounts: 0,
  activeApiKeys: 0,
};

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (typeof error === 'string' && error.trim()) {
    return error;
  }
  return fallback;
};

export function useUsageStatsData({
  enabled,
  preset,
  fromValue,
  toValue,
}: UseUsageStatsDataOptions): UseUsageStatsDataResult {
  const [accounts, setAccounts] = useState<ClientAccount[]>([]);
  const [rows, setRows] = useState<UsageAccountRow[]>([]);
  const [providerCards, setProviderCards] = useState<UsageProviderCard[]>([]);
  const [summary, setSummary] = useState<UsageSummary>(emptySummary);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [recentUsageError, setRecentUsageError] = useState('');
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const requestIdRef = useRef(0);

  const load = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      const isStaleRequest = () => requestIdRef.current !== requestId;

      if (!enabled) {
        setAccounts([]);
        setRows([]);
        setProviderCards([]);
        setSummary(emptySummary);
        setError('');
        setRecentUsageError('');
        setLastUpdatedAt(null);
        setIsLoading(false);
        setIsRefreshing(false);
        return;
      }

      if (mode === 'refresh') {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      setError('');
      setRecentUsageError('');

      try {
        const query = buildUsageQuery(preset, fromValue, toValue);
        const [accountList, usageList, recentUsageResult] = await Promise.all([
          accountsApi.list(),
          accountsApi.usage(query),
          apiKeyUsageApi
            .getUsage()
            .then((payload) => ({ payload, error: '' }))
            .catch((recentUsageError) => ({
              payload: null as ApiKeyUsageResponse | null,
              error: getErrorMessage(recentUsageError, 'Failed to load recent usage'),
            })),
        ]);

        if (isStaleRequest()) {
          return;
        }

        const usageRows = normalizeUsageRows(Array.isArray(usageList) ? usageList : [], accountList);
        setAccounts(accountList);
        setRows(usageRows);
        setSummary(buildUsageSummary(usageRows));
        setProviderCards(
          recentUsageResult.payload ? normalizeProviderCards(recentUsageResult.payload) : []
        );
        setRecentUsageError(recentUsageResult.error);
        setLastUpdatedAt(Date.now());
      } catch (loadError) {
        if (isStaleRequest()) {
          return;
        }
        setAccounts([]);
        setRows([]);
        setProviderCards([]);
        setSummary(emptySummary);
        setLastUpdatedAt(null);
        setError(getErrorMessage(loadError, 'Failed to load usage statistics'));
      } finally {
        if (!isStaleRequest()) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [enabled, fromValue, preset, toValue]
  );

  useEffect(() => {
    void load();
  }, [load]);

  return {
    accounts,
    rows,
    providerCards,
    summary,
    isLoading,
    isRefreshing,
    error,
    recentUsageError,
    lastUpdatedAt,
    refresh: async () => {
      await load('refresh');
    },
  };
}
