import { FindingsPage, ScanDetail, ScanSummary } from './types';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    let detail = `Request failed (${response.status})`;
    try {
      const data = (await response.json()) as { detail?: string };
      if (data.detail) {
        detail = data.detail;
      }
    } catch {
      // ignore non-JSON error body
    }
    throw new Error(detail);
  }

  return (await response.json()) as T;
}

export function fetchScans(): Promise<ScanSummary[]> {
  return request<ScanSummary[]>('/api/scans');
}

export function triggerScan(accountIds?: string[]): Promise<ScanSummary> {
  const body = accountIds ? JSON.stringify({ account_ids: accountIds }) : undefined;
  return request<ScanSummary>('/api/scans', {
    method: 'POST',
    body,
  });
}

export function fetchScanDetail(scanId: string): Promise<ScanDetail> {
  return request<ScanDetail>(`/api/scans/${encodeURIComponent(scanId)}`);
}

export interface FindingsFilters {
  status?: string;
  severity?: string;
  provider?: string;
  account_id?: string;
  check_id?: string;
  page?: number;
  page_size?: number;
}

export function fetchScanFindings(scanId: string, filters: FindingsFilters): Promise<FindingsPage> {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.severity) params.set('severity', filters.severity);
  if (filters.provider) params.set('provider', filters.provider);
  if (filters.account_id) params.set('account_id', filters.account_id);
  if (filters.check_id) params.set('check_id', filters.check_id);
  params.set('page', String(filters.page ?? 1));
  params.set('page_size', String(filters.page_size ?? 25));

  return request<FindingsPage>(
    `/api/scans/${encodeURIComponent(scanId)}/findings?${params.toString()}`
  );
}
