import time
from datetime import datetime, timezone
from pathlib import Path

from app.scanner.checks import (
    check_aws_ec2_01,
    check_aws_iam_01,
    check_aws_iam_02,
    check_aws_rds_01,
    check_aws_s3_01,
    check_az_nsg_01,
    check_az_stg_01,
    check_gcp_gcs_01,
    check_gcp_gcs_02,
    check_gcp_vpc_01,
)
from app.scanner.engine import load_inventory, run_snapshot_scan

SNAPSHOT_AT = datetime(2026, 10, 1, 0, 0, 0, tzinfo=timezone.utc)


def test_aws_s3_01_pass_fail_cannot_scan():
    assert (
        check_aws_s3_01(
            {
                "name": "ok",
                "public_access_block": {
                    "block_public_acls": True,
                    "ignore_public_acls": True,
                    "block_public_policy": True,
                    "restrict_public_buckets": True,
                },
            },
            SNAPSHOT_AT,
        ).status
        == "PASS"
    )

    fail_null = check_aws_s3_01({"name": "open", "public_access_block": None}, SNAPSHOT_AT)
    assert fail_null.status == "FAIL"

    fail_partial = check_aws_s3_01(
        {
            "name": "partial",
            "public_access_block": {
                "block_public_acls": False,
                "ignore_public_acls": True,
                "block_public_policy": True,
                "restrict_public_buckets": True,
            },
        },
        SNAPSHOT_AT,
    )
    assert fail_partial.status == "FAIL"
    assert "block_public_acls" in fail_partial.details

    bad = check_aws_s3_01({"name": "bad", "public_access_block": "invalid"}, SNAPSHOT_AT)
    assert bad.status == "CANNOT_SCAN"


def test_aws_ec2_01_edge_cases():
    # PASS: HTTPS only
    assert (
        check_aws_ec2_01(
            {
                "group_id": "sg-1",
                "ingress": [
                    {"protocol": "tcp", "from_port": 443, "to_port": 443, "cidrs": ["0.0.0.0/0"]}
                ],
            },
            SNAPSHOT_AT,
        ).status
        == "PASS"
    )

    # FAIL: IPv6 ::/0 SSH
    fail_ipv6 = check_aws_ec2_01(
        {
            "group_id": "sg-2",
            "ingress": [{"protocol": "tcp", "from_port": 22, "to_port": 22, "cidrs": ["::/0"]}],
        },
        SNAPSHOT_AT,
    )
    assert fail_ipv6.status == "FAIL"
    assert "::/0" in fail_ipv6.details

    # FAIL: Port range covering RDP 3389
    fail_range = check_aws_ec2_01(
        {
            "group_id": "sg-3",
            "ingress": [
                {"protocol": "tcp", "from_port": 3000, "to_port": 3500, "cidrs": ["0.0.0.0/0"]}
            ],
        },
        SNAPSHOT_AT,
    )
    assert fail_range.status == "FAIL"
    assert "3389" in fail_range.details

    # FAIL: Protocol -1 all traffic
    fail_all = check_aws_ec2_01(
        {
            "group_id": "sg-4",
            "ingress": [
                {"protocol": "-1", "from_port": None, "to_port": None, "cidrs": ["0.0.0.0/0"]}
            ],
        },
        SNAPSHOT_AT,
    )
    assert fail_all.status == "FAIL"

    # CANNOT_SCAN: Non-numeric port
    bad = check_aws_ec2_01(
        {
            "group_id": "sg-bad",
            "ingress": [
                {
                    "protocol": "tcp",
                    "from_port": "twenty-two",
                    "to_port": 22,
                    "cidrs": ["0.0.0.0/0"],
                }
            ],
        },
        SNAPSHOT_AT,
    )
    assert bad.status == "CANNOT_SCAN"


def test_aws_iam_01_mfa():
    assert (
        check_aws_iam_01(
            {"user_name": "alice", "console_access": True, "mfa_enabled": True}, SNAPSHOT_AT
        ).status
        == "PASS"
    )
    assert (
        check_aws_iam_01(
            {"user_name": "bot", "console_access": False, "mfa_enabled": False}, SNAPSHOT_AT
        ).status
        == "PASS"
    )
    assert (
        check_aws_iam_01(
            {"user_name": "bob", "console_access": True, "mfa_enabled": False}, SNAPSHOT_AT
        ).status
        == "FAIL"
    )
    assert (
        check_aws_iam_01(
            {"user_name": "bad", "console_access": "yes", "mfa_enabled": False}, SNAPSHOT_AT
        ).status
        == "CANNOT_SCAN"
    )


def test_aws_iam_02_exact_90_days():
    # Snapshot is 2026-10-01T00:00:00Z. 90 days earlier is 2026-07-03T00:00:00Z -> PASS
    exact_90 = check_aws_iam_02(
        {
            "user_name": "ci-deployer",
            "access_keys": [
                {"key_id": "k1", "status": "Active", "created_at": "2026-07-03T00:00:00Z"}
            ],
        },
        SNAPSHOT_AT,
    )
    assert exact_90.status == "PASS"

    # 91 days earlier -> FAIL
    day_91 = check_aws_iam_02(
        {
            "user_name": "reporting-bot",
            "access_keys": [
                {"key_id": "k2", "status": "Active", "created_at": "2026-07-02T00:00:00Z"}
            ],
        },
        SNAPSHOT_AT,
    )
    assert day_91.status == "FAIL"
    assert "k2" in day_91.details

    # Inactive old key -> PASS
    inactive = check_aws_iam_02(
        {
            "user_name": "former",
            "access_keys": [
                {"key_id": "k3", "status": "Inactive", "created_at": "2023-01-01T00:00:00Z"}
            ],
        },
        SNAPSHOT_AT,
    )
    assert inactive.status == "PASS"

    # Malformed date -> CANNOT_SCAN
    bad_date = check_aws_iam_02(
        {
            "user_name": "corrupt",
            "access_keys": [{"key_id": "k4", "status": "Active", "created_at": "not-a-date"}],
        },
        SNAPSHOT_AT,
    )
    assert bad_date.status == "CANNOT_SCAN"


def test_aws_rds_01():
    assert (
        check_aws_rds_01(
            {"db_instance_id": "db1", "publicly_accessible": False}, SNAPSHOT_AT
        ).status
        == "PASS"
    )
    assert (
        check_aws_rds_01({"db_instance_id": "db2", "publicly_accessible": True}, SNAPSHOT_AT).status
        == "FAIL"
    )
    assert (
        check_aws_rds_01({"db_instance_id": "db3", "publicly_accessible": "no"}, SNAPSHOT_AT).status
        == "CANNOT_SCAN"
    )


def test_az_stg_01():
    assert (
        check_az_stg_01({"name": "s1", "allow_blob_public_access": False}, SNAPSHOT_AT).status
        == "PASS"
    )
    assert (
        check_az_stg_01({"name": "s2", "allow_blob_public_access": True}, SNAPSHOT_AT).status
        == "FAIL"
    )
    assert check_az_stg_01({"name": "s3"}, SNAPSHOT_AT).status == "CANNOT_SCAN"


def test_az_nsg_01_deny_outbound_and_ranges():
    # Deny inbound and Allow outbound -> PASS
    res_pass = check_az_nsg_01(
        {
            "name": "nsg-locked",
            "rules": [
                {
                    "name": "deny-ssh",
                    "direction": "Inbound",
                    "access": "Deny",
                    "protocol": "Tcp",
                    "source": "Internet",
                    "destination_ports": "22",
                },
                {
                    "name": "allow-ssh-out",
                    "direction": "Outbound",
                    "access": "Allow",
                    "protocol": "Tcp",
                    "source": "*",
                    "destination_ports": "22",
                },
            ],
        },
        SNAPSHOT_AT,
    )
    assert res_pass.status == "PASS"

    # Port range 3380-3400 with protocol * -> FAIL
    res_fail = check_az_nsg_01(
        {
            "name": "nsg-mgmt",
            "rules": [
                {
                    "name": "allow-mgmt",
                    "direction": "Inbound",
                    "access": "Allow",
                    "protocol": "*",
                    "source": "0.0.0.0/0",
                    "destination_ports": "3380-3400",
                }
            ],
        },
        SNAPSHOT_AT,
    )
    assert res_fail.status == "FAIL"
    assert "3389" in res_fail.details

    # Malformed port -> CANNOT_SCAN
    res_bad = check_az_nsg_01(
        {
            "name": "nsg-bad",
            "rules": [
                {
                    "name": "bad-port",
                    "direction": "Inbound",
                    "access": "Allow",
                    "protocol": "Tcp",
                    "source": "*",
                    "destination_ports": "ssh",
                }
            ],
        },
        SNAPSHOT_AT,
    )
    assert res_bad.status == "CANNOT_SCAN"


def test_gcp_gcs_01_and_02():
    assert (
        check_gcp_gcs_01(
            {
                "name": "b1",
                "iam_bindings": [
                    {"role": "roles/storage.objectViewer", "members": ["user:a@b.com"]}
                ],
            },
            SNAPSHOT_AT,
        ).status
        == "PASS"
    )
    assert (
        check_gcp_gcs_01(
            {
                "name": "b2",
                "iam_bindings": [{"role": "roles/storage.objectViewer", "members": ["allUsers"]}],
            },
            SNAPSHOT_AT,
        ).status
        == "FAIL"
    )
    assert (
        check_gcp_gcs_01(
            {
                "name": "b3",
                "iam_bindings": [
                    {"role": "roles/storage.objectViewer", "members": ["allAuthenticatedUsers"]}
                ],
            },
            SNAPSHOT_AT,
        ).status
        == "FAIL"
    )
    assert (
        check_gcp_gcs_01({"name": "b4", "iam_bindings": "bad"}, SNAPSHOT_AT).status == "CANNOT_SCAN"
    )

    assert (
        check_gcp_gcs_02({"name": "b1", "uniform_bucket_level_access": True}, SNAPSHOT_AT).status
        == "PASS"
    )
    assert (
        check_gcp_gcs_02({"name": "b2", "uniform_bucket_level_access": False}, SNAPSHOT_AT).status
        == "FAIL"
    )
    assert (
        check_gcp_gcs_02({"name": "b3", "uniform_bucket_level_access": "true"}, SNAPSHOT_AT).status
        == "CANNOT_SCAN"
    )


def test_gcp_vpc_01_disabled_and_egress():
    # Disabled rule -> PASS
    assert (
        check_gcp_vpc_01(
            {
                "name": "disabled-all",
                "direction": "INGRESS",
                "disabled": True,
                "source_ranges": ["0.0.0.0/0"],
                "allowed": [{"IPProtocol": "all"}],
            },
            SNAPSHOT_AT,
        ).status
        == "PASS"
    )

    # Egress rule -> PASS
    assert (
        check_gcp_vpc_01(
            {
                "name": "egress-ssh",
                "direction": "EGRESS",
                "disabled": False,
                "destination_ranges": ["0.0.0.0/0"],
                "allowed": [{"IPProtocol": "tcp", "ports": ["22"]}],
            },
            SNAPSHOT_AT,
        ).status
        == "PASS"
    )

    # Active ingress RDP -> FAIL
    fail_rdp = check_gcp_vpc_01(
        {
            "name": "rdp-open",
            "direction": "INGRESS",
            "disabled": False,
            "source_ranges": ["0.0.0.0/0"],
            "allowed": [{"IPProtocol": "tcp", "ports": ["3389"]}],
        },
        SNAPSHOT_AT,
    )
    assert fail_rdp.status == "FAIL"
    assert "3389" in fail_rdp.details

    # Bad port -> CANNOT_SCAN
    bad_port = check_gcp_vpc_01(
        {
            "name": "bad-fw",
            "direction": "INGRESS",
            "disabled": False,
            "source_ranges": ["0.0.0.0/0"],
            "allowed": [{"IPProtocol": "tcp", "ports": ["not-a-port"]}],
        },
        SNAPSHOT_AT,
    )
    assert bad_port.status == "CANNOT_SCAN"


def test_full_snapshot_concurrency_and_counts():
    inv_path = Path(__file__).resolve().parents[2] / "data" / "inventory.json"
    data = load_inventory(inv_path)

    t0 = time.monotonic()
    findings = run_snapshot_scan(data, max_workers=4)
    elapsed = time.monotonic() - t0

    # Latencies are 1.5s, 3.0s, 1.0s, 2.5s -> concurrent max ~3.0s (well under 5.5s)
    assert elapsed < 5.5

    # Verify error collections produced CANNOT_SCAN without resource_id
    dev_err_findings = [
        f for f in findings if f["account_id"] == "210987654321" and f["resource_id"] is None
    ]
    # iam_users has 2 checks (AWS-IAM-01, AWS-IAM-02) + rds_instances has 1 check (AWS-RDS-01) = 3
    assert len(dev_err_findings) == 3
    assert all(f["status"] == "CANNOT_SCAN" for f in dev_err_findings)
