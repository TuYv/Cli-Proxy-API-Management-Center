import { apiClient } from './client';
import type {
  AccountUsageQuery,
  AccountUsageSnapshot,
  AccountsResponse,
  ClientAPIKey,
  ClientAccount,
} from '@/types/account';

const isClientAPIKey = (apiKey: ClientAPIKey | null): apiKey is ClientAPIKey => apiKey !== null;

const isClientAccount = (account: ClientAccount | null): account is ClientAccount =>
  account !== null;

const normalizeAPIKey = (raw: unknown): ClientAPIKey | null => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const id = String(record.id ?? '').trim();
  const key = String(record.key ?? '').trim();
  if (!id || !key) return null;
  return {
    id,
    name: typeof record.name === 'string' ? record.name : undefined,
    key,
    disabled: Boolean(record.disabled),
    metadata:
      record.metadata && typeof record.metadata === 'object' && !Array.isArray(record.metadata)
        ? (record.metadata as Record<string, string>)
        : undefined,
  };
};

const normalizeAccount = (raw: unknown): ClientAccount | null => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const id = String(record.id ?? '').trim();
  if (!id) return null;
  const apiKeysRaw = record['api-keys'] ?? record.apiKeys;
  return {
    id,
    name: typeof record.name === 'string' ? record.name : undefined,
    disabled: Boolean(record.disabled),
    apiKeys: Array.isArray(apiKeysRaw)
      ? apiKeysRaw.map((item) => normalizeAPIKey(item)).filter(isClientAPIKey)
      : [],
    metadata:
      record.metadata && typeof record.metadata === 'object' && !Array.isArray(record.metadata)
        ? (record.metadata as Record<string, string>)
        : undefined,
  };
};

const serializeAPIKey = (apiKey: ClientAPIKey) => ({
  id: apiKey.id.trim(),
  name: apiKey.name?.trim() || undefined,
  key: apiKey.key.trim(),
  disabled: Boolean(apiKey.disabled) || undefined,
  metadata: apiKey.metadata,
});

const serializeAccount = (account: ClientAccount) => ({
  id: account.id.trim(),
  name: account.name?.trim() || undefined,
  disabled: Boolean(account.disabled) || undefined,
  'api-keys': (account.apiKeys ?? []).map(serializeAPIKey),
  metadata: account.metadata,
});

export const accountsApi = {
  async list(): Promise<ClientAccount[]> {
    const data = await apiClient.get<AccountsResponse | ClientAccount[]>('/accounts');
    const accounts = Array.isArray(data) ? data : data.accounts;
    return Array.isArray(accounts)
      ? accounts.map((item) => normalizeAccount(item)).filter(isClientAccount)
      : [];
  },

  replace: (accounts: ClientAccount[]) =>
    apiClient.put(
      '/accounts',
      accounts.map((account) => serializeAccount(account))
    ),

  upsert: (account: ClientAccount) => apiClient.patch('/accounts', serializeAccount(account)),

  delete: (accountId: string) => apiClient.delete(`/accounts?id=${encodeURIComponent(accountId)}`),

  upsertAPIKey: (accountId: string, apiKey: ClientAPIKey) =>
    apiClient.patch(`/accounts/${encodeURIComponent(accountId)}/api-keys`, serializeAPIKey(apiKey)),

  deleteAPIKey: (accountId: string, apiKeyId: string) =>
    apiClient.delete(
      `/accounts/${encodeURIComponent(accountId)}/api-keys/${encodeURIComponent(apiKeyId)}`
    ),

  usage: (query?: AccountUsageQuery) =>
    apiClient.get<AccountUsageSnapshot[]>('/account-usage', {
      params: query,
      timeout: 15 * 1000,
    }),
};
