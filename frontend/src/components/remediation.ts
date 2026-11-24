export function getRemediationCommand(checkId: string, resourceId?: string | null): { command: string; guide: string } {
  const target = resourceId || '<RESOURCE_ID>';
  switch (checkId) {
    case 'AWS-S3-01':
      return {
        command: `aws s3api put-public-access-block --bucket ${target} --public-access-block-configuration "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"`,
        guide: 'Enables S3 Block Public Access on the bucket across all 4 protection flags.',
      };
    case 'AWS-SEC-01':
      return {
        command: `aws ec2 revoke-security-group-ingress --group-id ${target} --protocol tcp --port 22 --cidr 0.0.0.0/0`,
        guide: 'Removes unrestricted ingress rule for administrative port 22 (SSH).',
      };
    case 'AWS-IAM-01':
      return {
        command: `aws iam update-access-key --user-name ${target} --access-key-id <KEY_ID> --status Inactive`,
        guide: 'Deactivates stale IAM user access key exceeding 90-day rotation compliance.',
      };
    case 'AWS-RDS-01':
      return {
        command: `aws rds modify-db-instance --db-instance-identifier ${target} --no-publicly-accessible --apply-immediately`,
        guide: 'Disables public internet accessibility for the relational database instance.',
      };
    case 'AZ-STG-01':
      return {
        command: `az storage account update --name ${target} --allow-blob-public-access false`,
        guide: 'Prevents anonymous read access to blobs and containers in the Azure Storage account.',
      };
    case 'AZ-NSG-01':
      return {
        command: `az network nsg rule delete --resource-group <RESOURCE_GROUP> --nsg-name ${target} --name <RULE_NAME>`,
        guide: 'Removes open inbound NSG rule exposing SSH/RDP to the public internet.',
      };
    case 'GCP-GCS-01':
      return {
        command: `gcloud storage buckets remove-iam-policy-binding gs://${target} --member="allUsers" --role="roles/storage.objectViewer"`,
        guide: 'Removes unauthenticated allUsers/allAuthenticatedUsers IAM grant from bucket.',
      };
    case 'GCP-GCS-02':
      return {
        command: `gcloud storage buckets update gs://${target} --uniform-bucket-level-access`,
        guide: 'Enforces Uniform Bucket-Level Access (disables object ACL override risk).',
      };
    case 'GCP-VPC-01':
      return {
        command: `gcloud compute firewall-rules update ${target} --disabled`,
        guide: 'Disables wide-open VPC firewall rule permitting external SSH/RDP.',
      };
    default:
      return {
        command: `# Inspect resource ${target} for security compliance`,
        guide: 'Review configuration in cloud provider management console.',
      };
  }
}
