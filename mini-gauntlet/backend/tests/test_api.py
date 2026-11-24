import json
from pathlib import Path
import time

from fastapi.testclient import TestClient

from app.main import app


def _wait_for_scan(client: TestClient, scan_id: str, timeout: float = 8.0) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        res = client.get(f"/api/scans/{scan_id}")
        assert res.status_code == 200
        body = res.json()
        if body["status"] in {"COMPLETED", "FAILED"}:
            return body
        time.sleep(0.15)
    raise AssertionError("Scan did not complete in time")


def test_health_and_checks(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("DB_PATH", str(tmp_path / "test.db"))
    with TestClient(app) as client:
        h = client.get("/api/health")
        assert h.status_code == 200
        assert h.json() == {"status": "ok"}

        checks = client.get("/api/checks")
        assert checks.status_code == 200
        items = checks.json()
        assert len(items) == 10
        assert {c["check_id"] for c in items} == {
            "AWS-S3-01",
            "AWS-EC2-01",
            "AWS-IAM-01",
            "AWS-IAM-02",
            "AWS-RDS-01",
            "AZ-STG-01",
            "AZ-NSG-01",
            "GCP-GCS-01",
            "GCP-GCS-02",
            "GCP-VPC-01",
        }


def test_validation_422_and_404(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("DB_PATH", str(tmp_path / "test.db"))
    with TestClient(app) as client:
        r_empty = client.post("/api/scans", json={"account_ids": []})
        assert r_empty.status_code == 422

        r_unknown = client.post("/api/scans", json={"account_ids": ["non-existent-account"]})
        assert r_unknown.status_code == 422

        r_404 = client.get("/api/scans/does-not-exist")
        assert r_404.status_code == 404

        r_findings_404 = client.get("/api/scans/does-not-exist/findings")
        assert r_findings_404.status_code == 404


def test_scan_lifecycle_filtering_pagination_and_na_score(monkeypatch, tmp_path: Path):
    db_file = tmp_path / "persist.db"
    inv_file = tmp_path / "custom_inventory.json"
    inv_file.write_text(
        json.dumps(
            {
                "snapshot_taken_at": "2026-10-01T00:00:00Z",
                "accounts": [
                    {
                        "provider": "aws",
                        "account_id": "acc-na",
                        "name": "all-errors",
                        "simulated_latency_ms": 10,
                        "errors": {"s3_buckets": "AccessDenied"},
                        "resources": {},
                    },
                    {
                        "provider": "azure",
                        "account_id": "acc-az",
                        "name": "azure-main",
                        "simulated_latency_ms": 10,
                        "errors": {},
                        "resources": {
                            "storage_accounts": [
                                {"name": "stg1", "region": "eastus", "allow_blob_public_access": False},
                                {"name": "stg2", "region": "eastus", "allow_blob_public_access": True},
                            ]
                        },
                    },
                ],
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.setenv("DB_PATH", str(db_file))
    monkeypatch.setenv("INVENTORY_PATH", str(inv_file))

    with TestClient(app) as client:
        # 1. Account with only CANNOT_SCAN produces score None (N/A)
        res_na = client.post("/api/scans", json={"account_ids": ["acc-na"]})
        assert res_na.status_code == 202
        na_id = res_na.json()["id"]
        na_detail = _wait_for_scan(client, na_id)
        assert na_detail["status"] == "COMPLETED"
        assert na_detail["score"] is None
        assert na_detail["counts_by_status"]["CANNOT_SCAN"] == 1

        # 2. Full scan across both accounts
        res_full = client.post("/api/scans")
        assert res_full.status_code == 202
        full_id = res_full.json()["id"]
        full_detail = _wait_for_scan(client, full_id)
        assert full_detail["status"] == "COMPLETED"
        assert full_detail["score"] == 50.0  # 1 PASS, 1 FAIL, 1 CANNOT_SCAN

        # Case-insensitive filtering
        f_fail = client.get(f"/api/scans/{full_id}/findings?status=fail&provider=AZURE")
        assert f_fail.status_code == 200
        body_fail = f_fail.json()
        assert body_fail["total"] == 1
        assert body_fail["items"][0]["resource_id"] == "stg2"

        # Ordering check: FAIL -> CANNOT_SCAN -> PASS
        f_all = client.get(f"/api/scans/{full_id}/findings?page=1&page_size=2")
        assert f_all.status_code == 200
        page1 = f_all.json()
        assert page1["total"] == 3
        assert len(page1["items"]) == 2
        assert [i["status"] for i in page1["items"]] == ["FAIL", "CANNOT_SCAN"]

        # List scans newest first
        scans_list = client.get("/api/scans").json()
        assert len(scans_list) == 2
        assert scans_list[0]["id"] == full_id
