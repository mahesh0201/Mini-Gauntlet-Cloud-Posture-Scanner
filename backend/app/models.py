from typing import Literal, Optional

from pydantic import BaseModel

StatusType = Literal["PASS", "FAIL", "CANNOT_SCAN"]
SeverityType = Literal["CRITICAL", "HIGH", "MEDIUM", "LOW"]
ScanStatusType = Literal["RUNNING", "COMPLETED", "FAILED"]


class CheckMetadata(BaseModel):
    check_id: str
    title: str
    severity: SeverityType
    provider: str
    collection: str
    resource_id_field: str


class FindingResult(BaseModel):
    status: StatusType
    details: str


class FindingOut(BaseModel):
    id: str
    scan_id: str
    check_id: str
    title: str
    provider: str
    account_id: str
    region: Optional[str] = None
    resource_id: Optional[str] = None
    status: StatusType
    severity: SeverityType
    details: str


class ScanCreateRequest(BaseModel):
    account_ids: Optional[list[str]] = None


class StatusCounts(BaseModel):
    PASS: int = 0
    FAIL: int = 0
    CANNOT_SCAN: int = 0


class SeverityCounts(BaseModel):
    CRITICAL: int = 0
    HIGH: int = 0
    MEDIUM: int = 0
    LOW: int = 0


class AccountScore(BaseModel):
    account_id: str
    account_name: str
    provider: str
    score: Optional[float]
    counts_by_status: StatusCounts


class ScanSummary(BaseModel):
    id: str
    status: ScanStatusType
    started_at: str
    finished_at: Optional[str] = None
    account_ids: list[str]
    score: Optional[float] = None
    counts_by_status: StatusCounts
    error_message: Optional[str] = None


class ScanDetail(ScanSummary):
    fail_counts_by_severity: SeverityCounts
    accounts: list[AccountScore]


class FindingsPage(BaseModel):
    items: list[FindingOut]
    total: int
    page: int
    page_size: int
