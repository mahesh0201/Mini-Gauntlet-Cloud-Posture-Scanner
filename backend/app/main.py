from contextlib import asynccontextmanager
from datetime import datetime, timezone
import logging
from typing import Optional
import uuid

from fastapi import BackgroundTasks, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_db_path, get_inventory_path, get_worker_limit
from app.database import (
    complete_scan_record,
    create_scan_record,
    fail_scan_record,
    get_scan_detail,
    init_db,
    list_scans,
    query_findings,
)
from app.models import (
    CheckMetadata,
    FindingsPage,
    ScanCreateRequest,
    ScanDetail,
    ScanSummary,
)
import app.scanner.checks  # noqa: F401
from app.scanner.engine import load_inventory, run_snapshot_scan
from app.scanner.registry import registry

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger("mini_gauntlet.api")


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db(get_db_path())
    yield


app = FastAPI(
    title="Mini Gauntlet Posture Scanner API",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _execute_scan_background(scan_id: str, account_ids: list[str]) -> None:
    db_path = get_db_path()
    try:
        inventory_data = load_inventory(get_inventory_path())
        findings = run_snapshot_scan(
            inventory_data=inventory_data,
            selected_account_ids=account_ids,
            max_workers=get_worker_limit(),
        )
        complete_scan_record(
            scan_id=scan_id,
            finished_at=utc_now_iso(),
            findings=findings,
            db_path=db_path,
        )
        logger.info("Scan %s completed with %d findings.", scan_id, len(findings))
    except Exception as exc:
        logger.exception("Scan %s failed: %s", scan_id, exc)
        fail_scan_record(
            scan_id=scan_id,
            finished_at=utc_now_iso(),
            error_message=str(exc),
            db_path=db_path,
        )


@app.get("/api/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/checks", response_model=list[CheckMetadata])
def get_checks() -> list[CheckMetadata]:
    return [c.meta for c in registry.all_checks()]


@app.post("/api/scans", status_code=202, response_model=ScanSummary)
def start_scan(
    background_tasks: BackgroundTasks,
    payload: Optional[ScanCreateRequest] = None,
) -> ScanSummary:
    if payload is not None and payload.account_ids is not None and len(payload.account_ids) == 0:
        raise HTTPException(status_code=422, detail="account_ids cannot be an empty list.")

    try:
        inventory_data = load_inventory(get_inventory_path())
    except Exception as exc:
        # If inventory cannot be read at trigger time, still record a FAILED scan or validate accounts
        if payload and payload.account_ids:
            raise HTTPException(status_code=422, detail=f"Unable to validate account_ids: {exc}")
        scan_id = str(uuid.uuid4())
        now = utc_now_iso()
        create_scan_record(scan_id, now, [], [], db_path=get_db_path())
        background_tasks.add_task(_execute_scan_background, scan_id, [])
        return ScanSummary(
            id=scan_id,
            status="RUNNING",
            started_at=now,
            finished_at=None,
            account_ids=[],
            score=None,
            counts_by_status={"PASS": 0, "FAIL": 0, "CANNOT_SCAN": 0},
        )

    all_accounts = inventory_data.get("accounts", [])
    accounts_by_id = {
        str(acc.get("account_id")): acc for acc in all_accounts if acc.get("account_id")
    }

    if payload is not None and payload.account_ids is not None:
        # Preserve order while deduplicating
        requested_ids = list(dict.fromkeys(payload.account_ids))
        unknown = [aid for aid in requested_ids if aid not in accounts_by_id]
        if unknown:
            raise HTTPException(
                status_code=422,
                detail=f"Unknown account_id(s): {', '.join(unknown)}",
            )
        target_ids = requested_ids
    else:
        target_ids = list(accounts_by_id.keys())

    account_meta = [
        {
            "account_id": aid,
            "name": str(accounts_by_id[aid].get("name", aid)),
            "provider": str(accounts_by_id[aid].get("provider", "unknown")).lower(),
        }
        for aid in target_ids
    ]

    scan_id = str(uuid.uuid4())
    now = utc_now_iso()
    create_scan_record(
        scan_id=scan_id,
        started_at=now,
        account_ids=target_ids,
        account_meta=account_meta,
        db_path=get_db_path(),
    )
    background_tasks.add_task(_execute_scan_background, scan_id, target_ids)

    return ScanSummary(
        id=scan_id,
        status="RUNNING",
        started_at=now,
        finished_at=None,
        account_ids=target_ids,
        score=None,
        counts_by_status={"PASS": 0, "FAIL": 0, "CANNOT_SCAN": 0},
    )


@app.get("/api/scans", response_model=list[ScanSummary])
def get_scans() -> list[ScanSummary]:
    return list_scans(db_path=get_db_path())


@app.get("/api/scans/{scan_id}", response_model=ScanDetail)
def get_scan(scan_id: str) -> ScanDetail:
    detail = get_scan_detail(scan_id=scan_id, db_path=get_db_path())
    if detail is None:
        raise HTTPException(status_code=404, detail=f"Scan '{scan_id}' not found.")
    return detail


@app.get("/api/scans/{scan_id}/findings", response_model=FindingsPage)
def get_scan_findings(
    scan_id: str,
    status: Optional[str] = Query(default=None),
    severity: Optional[str] = Query(default=None),
    provider: Optional[str] = Query(default=None),
    account_id: Optional[str] = Query(default=None),
    check_id: Optional[str] = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
) -> FindingsPage:
    result = query_findings(
        scan_id=scan_id,
        status=status,
        severity=severity,
        provider=provider,
        account_id=account_id,
        check_id=check_id,
        page=page,
        page_size=page_size,
        db_path=get_db_path(),
    )
    if result is None:
        raise HTTPException(status_code=404, detail=f"Scan '{scan_id}' not found.")
    return result
