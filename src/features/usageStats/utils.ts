import type { AccountUsageQuery, AccountUsageSnapshot, ClientAccount } from '@/types/account';
import {
  mergeRecentRequestBucketGroups,
  normalizeRecentRequestUsageEntry,
  normalizeUsageTotal,
  statusBarDataFromRecentRequests,
  type ApiKeyUsageResponse,
  type RecentRequestBucket,
  type StatusBarData,
} from '@/utils/recentRequests';

export type UsageTimePreset = 'all' | '24h' | '7d' | '30d' | 'custom';

export interface UsageSummary {
  requests: number;
  failures: number;
  totalTokens: number;
  activeAccounts: number;
  activeApiKeys: number;
}

export interface UsageAccountRow {
  accountId: string;
  accountName: string;
  accountDisabled: boolean;
  apiKeyId: string;
  apiKeyName: string;
  apiKeyDisabled: boolean;
  requests: number;
  failures: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  lastUsedAt: string;
}

export interface UsageProviderCard {
  provider: string;
  apiKeyCount: number;
  totalSuccess: number;
  totalFailure: number;
  statusBarData: StatusBarData;
  recentBuckets: RecentRequestBucket[];
}

const emptyAccount = (): ClientAccount => ({
  id: '',
  name: '',
  disabled: false,
  apiKeys: [],
});

const normalizeAccount = (account?: ClientAccount): ClientAccount => ({
  ...emptyAccount(),
  ...(account ?? {}),
  id: account?.id ?? '',
  name: account?.name ?? '',
  disabled: Boolean(account?.disabled),
  apiKeys: account?.apiKeys ?? [],
});

const normalizeProviderLabel = (provider: string) => {
  const trimmed = provider.trim();
  if (!trimmed) return 'Unknown';
  return trimmed;
};

const readStringValue = (
  snapshot: AccountUsageSnapshot,
  snakeKey: keyof AccountUsageSnapshot,
  camelKey: keyof AccountUsageSnapshot
) => String(snapshot[snakeKey] ?? snapshot[camelKey] ?? '').trim();

const readTokenValue = (
  snapshot: AccountUsageSnapshot,
  snakeKey: keyof NonNullable<AccountUsageSnapshot['tokens']>,
  camelKey: keyof NonNullable<AccountUsageSnapshot['tokens']>
) => normalizeUsageTotal(snapshot.tokens?.[snakeKey] ?? snapshot.tokens?.[camelKey]);

export const tokenTotal = (snapshot: AccountUsageSnapshot) =>
  readTokenValue(snapshot, 'total_tokens', 'totalTokens');

export const formatUsageTime = (value: string, locale: string) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(locale);
};

const toIsoStringOrEmpty = (value: string) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString();
};

export const buildUsageQuery = (
  preset: UsageTimePreset,
  fromValue: string,
  toValue: string
): AccountUsageQuery | undefined => {
  const now = Date.now();
  if (preset === 'all') return undefined;
  if (preset === '24h') {
    return {
      from: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
      to: new Date(now).toISOString(),
    };
  }
  if (preset === '7d') {
    return {
      from: new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString(),
      to: new Date(now).toISOString(),
    };
  }
  if (preset === '30d') {
    return {
      from: new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString(),
      to: new Date(now).toISOString(),
    };
  }

  const from = toIsoStringOrEmpty(fromValue);
  const to = toIsoStringOrEmpty(toValue);
  if (!from && !to) return undefined;
  return { ...(from ? { from } : {}), ...(to ? { to } : {}) };
};

export const normalizeUsageRows = (
  usage: AccountUsageSnapshot[],
  accounts: ClientAccount[]
): UsageAccountRow[] => {
  const accountMap = new Map(accounts.map((account) => [account.id, normalizeAccount(account)]));

  return usage
    .map((snapshot) => {
      const accountId = readStringValue(snapshot, 'account_id', 'accountId');
      const accountFromMap = accountMap.get(accountId);
      const apiKeyId = readStringValue(snapshot, 'api_key_id', 'apiKeyId');
      const apiKeyFromMap = accountFromMap?.apiKeys?.find((item) => item.id === apiKeyId);
      const accountName =
        readStringValue(snapshot, 'account_name', 'accountName') || accountFromMap?.name || accountId;
      const apiKeyName =
        readStringValue(snapshot, 'api_key_name', 'apiKeyName') || apiKeyFromMap?.name || apiKeyId;

      return {
        accountId,
        accountName,
        accountDisabled: Boolean(accountFromMap?.disabled),
        apiKeyId,
        apiKeyName,
        apiKeyDisabled: Boolean(apiKeyFromMap?.disabled),
        requests: normalizeUsageTotal(snapshot.requests),
        failures: normalizeUsageTotal(snapshot.failures),
        totalTokens: tokenTotal(snapshot),
        inputTokens: readTokenValue(snapshot, 'input_tokens', 'inputTokens'),
        outputTokens: readTokenValue(snapshot, 'output_tokens', 'outputTokens'),
        reasoningTokens: readTokenValue(snapshot, 'reasoning_tokens', 'reasoningTokens'),
        cachedTokens: readTokenValue(snapshot, 'cached_tokens', 'cachedTokens'),
        lastUsedAt: readStringValue(snapshot, 'last_used_at', 'lastUsedAt'),
      };
    })
    .sort((left, right) => {
      const leftTime = left.lastUsedAt ? new Date(left.lastUsedAt).getTime() : 0;
      const rightTime = right.lastUsedAt ? new Date(right.lastUsedAt).getTime() : 0;
      return rightTime - leftTime;
    });
};

export const buildUsageSummary = (rows: UsageAccountRow[]): UsageSummary => {
  const accountIds = new Set<string>();
  const apiKeyIds = new Set<string>();

  const totals = rows.reduce(
    (summary, row) => {
      if (row.accountId) accountIds.add(row.accountId);
      if (row.accountId && row.apiKeyId) apiKeyIds.add(`${row.accountId}:${row.apiKeyId}`);
      summary.requests += row.requests;
      summary.failures += row.failures;
      summary.totalTokens += row.totalTokens;
      return summary;
    },
    {
      requests: 0,
      failures: 0,
      totalTokens: 0,
      activeAccounts: 0,
      activeApiKeys: 0,
    }
  );

  return {
    ...totals,
    activeAccounts: accountIds.size,
    activeApiKeys: apiKeyIds.size,
  };
};

export const normalizeProviderCards = (payload: ApiKeyUsageResponse): UsageProviderCard[] => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return [];
  }

  return Object.entries(payload)
    .map(([provider, rawEntries]) => {
      if (!rawEntries || typeof rawEntries !== 'object' || Array.isArray(rawEntries)) {
        return null;
      }

      const entries = Object.values(rawEntries).map((entry) => normalizeRecentRequestUsageEntry(entry));
      const recentBuckets = mergeRecentRequestBucketGroups(entries.map((entry) => entry.recentRequests));
      const totalSuccess = entries.reduce((sum, entry) => sum + entry.success, 0);
      const totalFailure = entries.reduce((sum, entry) => sum + entry.failed, 0);

      return {
        provider: normalizeProviderLabel(provider),
        apiKeyCount: entries.length,
        totalSuccess,
        totalFailure,
        recentBuckets,
        statusBarData: statusBarDataFromRecentRequests(recentBuckets),
      } satisfies UsageProviderCard;
    })
    .filter((card): card is UsageProviderCard => card !== null)
    .sort((left, right) => right.totalSuccess + right.totalFailure - (left.totalSuccess + left.totalFailure));
};
