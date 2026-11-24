import React, { useCallback, useEffect, useState } from 'react';
import { fetchScans, triggerScan } from './api';
import { ScanDetailPage } from './components/ScanDetailPage';
import { ScansListPage } from './components/ScansListPage';
import { ScanSummary } from './types';
import { setScanName } from './utils/scanNames';

export const App: React.FC = () => {
  const [scans, setScans] = useState<ScanSummary[]>([]);
  const [selectedScanId, setSelectedScanId] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [triggering, setTriggering] = useState<boolean>(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem('mini_gauntlet_theme') as 'dark' | 'light') || 'dark';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('mini_gauntlet_theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

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

  const handleRunScan = async (name?: string) => {
    setTriggering(true);
    try {
      const created = await triggerScan();
      if (name) {
        setScanName(created.id, name);
      }
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
          <button
            type="button"
            className="btn"
            onClick={toggleTheme}
            title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} mode`}
          >
            {theme === 'dark' ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
            <span>{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
          </button>
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
            onRunScan={(name) => void handleRunScan(name)}
            onSelectScan={(id) => setSelectedScanId(id)}
          />
        )}
      </main>
    </div>
  );
};

export default App;
