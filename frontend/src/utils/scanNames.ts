const STORAGE_KEY = 'mini_gauntlet_scan_names';

export function getScanNames(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function getScanName(scanId: string): string {
  const names = getScanNames();
  return names[scanId] || `Scan ${scanId.slice(0, 8)}`;
}

export function setScanName(scanId: string, name: string): void {
  try {
    const names = getScanNames();
    if (name.trim()) {
      names[scanId] = name.trim();
    } else {
      delete names[scanId];
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(names));
  } catch {
    // Ignore localStorage write errors
  }
}
