import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { accountsApi } from '@/services/api/accounts';
import { useAuthStore, useNotificationStore } from '@/stores';
import type { AccountUsageSnapshot, ClientAPIKey, ClientAccount } from '@/types/account';
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

const generatedAPIKeyDraft = (current?: ClientAPIKey): ClientAPIKey => {
  const token = randomToken(32);
  const currentDraft = normalizeKeyDraft(current);
  return {
    ...currentDraft,
    id: currentDraft.id.trim() || `key-${token.slice(0, 8).toLowerCase()}`,
    key: `sk-proxy-${token}`,
  };
};

export function AccountsPage() {
  const { t, i18n } = useTranslation();
  const { showNotification, showConfirmation } = useNotificationStore();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const [accounts, setAccounts] = useState<ClientAccount[]>([]);
  const [usage, setUsage] = useState<AccountUsageSnapshot[]>([]);
  const [accountDrafts, setAccountDrafts] = useState<Record<string, ClientAccount>>({});
  const [newAccount, setNewAccount] = useState<ClientAccount>(emptyAccount);
  const [newKeyDrafts, setNewKeyDrafts] = useState<Record<string, ClientAPIKey>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const disabled = connectionStatus !== 'connected' || saving;

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [accountList, usageList] = await Promise.all([accountsApi.list(), accountsApi.usage()]);
      setAccounts(accountList);
      setUsage(Array.isArray(usageList) ? usageList : []);
      setAccountDrafts(
        Object.fromEntries(
          accountList.map((account) => [account.id, normalizeAccountDraft(account)])
        )
      );
      setNewKeyDrafts(
        Object.fromEntries(accountList.map((account) => [account.id, normalizeKeyDraft()]))
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : t('notification.refresh_failed');
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const updateAccountDraft = (accountId: string, patch: Partial<ClientAccount>) => {
    setAccountDrafts((prev) => ({
      ...prev,
      [accountId]: { ...normalizeAccountDraft(prev[accountId] ?? { id: accountId }), ...patch },
    }));
  };

  const updateKeyDraft = (accountId: string, keyId: string, patch: Partial<ClientAPIKey>) => {
    setAccountDrafts((prev) => {
      const account = normalizeAccountDraft(prev[accountId] ?? { id: accountId });
      const apiKeys = (account.apiKeys ?? []).map((apiKey) =>
        apiKey.id === keyId ? { ...normalizeKeyDraft(apiKey), ...patch } : apiKey
      );
      return { ...prev, [accountId]: { ...account, apiKeys } };
    });
  };

  const saveAccount = async (account: ClientAccount) => {
    if (!account.id.trim()) {
      showNotification('Account ID is required', 'error');
      return;
    }
    setSaving(true);
    try {
      await accountsApi.upsert(account);
      await loadData();
      showNotification('Account saved', 'success');
    } catch (err) {
      showNotification(err instanceof Error ? err.message : 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const addAccount = async () => {
    await saveAccount({ ...newAccount, apiKeys: [] });
    setNewAccount(emptyAccount);
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
      setNewKeyDrafts((prev) => ({
        ...prev,
        [accountId]: generatedAPIKeyDraft(prev[accountId]),
      }));
      showNotification('API key generated. Copy it before sharing with the client.', 'success');
    } catch (err) {
      showNotification(err instanceof Error ? err.message : 'Generate failed', 'error');
    }
  };

  const saveAPIKey = async (accountId: string, apiKey: ClientAPIKey) => {
    if (!apiKey.id.trim() || !apiKey.key.trim()) {
      showNotification('API key ID and key are required', 'error');
      return;
    }
    setSaving(true);
    try {
      await accountsApi.upsertAPIKey(accountId, apiKey);
      await loadData();
      setNewKeyDrafts((prev) => ({ ...prev, [accountId]: normalizeKeyDraft() }));
      showNotification('API key saved', 'success');
    } catch (err) {
      showNotification(err instanceof Error ? err.message : 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
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
          <div className={styles.formGrid}>
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
          </div>
          <label className={styles.checkboxRow}>
            <input
              type="checkbox"
              checked={Boolean(newAccount.disabled)}
              disabled={disabled}
              onChange={(event) =>
                setNewAccount((prev) => ({ ...prev, disabled: event.target.checked }))
              }
            />
            Disabled
          </label>
          <div className={styles.inlineActions}>
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
                return (
                  <div key={account.id} className={styles.accountCard}>
                    <div className={styles.accountHeader}>
                      <div className={styles.accountTitle}>
                        <div className={styles.accountName}>{account.name || account.id}</div>
                        <div className={styles.accountMeta}>ID: {account.id}</div>
                        {account.disabled ? (
                          <span className={`${styles.badge} ${styles.disabledBadge}`}>
                            Disabled
                          </span>
                        ) : null}
                      </div>
                      <div className={styles.inlineActions}>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => saveAccount(draft)}
                          disabled={disabled}
                        >
                          Save account
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
                            updateAccountDraft(account.id, { disabled: event.target.checked })
                          }
                        />
                        Disabled
                      </label>
                    </div>

                    <div className={styles.keyList}>
                      {(draft.apiKeys ?? []).map((apiKey) => {
                        const keyDraft = normalizeKeyDraft(apiKey);
                        return (
                          <div key={apiKey.id} className={styles.keyRow}>
                            <Input label="Key ID" value={keyDraft.id} disabled />
                            <Input
                              label="Name"
                              value={keyDraft.name ?? ''}
                              disabled={disabled}
                              onChange={(event) =>
                                updateKeyDraft(account.id, apiKey.id, { name: event.target.value })
                              }
                            />
                            <Input
                              label="API key"
                              value={keyDraft.key}
                              disabled={disabled}
                              onChange={(event) =>
                                updateKeyDraft(account.id, apiKey.id, { key: event.target.value })
                              }
                            />
                            <div className={styles.inlineActions}>
                              <label className={styles.checkboxRow}>
                                <input
                                  type="checkbox"
                                  checked={Boolean(keyDraft.disabled)}
                                  disabled={disabled}
                                  onChange={(event) =>
                                    updateKeyDraft(account.id, apiKey.id, {
                                      disabled: event.target.checked,
                                    })
                                  }
                                />
                                Disabled
                              </label>
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
                                onClick={() => saveAPIKey(account.id, keyDraft)}
                                disabled={disabled}
                              >
                                Save
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
                      })}
                      <div className={styles.keyRow}>
                        <Input
                          label="New key ID"
                          value={newKeyDraft.id}
                          disabled={disabled}
                          onChange={(event) =>
                            setNewKeyDrafts((prev) => ({
                              ...prev,
                              [account.id]: { ...newKeyDraft, id: event.target.value },
                            }))
                          }
                        />
                        <Input
                          label="Name"
                          value={newKeyDraft.name ?? ''}
                          disabled={disabled}
                          onChange={(event) =>
                            setNewKeyDrafts((prev) => ({
                              ...prev,
                              [account.id]: { ...newKeyDraft, name: event.target.value },
                            }))
                          }
                        />
                        <Input
                          label="API key"
                          value={newKeyDraft.key}
                          disabled={disabled}
                          onChange={(event) =>
                            setNewKeyDrafts((prev) => ({
                              ...prev,
                              [account.id]: { ...newKeyDraft, key: event.target.value },
                            }))
                          }
                        />
                        <div className={styles.inlineActions}>
                          <label className={styles.checkboxRow}>
                            <input
                              type="checkbox"
                              checked={Boolean(newKeyDraft.disabled)}
                              disabled={disabled}
                              onChange={(event) =>
                                setNewKeyDrafts((prev) => ({
                                  ...prev,
                                  [account.id]: { ...newKeyDraft, disabled: event.target.checked },
                                }))
                              }
                            />
                            Disabled
                          </label>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => generateNewAPIKey(account.id)}
                            disabled={saving}
                          >
                            Generate key
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => copyAPIKey(newKeyDraft.key)}
                            disabled={!newKeyDraft.key.trim()}
                          >
                            Copy
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => saveAPIKey(account.id, newKeyDraft)}
                            disabled={disabled || !newKeyDraft.id.trim() || !newKeyDraft.key.trim()}
                          >
                            Add key
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card title="Account usage">
          {usage.length === 0 ? (
            <div className={styles.emptyText}>No account usage has been recorded yet.</div>
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
                    return (
                      <tr key={`${accountId}:${apiKeyId}:${index}`}>
                        <td>{accountName ? `${accountName} (${accountId})` : accountId}</td>
                        <td>{apiKeyName ? `${apiKeyName} (${apiKeyId})` : apiKeyId || '-'}</td>
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
