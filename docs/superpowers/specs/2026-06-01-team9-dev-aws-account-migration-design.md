# Team9 Dev AWS Account Migration Design

Date: 2026-06-01

## Summary

Migrate the AWS-backed dev dependency environment from the `ww` AWS account to
the new `t9` AWS account. Team9 itself continues to run on Railway during this
phase, but AWS resources that Team9 depends on are rebuilt or copied into `t9`.

The migration preserves dev data where it matters: PostgreSQL, EFS, and S3 are
copied. Redis is recreated empty. A short dev downtime / write-freeze window is
accepted and is part of the consistency plan.

## Accounts and Region

- Source account: `ww` / `471112576951`
- Target account: `t9` / `149614785083`
- Region: `us-east-1`

## Scope

In scope:

- aHand Hub dev AWS resources.
- folder9 dev AWS resources.
- openclaw-hive dev AWS resources.
- Team9 dev S3 file data, even though the Team9 runtime remains on Railway.
- Capability Hub S3 buckets in `t9`, split by `dev` and `prod`.
- Terraform state infrastructure for the new account.
- GitHub deployment trust should move toward OIDC roles in `t9`.

Out of scope for this phase:

- Moving the Team9 Railway runtime to AWS.
- Deleting the existing `ww` dev resources immediately after cutover.
- Migrating Redis runtime data.
- Reworking application behavior outside what is needed for AWS account
  migration.

## Existing Source State

Known `ww` dev resources:

- ECS clusters:
  - `openclaw-hive-dev`
  - `folder9-dev`
- ECS services:
  - `ahand-hub-dev`
  - `control-plane-dev`
  - `file-keeper-dev`
  - `traefik-dev`
  - `folder9-dev`
  - `folder9-dashboard-dev`
  - `folder9-traefik-dev`
- RDS:
  - `openclaw-hive-dev`, PostgreSQL 16.10, `db.t4g.micro`, 20 GiB gp3,
    Single-AZ, publicly accessible, unencrypted, 7 day backup retention.
- ElastiCache:
  - `ahand-hub-dev`, Redis, `cache.t4g.micro`, single node.
- EFS:
  - `folder9-dev` around 377 MB.
  - `folder9-dev-acme` around 59 KB.
  - `openclaw-hive-dev` around 33 MB.
  - `openclaw-hive-dev-efs` around 1.8 MB.
- S3:
  - `ahand-hub-dev`, around 19 KB / 2 objects.
  - `t9-development`, around 118 MB / 137 objects.
  - `capability-hub`, around 653 MB / 432 objects.
- ECR repositories:
  - `control-plane`
  - `file-keeper`
  - `ahand-hub`
  - `openclaw-hive`
  - `folder9`
  - `folder9-dashboard`

Known `t9` state:

- Default VPC exists, but no target ECS/RDS/ECR/S3 baseline is present.
- No existing S3 bucket names from the target naming plan were found during
  read-only `head-bucket` checks.

## Naming Decisions

S3 buckets use:

```text
team9-<domain>-<env>
```

Approved target bucket names:

| Purpose                        | Dev bucket                 | Prod bucket                            |
| ------------------------------ | -------------------------- | -------------------------------------- |
| Team9 uploaded files           | `team9-files-dev`          | `team9-files-prod`                     |
| aHand Hub file operations      | `team9-ahand-hub-dev`      | `team9-ahand-hub-prod`                 |
| Capability Hub generated files | `team9-capability-hub-dev` | `team9-capability-hub-prod`            |
| Terraform state                | `team9-tfstate`            | Shared bucket, separated by state keys |

S3 data mappings:

| Source              | Target                                       |
| ------------------- | -------------------------------------------- |
| `ww:ahand-hub-dev`  | `t9:team9-ahand-hub-dev`                     |
| `ww:t9-development` | `t9:team9-files-dev`                         |
| `ww:capability-hub` | `t9:team9-capability-hub-prod`               |
| none                | `t9:team9-capability-hub-dev`, created empty |

## S3 Access Model

`team9-files-*`:

- Private buckets.
- Access through service credentials and presigned upload/download URLs.
- The initial AWS migration copies data but does not force Railway Team9 to
  switch immediately.
- A later Team9 S3 cutover must either update database references from the old
  bucket name / URL to the new bucket name / URL, or keep old bucket access
  available until no stored references use it.

`team9-ahand-hub-*`:

- Private buckets.
- Access limited to aHand Hub service roles and migration operators.
- Preserve the current dev lifecycle rule behavior for file operation objects.

`team9-capability-hub-*`:

- Public-readable objects, service-only writes.
- This matches the current Capability Hub usage where generated files can be
  returned to Team9 and stored as durable `fileUrl` values.
- Public write is never allowed.
- CloudFront can be added later without changing bucket names.

## Target Infrastructure Design

Create a dedicated VPC in `t9`; do not use the default VPC for migrated dev
services. The target VPC should have at least two Availability Zones, public
subnets for load balancers, and private subnets for ECS tasks and data stores
where practical.

Rebuild the following target resources in `t9`:

- Terraform state:
  - `team9-tfstate` S3 bucket.
  - DynamoDB lock table.
- IAM:
  - GitHub OIDC provider.
  - Repo-scoped deploy roles for aHand, folder9, and openclaw-hive.
  - ECS task execution and task roles.
  - Least-privilege S3 policies per service bucket.
- Networking:
  - Dedicated VPC, subnets, route tables, security groups.
  - NLBs for the dev endpoints that are currently fronted by NLB / Traefik.
- Compute:
  - ECS clusters and services for aHand Hub, folder9, folder9 dashboard,
    openclaw-hive control plane, file keeper, and Traefik services.
- Data:
  - RDS PostgreSQL restored from the final `openclaw-hive-dev` snapshot.
  - ElastiCache Redis recreated empty.
  - EFS file systems recreated and populated from source EFS.
  - S3 buckets created with the approved names and policies.
- Registry:
  - ECR repositories copied or recreated in `t9`.

## Data Migration Plan

Use a write-freeze window for final consistency.

Pre-copy phase:

1. Create target S3 buckets and baseline policies.
2. Run full S3 copies from `ww` to `t9`.
3. Create target EFS file systems.
4. Run full EFS copies from `ww` to `t9`.
5. Prepare target RDS subnet groups, security groups, and parameter settings.
6. Prepare target ECS task definitions and service configuration.

Write-freeze phase:

1. Stop writes to source dev services. The simplest acceptable method is to
   scale down or stop the relevant `ww` dev ECS services and prevent new write
   traffic during the window.
2. Take the final `openclaw-hive-dev` RDS snapshot.
3. Restore the final snapshot into `t9`.
4. Run final incremental S3 syncs.
5. Run final incremental EFS syncs.
6. Update target SSM parameters and service env references to target resource
   names and endpoints.
7. Start target ECS services.
8. Cut DNS records for dev service hostnames to the target `t9` load balancers.

Post-cutover phase:

1. Run smoke tests against target dev domains.
2. Validate app-level flows from Railway Team9 into the new AWS-backed services.
3. Keep `ww` dev resources available for rollback, but do not allow normal
   writes there after a successful cutover.
4. Delete or archive `ww` dev only after a separate confirmation.

## Configuration and Secrets

Secrets must be copied without printing values to logs or terminal output.

Target SSM parameters should preserve the existing logical names where possible
inside the target account, but values must point at target resources:

- aHand Hub:
  - `DATABASE_URL`
  - `REDIS_URL`
  - `S3_BUCKET=team9-ahand-hub-dev`
  - `S3_REGION=us-east-1`
  - service tokens and webhook secrets.
- folder9:
  - `DATABASE_URL`
  - `PSK`
  - webhook and Sentry settings.
- folder9 dashboard:
  - `DATABASE_URL`
  - `FOLDER9_PSK`
  - `JWT_SECRET`
  - dashboard password.
- openclaw-hive:
  - task-definition and GitHub deployment settings should point at target
    account ECR repositories, target cluster names, target EFS IDs, and target
    service endpoints.
- Capability Hub:
  - `S3_BUCKET=team9-capability-hub-dev` for dev.
  - `S3_BUCKET=team9-capability-hub-prod` for prod.
  - `S3_PUBLIC=true` when durable public object URLs are required.

GitHub Actions should use OIDC roles in the `t9` account. Static AWS access keys
should be removed from the deploy path after replacement is verified.

## DNS and External Runtime Handling

The dev service domains should stay stable from the caller perspective. DNS
records are repointed to `t9` load balancers during cutover.

Team9 on Railway is not migrated in this phase. If a Railway env var points to a
stable dev domain, no Railway change is required for that dependency after DNS
cutover. If a Railway env var points directly to an AWS endpoint, bucket name, or
account-scoped resource, it must be changed in an explicit Railway cutover step.

Team9 file bucket cutover is separate from copying `t9-development` data:

- Copy now to `team9-files-dev`.
- Keep current Railway file configuration unchanged unless a Team9 S3 cutover is
  explicitly scheduled.
- When scheduled, update Team9 env vars and database references consistently.

## Validation

Before cutover:

- Confirm all target S3 bucket names still return `404` or are owned by `t9`.
- Confirm target Terraform state bucket and lock table are accessible.
- Confirm ECR images exist in `t9`.
- Confirm SSM parameters exist in `t9` with expected names and no empty required
  values.
- Confirm target RDS restore has expected databases and users.
- Confirm EFS mounts are readable by target tasks.

During cutover:

- Confirm source dev services are stopped or write-blocked.
- Confirm final RDS snapshot restore completes.
- Confirm final S3 and EFS syncs report no unexpected failures.
- Confirm DNS records resolve to target load balancers.

After cutover:

- aHand Hub health endpoint responds.
- folder9 API and dashboard health checks respond.
- openclaw-hive control plane can create/list/start/stop dev instances.
- file keeper paths resolve and existing copied EFS data is visible.
- Team9 Railway can call the dev control plane through the existing configured
  base URL.
- S3 read/write checks pass for service roles:
  - Team9 files bucket private access.
  - aHand Hub private bucket access.
  - Capability Hub public read and service-only write.

## Rollback

Rollback is DNS/config based:

1. Stop or scale down target `t9` dev services.
2. Repoint dev DNS records back to `ww` load balancers.
3. Restart source `ww` dev services if they were stopped.
4. Leave copied `t9` data intact for diagnosis.

Rollback is simplest before new writes happen in `t9`. If writes happen in `t9`
after cutover, choose whether to discard them or perform a reverse data sync
before returning traffic to `ww`.

## Risks and Mitigations

- S3 bucket names are global.
  - Use the approved new names and re-check immediately before creation.
- Stored file URLs can point at old buckets.
  - Copy data now, but schedule Team9 file bucket cutover separately with DB URL
    and bucket-reference handling.
- openclaw-hive deployment is less Terraformized than aHand/folder9.
  - Standardize target deploy roles, account IDs, ECR references, task
    definitions, SSM parameters, and EFS IDs as part of the migration plan.
- Secrets can leak during manual migration.
  - Copy secrets through AWS CLI / SSM APIs without printing values.
- RDS source is currently unencrypted.
  - Restore target with encryption enabled if practical; document any limitation
    in the implementation plan.
- Capability Hub public objects need careful write protection.
  - Public read policy must be object-read only; write/delete/list remain limited
    to service and operator roles.

## Deferred Work

- Move Team9 runtime from Railway to AWS.
- Add CloudFront in front of public object buckets.
- Fully Terraformize openclaw-hive beyond what is required for this migration.
- Delete legacy `ww` dev resources after a separate cleanup approval.
