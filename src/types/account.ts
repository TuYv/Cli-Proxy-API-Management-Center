export interface ClientAPIKey {
  id: string;
  name?: string;
  key: string;
  disabled?: boolean;
  metadata?: Record<string, string>;
}

export interface ClientAccount {
  id: string;
  name?: string;
  disabled?: boolean;
  apiKeys?: ClientAPIKey[];
  metadata?: Record<string, string>;
}

export interface AccountsResponse {
  accounts?: ClientAccount[];
}

export interface AccountUsageQuery {
  from?: string;
  to?: string;
}

export interface AccountUsageSnapshot {
  account_id?: string;
  accountId?: string;
  account_name?: string;
  accountName?: string;
  api_key_id?: string;
  apiKeyId?: string;
  api_key_name?: string;
  apiKeyName?: string;
  requests?: number;
  failures?: number;
  tokens?: {
    input_tokens?: number;
    inputTokens?: number;
    output_tokens?: number;
    outputTokens?: number;
    reasoning_tokens?: number;
    reasoningTokens?: number;
    cached_tokens?: number;
    cachedTokens?: number;
    cache_read_tokens?: number;
    cacheReadTokens?: number;
    cache_creation_tokens?: number;
    cacheCreationTokens?: number;
    total_tokens?: number;
    totalTokens?: number;
  };
  last_used_at?: string;
  lastUsedAt?: string;
}
