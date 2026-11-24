import React from 'react';
import { ScanSummary } from '../types';

interface Props {
  scans: ScanSummary[];
  loading: boolean;
  triggering: boolean;
  onRunScan: () => void;
  onSelectScan: (scanId: string) => void;
}

export function formatScore(score: number | null): string {
  return score === null ? 'N/A' : `${score.toFixed(1)}%`;
}

export function scoreColorClass(score: number | null): string {
  if (score === null) return 'score-na';
  if (score >= 80) return 'score-good';
  if (score >= 50) return 'score-mid';
  return 'score-bad';
}

export function formatLocalTime(iso: string): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  return dt.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function formatDuration(startedAt: string, finishedAt: string | null): string {
  const start = new Date(startedAt).getTime();
  if (Number.isNaN(start)) return '—';
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
  const diffSec = Math.max(0, (end - start) / 1000);
  return `${diffSec.toFixed(1)}s`;
}

export const ScansListPage: React.FC<Props> = ({
  scans,
  loading,
  triggering,
  onRunScan,
  onSelectScan,
}) => {
  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Posture Scan Runs</h1>
          <p className="page-desc">
            Multi-cloud configuration assessments across AWS, Azure, and Google Cloud snapshots.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={onRunScan}
          disabled={triggering}
        >
          {triggering ? 'Starting Scan…' : '▶ Run Scan'}
        </button>
      </div>

      <div className="card">
        {loading ? (
          <div className="empty-state">Loading scan history…</div>
        ) : scans.length === 0 ? (
          <div className="empty-state">
            <p style={{ marginTop: 0, fontWeight: 600, color: 'var(--text-primary)' }}>
              No scans recorded yet
            </p>
            <p style={{ marginBottom: 18 }}>
              Trigger your first posture scan to evaluate all configured cloud accounts.
            </p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={onRunScan}
              disabled={triggering}
            >
              Run Initial Scan
            </button>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Scan ID</th>
                  <th>Status</th>
                  <th>Started (Local Time)</th>
                  <th>Duration</th>
                  <th>Accounts</th>
                  <th>Posture Score</th>
                  <th>Findings Summary</th>
                </tr>
              </thead>
              <tbody>
                {scans.map((scan) => (
                  <tr
                    key={scan.id}
                    className="clickable-row"
                    onClick={() => onSelectScan(scan.id)}
                  >
                    <td className="mono">{scan.id.slice(0, 8)}…</td>
                    <td>
                      <span className={`badge badge-${scan.status}`}>
                        {scan.status === 'RUNNING' && <span className="pulse-dot" />}
                        {scan.status}
                      </span>
                    </td>
                    <td>{formatLocalTime(scan.started_at)}</td>
                    <td className="mono">{formatDuration(scan.started_at, scan.finished_at)}</td>
                    <td>{scan.account_ids.length} accounts</td>
                    <td>
                      <span className={`score-pill ${scoreColorClass(scan.score)}`}>
                        {formatScore(scan.score)}
                      </span>
                    </td>
                    <td>
                      <span style={{ color: 'var(--status-fail)', fontWeight: 600 }}>
                        {scan.counts_by_status.FAIL} FAIL
                      </span>
                      {' · '}
                      <span style={{ color: 'var(--status-warn)', fontWeight: 600 }}>
                        {scan.counts_by_status.CANNOT_SCAN} CANNOT_SCAN
                      </span>
                      {' · '}
                      <span style={{ color: 'var(--status-pass)', fontWeight: 600 }}>
                        {scan.counts_by_status.PASS} PASS
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
