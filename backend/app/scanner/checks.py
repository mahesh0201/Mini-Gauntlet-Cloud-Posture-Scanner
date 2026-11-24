from datetime import datetime, timezone
from typing import Any

from app.models import FindingResult
from app.scanner.registry import registry

SENSITIVE_PORTS = {22, 3389}
PUBLIC_CIDRS = {"0.0.0.0/0", "::/0"}
AZURE_PUBLIC_SOURCES = {"*", "internet", "any", "0.0.0.0/0", "::/0"}


def _parse_iso_utc(raw: Any) -> datetime:
    if not isinstance(raw, str) or not raw.strip():
        raise ValueError("Timestamp must be a non-empty ISO-8601 string")
    text = raw.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    dt = datetime.fromisoformat(text)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _port_range_exposes_sensitive(from_port: Any, to_port: Any) -> list[int]:
    if isinstance(from_port, bool) or isinstance(to_port, bool):
        raise ValueError("Boolean is not a valid port")
    if not isinstance(from_port, int) or not isinstance(to_port, int):
        raise ValueError(f"Ports must be integers, got {from_port!r}..{to_port!r}")
    if from_port < 0 or to_port > 65535 or from_port > to_port:
        raise ValueError(f"Invalid port range {from_port}..{to_port}")
    return [p for p in sorted(SENSITIVE_PORTS) if from_port <= p <= to_port]


def _parse_port_spec(spec: Any) -> list[int]:
    if isinstance(spec, bool):
        raise ValueError("Boolean is not a valid port specification")
    if isinstance(spec, int):
        return _port_range_exposes_sensitive(spec, spec)
    if not isinstance(spec, str) or not spec.strip():
        raise ValueError(f"Invalid port specification: {spec!r}")
    s = spec.strip()
    if s == "*":
        return sorted(SENSITIVE_PORTS)
    if "-" in s:
        parts = s.split("-")
        if len(parts) != 2:
            raise ValueError(f"Invalid port range string: {spec!r}")
        start = int(parts[0].strip())
        end = int(parts[1].strip())
        return _port_range_exposes_sensitive(start, end)
    port = int(s)
    return _port_range_exposes_sensitive(port, port)


@registry.register(
    check_id="AWS-S3-01",
    title="S3 bucket blocks public access",
    severity="HIGH",
    provider="aws",
    collection="s3_buckets",
    resource_id_field="name",
)
def check_aws_s3_01(resource: dict[str, Any], snapshot_at: datetime) -> FindingResult:
    pab = resource.get("public_access_block")
    if pab is None:
        return FindingResult(
            status="FAIL",
            details=(
                "Public access block configuration is missing (null); "
                "bucket allows public access settings."
            ),
        )
    if not isinstance(pab, dict):
        return FindingResult(
            status="CANNOT_SCAN",
            details="Malformed public_access_block: expected an object or null.",
        )

    required_flags = [
        "block_public_acls",
        "ignore_public_acls",
        "block_public_policy",
        "restrict_public_buckets",
    ]
    disabled: list[str] = []
    for flag in required_flags:
        val = pab.get(flag)
        if not isinstance(val, bool):
            return FindingResult(
                status="CANNOT_SCAN",
                details=f"Malformed public_access_block.{flag}: expected boolean, got {val!r}.",
            )
        if not val:
            disabled.append(flag)

    if disabled:
        return FindingResult(
            status="FAIL",
            details=f"Public access block disabled for: {', '.join(disabled)}.",
        )
    return FindingResult(
        status="PASS",
        details="All four S3 Block Public Access settings are enabled.",
    )


@registry.register(
    check_id="AWS-EC2-01",
    title="Security group doesn't expose SSH or RDP to the internet",
    severity="CRITICAL",
    provider="aws",
    collection="security_groups",
    resource_id_field="group_id",
)
def check_aws_ec2_01(resource: dict[str, Any], snapshot_at: datetime) -> FindingResult:
    ingress = resource.get("ingress")
    if not isinstance(ingress, list):
        return FindingResult(
            status="CANNOT_SCAN",
            details="Malformed security group ingress rules: expected a list.",
        )

    violations: list[str] = []
    for idx, rule in enumerate(ingress):
        if not isinstance(rule, dict):
            return FindingResult(
                status="CANNOT_SCAN",
                details=f"Malformed ingress rule at index {idx}: expected an object.",
            )

        protocol = rule.get("protocol")
        if protocol is None or not isinstance(protocol, (str, int)):
            return FindingResult(
                status="CANNOT_SCAN",
                details=f"Malformed protocol in ingress rule {idx}: {protocol!r}.",
            )
        proto_str = str(protocol).strip().lower()

        cidrs = rule.get("cidrs")
        if not isinstance(cidrs, list) or not all(isinstance(c, str) for c in cidrs):
            return FindingResult(
                status="CANNOT_SCAN",
                details=f"Malformed cidrs in ingress rule {idx}: expected list of strings.",
            )

        exposed_cidrs = [c.strip() for c in cidrs if c.strip() in PUBLIC_CIDRS]
        from_port = rule.get("from_port")
        to_port = rule.get("to_port")

        # Validate ports even if CIDR isn't public so corrupt records are caught reliably
        if proto_str in {"-1", "all"}:
            exposed_ports = sorted(SENSITIVE_PORTS)
            port_label = "all ports (protocol -1)"
        elif proto_str in {"tcp", "6"}:
            try:
                exposed_ports = _port_range_exposes_sensitive(from_port, to_port)
            except ValueError as exc:
                return FindingResult(
                    status="CANNOT_SCAN",
                    details=f"Malformed port range in ingress rule {idx}: {exc}.",
                )
            port_label = f"{from_port}" if from_port == to_port else f"{from_port}-{to_port}"
        else:
            # Other protocols (e.g., UDP 53, ICMP) do not expose TCP SSH/RDP,
            # but still validate numeric ports if present
            if from_port is not None or to_port is not None:
                try:
                    _port_range_exposes_sensitive(from_port, to_port)
                except ValueError as exc:
                    return FindingResult(
                        status="CANNOT_SCAN",
                        details=f"Malformed port range in ingress rule {idx}: {exc}.",
                    )
            continue

        if exposed_cidrs and exposed_ports:
            ports_txt = "/".join(str(p) for p in exposed_ports)
            cidrs_txt = ", ".join(exposed_cidrs)
            violations.append(
                f"Ingress rule {idx} (protocol={proto_str}, ports={port_label}) "
                f"exposes port {ports_txt} to {cidrs_txt}"
            )

    if violations:
        return FindingResult(status="FAIL", details="; ".join(violations) + ".")
    return FindingResult(
        status="PASS",
        details="No ingress rule exposes SSH (22) or RDP (3389) to 0.0.0.0/0 or ::/0.",
    )


@registry.register(
    check_id="AWS-IAM-01",
    title="Console users have MFA",
    severity="HIGH",
    provider="aws",
    collection="iam_users",
    resource_id_field="user_name",
)
def check_aws_iam_01(resource: dict[str, Any], snapshot_at: datetime) -> FindingResult:
    console_access = resource.get("console_access")
    mfa_enabled = resource.get("mfa_enabled")
    if not isinstance(console_access, bool) or not isinstance(mfa_enabled, bool):
        return FindingResult(
            status="CANNOT_SCAN",
            details="Malformed IAM user fields: console_access and mfa_enabled must be booleans.",
        )

    if console_access and not mfa_enabled:
        return FindingResult(
            status="FAIL",
            details="IAM user has console_access enabled without MFA (mfa_enabled=false).",
        )
    if not console_access:
        return FindingResult(
            status="PASS",
            details="IAM user does not have console access enabled.",
        )
    return FindingResult(
        status="PASS",
        details="IAM user has console access enabled with MFA active.",
    )


@registry.register(
    check_id="AWS-IAM-02",
    title="No active access key is older than 90 days",
    severity="MEDIUM",
    provider="aws",
    collection="iam_users",
    resource_id_field="user_name",
)
def check_aws_iam_02(resource: dict[str, Any], snapshot_at: datetime) -> FindingResult:
    keys = resource.get("access_keys")
    if not isinstance(keys, list):
        return FindingResult(
            status="CANNOT_SCAN",
            details="Malformed access_keys field: expected a list.",
        )

    old_keys: list[str] = []
    for idx, key in enumerate(keys):
        if not isinstance(key, dict):
            return FindingResult(
                status="CANNOT_SCAN",
                details=f"Malformed access key entry at index {idx}: expected object.",
            )
        status = key.get("status")
        key_id = key.get("key_id", f"index-{idx}")
        created_raw = key.get("created_at")
        if not isinstance(status, str):
            return FindingResult(
                status="CANNOT_SCAN",
                details=f"Malformed status on access key {key_id}: expected string.",
            )
        try:
            created_at = _parse_iso_utc(created_raw)
        except ValueError as exc:
            return FindingResult(
                status="CANNOT_SCAN",
                details=f"Malformed created_at on access key {key_id}: {exc}.",
            )

        if status.strip().lower() == "active":
            age_seconds = (snapshot_at - created_at).total_seconds()
            age_days = age_seconds / 86400.0
            if age_days > 90:
                old_keys.append(
                    f"key {key_id} created {created_raw} ({int(age_days)} days old at snapshot)"
                )

    if old_keys:
        return FindingResult(
            status="FAIL",
            details=f"Active access key(s) exceed 90 days: {'; '.join(old_keys)}.",
        )
    return FindingResult(
        status="PASS",
        details="No active IAM access keys are older than 90 days.",
    )


@registry.register(
    check_id="AWS-RDS-01",
    title="RDS instance isn't publicly accessible",
    severity="HIGH",
    provider="aws",
    collection="rds_instances",
    resource_id_field="db_instance_id",
)
def check_aws_rds_01(resource: dict[str, Any], snapshot_at: datetime) -> FindingResult:
    publicly_accessible = resource.get("publicly_accessible")
    if not isinstance(publicly_accessible, bool):
        return FindingResult(
            status="CANNOT_SCAN",
            details="Malformed publicly_accessible field: expected boolean.",
        )
    if publicly_accessible:
        return FindingResult(
            status="FAIL",
            details="RDS instance has publicly_accessible=true.",
        )
    return FindingResult(
        status="PASS",
        details="RDS instance is private (publicly_accessible=false).",
    )


@registry.register(
    check_id="AZ-STG-01",
    title="Storage account blocks public blob access",
    severity="HIGH",
    provider="azure",
    collection="storage_accounts",
    resource_id_field="name",
)
def check_az_stg_01(resource: dict[str, Any], snapshot_at: datetime) -> FindingResult:
    allow_public = resource.get("allow_blob_public_access")
    if not isinstance(allow_public, bool):
        return FindingResult(
            status="CANNOT_SCAN",
            details="Malformed allow_blob_public_access field: expected boolean.",
        )
    if allow_public:
        return FindingResult(
            status="FAIL",
            details="Storage account has allow_blob_public_access=true.",
        )
    return FindingResult(
        status="PASS",
        details="Storage account disables public blob access (allow_blob_public_access=false).",
    )


@registry.register(
    check_id="AZ-NSG-01",
    title="NSG doesn't expose SSH or RDP to the internet",
    severity="CRITICAL",
    provider="azure",
    collection="network_security_groups",
    resource_id_field="name",
)
def check_az_nsg_01(resource: dict[str, Any], snapshot_at: datetime) -> FindingResult:
    rules = resource.get("rules")
    if not isinstance(rules, list):
        return FindingResult(
            status="CANNOT_SCAN",
            details="Malformed NSG rules field: expected a list.",
        )

    violations: list[str] = []
    for idx, rule in enumerate(rules):
        if not isinstance(rule, dict):
            return FindingResult(
                status="CANNOT_SCAN",
                details=f"Malformed NSG rule at index {idx}: expected object.",
            )

        rule_name = str(rule.get("name", f"rule-{idx}"))
        direction = rule.get("direction")
        access = rule.get("access")
        protocol = rule.get("protocol")
        source = rule.get("source")
        dest_ports = rule.get("destination_ports")

        if not all(isinstance(v, str) for v in (direction, access, protocol, source)):
            return FindingResult(
                status="CANNOT_SCAN",
                details=f"Malformed string fields in NSG rule '{rule_name}'.",
            )

        try:
            exposed_ports = _parse_port_spec(dest_ports)
        except ValueError as exc:
            return FindingResult(
                status="CANNOT_SCAN",
                details=f"Malformed destination_ports in NSG rule '{rule_name}': {exc}.",
            )

        if direction.strip().lower() != "inbound":
            continue
        if access.strip().lower() != "allow":
            continue
        if protocol.strip().lower() not in {"tcp", "*"}:
            continue
        if source.strip().lower() not in AZURE_PUBLIC_SOURCES:
            continue

        if exposed_ports:
            ports_txt = "/".join(str(p) for p in exposed_ports)
            violations.append(
                f"Inbound Allow rule '{rule_name}' "
                f"(protocol={protocol}, ports={dest_ports}, source={source}) "
                f"exposes port {ports_txt}"
            )

    if violations:
        return FindingResult(status="FAIL", details="; ".join(violations) + ".")
    return FindingResult(
        status="PASS",
        details="No inbound Allow NSG rule exposes SSH (22) or RDP (3389) to the internet.",
    )


@registry.register(
    check_id="GCP-GCS-01",
    title="Bucket isn't public",
    severity="HIGH",
    provider="gcp",
    collection="gcs_buckets",
    resource_id_field="name",
)
def check_gcp_gcs_01(resource: dict[str, Any], snapshot_at: datetime) -> FindingResult:
    bindings = resource.get("iam_bindings")
    if not isinstance(bindings, list):
        return FindingResult(
            status="CANNOT_SCAN",
            details="Malformed iam_bindings field: expected a list.",
        )

    public_principals = {"allusers", "allauthenticatedusers"}
    violations: list[str] = []
    for idx, binding in enumerate(bindings):
        if not isinstance(binding, dict):
            return FindingResult(
                status="CANNOT_SCAN",
                details=f"Malformed IAM binding at index {idx}: expected object.",
            )
        role = binding.get("role", "unknown-role")
        members = binding.get("members")
        if not isinstance(members, list) or not all(isinstance(m, str) for m in members):
            return FindingResult(
                status="CANNOT_SCAN",
                details=f"Malformed members in IAM binding {idx}: expected list of strings.",
            )
        exposed = [m for m in members if m.strip().lower() in public_principals]
        if exposed:
            violations.append(f"role '{role}' granted to {', '.join(exposed)}")

    if violations:
        return FindingResult(
            status="FAIL",
            details=f"Bucket IAM policy allows public access: {'; '.join(violations)}.",
        )
    return FindingResult(
        status="PASS",
        details="Bucket IAM bindings do not grant access to allUsers or allAuthenticatedUsers.",
    )


@registry.register(
    check_id="GCP-GCS-02",
    title="Bucket uses uniform bucket-level access",
    severity="LOW",
    provider="gcp",
    collection="gcs_buckets",
    resource_id_field="name",
)
def check_gcp_gcs_02(resource: dict[str, Any], snapshot_at: datetime) -> FindingResult:
    ubla = resource.get("uniform_bucket_level_access")
    if not isinstance(ubla, bool):
        return FindingResult(
            status="CANNOT_SCAN",
            details="Malformed uniform_bucket_level_access field: expected boolean.",
        )
    if not ubla:
        return FindingResult(
            status="FAIL",
            details="Bucket has uniform_bucket_level_access=false (fine-grained ACLs enabled).",
        )
    return FindingResult(
        status="PASS",
        details="Bucket enforces uniform bucket-level access (uniform_bucket_level_access=true).",
    )


@registry.register(
    check_id="GCP-VPC-01",
    title="Firewall rule doesn't expose SSH or RDP to the internet",
    severity="CRITICAL",
    provider="gcp",
    collection="firewall_rules",
    resource_id_field="name",
)
def check_gcp_vpc_01(resource: dict[str, Any], snapshot_at: datetime) -> FindingResult:
    direction = resource.get("direction")
    disabled = resource.get("disabled")
    allowed = resource.get("allowed")

    if (
        not isinstance(direction, str)
        or not isinstance(disabled, bool)
        or not isinstance(allowed, list)
    ):
        return FindingResult(
            status="CANNOT_SCAN",
            details=(
                "Malformed firewall rule fields: "
                "direction (str), disabled (bool), allowed (list) required."
            ),
        )

    # Validate allowed entries even on disabled/egress rules so corrupt configs
    # still surface CANNOT_SCAN
    exposed_ports_found: list[int] = []
    matched_protos: list[str] = []
    for idx, entry in enumerate(allowed):
        if not isinstance(entry, dict):
            return FindingResult(
                status="CANNOT_SCAN",
                details=f"Malformed allowed entry at index {idx}: expected object.",
            )
        proto = entry.get("IPProtocol")
        if not isinstance(proto, str) or not proto.strip():
            return FindingResult(
                status="CANNOT_SCAN",
                details=f"Malformed IPProtocol in allowed entry {idx}: {proto!r}.",
            )
        proto_norm = proto.strip().lower()
        ports = entry.get("ports")
        if proto_norm == "all":
            exposed_ports_found.extend(sorted(SENSITIVE_PORTS))
            matched_protos.append("all")
        elif proto_norm in {"tcp", "6"}:
            if ports is None:
                exposed_ports_found.extend(sorted(SENSITIVE_PORTS))
                matched_protos.append("tcp:all")
            elif isinstance(ports, list):
                for p_spec in ports:
                    try:
                        hits = _parse_port_spec(p_spec)
                    except ValueError as exc:
                        return FindingResult(
                            status="CANNOT_SCAN",
                            details=f"Malformed port '{p_spec}' in firewall rule: {exc}.",
                        )
                    if hits:
                        exposed_ports_found.extend(hits)
                        matched_protos.append(f"tcp:{p_spec}")
            else:
                return FindingResult(
                    status="CANNOT_SCAN",
                    details=f"Malformed ports list in allowed entry {idx}: expected list.",
                )

    if disabled:
        return FindingResult(
            status="PASS",
            details="Firewall rule is disabled (disabled=true).",
        )

    if direction.strip().upper() != "INGRESS":
        return FindingResult(
            status="PASS",
            details=f"Firewall rule direction is {direction} (not INGRESS).",
        )

    source_ranges = resource.get("source_ranges")
    if not isinstance(source_ranges, list) or not all(isinstance(s, str) for s in source_ranges):
        return FindingResult(
            status="CANNOT_SCAN",
            details="Malformed source_ranges on INGRESS firewall rule: expected list of strings.",
        )

    public_sources = [s.strip() for s in source_ranges if s.strip() in PUBLIC_CIDRS]
    unique_ports = sorted(set(exposed_ports_found))
    if public_sources and unique_ports:
        ports_txt = "/".join(str(p) for p in unique_ports)
        rule_name = resource.get("name", "unnamed-rule")
        return FindingResult(
            status="FAIL",
            details=(
                f"Enabled INGRESS rule '{rule_name}' ({', '.join(matched_protos)}) "
                f"exposes port {ports_txt} to {', '.join(public_sources)}."
            ),
        )

    return FindingResult(
        status="PASS",
        details="Firewall rule does not expose SSH (22) or RDP (3389) to 0.0.0.0/0 or ::/0.",
    )
