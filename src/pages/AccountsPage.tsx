import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { accountsApi } from '@/services/api/accounts';
import { useAuthStore, useNotificationStore } from '@/stores';
import type {
  AccountUsageQuery,
  AccountUsageSnapshot,
  ClientAPIKey,
  ClientAccount,
} from '@/types/account';
import styles from './AccountsPage.module.scss';

const emptyAccount: ClientAccount = { id: '', name: '', disabled: false, apiKeys: [] };
const emptyAPIKey: ClientAPIKey = { id: '', name: '', key: '', disabled: false };

const normalizeAccountDraft = (account: ClientAccount): ClientAccount => ({
  ...account,
  id: account.id ?? '',
  name: account.name ?? '',
  disabled: Boolean(account.disabled),
  apiKeys: account.apiKeys ?? [],
});

const normalizeKeyDraft = (apiKey?: ClientAPIKey): ClientAPIKey => ({
  ...emptyAPIKey,
  ...(apiKey ?? {}),
  id: apiKey?.id ?? '',
  name: apiKey?.name ?? '',
  key: apiKey?.key ?? '',
  disabled: Boolean(apiKey?.disabled),
});

const usageValue = (snapshot: AccountUsageSnapshot, snakeKey: string, camelKey: string) =>
  String(
    (snapshot as Record<string, unknown>)[snakeKey] ??
      (snapshot as Record<string, unknown>)[camelKey] ??
      ''
  );

const tokenTotal = (snapshot: AccountUsageSnapshot) =>
  snapshot.tokens?.total_tokens ?? snapshot.tokens?.totalTokens ?? 0;

const formatTime = (value: string, locale: string) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(locale);
};

const randomToken = (byteCount: number) => {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error('Secure random generator is unavailable');
  }
  const bytes = new Uint8Array(byteCount);
  globalThis.crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
};

const generatedAPIKeyDraft = (): ClientAPIKey => {
  const token = randomToken(32);
  return {
    id: `key-${token.slice(0, 8).toLowerCase()}`,
    name: '',
    key: `sk-proxy-${token}`,
    disabled: false,
  };
};

const maskSecret = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return '••••••••';
  return `${'•'.repeat(24)}${trimmed.slice(-6)}`;
};

const compactIdentifier = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.length <= 18) return trimmed;
  return `${trimmed.slice(0, 8)}…${trimmed.slice(-6)}`;
};

type UsageTimePreset = 'all' | '24h' | '7d' | '30d' | 'custom';

const toIsoStringOrEmpty = (value: string) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString();
};

const buildUsageQuery = (
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

const keyDraftStateKey = (accountId: string, apiKeyId: string) => `${accountId}:${apiKeyId}`;

export function AccountsPage() {
  const { t, i18n } = useTranslation();
  const { showNotification, showConfirmation } = useNotificationStore();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const [accounts, setAccounts] = useState<ClientAccount[]>([]);
  const [usage, setUsage] = useState<AccountUsageSnapshot[]>([]);
  const [accountDrafts, setAccountDrafts] = useState<Record<string, ClientAccount>>({});
  const [editingAccounts, setEditingAccounts] = useState<Record<string, boolean>>({});
  const [expandedAccounts, setExpandedAccounts] = useState<Record<string, boolean>>({});
  const [newAccount, setNewAccount] = useState<ClientAccount>(emptyAccount);
  const [newKeyDrafts, setNewKeyDrafts] = useState<Record<string, ClientAPIKey>>({});
  const [keyIdDrafts, setKeyIdDrafts] = useState<Record<string, string>>({});
  const [usageTimePreset, setUsageTimePreset] = useState<UsageTimePreset>('all');
  const [usageFrom, setUsageFrom] = useState('');
  const [usageTo, setUsageTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const disabled = connectionStatus !== 'connected' || saving;

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [accountList, usageList] = await Promise.all([
        accountsApi.list(),
        accountsApi.usage(buildUsageQuery(usageTimePreset, usageFrom, usageTo)),
      ]);
      setAccounts(accountList);
      setUsage(Array.isArray(usageList) ? usageList : []);
      setAccountDrafts(
        Object.fromEntries(
          accountList.map((account) => [account.id, normalizeAccountDraft(account)])
        )
      );
      setNewKeyDrafts((prev) =>
        Object.fromEntries(
          accountList.map((account) => [account.id, prev[account.id] ?? normalizeKeyDraft()])
        )
      );
      setExpandedAccounts((prev) =>
        Object.fromEntries(accountList.map((account) => [account.id, prev[account.id] ?? false]))
      );
      setKeyIdDrafts({});
    } catch (err) {
      const message = err instanceof Error ? err.message : t('notification.refresh_failed');
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [t, usageFrom, usageTimePreset, usageTo]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const toggleAccountExpanded = (accountId: string) => {
    setExpandedAccounts((prev) => ({ ...prev, [accountId]: !prev[accountId] }));
  };

  const setAccountEditing = (account: ClientAccount, editing: boolean) => {
    setEditingAccounts((prev) => ({ ...prev, [account.id]: editing }));
    setAccountDrafts((prev) => ({ ...prev, [account.id]: normalizeAccountDraft(account) }));
    if (editing) setExpandedAccounts((prev) => ({ ...prev, [account.id]: true }));
  };

  const updateAccountDraft = (accountId: string, patch: Partial<ClientAccount>) => {
    setAccountDrafts((prev) => ({
      ...prev,
      [accountId]: { ...normalizeAccountDraft(prev[accountId] ?? { id: accountId }), ...patch },
    }));
  };

  const updateKeyIdDraft = (accountId: string, apiKeyId: string, value: string) => {
    setKeyIdDrafts((prev) => ({ ...prev, [keyDraftStateKey(accountId, apiKeyId)]: value }));
  };

  const saveAccount = async (account: ClientAccount) => {
    if (!account.id.trim()) {
      showNotification('Account ID is required', 'error');
      return false;
    }
    setSaving(true);
    try {
      await accountsApi.upsert(account);
      await loadData();
      showNotification('Account saved', 'success');
      return true;
    } catch (err) {
      showNotification(err instanceof Error ? err.message : 'Save failed', 'error');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const addAccount = async () => {
    const saved = await saveAccount({ ...newAccount, apiKeys: [] });
    if (saved) setNewAccount(emptyAccount);
  };

  const deleteAccount = (accountId: string) => {
    showConfirmation({
      title: 'Delete account',
      message: `Delete account "${accountId}" and all of its API keys?`,
      confirmText: t('common.delete', { defaultValue: 'Delete' }),
      cancelText: t('common.cancel', { defaultValue: 'Cancel' }),
      variant: 'danger',
      onConfirm: async () => {
        setSaving(true);
        try {
          await accountsApi.delete(accountId);
          await loadData();
          showNotification('Account deleted', 'success');
        } catch (err) {
          showNotification(err instanceof Error ? err.message : 'Delete failed', 'error');
        } finally {
          setSaving(false);
        }
      },
    });
  };

  const copyAPIKey = async (apiKey: string) => {
    const value = apiKey.trim();
    if (!value) {
      showNotification('API key is empty', 'error');
      return;
    }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = value;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        const copied = document.execCommand('copy');
        textarea.remove();
        if (!copied) throw new Error('Copy failed');
      }
      showNotification('API key copied', 'success');
    } catch (err) {
      showNotification(err instanceof Error ? err.message : 'Copy failed', 'error');
    }
  };

  const generateNewAPIKey = (accountId: string) => {
    try {
      setExpandedAccounts((prev) => ({ ...prev, [accountId]: true }));
      setNewKeyDrafts((prev) => ({ ...prev, [accountId]: generatedAPIKeyDraft() }));
      showNotification('API key generated. Copy it before sharing with the client.', 'success');
    } catch (err) {
      showNotification(err instanceof Error ? err.message : 'Generate failed', 'error');
    }
  };

  const discardNewAPIKey = (accountId: string) => {
    setNewKeyDrafts((prev) => ({ ...prev, [accountId]: normalizeKeyDraft() }));
  };

  const saveAPIKey = async (accountId: string, apiKey: ClientAPIKey, originalId?: string) => {
    const normalized = normalizeKeyDraft(apiKey);
    const nextId = normalized.id.trim();
    const previousId = originalId?.trim();
    if (!nextId || !normalized.key.trim()) {
      showNotification('API key ID and value are required', 'error');
      return false;
    }
    const account = accounts.find((item) => item.id === accountId);
    const duplicate = account?.apiKeys?.some(
      (item) => item.id.trim() === nextId && item.id.trim() !== previousId
    );
    if (duplicate) {
      showNotification('API key ID already exists in this account', 'error');
      return false;
    }
    setSaving(true);
    try {
      await accountsApi.upsertAPIKey(accountId, {
        ...normalized,
        id: nextId,
        key: normalized.key.trim(),
      });
      if (previousId && previousId !== nextId) {
        await accountsApi.deleteAPIKey(accountId, previousId);
      }
      await loadData();
      setNewKeyDrafts((prev) => ({ ...prev, [accountId]: normalizeKeyDraft() }));
      showNotification('API key saved', 'success');
      return true;
    } catch (err) {
      showNotification(err instanceof Error ? err.message : 'Save failed', 'error');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const toggleAPIKeyDisabled = async (accountId: string, apiKey: ClientAPIKey) => {
    const keyDraft = normalizeKeyDraft(apiKey);
    await saveAPIKey(accountId, { ...keyDraft, disabled: !apiKey.disabled }, keyDraft.id);
  };

  const deleteAPIKey = (accountId: string, apiKeyId: string) => {
    showConfirmation({
      title: 'Delete API key',
      message: `Delete API key "${apiKeyId}" from account "${accountId}"?`,
      confirmText: t('common.delete', { defaultValue: 'Delete' }),
      cancelText: t('common.cancel', { defaultValue: 'Cancel' }),
      variant: 'danger',
      onConfirm: async () => {
        setSaving(true);
        try {
          await accountsApi.deleteAPIKey(accountId, apiKeyId);
          await loadData();
          showNotification('API key deleted', 'success');
        } catch (err) {
          showNotification(err instanceof Error ? err.message : 'Delete failed', 'error');
        } finally {
          setSaving(false);
        }
      },
    });
  };

  return (
    <div className={styles.container}>
      <div className={styles.toolbar}>
        <div>
          <h1 className={styles.pageTitle}>Accounts</h1>
          <p className={styles.pageDescription}>
            Manage client accounts, account-scoped API keys, and per-key usage.
          </p>
        </div>
        <Button variant="secondary" onClick={loadData} loading={loading} disabled={disabled}>
          {t('common.refresh', { defaultValue: 'Refresh' })}
        </Button>
      </div>

      <div className={styles.content}>
        {error ? <div className={styles.errorBox}>{error}</div> : null}

        <Card title="Add account">
          <div className={styles.addAccountRow}>
            <Input
              label="Account ID"
              value={newAccount.id}
              disabled={disabled}
              onChange={(event) => setNewAccount((prev) => ({ ...prev, id: event.target.value }))}
            />
            <Input
              label="Account name"
              value={newAccount.name ?? ''}
              disabled={disabled}
              onChange={(event) => setNewAccount((prev) => ({ ...prev, name: event.target.value }))}
            />
            <Button onClick={addAccount} disabled={disabled || !newAccount.id.trim()}>
              Add account
            </Button>
          </div>
        </Card>

        <Card title="Accounts">
          {loading ? (
            <div className={styles.emptyText}>Loading accounts...</div>
          ) : accounts.length === 0 ? (
            <div className={styles.emptyText}>No accounts configured.</div>
          ) : (
            <div className={styles.accountList}>
              {accounts.map((account) => {
                const draft = normalizeAccountDraft(accountDrafts[account.id] ?? account);
                const newKeyDraft = normalizeKeyDraft(newKeyDrafts[account.id]);
                const isEditing = Boolean(editingAccounts[account.id]);
                const isExpanded = Boolean(expandedAccounts[account.id]);
                const apiKeys = draft.apiKeys ?? [];
                return (
                  <div key={account.id} className={styles.accountCard}>
                    <div className={styles.accountHeader}>
                      <div className={styles.accountTitle}>
                        <div className={styles.accountNameRow}>
                          <span className={styles.accountName}>{account.name || account.id}</span>
                          {account.disabled ? (
                            <span className={`${styles.badge} ${styles.disabledBadge}`}>
                              Disabled
                            </span>
                          ) : null}
                        </div>
                        <div className={styles.accountMeta}>ID: {account.id}</div>
                        <div className={styles.accountMeta}>
                          {apiKeys.length} API key{apiKeys.length === 1 ? '' : 's'}
                        </div>
                      </div>
                      <div className={styles.inlineActions}>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => toggleAccountExpanded(account.id)}
                          disabled={saving}
                        >
                          {isExpanded ? 'Collapse' : 'Expand'}
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setAccountEditing(account, !isEditing)}
                          disabled={saving}
                        >
                          {isEditing ? 'Cancel' : 'Edit'}
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => deleteAccount(account.id)}
                          disabled={disabled}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>

                    {isExpanded ? (
                      <>
                        {isEditing ? (
                          <div className={styles.accountEditPanel}>
                            <div className={styles.formGrid}>
                              <Input
                                label="Account name"
                                value={draft.name ?? ''}
                                disabled={disabled}
                                onChange={(event) =>
                                  updateAccountDraft(account.id, { name: event.target.value })
                                }
                              />
                              <label className={styles.checkboxRow}>
                                <input
                                  type="checkbox"
                                  checked={Boolean(draft.disabled)}
                                  disabled={disabled}
                                  onChange={(event) =>
                                    updateAccountDraft(account.id, {
                                      disabled: event.target.checked,
                                    })
                                  }
                                />
                                Disabled
                              </label>
                            </div>
                            <div className={styles.inlineActions}>
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => setAccountEditing(account, false)}
                                disabled={saving}
                              >
                                Cancel
                              </Button>
                              <Button
                                size="sm"
                                onClick={async () => {
                                  if (await saveAccount(draft)) {
                                    setEditingAccounts((prev) => ({
                                      ...prev,
                                      [account.id]: false,
                                    }));
                                  }
                                }}
                                disabled={disabled}
                              >
                                Save changes
                              </Button>
                            </div>
                          </div>
                        ) : null}

                        <div className={styles.keysHeader}>
                          <div>
                            <div className={styles.sectionTitle}>API keys</div>
                            <div className={styles.accountMeta}>
                              Saved keys are hidden; Copy uses the plaintext value.
                            </div>
                          </div>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => generateNewAPIKey(account.id)}
                            disabled={saving}
                          >
                            Generate new key
                          </Button>
                        </div>

                        {newKeyDraft.key ? (
                          <div className={styles.generatedKeyPanel}>
                            <div className={styles.generatedKeyDetails}>
                              <div className={styles.generatedLabel}>New key generated</div>
                              <Input
                                label="Key ID"
                                value={newKeyDraft.id}
                                disabled={saving}
                                onChange={(event) =>
                                  setNewKeyDrafts((prev) => ({
                                    ...prev,
                                    [account.id]: { ...newKeyDraft, id: event.target.value },
                                  }))
                                }
                              />
                              <div className={styles.generatedKey}>{newKeyDraft.key}</div>
                            </div>
                            <div className={styles.inlineActions}>
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => copyAPIKey(newKeyDraft.key)}
                              >
                                Copy
                              </Button>
                              <Button
                                size="sm"
                                onClick={() => saveAPIKey(account.id, newKeyDraft)}
                                disabled={disabled}
                              >
                                Add key
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => discardNewAPIKey(account.id)}
                                disabled={saving}
                              >
                                Discard
                              </Button>
                            </div>
                          </div>
                        ) : null}

                        <div className={styles.keyList}>
                          {apiKeys.length === 0 ? (
                            <div className={styles.emptyText}>
                              No API keys issued for this account.
                            </div>
                          ) : (
                            apiKeys.map((apiKey) => {
                              const keyDraft = normalizeKeyDraft(apiKey);
                              const keyIdDraftKey = keyDraftStateKey(account.id, apiKey.id);
                              const keyIdDraft = keyIdDrafts[keyIdDraftKey] ?? keyDraft.id;
                              const keyIdChanged = keyIdDraft.trim() !== keyDraft.id;
                              return (
                                <div key={apiKey.id} className={styles.keyItem}>
                                  <div className={styles.keyIdentity}>
                                    <div className={styles.keyName}>
                                      {keyDraft.name || keyDraft.id}
                                    </div>
                                    <Input
                                      label="Key ID"
                                      value={keyIdDraft}
                                      disabled={saving}
                                      onChange={(event) =>
                                        updateKeyIdDraft(account.id, apiKey.id, event.target.value)
                                      }
                                    />
                                  </div>
                                  <div className={styles.maskedKey}>{maskSecret(keyDraft.key)}</div>
                                  {keyDraft.disabled ? (
                                    <span className={`${styles.badge} ${styles.disabledBadge}`}>
                                      Disabled
                                    </span>
                                  ) : (
                                    <span className={`${styles.badge} ${styles.enabledBadge}`}>
                                      Active
                                    </span>
                                  )}
                                  <div className={styles.inlineActions}>
                                    <Button
                                      variant="secondary"
                                      size="sm"
                                      onClick={() => copyAPIKey(keyDraft.key)}
                                      disabled={!keyDraft.key.trim()}
                                    >
                                      Copy
                                    </Button>
                                    <Button
                                      variant="secondary"
                                      size="sm"
                                      onClick={() =>
                                        saveAPIKey(
                                          account.id,
                                          { ...keyDraft, id: keyIdDraft },
                                          keyDraft.id
                                        )
                                      }
                                      disabled={disabled || !keyIdChanged || !keyIdDraft.trim()}
                                    >
                                      Save ID
                                    </Button>
                                    <Button
                                      variant="secondary"
                                      size="sm"
                                      onClick={() => toggleAPIKeyDisabled(account.id, keyDraft)}
                                      disabled={disabled}
                                    >
                                      {keyDraft.disabled ? 'Enable' : 'Disable'}
                                    </Button>
                                    <Button
                                      variant="danger"
                                      size="sm"
                                      onClick={() => deleteAPIKey(account.id, apiKey.id)}
                                      disabled={disabled}
                                    >
                                      Delete
                                    </Button>
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card title="Account usage">
          <div className={styles.usageFilters}>
            <label className={styles.filterField}>
              <span>Time range</span>
              <select
                value={usageTimePreset}
                onChange={(event) => setUsageTimePreset(event.target.value as UsageTimePreset)}
              >
                <option value="all">All time</option>
                <option value="24h">Last 24 hours</option>
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
                <option value="custom">Custom</option>
              </select>
            </label>
            {usageTimePreset === 'custom' ? (
              <>
                <label className={styles.filterField}>
                  <span>From</span>
                  <input
                    type="datetime-local"
                    value={usageFrom}
                    onChange={(event) => setUsageFrom(event.target.value)}
                  />
                </label>
                <label className={styles.filterField}>
                  <span>To</span>
                  <input
                    type="datetime-local"
                    value={usageTo}
                    onChange={(event) => setUsageTo(event.target.value)}
                  />
                </label>
              </>
            ) : null}
            <div className={styles.filterSummary}>
              Showing {usage.length} backend total rows for the selected time range.
            </div>
          </div>
          {usage.length === 0 ? (
            <div className={styles.emptyText}>
              {usageTimePreset === 'all'
                ? 'No account usage has been recorded yet.'
                : 'No usage matches the selected time range.'}
            </div>
          ) : (
            <div className={styles.usageTableWrap}>
              <table className={styles.usageTable}>
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>API key</th>
                    <th>Requests</th>
                    <th>Failures</th>
                    <th>Total tokens</th>
                    <th>Last used</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.map((item, index) => {
                    const accountId = usageValue(item, 'account_id', 'accountId');
                    const accountName = usageValue(item, 'account_name', 'accountName');
                    const apiKeyId = usageValue(item, 'api_key_id', 'apiKeyId');
                    const apiKeyName = usageValue(item, 'api_key_name', 'apiKeyName');
                    const lastUsedAt = usageValue(item, 'last_used_at', 'lastUsedAt');
                    const compactKeyId = compactIdentifier(apiKeyId);
                    return (
                      <tr key={`${accountId}:${apiKeyId}:${index}`}>
                        <td>{accountName ? `${accountName} (${accountId})` : accountId}</td>
                        <td>
                          {apiKeyName ? `${apiKeyName} (${compactKeyId})` : compactKeyId || '-'}
                        </td>
                        <td>{item.requests ?? 0}</td>
                        <td>{item.failures ?? 0}</td>
                        <td>{tokenTotal(item)}</td>
                        <td>{formatTime(lastUsedAt, i18n.language)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
