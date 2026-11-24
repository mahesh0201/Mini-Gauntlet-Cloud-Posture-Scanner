export type StatusType = 'PASS' | 'FAIL' | 'CANNOT_SCAN';
export type SeverityType = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type ScanStatusType = 'RUNNING' | 'COMPLETED' | 'FAILED';

export interface StatusCounts {
  PASS: number;
  FAIL: number;
  CANNOT_SCAN: number;
}

export interface SeverityCounts {
  CRITICAL: number;
  HIGH: number;
  MEDIUM: number;
  LOW: number;
}

export interface AccountScore {
  account_id: string;
  account_name: string;
  provider: string;
  score: number | null;
  counts_by_status: StatusCounts;
}

export interface ScanSummary {
  id: string;
  status: ScanStatusType;
  started_at: string;
  finished_at: string | null;
  account_ids: string[];
  score: number | null;
  counts_by_status: StatusCounts;
  error_message?: string | null;
}

export interface ScanDetail extends ScanSummary {
  fail_counts_by_severity: SeverityCounts;
  accounts: AccountScore[];
}

export interface Finding {
  id: string;
  scan_id: string;
  check_id: string;
  title: string;
  provider: string;
  account_id: string;
  region: string | null;
  resource_id: string | null;
  status: StatusType;
  severity: SeverityType;
  details: string;
}

export interface FindingsPage {
  items: Finding[];
  total: number;
  page: number;
  page_size: number;
}
