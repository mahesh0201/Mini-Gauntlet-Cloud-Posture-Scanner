# Production Deployment Architecture — Mini Gauntlet (AWS)

This document outlines how **Mini Gauntlet** would run in production on **Amazon Web Services (AWS)** with zero long-lived cloud credentials, isolated networking, managed persistence, and least-privilege cross-account scanning permissions.

---

## 1. Compute, Networking & Storage

* **Compute (Amazon ECS on AWS Fargate)**:
  * Run the `api` (FastAPI/Uvicorn) and `dashboard` (Nginx + static React bundle) containers as separate ECS Fargate services behind an internal or WAF-protected **Application Load Balancer (ALB)**.
  * ALB listener rules route `/api/*` to the FastAPI target group (`port 8000`, health check `/api/health`) and `/*` to the Dashboard target group (`port 3000`).
  * Horizontal autoscaling scales API tasks based on CPU/request concurrency while keeping container images immutable (built from the exact CI Dockerfiles).
* **Database (Amazon RDS for PostgreSQL)**:
  * Replace local SQLite with **Amazon RDS for PostgreSQL (Multi-AZ)** in private database subnets (`db.t4g.medium` or Serverless v2) so scan runs and findings persist across task deployments and horizontal scaling.
  * Store connection strings in **AWS Secrets Manager** and inject them into ECS task definitions via `secrets` ARNs at runtime.
* **Networking & Isolation**:
  * Custom VPC spanning two Availability Zones with **public subnets** (ALB + NAT Gateway), **private application subnets** (ECS Fargate tasks), and **isolated data subnets** (RDS PostgreSQL).
  * Security groups enforce strict least-privilege traffic: ALB accepts `443` (TLS 1.2+ via ACM) from allowed corporate CIDRs/IdP; ECS tasks accept traffic only from the ALB security group; RDS accepts `5432` only from the API task security group.
* **Observability & Logs**:
  * Container `stdout`/`stderr` streams forward via the `awslogs` driver to **Amazon CloudWatch Logs** with structured JSON logging, 30-day retention, and metric alarms on `5XX` spikes or failed background scans.

---

## 2. Keyless CI/CD & Cross-Account Scanning Authentication

* **CI/CD Without Long-Lived Keys (GitHub Actions OIDC)**:
  * Configure AWS IAM as an **OIDC Identity Provider** trusting `token.actions.githubusercontent.com` scoped strictly to the repository (`repo:<org>/mini-gauntlet:ref:refs/heads/main`).
  * GitHub Actions assumes a deploy IAM role using `aws-actions/configure-aws-credentials@v4`, pushes signed/tagged images to **Amazon ECR**, and updates the ECS service—eliminating static `AWS_ACCESS_KEY_ID` secrets.
* **Cross-Account Scanner Execution**:
  * Instead of reading `inventory.json`, the live scanner task uses its **ECS Task IAM Role** to call `sts:AssumeRole` (with an `ExternalId`) into customer/member accounts across AWS, and Workload Identity Federation (OIDC token exchange) for Azure and Google Cloud—requiring zero static cloud credentials.

---

## 3. Least-Privilege Read-Only Scanner Permissions

To execute the 10 catalog checks against live cloud APIs, the scanner role requires strictly read-only metadata permissions:

### AWS (`AWS-S3-01`, `AWS-EC2-01`, `AWS-IAM-01`, `AWS-IAM-02`, `AWS-RDS-01`)
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "MiniGauntletReadOnlyPosture",
      "Effect": "Allow",
      "Action": [
        "s3:ListAllMyBuckets",
        "s3:GetBucketLocation",
        "s3:GetBucketPublicAccessBlock",
        "ec2:DescribeSecurityGroups",
        "iam:ListUsers",
        "iam:GetLoginProfile",
        "iam:ListMFADevices",
        "iam:ListAccessKeys",
        "rds:DescribeDBInstances"
      ],
      "Resource": "*"
    }
  ]
}
```

### Azure (`AZ-STG-01`, `AZ-NSG-01`)
Custom RBAC role assigned at Subscription or Management Group scope (read-only control-plane metadata only; no `Microsoft.Storage/storageAccounts/listKeys/action`):
* `Microsoft.Storage/storageAccounts/read`
* `Microsoft.Network/networkSecurityGroups/read`

### Google Cloud (`GCP-GCS-01`, `GCP-GCS-02`, `GCP-VPC-01`)
Custom IAM role bound at Organization or Project scope (metadata/IAM policy only; no `storage.objects.get`):
* `storage.buckets.list`
* `storage.buckets.get`
* `storage.buckets.getIamPolicy`
* `compute.firewalls.list`
* `compute.firewalls.get`
