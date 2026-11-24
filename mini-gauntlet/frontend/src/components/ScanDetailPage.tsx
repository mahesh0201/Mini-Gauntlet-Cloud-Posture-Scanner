import React, { useCallback, useEffect, useState } from 'react';
import { fetchScanDetail, fetchScanFindings } from '../api';
import { FindingsPage, ScanDetail } from '../types';
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

  const totalPages = findingsPage ? Math.max(1, Math.ceil(findingsPage.total / pageSize)) : 1;

  return (
    <div>
      <div className="page-header">
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
        {detail && (
          <span className={`badge badge-${detail.status}`} style={{ fontSize: 13, padding: '6px 14px' }}>
            {detail.status === 'RUNNING' && <span className="pulse-dot" />}
            {detail.status}
          </span>
        )}
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

          <div className="kpi-grid">
            <div className="kpi-card">
              <div className="kpi-label">Overall Posture Score</div>
              <div className={`kpi-value ${scoreColorClass(detail.score)}`}>
                {formatScore(detail.score)}
              </div>
              <div className="kpi-sub">PASS / (PASS + FAIL)</div>
            </div>

            <div className="kpi-card">
              <div className="kpi-label">Failed Checks</div>
              <div className="kpi-value" style={{ color: 'var(--status-fail)' }}>
                {detail.counts_by_status.FAIL}
              </div>
              <div className="sev-strip">
                <span className="sev-chip">CRIT: {detail.fail_counts_by_severity.CRITICAL}</span>
                <span className="sev-chip">HIGH: {detail.fail_counts_by_severity.HIGH}</span>
                <span className="sev-chip">MED: {detail.fail_counts_by_severity.MEDIUM}</span>
                <span className="sev-chip">LOW: {detail.fail_counts_by_severity.LOW}</span>
              </div>
            </div>

            <div className="kpi-card">
              <div className="kpi-label">Passed Checks</div>
              <div className="kpi-value" style={{ color: 'var(--status-pass)' }}>
                {detail.counts_by_status.PASS}
              </div>
              <div className="kpi-sub">Compliant cloud resources</div>
            </div>

            <div className="kpi-card">
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
            {detail.accounts.map((acc) => (
              <div key={acc.account_id} className="account-card">
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
            ))}
          </div>

          <div className="card">
            <div className="filter-bar">
              <div className="filter-group">
                <label className="filter-label" htmlFor="filter-status">
                  Status
                </label>
                <select
                  id="filter-status"
                  className="select-input"
                  value={statusFilter}
                  onChange={(e) => {
                    setStatusFilter(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">All Statuses</option>
                  <option value="FAIL">FAIL</option>
                  <option value="CANNOT_SCAN">CANNOT_SCAN</option>
                  <option value="PASS">PASS</option>
                </select>
              </div>

              <div className="filter-group">
                <label className="filter-label" htmlFor="filter-severity">
                  Severity
                </label>
                <select
                  id="filter-severity"
                  className="select-input"
                  value={severityFilter}
                  onChange={(e) => {
                    setSeverityFilter(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">All Severities</option>
                  <option value="CRITICAL">CRITICAL</option>
                  <option value="HIGH">HIGH</option>
                  <option value="MEDIUM">MEDIUM</option>
                  <option value="LOW">LOW</option>
                </select>
              </div>

              <div className="filter-group">
                <label className="filter-label" htmlFor="filter-provider">
                  Provider
                </label>
                <select
                  id="filter-provider"
                  className="select-input"
                  value={providerFilter}
                  onChange={(e) => {
                    setProviderFilter(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">All Providers</option>
                  <option value="aws">AWS</option>
                  <option value="azure">Azure</option>
                  <option value="gcp">GCP</option>
                </select>
              </div>

              <div className="filter-group">
                <label className="filter-label" htmlFor="filter-account">
                  Account
                </label>
                <select
                  id="filter-account"
                  className="select-input"
                  value={accountFilter}
                  onChange={(e) => {
                    setAccountFilter(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">All Accounts</option>
                  {detail.accounts.map((a) => (
                    <option key={a.account_id} value={a.account_id}>
                      {a.account_name} ({a.account_id})
                    </option>
                  ))}
                </select>
              </div>

              {(statusFilter || severityFilter || providerFilter || accountFilter) && (
                <button
                  type="button"
                  className="btn"
                  style={{ alignSelf: 'flex-end' }}
                  onClick={() => {
                    setStatusFilter('');
                    setSeverityFilter('');
                    setProviderFilter('');
                    setAccountFilter('');
                    setPage(1);
                  }}
                >
                  Clear Filters
                </button>
              )}
            </div>

            {loadingFindings && !findingsPage ? (
              <div className="empty-state">Loading findings…</div>
            ) : !findingsPage || findingsPage.items.length === 0 ? (
              <div className="empty-state">
                {detail.status === 'RUNNING'
                  ? 'Scan in progress — findings will appear automatically…'
                  : 'No findings match the active filters.'}
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
                        <th>Details</th>
                      </tr>
                    </thead>
                    <tbody>
                      {findingsPage.items.map((f) => (
                        <tr key={f.id}>
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
                          <td className="details-cell">{f.details}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="pagination-bar">
                  <span>
                    Showing {(findingsPage.page - 1) * findingsPage.page_size + 1}–
                    {Math.min(findingsPage.page * findingsPage.page_size, findingsPage.total)} of{' '}
                    {findingsPage.total} findings
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
