import type { LatestVersionApiPayload, LatestVersionResponse } from '@/types';

export function parseVersionSegments(version?: string | null): number[] | null {
  if (!version) return null;

  const cleaned = version.trim().replace(/^v/i, '');
  if (!cleaned) return null;

  const parts = cleaned
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map((segment) => Number.parseInt(segment, 10))
    .filter(Number.isFinite);

  return parts.length ? parts : null;
}

export function compareVersions(
  latest?: string | null,
  current?: string | null
): -1 | 0 | 1 | null {
  const latestParts = parseVersionSegments(latest);
  const currentParts = parseVersionSegments(current);
  if (!latestParts || !currentParts) return null;

  const length = Math.max(latestParts.length, currentParts.length);
  for (let i = 0; i < length; i += 1) {
    const latestValue = latestParts[i] || 0;
    const currentValue = currentParts[i] || 0;
    if (latestValue > currentValue) return 1;
    if (latestValue < currentValue) return -1;
  }

  return 0;
}

export function normalizeLatestVersionResponse(
  payload: LatestVersionApiPayload
): LatestVersionResponse {
  const latestRaw = payload['latest-version'] ?? payload.latest_version ?? payload.latest ?? '';
  const latestVersion = String(latestRaw ?? '').trim();

  return {
    latestVersion: latestVersion || null,
    raw: payload,
  };
}

export function buildReleaseUrl(version?: string | null): string {
  const normalizedVersion = String(version ?? '').trim();
  if (!normalizedVersion) {
    return 'https://github.com/router-for-me/CLIProxyAPI/releases/latest';
  }

  return `https://github.com/router-for-me/CLIProxyAPI/releases/tag/${encodeURIComponent(normalizedVersion)}`;
}
