import json
import sqlite3
from pathlib import Path
from typing import Any, Optional

from app.config import get_db_path

SEVERITY_RANK = {
    "CRITICAL": 1,
    "HIGH": 2,
    "MEDIUM": 3,
    "LOW": 4,
}

STATUS_RANK = {
    "FAIL": 1,
    "CANNOT_SCAN": 2,
    "PASS": 3,
}


def get_connection(db_path: Optional[Path] = None) -> sqlite3.Connection:
    path = db_path or get_db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    return conn


def init_db(db_path: Optional[Path] = None) -> None:
    conn = get_connection(db_path)
    try:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS scans (
                id TEXT PRIMARY KEY,
                status TEXT NOT NULL,
                started_at TEXT NOT NULL,
                finished_at TEXT,
                account_ids_json TEXT NOT NULL,
                account_meta_json TEXT NOT NULL DEFAULT '[]',
                error_message TEXT
            );

            CREATE TABLE IF NOT EXISTS findings (
                id TEXT PRIMARY KEY,
                scan_id TEXT NOT NULL,
                check_id TEXT NOT NULL,
                title TEXT NOT NULL,
                provider TEXT NOT NULL,
                account_id TEXT NOT NULL,
                region TEXT,
                resource_id TEXT,
                status TEXT NOT NULL,
                severity TEXT NOT NULL,
                details TEXT NOT NULL,
                status_rank INTEGER NOT NULL,
                severity_rank INTEGER NOT NULL,
                FOREIGN KEY (scan_id) REFERENCES scans(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_findings_scan_order
            ON findings (scan_id, status_rank, severity_rank, check_id, resource_id);
            """
        )
        conn.commit()
    finally:
        conn.close()


def compute_score(pass_count: int, fail_count: int) -> Optional[float]:
    total = pass_count + fail_count
    if total == 0:
        return None
    return round(100.0 * (pass_count / total), 1)


def create_scan_record(
    scan_id: str,
    started_at: str,
    account_ids: list[str],
    account_meta: list[dict[str, str]],
    db_path: Optional[Path] = None,
) -> None:
    conn = get_connection(db_path)
    try:
        conn.execute(
            """
            INSERT INTO scans (id, status, started_at, finished_at, account_ids_json, account_meta_json, error_message)
            VALUES (?, 'RUNNING', ?, NULL, ?, ?, NULL)
            """,
            (scan_id, started_at, json.dumps(account_ids), json.dumps(account_meta)),
        )
        conn.commit()
    finally:
        conn.close()


def complete_scan_record(
    scan_id: str,
    finished_at: str,
    findings: list[dict[str, Any]],
    db_path: Optional[Path] = None,
) -> None:
    conn = get_connection(db_path)
    try:
        conn.executemany(
            """
            INSERT INTO findings (
                id, scan_id, check_id, title, provider, account_id,
                region, resource_id, status, severity, details,
                status_rank, severity_rank
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    f["id"],
                    scan_id,
                    f["check_id"],
                    f["title"],
                    f["provider"],
                    f["account_id"],
                    f.get("region"),
                    f.get("resource_id"),
                    f["status"],
                    f["severity"],
                    f["details"],
                    STATUS_RANK[f["status"]],
                    SEVERITY_RANK[f["severity"]],
                )
                for f in findings
            ],
        )
        conn.execute(
            "UPDATE scans SET status = 'COMPLETED', finished_at = ? WHERE id = ?",
            (finished_at, scan_id),
        )
        conn.commit()
    finally:
        conn.close()


def fail_scan_record(
    scan_id: str,
    finished_at: str,
    error_message: str,
    db_path: Optional[Path] = None,
) -> None:
    conn = get_connection(db_path)
    try:
        conn.execute(
            "UPDATE scans SET status = 'FAILED', finished_at = ?, error_message = ? WHERE id = ?",
            (finished_at, error_message, scan_id),
        )
        conn.commit()
    finally:
        conn.close()


def _status_counts_for_scan(conn: sqlite3.Connection, scan_id: str) -> dict[str, int]:
    counts = {"PASS": 0, "FAIL": 0, "CANNOT_SCAN": 0}
    rows = conn.execute(
        "SELECT status, COUNT(*) as cnt FROM findings WHERE scan_id = ? GROUP BY status",
        (scan_id,),
    ).fetchall()
    for r in rows:
        counts[r["status"]] = r["cnt"]
    return counts


def list_scans(db_path: Optional[Path] = None) -> list[dict[str, Any]]:
    conn = get_connection(db_path)
    try:
        rows = conn.execute(
            "SELECT * FROM scans ORDER BY started_at DESC, rowid DESC"
        ).fetchall()
        results = []
        for row in rows:
            counts = _status_counts_for_scan(conn, row["id"])
            score = (
                compute_score(counts["PASS"], counts["FAIL"])
                if row["status"] == "COMPLETED"
                else None
            )
            results.append(
                {
                    "id": row["id"],
                    "status": row["status"],
                    "started_at": row["started_at"],
                    "finished_at": row["finished_at"],
                    "account_ids": json.loads(row["account_ids_json"]),
                    "score": score,
                    "counts_by_status": counts,
                    "error_message": row["error_message"],
                }
            )
        return results
    finally:
        conn.close()


def get_scan_detail(scan_id: str, db_path: Optional[Path] = None) -> Optional[dict[str, Any]]:
    conn = get_connection(db_path)
    try:
        row = conn.execute("SELECT * FROM scans WHERE id = ?", (scan_id,)).fetchone()
        if not row:
            return None

        counts = _status_counts_for_scan(conn, scan_id)
        score = (
            compute_score(counts["PASS"], counts["FAIL"])
            if row["status"] == "COMPLETED"
            else None
        )

        fail_sev = {"CRITICAL": 0, "HIGH": 0, "MEDIUM": 0, "LOW": 0}
        sev_rows = conn.execute(
            """
            SELECT severity, COUNT(*) as cnt
            FROM findings
            WHERE scan_id = ? AND status = 'FAIL'
            GROUP BY severity
            """,
            (scan_id,),
        ).fetchall()
        for r in sev_rows:
            fail_sev[r["severity"]] = r["cnt"]

        account_meta = json.loads(row["account_meta_json"])
        acc_rows = conn.execute(
            """
            SELECT account_id, status, COUNT(*) as cnt
            FROM findings
            WHERE scan_id = ?
            GROUP BY account_id, status
            """,
            (scan_id,),
        ).fetchall()

        per_acc_counts: dict[str, dict[str, int]] = {}
        for r in acc_rows:
            per_acc_counts.setdefault(r["account_id"], {"PASS": 0, "FAIL": 0, "CANNOT_SCAN": 0})
            per_acc_counts[r["account_id"]][r["status"]] = r["cnt"]

        accounts_out = []
        for meta in account_meta:
            aid = meta["account_id"]
            ac = per_acc_counts.get(aid, {"PASS": 0, "FAIL": 0, "CANNOT_SCAN": 0})
            acc_score = (
                compute_score(ac["PASS"], ac["FAIL"])
                if row["status"] == "COMPLETED"
                else None
            )
            accounts_out.append(
                {
                    "account_id": aid,
                    "account_name": meta.get("name", aid),
                    "provider": meta.get("provider", "unknown"),
                    "score": acc_score,
                    "counts_by_status": ac,
                }
            )

        return {
            "id": row["id"],
            "status": row["status"],
            "started_at": row["started_at"],
            "finished_at": row["finished_at"],
            "account_ids": json.loads(row["account_ids_json"]),
            "score": score,
            "counts_by_status": counts,
            "fail_counts_by_severity": fail_sev,
            "accounts": accounts_out,
            "error_message": row["error_message"],
        }
    finally:
        conn.close()


def query_findings(
    scan_id: str,
    status: Optional[str] = None,
    severity: Optional[str] = None,
    provider: Optional[str] = None,
    account_id: Optional[str] = None,
    check_id: Optional[str] = None,
    page: int = 1,
    page_size: int = 25,
    db_path: Optional[Path] = None,
) -> Optional[dict[str, Any]]:
    conn = get_connection(db_path)
    try:
        scan_exists = conn.execute("SELECT 1 FROM scans WHERE id = ?", (scan_id,)).fetchone()
        if not scan_exists:
            return None

        clauses = ["scan_id = ?"]
        params: list[Any] = [scan_id]

        if status:
            clauses.append("LOWER(status) = LOWER(?)")
            params.append(status.strip())
        if severity:
            clauses.append("LOWER(severity) = LOWER(?)")
            params.append(severity.strip())
        if provider:
            clauses.append("LOWER(provider) = LOWER(?)")
            params.append(provider.strip())
        if account_id:
            clauses.append("LOWER(account_id) = LOWER(?)")
            params.append(account_id.strip())
        if check_id:
            clauses.append("LOWER(check_id) = LOWER(?)")
            params.append(check_id.strip())

        where_sql = " AND ".join(clauses)
        total = conn.execute(
            f"SELECT COUNT(*) as cnt FROM findings WHERE {where_sql}",
            params,
        ).fetchone()["cnt"]

        offset = (page - 1) * page_size
        rows = conn.execute(
            f"""
            SELECT id, scan_id, check_id, title, provider, account_id,
                   region, resource_id, status, severity, details
            FROM findings
            WHERE {where_sql}
            ORDER BY status_rank ASC, severity_rank ASC, check_id ASC, COALESCE(resource_id, '') ASC
            LIMIT ? OFFSET ?
            """,
            [*params, page_size, offset],
        ).fetchall()

        return {
            "items": [dict(r) for r in rows],
            "total": total,
            "page": page,
            "page_size": page_size,
        }
    finally:
        conn.close()
