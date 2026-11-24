import React from 'react';

interface ScoreGaugeProps {
  score: number | null;
  size?: number;
  strokeWidth?: number;
}

export const ScoreGauge: React.FC<ScoreGaugeProps> = ({
  score,
  size = 64,
  strokeWidth = 6,
}) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clampedScore = score !== null ? Math.min(100, Math.max(0, score)) : 0;
  const strokeDashoffset = score !== null ? circumference - (clampedScore / 100) * circumference : circumference;

  let color = 'var(--text-muted)';
  if (score !== null) {
    if (score >= 80) color = 'var(--status-pass)';
    else if (score >= 50) color = 'var(--accent-gold)';
    else color = 'var(--status-fail)';
  }

  return (
    <div className="gauge-container" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="gauge-svg">
        <circle
          className="gauge-bg"
          stroke="var(--border-strong)"
          strokeWidth={strokeWidth}
          fill="transparent"
          r={radius}
          cx={size / 2}
          cy={size / 2}
        />
        <circle
          className="gauge-progress"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          fill="transparent"
          r={radius}
          cx={size / 2}
          cy={size / 2}
        />
      </svg>
      <div className="gauge-text" style={{ color }}>
        {score === null ? 'N/A' : `${score.toFixed(0)}%`}
      </div>
    </div>
  );
};
