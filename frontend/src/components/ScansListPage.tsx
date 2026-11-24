import React, { useState } from 'react';
import { ScanSummary } from '../types';
import { getScanName, setScanName } from '../utils/scanNames';

interface Props {
  scans: ScanSummary[];
  loading: boolean;
  triggering: boolean;
  onRunScan: (name?: string) => void;
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
  const [newScanName, setNewScanName] = useState('');
  const [editingScanId, setEditingScanId] = useState<string | null>(null);
  const [editingNameValue, setEditingNameValue] = useState('');

  const handleStartScan = (e: React.FormEvent) => {
    e.preventDefault();
    onRunScan(newScanName.trim() || undefined);
    setNewScanName('');
  };

  const handleSaveName = (id: string) => {
    setScanName(id, editingNameValue);
    setEditingScanId(null);
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Posture Scan Runs</h1>
          <p className="page-desc">
            Multi-cloud configuration assessments across AWS, Azure, and Google Cloud snapshots.
          </p>
        </div>
        <form onSubmit={handleStartScan} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="text"
            className="filter-search-input"
            style={{ width: 200, height: 36, paddingLeft: 12 }}
            placeholder="Optional scan name…"
            value={newScanName}
            onChange={(e) => setNewScanName(e.target.value)}
          />
          <button
            type="submit"
            className="btn btn-primary"
            disabled={triggering}
          >
            {triggering ? 'Starting Scan…' : '▶ Run Scan'}
          </button>
        </form>
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
              onClick={() => onRunScan()}
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
                  <th>Scan Name & ID</th>
                  <th>Status</th>
                  <th>Started (Local Time)</th>
                  <th>Duration</th>
                  <th>Accounts</th>
                  <th>Posture Score</th>
                  <th>Findings Summary</th>
                </tr>
              </thead>
              <tbody>
                {scans.map((scan) => {
                  const currentName = getScanName(scan.id);
                  const isEditing = editingScanId === scan.id;
                  return (
                    <tr
                      key={scan.id}
                      className="clickable-row"
                      onClick={() => onSelectScan(scan.id)}
                    >
                      <td>
                        {isEditing ? (
                          <div
                            onClick={(e) => e.stopPropagation()}
                            style={{ display: 'flex', gap: 4, alignItems: 'center' }}
                          >
                            <input
                              type="text"
                              className="filter-search-input"
                              style={{ height: 26, width: 140, paddingLeft: 6, fontSize: 12 }}
                              value={editingNameValue}
                              onChange={(e) => setEditingNameValue(e.target.value)}
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveName(scan.id);
                                if (e.key === 'Escape') setEditingScanId(null);
                              }}
                            />
                            <button
                              type="button"
                              className="copy-btn"
                              style={{ padding: '2px 6px' }}
                              onClick={() => handleSaveName(scan.id)}
                            >
                              Save
                            </button>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontWeight: 600 }}>{currentName}</span>
                            <button
                              type="button"
                              className="edit-name-btn"
                              title="Rename scan"
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingScanId(scan.id);
                                setEditingNameValue(currentName);
                              }}
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                              </svg>
                            </button>
                          </div>
                        )}
                        <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                          {scan.id.slice(0, 8)}…
                        </div>
                      </td>
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
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
