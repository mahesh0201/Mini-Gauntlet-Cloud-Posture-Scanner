import json
import logging
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import app.scanner.checks  # noqa: F401  # Ensures all checks register at import time
from app.scanner.registry import registry

logger = logging.getLogger("mini_gauntlet.scanner")


def load_inventory(inventory_path: Path) -> dict[str, Any]:
    if not inventory_path.exists():
        raise FileNotFoundError(f"Inventory file not found at {inventory_path}")
    with inventory_path.open("r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise ValueError("Inventory root must be a JSON object")
    if "snapshot_taken_at" not in data or not isinstance(data.get("accounts"), list):
        raise ValueError("Inventory must contain 'snapshot_taken_at' and 'accounts' list")
    return data


def _parse_snapshot_time(raw: Any) -> datetime:
    if not isinstance(raw, str) or not raw.strip():
        raise ValueError("snapshot_taken_at must be a non-empty ISO-8601 string")
    text = raw.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    dt = datetime.fromisoformat(text)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def scan_account(account: dict[str, Any], snapshot_at: datetime) -> list[dict[str, Any]]:
    latency_ms = account.get("simulated_latency_ms", 0)
    if isinstance(latency_ms, (int, float)) and latency_ms > 0:
        time.sleep(latency_ms / 1000.0)

    provider = str(account.get("provider", "")).lower()
    account_id = str(account.get("account_id", "unknown"))
    errors = account.get("errors") if isinstance(account.get("errors"), dict) else {}
    resources = account.get("resources") if isinstance(account.get("resources"), dict) else {}

    findings: list[dict[str, Any]] = []
    checks = registry.checks_for_provider(provider)

    for reg_check in checks:
        meta = reg_check.meta
        collection = meta.collection

        # Rule 1: collection listed in errors -> one CANNOT_SCAN finding per check
        # with no resource_id
        if collection in errors:
            err_code = str(errors[collection])
            logger.warning(
                "Account %s (%s) reported collection error on %s: %s",
                account_id,
                provider,
                collection,
                err_code,
            )
            findings.append(
                {
                    "id": str(uuid.uuid4()),
                    "check_id": meta.check_id,
                    "title": meta.title,
                    "provider": provider,
                    "account_id": account_id,
                    "region": None,
                    "resource_id": None,
                    "status": "CANNOT_SCAN",
                    "severity": meta.severity,
                    "details": f"Collection '{collection}' could not be read: {err_code}",
                }
            )
            continue

        # Rule 2: collection missing from both resources and errors -> produces no findings
        if collection not in resources:
            continue

        items = resources.get(collection)
        if not isinstance(items, list):
            logger.warning(
                "Account %s (%s) collection %s is not a list; recording CANNOT_SCAN",
                account_id,
                provider,
                collection,
            )
            findings.append(
                {
                    "id": str(uuid.uuid4()),
                    "check_id": meta.check_id,
                    "title": meta.title,
                    "provider": provider,
                    "account_id": account_id,
                    "region": None,
                    "resource_id": None,
                    "status": "CANNOT_SCAN",
                    "severity": meta.severity,
                    "details": (
                        f"Malformed collection '{collection}': expected a list of resources."
                    ),
                }
            )
            continue

        for idx, item in enumerate(items):
            if not isinstance(item, dict):
                logger.warning(
                    "Malformed resource at %s.%s[%d] in account %s",
                    provider,
                    collection,
                    idx,
                    account_id,
                )
                findings.append(
                    {
                        "id": str(uuid.uuid4()),
                        "check_id": meta.check_id,
                        "title": meta.title,
                        "provider": provider,
                        "account_id": account_id,
                        "region": None,
                        "resource_id": None,
                        "status": "CANNOT_SCAN",
                        "severity": meta.severity,
                        "details": (
                            f"Malformed resource entry at index {idx}: expected JSON object."
                        ),
                    }
                )
                continue

            raw_rid = item.get(meta.resource_id_field)
            resource_id = str(raw_rid) if raw_rid is not None else None
            raw_region = item.get("region")
            region = str(raw_region) if raw_region is not None else None

            if not resource_id:
                logger.warning(
                    "Missing resource ID '%s' on %s.%s[%d] in account %s",
                    meta.resource_id_field,
                    provider,
                    collection,
                    idx,
                    account_id,
                )
                findings.append(
                    {
                        "id": str(uuid.uuid4()),
                        "check_id": meta.check_id,
                        "title": meta.title,
                        "provider": provider,
                        "account_id": account_id,
                        "region": region,
                        "resource_id": None,
                        "status": "CANNOT_SCAN",
                        "severity": meta.severity,
                        "details": (
                            f"Missing required resource identifier '{meta.resource_id_field}'."
                        ),
                    }
                )
                continue

            try:
                res = reg_check.fn(item, snapshot_at)
                if res.status == "CANNOT_SCAN":
                    logger.warning(
                        "CANNOT_SCAN on %s for %s/%s: %s",
                        meta.check_id,
                        account_id,
                        resource_id,
                        res.details,
                    )
                findings.append(
                    {
                        "id": str(uuid.uuid4()),
                        "check_id": meta.check_id,
                        "title": meta.title,
                        "provider": provider,
                        "account_id": account_id,
                        "region": region,
                        "resource_id": resource_id,
                        "status": res.status,
                        "severity": meta.severity,
                        "details": res.details,
                    }
                )
            except Exception as exc:
                logger.warning(
                    "Unhandled check error on %s for %s/%s: %s",
                    meta.check_id,
                    account_id,
                    resource_id,
                    exc,
                )
                findings.append(
                    {
                        "id": str(uuid.uuid4()),
                        "check_id": meta.check_id,
                        "title": meta.title,
                        "provider": provider,
                        "account_id": account_id,
                        "region": region,
                        "resource_id": resource_id,
                        "status": "CANNOT_SCAN",
                        "severity": meta.severity,
                        "details": f"Check evaluation failed due to malformed record: {exc}",
                    }
                )

    return findings


def run_snapshot_scan(
    inventory_data: dict[str, Any],
    selected_account_ids: Optional[list[str]] = None,
    max_workers: int = 4,
) -> list[dict[str, Any]]:
    snapshot_at = _parse_snapshot_time(inventory_data.get("snapshot_taken_at"))
    accounts = inventory_data.get("accounts", [])
    if selected_account_ids is not None:
        wanted = set(selected_account_ids)
        accounts = [a for a in accounts if a.get("account_id") in wanted]

    all_findings: list[dict[str, Any]] = []
    workers = max(1, min(max_workers, max(1, len(accounts))))

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(scan_account, acc, snapshot_at) for acc in accounts]
        for fut in as_completed(futures):
            all_findings.extend(fut.result())

    return all_findings
