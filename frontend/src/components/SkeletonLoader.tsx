import React from 'react';

export const SkeletonFindingsTable: React.FC = () => {
  return (
    <div className="skeleton-table-container">
      <div className="skeleton-table-header">
        <div className="skeleton-icon-pulse">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
        </div>
        <span className="skeleton-status-text">Scanning and evaluating cloud posture telemetry…</span>
      </div>

      <div className="skeleton-rows-list">
        {[1, 2, 3, 4, 5].map((row) => (
          <div key={row} className="skeleton-table-row">
            {/* Status badge skeleton */}
            <div className="skeleton-box skeleton-badge" />
            {/* Severity icon + pill skeleton */}
            <div className="skeleton-pill-wrap">
              <div className="skeleton-icon-circle" />
              <div className="skeleton-box skeleton-sev" />
            </div>
            {/* Check ID & title */}
            <div className="skeleton-check-col">
              <div className="skeleton-box skeleton-check-id" />
              <div className="skeleton-box skeleton-check-desc" />
            </div>
            {/* Provider & account */}
            <div className="skeleton-account-col">
              <div className="skeleton-box skeleton-provider" />
              <div className="skeleton-box skeleton-account-id" />
            </div>
            {/* Resource ID */}
            <div className="skeleton-box skeleton-resource" />
            {/* Region */}
            <div className="skeleton-box skeleton-region" />
            {/* Details */}
            <div className="skeleton-box skeleton-details" />
          </div>
        ))}
      </div>
    </div>
  );
};
