import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchScanDetail, fetchScanFindings } from '../api';
import { FindingsPage, ScanDetail } from '../types';
import { CustomSelect } from './CustomSelect';
import { ScoreGauge } from './ScoreGauge';
import { SeverityDistributionBar } from './SeverityDistributionBar';
import { getRemediationCommand } from './remediation';
import { formatDuration, formatLocalTime, formatScore, scoreColorClass } from './ScansListPage';

interface Props {
  scanId: string;
  onBack: () => void;
}

export const ScanDetailPage: React.FC<Props> = ({ scanId, onBack }) => {
  const [detail, setDetail] = useState<ScanDetail | null>(null);
  const [findingsPage, setFindingsPage] = useState<FindingsPage | null>(null);
  const [loadingDetail, setLoadingDetail] = useState<boolean>(true);
  const [loadingFindings, setLoadingFindings] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<string>('');
  const [severityFilter, setSeverityFilter] = useState<string>('');
  const [providerFilter, setProviderFilter] = useState<string>('');
  const [accountFilter, setAccountFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [expandedFindingId, setExpandedFindingId] = useState<string | null>(null);
  const [copiedCodeId, setCopiedCodeId] = useState<string | null>(null);
  const [page, setPage] = useState<number>(1);
  const pageSize = 25;

  const loadDetail = useCallback(async () => {
    try {
      const data = await fetchScanDetail(scanId);
      setDetail(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load scan details');
    } finally {
      setLoadingDetail(false);
    }
  }, [scanId]);

  const loadFindings = useCallback(async () => {
    setLoadingFindings(true);
    try {
      const data = await fetchScanFindings(scanId, {
        status: statusFilter || undefined,
        severity: severityFilter || undefined,
        provider: providerFilter || undefined,
        account_id: accountFilter || undefined,
        page,
        page_size: pageSize,
      });
      setFindingsPage(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load findings');
    } finally {
      setLoadingFindings(false);
    }
  }, [scanId, statusFilter, severityFilter, providerFilter, accountFilter, page]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  useEffect(() => {
    void loadFindings();
  }, [loadFindings]);

  // Poll while scan is still RUNNING
  useEffect(() => {
    if (!detail || detail.status !== 'RUNNING') return;
    const timer = window.setInterval(() => {
      void loadDetail();
      void loadFindings();
    }, 1500);
    return () => window.clearInterval(timer);
  }, [detail, loadDetail, loadFindings]);

  // Client-side text filter on the current findings page
  const filteredFindings = useMemo(() => {
    if (!findingsPage) return [];
    if (!searchQuery.trim()) return findingsPage.items;
    const q = searchQuery.toLowerCase();
    return findingsPage.items.filter(
      (f) =>
        f.check_id.toLowerCase().includes(q) ||
        f.title.toLowerCase().includes(q) ||
        (f.resource_id && f.resource_id.toLowerCase().includes(q)) ||
        (f.region && f.region.toLowerCase().includes(q)) ||
        f.account_id.toLowerCase().includes(q) ||
        f.details.toLowerCase().includes(q)
    );
  }, [findingsPage, searchQuery]);

  const handleCopy = (id: string, text: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedCodeId(id);
    setTimeout(() => {
      setCopiedCodeId(null);
    }, 2000);
  };

  const handleExportCSV = () => {
    if (!findingsPage || findingsPage.items.length === 0) return;
    const headers = ['Check ID', 'Severity', 'Status', 'Provider', 'Account ID', 'Resource ID', 'Region', 'Details'];
    const rows = findingsPage.items.map((f) => [
      `"${f.check_id}"`,
      `"${f.severity}"`,
      `"${f.status}"`,
      `"${f.provider}"`,
      `"${f.account_id}"`,
      `"${f.resource_id ?? ''}"`,
      `"${f.region ?? ''}"`,
      `"${f.details.replace(/"/g, '""')}"`,
    ]);
    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `mini-gauntlet-scan-${scanId}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const activeFilterCount = [statusFilter, severityFilter, providerFilter, accountFilter].filter(Boolean).length;
  const totalPages = findingsPage ? Math.max(1, Math.ceil(findingsPage.total / pageSize)) : 1;

  return (
    <div>
      <div className={`page-header ${detail?.status === 'RUNNING' ? 'scan-running-banner' : ''}`}>
        <div>
          <button type="button" className="btn" onClick={onBack} style={{ marginBottom: 12 }}>
            ← All Scans
          </button>
          <h1 className="page-title">
            Scan <span className="mono">{scanId}</span>
          </h1>
          {detail && (
            <p className="page-desc">
              Started {formatLocalTime(detail.started_at)} · Duration{' '}
              {formatDuration(detail.started_at, detail.finished_at)}
            </p>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {findingsPage && findingsPage.items.length > 0 && (
            <button
              type="button"
              className="btn"
              onClick={handleExportCSV}
              title="Download findings as CSV"
            >
              📥 Export CSV
            </button>
          )}
          {detail && (
            <span className={`badge badge-${detail.status}`} style={{ fontSize: 13, padding: '6px 14px' }}>
              {detail.status === 'RUNNING' && <span className="pulse-dot" />}
              {detail.status}
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="banner banner-error" role="alert">
          <span>{error}</span>
          <button type="button" className="btn" onClick={() => void loadDetail()}>
            Retry
          </button>
        </div>
      )}

      {loadingDetail && !detail ? (
        <div className="card">
          <div className="empty-state">Loading scan telemetry…</div>
        </div>
      ) : detail ? (
        <>
          {detail.status === 'FAILED' && detail.error_message && (
            <div className="banner banner-error" role="alert">
              Scan failed: {detail.error_message}
            </div>
          )}

          {/* Interactive KPI Cards */}
          <div className="kpi-grid">
            <div className="kpi-card">
              <div className="kpi-gauge-row">
                <div>
                  <div className="kpi-label">Overall Posture</div>
                  <div className={`kpi-value ${scoreColorClass(detail.score)}`}>
                    {formatScore(detail.score)}
                  </div>
                  <div className="kpi-sub">PASS / (PASS + FAIL)</div>
                </div>
                <ScoreGauge score={detail.score} size={68} strokeWidth={6} />
              </div>
            </div>

            <div
              className={`kpi-card interactive ${statusFilter === 'FAIL' ? 'active-filter' : ''}`}
              onClick={() => {
                setStatusFilter(statusFilter === 'FAIL' ? '' : 'FAIL');
                setPage(1);
              }}
              title="Click to toggle FAIL filter"
            >
              <div className="kpi-label">Failed Checks</div>
              <div className="kpi-value" style={{ color: 'var(--status-fail)' }}>
                {detail.counts_by_status.FAIL}
              </div>
              <div className="sev-strip">
                <span
                  className="sev-chip"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSeverityFilter(severityFilter === 'CRITICAL' ? '' : 'CRITICAL');
                    setPage(1);
                  }}
                  style={{
                    cursor: 'pointer',
                    borderColor: severityFilter === 'CRITICAL' ? 'var(--sev-critical)' : undefined,
                  }}
                >
                  CRIT: {detail.fail_counts_by_severity.CRITICAL}
                </span>
                <span
                  className="sev-chip"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSeverityFilter(severityFilter === 'HIGH' ? '' : 'HIGH');
                    setPage(1);
                  }}
                  style={{
                    cursor: 'pointer',
                    borderColor: severityFilter === 'HIGH' ? 'var(--sev-high)' : undefined,
                  }}
                >
                  HIGH: {detail.fail_counts_by_severity.HIGH}
                </span>
                <span
                  className="sev-chip"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSeverityFilter(severityFilter === 'MEDIUM' ? '' : 'MEDIUM');
                    setPage(1);
                  }}
                  style={{
                    cursor: 'pointer',
                    borderColor: severityFilter === 'MEDIUM' ? 'var(--sev-medium)' : undefined,
                  }}
                >
                  MED: {detail.fail_counts_by_severity.MEDIUM}
                </span>
                <span
                  className="sev-chip"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSeverityFilter(severityFilter === 'LOW' ? '' : 'LOW');
                    setPage(1);
                  }}
                  style={{
                    cursor: 'pointer',
                    borderColor: severityFilter === 'LOW' ? 'var(--sev-low)' : undefined,
                  }}
                >
                  LOW: {detail.fail_counts_by_severity.LOW}
                </span>
              </div>
              <SeverityDistributionBar
                critical={detail.fail_counts_by_severity.CRITICAL}
                high={detail.fail_counts_by_severity.HIGH}
                medium={detail.fail_counts_by_severity.MEDIUM}
                low={detail.fail_counts_by_severity.LOW}
                onSelectSeverity={(sev) => {
                  setSeverityFilter(sev);
                  setPage(1);
                }}
              />
            </div>

            <div
              className={`kpi-card interactive ${statusFilter === 'PASS' ? 'active-filter' : ''}`}
              onClick={() => {
                setStatusFilter(statusFilter === 'PASS' ? '' : 'PASS');
                setPage(1);
              }}
              title="Click to toggle PASS filter"
            >
              <div className="kpi-label">Passed Checks</div>
              <div className="kpi-value" style={{ color: 'var(--status-pass)' }}>
                {detail.counts_by_status.PASS}
              </div>
              <div className="kpi-sub">Compliant cloud resources</div>
            </div>

            <div
              className={`kpi-card interactive ${statusFilter === 'CANNOT_SCAN' ? 'active-filter' : ''}`}
              onClick={() => {
                setStatusFilter(statusFilter === 'CANNOT_SCAN' ? '' : 'CANNOT_SCAN');
                setPage(1);
              }}
              title="Click to toggle CANNOT_SCAN filter"
            >
              <div className="kpi-label">Cannot Scan</div>
              <div className="kpi-value" style={{ color: 'var(--status-warn)' }}>
                {detail.counts_by_status.CANNOT_SCAN}
              </div>
              <div className="kpi-sub">Excluded from score</div>
            </div>
          </div>

          <h2 style={{ fontSize: 16, marginBottom: 12, color: 'var(--text-secondary)' }}>
            Account Posture Breakdown
          </h2>
          <div className="account-grid">
            {detail.accounts.map((acc) => {
              const isSelected = accountFilter === acc.account_id;
              return (
                <div
                  key={acc.account_id}
                  className={`account-card ${isSelected ? 'active-filter' : ''}`}
                  style={{ cursor: 'pointer' }}
                  onClick={() => {
                    setAccountFilter(isSelected ? '' : acc.account_id);
                    setPage(1);
                  }}
                  title="Click to filter by this account"
                >
                  <div className="account-top">
                    <span className="provider-pill">{acc.provider}</span>
                    <span className={`score-pill ${scoreColorClass(acc.score)}`}>
                      {formatScore(acc.score)}
                    </span>
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{acc.account_name}</div>
                    <div className="mono" style={{ color: 'var(--text-muted)', marginTop: 2 }}>
                      {acc.account_id}
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    <span style={{ color: 'var(--status-fail)' }}>{acc.counts_by_status.FAIL} fail</span>
                    {' · '}
                    <span style={{ color: 'var(--status-warn)' }}>
                      {acc.counts_by_status.CANNOT_SCAN} cannot scan
                    </span>
                    {' · '}
                    <span style={{ color: 'var(--status-pass)' }}>{acc.counts_by_status.PASS} pass</span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="card">
            <div className="filter-bar">
              {/* Free-text search input */}
              <div className="filter-search-wrap">
                <span className="filter-search-icon">🔍</span>
                <input
                  type="text"
                  className="filter-search-input"
                  placeholder="Search check ID, resource, details…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              <div className="filter-group">
                <label className="filter-label" htmlFor="filter-status">
                  Status
                </label>
                <CustomSelect
                  id="filter-status"
                  value={statusFilter}
                  onChange={(val) => {
                    setStatusFilter(val);
                    setPage(1);
                  }}
                  options={[
                    { value: '', label: 'All Statuses' },
                    {
                      value: 'FAIL',
                      label: 'FAIL',
                      badge: 'Violations',
                      badgeColor: 'rgba(239, 68, 68, 0.25)',
                    },
                    {
                      value: 'CANNOT_SCAN',
                      label: 'CANNOT_SCAN',
                      badge: 'Skipped',
                      badgeColor: 'rgba(245, 158, 11, 0.25)',
                    },
                    {
                      value: 'PASS',
                      label: 'PASS',
                      badge: 'Compliant',
                      badgeColor: 'rgba(16, 185, 129, 0.25)',
                    },
                  ]}
                />
              </div>

              <div className="filter-group">
                <label className="filter-label" htmlFor="filter-severity">
                  Severity
                </label>
                <CustomSelect
                  id="filter-severity"
                  value={severityFilter}
                  onChange={(val) => {
                    setSeverityFilter(val);
                    setPage(1);
                  }}
                  options={[
                    { value: '', label: 'All Severities' },
                    {
                      value: 'CRITICAL',
                      label: 'CRITICAL',
                      badge: 'Sev 1',
                      badgeColor: 'rgba(220, 38, 38, 0.3)',
                    },
                    {
                      value: 'HIGH',
                      label: 'HIGH',
                      badge: 'Sev 2',
                      badgeColor: 'rgba(234, 88, 12, 0.3)',
                    },
                    {
                      value: 'MEDIUM',
                      label: 'MEDIUM',
                      badge: 'Sev 3',
                      badgeColor: 'rgba(217, 119, 6, 0.3)',
                    },
                    {
                      value: 'LOW',
                      label: 'LOW',
                      badge: 'Sev 4',
                      badgeColor: 'rgba(101, 163, 13, 0.3)',
                    },
                  ]}
                />
              </div>

              <div className="filter-group">
                <label className="filter-label" htmlFor="filter-provider">
                  Provider
                </label>
                <CustomSelect
                  id="filter-provider"
                  value={providerFilter}
                  onChange={(val) => {
                    setProviderFilter(val);
                    setPage(1);
                  }}
                  options={[
                    { value: '', label: 'All Providers' },
                    { value: 'aws', label: 'AWS', badge: 'Cloud' },
                    { value: 'azure', label: 'Azure', badge: 'Cloud' },
                    { value: 'gcp', label: 'GCP', badge: 'Cloud' },
                  ]}
                />
              </div>

              <div className="filter-group">
                <label className="filter-label" htmlFor="filter-account">
                  Account
                </label>
                <CustomSelect
                  id="filter-account"
                  value={accountFilter}
                  onChange={(val) => {
                    setAccountFilter(val);
                    setPage(1);
                  }}
                  options={[
                    { value: '', label: 'All Accounts' },
                    ...detail.accounts.map((a) => ({
                      value: a.account_id,
                      label: `${a.account_name}`,
                      badge: a.provider.toUpperCase(),
                      badgeColor: 'var(--bg-hover)',
                    })),
                  ]}
                />
              </div>

              {(activeFilterCount > 0 || searchQuery) && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, alignSelf: 'flex-end' }}>
                  {activeFilterCount > 0 && (
                    <span className="filter-active-count">{activeFilterCount} active</span>
                  )}
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setStatusFilter('');
                      setSeverityFilter('');
                      setProviderFilter('');
                      setAccountFilter('');
                      setSearchQuery('');
                      setPage(1);
                    }}
                  >
                    Clear Filters
                  </button>
                </div>
              )}
            </div>

            {loadingFindings && !findingsPage ? (
              <div style={{ padding: '24px' }}>
                <div className="skeleton-row" />
                <div className="skeleton-row" />
                <div className="skeleton-row" />
                <div className="skeleton-row" />
              </div>
            ) : !findingsPage || filteredFindings.length === 0 ? (
              <div className="empty-state">
                {detail.status === 'RUNNING'
                  ? 'Scan in progress — findings will appear automatically…'
                  : 'No findings match the active filters or search query.'}
              </div>
            ) : (
              <>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Status</th>
                        <th>Severity</th>
                        <th>Check</th>
                        <th>Provider / Account</th>
                        <th>Resource</th>
                        <th>Region</th>
                        <th>Details & Guidance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredFindings.map((f) => {
                        const isExpanded = expandedFindingId === f.id;
                        const remediation = getRemediationCommand(f.check_id, f.resource_id);
                        return (
                          <React.Fragment key={f.id}>
                            <tr
                              className="clickable-row"
                              onClick={() => setExpandedFindingId(isExpanded ? null : f.id)}
                            >
                              <td>
                                <span className={`badge badge-${f.status}`}>{f.status}</span>
                              </td>
                              <td>
                                <span className={`sev-badge sev-${f.severity}`}>{f.severity}</span>
                              </td>
                              <td>
                                <div className="mono" style={{ fontWeight: 700, color: 'var(--accent-gold)' }}>
                                  {f.check_id}
                                </div>
                                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                                  {f.title}
                                </div>
                              </td>
                              <td>
                                <div style={{ fontWeight: 600, textTransform: 'uppercase', fontSize: 11 }}>
                                  {f.provider}
                                </div>
                                <div className="mono" style={{ color: 'var(--text-secondary)' }}>
                                  {f.account_id}
                                </div>
                              </td>
                              <td className="mono">{f.resource_id ?? '—'}</td>
                              <td className="mono" style={{ color: 'var(--text-secondary)' }}>
                                {f.region ?? '—'}
                              </td>
                              {/* Rendered strictly as plain text to neutralize untrusted snapshot strings */}
                              <td className="details-cell">
                                <div>{f.details}</div>
                                {f.status === 'FAIL' && (
                                  <div
                                    style={{
                                      fontSize: 11,
                                      color: 'var(--accent-gold)',
                                      marginTop: 6,
                                      fontWeight: 600,
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: 4,
                                    }}
                                  >
                                    <span>{isExpanded ? '▼ Hide remediation' : '▶ View remediation CLI'}</span>
                                  </div>
                                )}
                              </td>
                            </tr>
                            {isExpanded && f.status === 'FAIL' && (
                              <tr style={{ background: 'var(--bg-obsidian)' }}>
                                <td colSpan={7} style={{ padding: '8px 24px 16px' }}>
                                  <div className="remediation-box">
                                    <div className="remediation-title">
                                      <span>Remediation CLI Snippet</span>
                                      <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                                        {f.provider.toUpperCase()} CLI
                                      </span>
                                    </div>
                                    <div className="remediation-guide">{remediation.guide}</div>
                                    <div className="remediation-code-wrap">
                                      <code className="remediation-code">{remediation.command}</code>
                                      <button
                                        type="button"
                                        className={`copy-btn ${copiedCodeId === f.id ? 'copied' : ''}`}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleCopy(f.id, remediation.command);
                                        }}
                                      >
                                        {copiedCodeId === f.id ? '✓ Copied' : 'Copy CLI'}
                                      </button>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="pagination-bar">
                  <span>
                    Showing {Math.min((page - 1) * pageSize + 1, findingsPage.total)}–
                    {Math.min(page * pageSize, findingsPage.total)} of {findingsPage.total} findings
                  </span>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button
                      type="button"
                      className="btn"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      Previous
                    </button>
                    <span>
                      Page {page} of {totalPages}
                    </span>
                    <button
                      type="button"
                      className="btn"
                      disabled={page >= totalPages}
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    >
                      Next
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
};
