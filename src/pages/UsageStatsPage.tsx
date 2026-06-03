import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ProviderStatusBar } from '@/components/providers/ProviderStatusBar';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { useAuthStore } from '@/stores';
import { useUsageStatsData } from '@/features/usageStats/hooks/useUsageStatsData';
import {
  formatUsageTime,
  type UsageAccountRow,
  type UsageTimePreset,
} from '@/features/usageStats/utils';
import styles from './UsageStatsPage.module.scss';

const maskSecret = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return '••••••••';
  if (trimmed.length > 8) return `${'•'.repeat(24)}${trimmed.slice(-6)}`;
  if (trimmed.length > 4) return `${'•'.repeat(12)}${trimmed.slice(-2)}`;
  return '••••••••';
};

const numberFormatter = (locale: string) =>
  new Intl.NumberFormat(locale, {
    maximumFractionDigits: 0,
  });

const buildAccountLabel = (row: UsageAccountRow) =>
  row.accountName && row.accountName !== row.accountId
    ? `${row.accountName} (${row.accountId})`
    : row.accountId || row.accountName || '-';

const buildApiKeyLabel = (row: UsageAccountRow) => {
  const maskedKeyId = maskSecret(row.apiKeyId);
  if (row.apiKeyName && row.apiKeyName !== row.apiKeyId) {
    return `${row.apiKeyName} (${maskedKeyId})`;
  }
  return maskedKeyId;
};

export function UsageStatsPage() {
  const { t, i18n } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const [preset, setPreset] = useState<UsageTimePreset>('24h');
  const [fromValue, setFromValue] = useState('');
  const [toValue, setToValue] = useState('');
  const [accountFilter, setAccountFilter] = useState('');

  const {
    rows,
    providerCards,
    summary,
    isLoading,
    isRefreshing,
    error,
    recentUsageError,
    lastUpdatedAt,
    refresh,
  } = useUsageStatsData({
    enabled: connectionStatus === 'connected',
    preset,
    fromValue,
    toValue,
  });

  const filteredRows = useMemo(() => {
    const keyword = accountFilter.trim().toLowerCase();
    if (!keyword) return rows;
    return rows.filter((row) => {
      const haystack = [row.accountId, row.accountName, row.apiKeyName, buildApiKeyLabel(row)]
        .join(' ')
        .toLowerCase();
      return haystack.includes(keyword);
    });
  }, [accountFilter, rows]);

  const filteredSummary = useMemo(() => {
    const formatter = numberFormatter(i18n.language);
    const aggregate = filteredRows.reduce(
      (acc, row) => {
        acc.requests += row.requests;
        acc.failures += row.failures;
        acc.totalTokens += row.totalTokens;
        acc.accounts.add(row.accountId);
        acc.apiKeys.add(`${row.accountId}:${row.apiKeyId}`);
        return acc;
      },
      {
        requests: 0,
        failures: 0,
        totalTokens: 0,
        accounts: new Set<string>(),
        apiKeys: new Set<string>(),
      }
    );

    return {
      requests: formatter.format(aggregate.requests),
      failures: formatter.format(aggregate.failures),
      totalTokens: formatter.format(aggregate.totalTokens),
      activeAccounts: formatter.format(aggregate.accounts.size),
      activeApiKeys: formatter.format(aggregate.apiKeys.size),
    };
  }, [filteredRows, i18n.language]);

  const totalSummary = useMemo(() => {
    const formatter = numberFormatter(i18n.language);
    return {
      requests: formatter.format(summary.requests),
      failures: formatter.format(summary.failures),
      totalTokens: formatter.format(summary.totalTokens),
      activeAccounts: formatter.format(summary.activeAccounts),
      activeApiKeys: formatter.format(summary.activeApiKeys),
    };
  }, [i18n.language, summary]);

  const lastUpdatedLabel = lastUpdatedAt
    ? new Date(lastUpdatedAt).toLocaleString(i18n.language)
    : t('usage_stats.not_updated');

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.pageTitle}>{t('usage_stats.title')}</h1>
          <p className={styles.pageDescription}>{t('usage_stats.description')}</p>
        </div>
        <div className={styles.headerActions}>
          <div className={styles.lastUpdated}>
            {t('usage_stats.last_updated')}: {lastUpdatedLabel}
          </div>
          <Button variant="secondary" onClick={() => void refresh()} loading={isRefreshing}>
            {t('usage_stats.refresh')}
          </Button>
        </div>
      </div>

      {connectionStatus !== 'connected' ? (
        <div className={styles.warningBox}>{t('usage_stats.connection_required')}</div>
      ) : null}
      {error ? <div className={styles.errorBox}>{error}</div> : null}

      <div className={styles.summaryGrid}>
        <Card className={styles.summaryCard}>
          <div className={styles.summaryLabel}>{t('usage_stats.summary_requests')}</div>
          <div className={styles.summaryValue}>{totalSummary.requests}</div>
          <div className={styles.summarySubLabel}>{t('usage_stats.summary_requests_filtered')}</div>
          <div className={styles.summarySubValue}>{filteredSummary.requests}</div>
        </Card>
        <Card className={styles.summaryCard}>
          <div className={styles.summaryLabel}>{t('usage_stats.summary_failures')}</div>
          <div className={styles.summaryValue}>{totalSummary.failures}</div>
          <div className={styles.summarySubLabel}>{t('usage_stats.summary_failures_filtered')}</div>
          <div className={styles.summarySubValue}>{filteredSummary.failures}</div>
        </Card>
        <Card className={styles.summaryCard}>
          <div className={styles.summaryLabel}>{t('usage_stats.summary_tokens')}</div>
          <div className={styles.summaryValue}>{totalSummary.totalTokens}</div>
          <div className={styles.summarySubLabel}>{t('usage_stats.summary_tokens_filtered')}</div>
          <div className={styles.summarySubValue}>{filteredSummary.totalTokens}</div>
        </Card>
        <Card className={styles.summaryCard}>
          <div className={styles.summaryLabel}>{t('usage_stats.summary_active_accounts')}</div>
          <div className={styles.summaryValue}>{totalSummary.activeAccounts}</div>
          <div className={styles.summaryMetaRow}>
            <span>{t('usage_stats.summary_active_accounts_filtered')}</span>
            <strong>{filteredSummary.activeAccounts}</strong>
          </div>
          <div className={styles.summaryMetaRow}>
            <span>{t('usage_stats.summary_active_keys')}</span>
            <strong>{totalSummary.activeApiKeys}</strong>
          </div>
        </Card>
      </div>

      <Card title={t('usage_stats.history_title')}>
        <div className={styles.filters}>
          <label className={styles.filterField}>
            <span>{t('usage_stats.time_range')}</span>
            <select value={preset} onChange={(event) => setPreset(event.target.value as UsageTimePreset)}>
              <option value="all">{t('usage_stats.range_all')}</option>
              <option value="24h">{t('usage_stats.range_24h')}</option>
              <option value="7d">{t('usage_stats.range_7d')}</option>
              <option value="30d">{t('usage_stats.range_30d')}</option>
              <option value="custom">{t('usage_stats.range_custom')}</option>
            </select>
          </label>
          {preset === 'custom' ? (
            <>
              <label className={styles.filterField}>
                <span>{t('usage_stats.from')}</span>
                <input
                  type="datetime-local"
                  value={fromValue}
                  onChange={(event) => setFromValue(event.target.value)}
                />
              </label>
              <label className={styles.filterField}>
                <span>{t('usage_stats.to')}</span>
                <input
                  type="datetime-local"
                  value={toValue}
                  onChange={(event) => setToValue(event.target.value)}
                />
              </label>
            </>
          ) : null}
          <label className={`${styles.filterField} ${styles.searchField}`}>
            <span>{t('usage_stats.account_filter')}</span>
            <Input
              value={accountFilter}
              onChange={(event) => setAccountFilter(event.target.value)}
              placeholder={t('usage_stats.account_filter_placeholder')}
            />
          </label>
        </div>

        {isLoading ? (
          <div className={styles.emptyState}>{t('usage_stats.loading')}</div>
        ) : filteredRows.length === 0 ? (
          <div className={styles.emptyState}>
            {rows.length === 0
              ? t('usage_stats.history_empty')
              : t('usage_stats.history_empty_filtered')}
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t('usage_stats.column_account')}</th>
                  <th>{t('usage_stats.column_api_key')}</th>
                  <th>{t('usage_stats.column_requests')}</th>
                  <th>{t('usage_stats.column_failures')}</th>
                  <th>{t('usage_stats.column_total_tokens')}</th>
                  <th>{t('usage_stats.column_last_used')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => (
                  <tr key={`${row.accountId}:${row.apiKeyId}:${row.lastUsedAt}`}>
                    <td>
                      <div className={styles.primaryCell}>{buildAccountLabel(row)}</div>
                      <div className={styles.secondaryCell}>
                        {row.accountDisabled ? t('usage_stats.account_disabled') : t('usage_stats.account_active')}
                      </div>
                    </td>
                    <td>
                      <div className={styles.primaryCell}>{buildApiKeyLabel(row)}</div>
                      <div className={styles.secondaryCell}>
                        {row.apiKeyDisabled ? t('usage_stats.api_key_disabled') : t('usage_stats.api_key_active')}
                      </div>
                    </td>
                    <td>{row.requests.toLocaleString(i18n.language)}</td>
                    <td>{row.failures.toLocaleString(i18n.language)}</td>
                    <td>{row.totalTokens.toLocaleString(i18n.language)}</td>
                    <td>{formatUsageTime(row.lastUsedAt, i18n.language)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title={t('usage_stats.recent_title')}>
        {recentUsageError ? <div className={styles.warningBox}>{recentUsageError}</div> : null}
        {providerCards.length === 0 ? (
          <div className={styles.emptyState}>{t('usage_stats.recent_empty')}</div>
        ) : (
          <div className={styles.providerGrid}>
            {providerCards.map((card) => {
              const totalRequests = card.totalSuccess + card.totalFailure;
              return (
                <div key={card.provider} className={styles.providerCard}>
                  <div className={styles.providerHeader}>
                    <div>
                      <div className={styles.providerTitle}>{card.provider}</div>
                      <div className={styles.providerMeta}>
                        {t('usage_stats.provider_keys', { count: card.apiKeyCount })}
                      </div>
                    </div>
                    <div className={styles.providerStats}>
                      <span>{t('usage_stats.provider_success', { count: card.totalSuccess })}</span>
                      <span>{t('usage_stats.provider_failure', { count: card.totalFailure })}</span>
                      <span>{t('usage_stats.provider_total', { count: totalRequests })}</span>
                    </div>
                  </div>
                  <ProviderStatusBar statusData={card.statusBarData} />
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
