import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { ScanDetailPage } from '../components/ScanDetailPage';

describe('Mini Gauntlet Dashboard', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders scan list, handles N/A score, and triggers a new scan', async () => {
    const initialScans = [
      {
        id: 'scan-11111111-aaaa-bbbb-cccc-1234567890ab',
        status: 'COMPLETED',
        started_at: '2026-10-01T00:00:00Z',
        finished_at: '2026-10-01T00:00:03Z',
        account_ids: ['acc-1'],
        score: null,
        counts_by_status: { PASS: 0, FAIL: 0, CANNOT_SCAN: 2 },
      },
    ];

    const newScan = {
      id: 'scan-22222222-aaaa-bbbb-cccc-1234567890ab',
      status: 'RUNNING',
      started_at: '2026-10-01T01:00:00Z',
      finished_at: null,
      account_ids: ['acc-1', 'acc-2'],
      score: null,
      counts_by_status: { PASS: 0, FAIL: 0, CANNOT_SCAN: 0 },
    };

    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/scans') && (!init || init.method !== 'POST')) {
        return Promise.resolve(new Response(JSON.stringify(initialScans), { status: 200 }));
      }
      if (url.endsWith('/api/scans') && init?.method === 'POST') {
        return Promise.resolve(new Response(JSON.stringify(newScan), { status: 202 }));
      }
      if (url.includes(`/api/scans/${newScan.id}/findings`)) {
        return Promise.resolve(
          new Response(JSON.stringify({ items: [], total: 0, page: 1, page_size: 25 }), {
            status: 200,
          })
        );
      }
      if (url.endsWith(`/api/scans/${newScan.id}`)) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ...newScan,
              fail_counts_by_severity: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 },
              accounts: [],
            }),
            { status: 200 }
          )
        );
      }
      return Promise.resolve(new Response('{}', { status: 404 }));
    });

    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    expect(await screen.findByText('N/A')).toBeInTheDocument();
    expect(screen.getByText('COMPLETED')).toBeInTheDocument();

    const runBtn = screen.getByRole('button', { name: /run scan/i });
    await userEvent.click(runBtn);

    await waitFor(() => {
      expect(screen.getByText(/scan-22222222/i)).toBeInTheDocument();
    });
  });

  it('safely renders untrusted HTML strings as text and applies filters', async () => {
    const scanId = 'scan-detail-123';
    const xssPayload = "<img src=x onerror=alert('untrusted-input')> temporary rule";

    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith(`/api/scans/${scanId}`)) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: scanId,
              status: 'COMPLETED',
              started_at: '2026-10-01T00:00:00Z',
              finished_at: '2026-10-01T00:00:03Z',
              account_ids: ['example-corp-gcp'],
              score: 75.0,
              counts_by_status: { PASS: 3, FAIL: 1, CANNOT_SCAN: 0 },
              fail_counts_by_severity: { CRITICAL: 1, HIGH: 0, MEDIUM: 0, LOW: 0 },
              accounts: [
                {
                  account_id: 'example-corp-gcp',
                  account_name: 'example-corp-gcp',
                  provider: 'gcp',
                  score: 75.0,
                  counts_by_status: { PASS: 3, FAIL: 1, CANNOT_SCAN: 0 },
                },
              ],
            }),
            { status: 200 }
          )
        );
      }
      if (url.includes(`/api/scans/${scanId}/findings`)) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              items: [
                {
                  id: 'f-1',
                  scan_id: scanId,
                  check_id: 'GCP-VPC-01',
                  title: "Firewall rule doesn't expose SSH or RDP to the internet",
                  provider: 'gcp',
                  account_id: 'example-corp-gcp',
                  region: 'global',
                  resource_id: 'allow-rdp-anywhere',
                  status: 'FAIL',
                  severity: 'CRITICAL',
                  details: xssPayload,
                },
              ],
              total: 1,
              page: 1,
              page_size: 25,
            }),
            { status: 200 }
          )
        );
      }
      return Promise.resolve(new Response('{}', { status: 404 }));
    });

    vi.stubGlobal('fetch', fetchMock);

    const { container } = render(<ScanDetailPage scanId={scanId} onBack={() => {}} />);

    expect(await screen.findByText('GCP-VPC-01')).toBeInTheDocument();
    expect(screen.getByText(xssPayload)).toBeInTheDocument();
    // Ensure no raw <img> tag was injected into the DOM
    expect(container.querySelector('img')).toBeNull();

    const statusSelect = screen.getByLabelText(/status/i);
    await userEvent.selectOptions(statusSelect, 'FAIL');

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('status=FAIL'),
        expect.anything()
      );
    });
  });
});
