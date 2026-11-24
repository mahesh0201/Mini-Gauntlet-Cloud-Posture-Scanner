import React, { useCallback, useEffect, useState } from 'react';
import { fetchScans, triggerScan } from './api';
import { ScanDetailPage } from './components/ScanDetailPage';
import { ScansListPage } from './components/ScansListPage';
import { ScanSummary } from './types';

export const App: React.FC = () => {
  const [scans, setScans] = useState<ScanSummary[]>([]);
  const [selectedScanId, setSelectedScanId] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [triggering, setTriggering] = useState<boolean>(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const loadScans = useCallback(async () => {
    try {
      const data = await fetchScans();
      setScans(data);
      setApiError(null);
    } catch (err) {
      setApiError(
        err instanceof Error
          ? `API unreachable: ${err.message}`
          : 'Unable to reach Mini Gauntlet API'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadScans();
  }, [loadScans]);

  // Poll every 1.5s while any scan is RUNNING
  useEffect(() => {
    const hasRunning = scans.some((s) => s.status === 'RUNNING');
    if (!hasRunning) return;
    const timer = window.setInterval(() => {
      void loadScans();
    }, 1500);
    return () => window.clearInterval(timer);
  }, [scans, loadScans]);

  const handleRunScan = async () => {
    setTriggering(true);
    try {
      const created = await triggerScan();
      setApiError(null);
      setScans((prev) => [created, ...prev]);
      setSelectedScanId(created.id);
    } catch (err) {
      setApiError(err instanceof Error ? err.message : 'Failed to start scan');
    } finally {
      setTriggering(false);
    }
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand" onClick={() => setSelectedScanId(null)} role="button" tabIndex={0}>
          <div className="brand-mark">MG</div>
          <div>
            <div className="brand-title">Mini Gauntlet</div>
            <div className="brand-sub">Cloud Posture Command</div>
          </div>
        </div>
        <div className="topbar-actions">
          {selectedScanId && (
            <button type="button" className="btn" onClick={() => setSelectedScanId(null)}>
              Scans History
            </button>
          )}
        </div>
      </header>

      <main className="main-container">
        {apiError && (
          <div className="banner banner-error" role="alert">
            <span>{apiError}</span>
            <button type="button" className="btn" onClick={() => void loadScans()}>
              Retry Connection
            </button>
          </div>
        )}

        {selectedScanId ? (
          <ScanDetailPage
            scanId={selectedScanId}
            onBack={() => {
              setSelectedScanId(null);
              void loadScans();
            }}
          />
        ) : (
          <ScansListPage
            scans={scans}
            loading={loading}
            triggering={triggering}
            onRunScan={() => void handleRunScan()}
            onSelectScan={(id) => setSelectedScanId(id)}
          />
        )}
      </main>
    </div>
  );
};

export default App;
