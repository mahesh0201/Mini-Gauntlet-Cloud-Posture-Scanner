from dataclasses import dataclass
from datetime import datetime
from typing import Any, Callable, Dict, List

from app.models import CheckMetadata, FindingResult, SeverityType

CheckFn = Callable[[dict[str, Any], datetime], FindingResult]


@dataclass(frozen=True)
class RegisteredCheck:
    meta: CheckMetadata
    fn: CheckFn


class CheckRegistry:
    def __init__(self) -> None:
        self._checks: Dict[str, RegisteredCheck] = {}

    def register(
        self,
        *,
        check_id: str,
        title: str,
        severity: SeverityType,
        provider: str,
        collection: str,
        resource_id_field: str,
    ) -> Callable[[CheckFn], CheckFn]:
        def decorator(fn: CheckFn) -> CheckFn:
            meta = CheckMetadata(
                check_id=check_id,
                title=title,
                severity=severity,
                provider=provider.lower(),
                collection=collection,
                resource_id_field=resource_id_field,
            )
            self._checks[check_id] = RegisteredCheck(meta=meta, fn=fn)
            return fn

        return decorator

    def all_checks(self) -> List[RegisteredCheck]:
        return list(self._checks.values())

    def checks_for_provider(self, provider: str) -> List[RegisteredCheck]:
        p = provider.lower()
        return [c for c in self._checks.values() if c.meta.provider == p]


registry = CheckRegistry()
