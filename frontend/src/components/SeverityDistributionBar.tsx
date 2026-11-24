import React from 'react';

interface SeverityDistributionBarProps {
  critical: number;
  high: number;
  medium: number;
  low: number;
  onSelectSeverity?: (sev: string) => void;
}

export const SeverityDistributionBar: React.FC<SeverityDistributionBarProps> = ({
  critical,
  high,
  medium,
  low,
  onSelectSeverity,
}) => {
  const total = critical + high + medium + low;

  if (total === 0) {
    return (
      <div className="sev-dist-empty">
        <div className="sev-dist-bar-bg" />
        <span className="sev-dist-empty-label">0 total violations</span>
      </div>
    );
  }

  const pCrit = (critical / total) * 100;
  const pHigh = (high / total) * 100;
  const pMed = (medium / total) * 100;
  const pLow = (low / total) * 100;

  return (
    <div className="sev-dist-wrap">
      <div className="sev-dist-bar">
        {critical > 0 && (
          <div
            className="sev-dist-segment sev-dist-crit"
            style={{ width: `${pCrit}%` }}
            title={`Critical: ${critical} (${pCrit.toFixed(0)}%)`}
            onClick={() => onSelectSeverity?.('CRITICAL')}
          />
        )}
        {high > 0 && (
          <div
            className="sev-dist-segment sev-dist-high"
            style={{ width: `${pHigh}%` }}
            title={`High: ${high} (${pHigh.toFixed(0)}%)`}
            onClick={() => onSelectSeverity?.('HIGH')}
          />
        )}
        {medium > 0 && (
          <div
            className="sev-dist-segment sev-dist-med"
            style={{ width: `${pMed}%` }}
            title={`Medium: ${medium} (${pMed.toFixed(0)}%)`}
            onClick={() => onSelectSeverity?.('MEDIUM')}
          />
        )}
        {low > 0 && (
          <div
            className="sev-dist-segment sev-dist-low"
            style={{ width: `${pLow}%` }}
            title={`Low: ${low} (${pLow.toFixed(0)}%)`}
            onClick={() => onSelectSeverity?.('LOW')}
          />
        )}
      </div>
    </div>
  );
};
