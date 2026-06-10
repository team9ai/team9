# Team9 Dev AWS Migration Runbook

## Current Accounts

- Source AWS account (`ww`): `471112576951`
- Target AWS account (`t9`): `149614785083`
- Region: `us-east-1`

## 2026-06-03 Cutover State

The Team9 dev AWS-backed services have been migrated so that the old `ww`
account can be shut down after retention/audit approval. Railway production
was not modified.

Runtime in `t9`:

- aHand dev: `openclaw-hive-dev/ahand-hub-dev`, desired/running `1/1`,
  task definition `ahand-hub-dev:2`
- Shared Traefik for aHand dev: `openclaw-hive-dev/traefik-dev`,
  desired/running `1/1`, task definition `traefik-dev:2`
- folder9 dev: `folder9-dev/folder9-dev`, desired/running `1/1`
- folder9 dashboard dev: `folder9-dev/folder9-dashboard-dev`,
  desired/running `1/1`
- folder9 Traefik dev: `folder9-dev/folder9-traefik-dev`,
  desired/running `1/1`

DNS cutover:

- `ahand-hub.dev.team9.ai` -> `traefik-dev-nlb-ba679d7f5738b11f.elb.us-east-1.amazonaws.com`
- `folder.dev.team9.ai` -> `folder9-dev-nlb-b95ffda8112d744a.elb.us-east-1.amazonaws.com`
- `git.folder.dev.team9.ai` -> `folder9-dev-nlb-b95ffda8112d744a.elb.us-east-1.amazonaws.com`
- `admin.folder.dev.team9.ai` -> `folder9-dev-nlb-b95ffda8112d744a.elb.us-east-1.amazonaws.com`
- `files.dev.team9.ai` -> `d2tedyjbca4wja.cloudfront.net`

The `files.dev.team9.ai` CloudFront distribution is now in `t9`:

- Distribution ID: `E202H3U9IOAAUY`
- Origin: `team9-files-dev.s3.us-east-1.amazonaws.com`
- ACM certificate: `arn:aws:acm:us-east-1:149614785083:certificate/f5d21c68-8ca1-4258-b427-8fd0ce94fc17`
- Access model: CloudFront OAC reads the private `team9-files-dev` bucket
- Compatibility function strips both `/t9-development/` and `/team9-files-dev/`
  path prefixes

The old `ww` CloudFront distribution `E1TFNLFUI3702I` no longer has the
`files.dev.team9.ai` alias.

Railway `development` variables were updated and the services were restarted:

- `API-Gateway`: `S3_BUCKET=team9-files-dev`, S3 access key account `149614785083`
- `Im-worker`: `S3_BUCKET=team9-files-dev`, S3 access key account `149614785083`
- `capability-hub`: `S3_BUCKET=team9-capability-hub-dev`, S3 access key account `149614785083`

Other Railway dev URLs point to migrated dev endpoints:

- `S3_PUBLIC_URL=https://files.dev.team9.ai`
- `AHAND_HUB_URL=https://ahand-hub.dev.team9.ai`
- `FOLDER9_API_URL=https://folder.dev.team9.ai`
- `CAPABILITY_BASE_URL=https://gateway.capability.dev.team9.ai`

OpenClaw runtime and file-keeper were intentionally not migrated. Keep them
off unless the requirement changes.

## 2026-06-03 PRs and ww Dev Decommission

Draft PRs created for the migration branches:

- Team9: https://github.com/team9ai/team9/pull/124
- folder9: https://github.com/team9ai/folder9/pull/9
- aHand: https://github.com/team9ai/aHand/pull/42
- openclaw-hive: https://github.com/weightwave/openclaw-hive/pull/2

Additional `ww` dev-only shutdown actions completed after the cutover:

- Removed Cloudflare DNS records that still pointed OpenClaw/file-keeper dev
  hostnames at the old `ww` Traefik dev NLB:
  - `file-keeper.claw.dev.team9.ai`
  - `files-explorer.claw.dev.team9.ai`
  - `*.fk.claw.dev.team9.ai`
  - `*.instance.claw.dev.team9.ai`
  - `plane.claw.dev.team9.ai`
- Disabled the old `ww` `files.dev.team9.ai` CloudFront distribution
  `E1TFNLFUI3702I`. It now has no aliases and `Enabled=false`.
- Stopped the old `ww` dev RDS instance `openclaw-hive-dev`.

Verified after decommission:

- Cloudflare has no records pointing to the old `ww` dev NLBs or old
  `files.dev` CloudFront domain.
- `ww/openclaw-hive-dev` ECS services all have desired/running `0/0`.
- `ww/folder9-dev` ECS services all have desired/running `0/0`.
- `ww/openclaw-hive-dev` RDS status is `stopped`.

Remaining `ww` dev resources that still exist for rollback/retention and can
be deleted after the observation window:

- S3 buckets: `t9-development`, `ahand-hub-dev`, `capability-hub`
- ElastiCache Redis: `ahand-hub-dev`
- NLBs: `traefik-dev-nlb-8cda97ce6b37e5e1`, `folder9-dev-nlb-c5c54878a223a778`
- ECS clusters/services/task definitions for `openclaw-hive-dev` and
  `folder9-dev`
- Disabled CloudFront distribution `E1TFNLFUI3702I`
- Stopped RDS instance `openclaw-hive-dev` and its old snapshots

`ww` cannot be fully closed yet if production still depends on it. Current
production blockers observed in `ww`:

- `folder9-prod` ECS cluster is still running `folder9-prod`,
  `folder9-dashboard-prod`, and `folder9-traefik-prod`.
- `openclaw-hive` ECS cluster is still running `control-plane-prod`,
  `file-keeper-prod`, `ahand-hub-prod`, Traefik, and a file-keeper instance.
- RDS `openclaw-hive-prod` is still available.
- ElastiCache Redis `ahand-hub-prod` is still available.
- CloudFront `E210V6XIJ0X5JL` still serves `files.team9.ai`.
- Cloudflare production records still point at `ww` prod NLBs:
  `folder.team9.ai`, `git.folder.team9.ai`, `admin.folder.team9.ai`,
  `plane.claw.team9.ai`, `*.instance.claw.team9.ai`,
  `file-keeper.claw.team9.ai`, `files-explorer.claw.team9.ai`,
  `*.fk.claw.team9.ai`, `ahand-hub.team9.ai`, and `*.claw.team9.ai`.

## S3 Pre-Copy

Run before write-freeze. The 2026-06-02 source inventory is under 1 GiB:

- `ahand-hub-dev`: 10 objects, 84.4 KiB
- `t9-development`: 141 objects, 118.0 MiB after the final 2026-06-03 delta copy
- `capability-hub`: 433 objects, 654.7 MiB after the final 2026-06-03 delta copy

The migration target buckets are:

- `ahand-hub-dev` -> `team9-ahand-hub-dev`
- `t9-development` -> `team9-files-dev`
- `capability-hub` -> `team9-capability-hub-dev`
- `capability-hub` -> `team9-capability-hub-prod`

No distinct old capability-hub dev source bucket was found, so the old
`capability-hub` bucket was copied into both `team9-capability-hub-dev` and
`team9-capability-hub-prod`.

Pre-copy was completed on 2026-06-02. Final deltas were copied on 2026-06-03
and verified with matching source/target totals:

- `team9-ahand-hub-dev`: 10 objects, 84.4 KiB
- `team9-files-dev`: 141 objects, 118.0 MiB
- `team9-capability-hub-dev`: 433 objects, 654.7 MiB
- `team9-capability-hub-prod`: 433 objects, 654.7 MiB

```bash
mkdir -p /tmp/team9-s3-migration
aws s3 sync s3://ahand-hub-dev /tmp/team9-s3-migration/ahand-hub-dev --region us-east-1 --profile ww
aws s3 sync /tmp/team9-s3-migration/ahand-hub-dev s3://team9-ahand-hub-dev --region us-east-1 --profile t9
aws s3 sync s3://t9-development /tmp/team9-s3-migration/t9-development --region us-east-1 --profile ww
aws s3 sync /tmp/team9-s3-migration/t9-development s3://team9-files-dev --region us-east-1 --profile t9
aws s3 sync s3://capability-hub /tmp/team9-s3-migration/capability-hub --region us-east-1 --profile ww
aws s3 sync /tmp/team9-s3-migration/capability-hub s3://team9-capability-hub-dev --region us-east-1 --profile t9
aws s3 sync /tmp/team9-s3-migration/capability-hub s3://team9-capability-hub-prod --region us-east-1 --profile t9
```

Run again during write-freeze with `--delete`:

```bash
aws s3 sync s3://ahand-hub-dev /tmp/team9-s3-migration/ahand-hub-dev --region us-east-1 --profile ww --delete
aws s3 sync /tmp/team9-s3-migration/ahand-hub-dev s3://team9-ahand-hub-dev --region us-east-1 --profile t9 --delete
aws s3 sync s3://t9-development /tmp/team9-s3-migration/t9-development --region us-east-1 --profile ww --delete
aws s3 sync /tmp/team9-s3-migration/t9-development s3://team9-files-dev --region us-east-1 --profile t9 --delete
aws s3 sync s3://capability-hub /tmp/team9-s3-migration/capability-hub --region us-east-1 --profile ww --delete
aws s3 sync /tmp/team9-s3-migration/capability-hub s3://team9-capability-hub-dev --region us-east-1 --profile t9 --delete
aws s3 sync /tmp/team9-s3-migration/capability-hub s3://team9-capability-hub-prod --region us-east-1 --profile t9 --delete
```

Verify after copy:

```bash
for b in team9-ahand-hub-dev team9-files-dev team9-capability-hub-prod team9-capability-hub-dev; do
  echo "TARGET $b"
  aws s3 ls "s3://$b" --recursive --summarize --human-readable --profile t9 --region us-east-1 | tail -5
done
```

## RDS Final Snapshot and Restore

Run during write-freeze only:

```bash
SNAPSHOT_ID="openclaw-hive-dev-final-$(date -u +%Y%m%d%H%M%S)"
aws rds create-db-snapshot \
  --profile ww \
  --region us-east-1 \
  --db-instance-identifier openclaw-hive-dev \
  --db-snapshot-identifier "$SNAPSHOT_ID"

aws rds wait db-snapshot-completed \
  --profile ww \
  --region us-east-1 \
  --db-snapshot-identifier "$SNAPSHOT_ID"

aws rds modify-db-snapshot-attribute \
  --profile ww \
  --region us-east-1 \
  --db-snapshot-identifier "$SNAPSHOT_ID" \
  --attribute-name restore \
  --values-to-add 149614785083
```

Then copy the shared snapshot in the `t9` account so it is encrypted in the target account:

```bash
aws rds copy-db-snapshot \
  --profile t9 \
  --region us-east-1 \
  --source-db-snapshot-identifier "arn:aws:rds:us-east-1:471112576951:snapshot:${SNAPSHOT_ID}" \
  --target-db-snapshot-identifier "${SNAPSHOT_ID}-t9-encrypted" \
  --kms-key-id alias/aws/rds

aws rds wait db-snapshot-completed \
  --profile t9 \
  --region us-east-1 \
  --db-snapshot-identifier "${SNAPSHOT_ID}-t9-encrypted"

DB_SUBNET_GROUP="$(terraform -chdir=/Users/winrey/Projects/weightwave/team9/infra/aws/t9-dev-core output -raw db_subnet_group_name)"
RDS_SG_ID="$(terraform -chdir=/Users/winrey/Projects/weightwave/team9/infra/aws/t9-dev-core output -raw rds_security_group_id)"

if aws rds describe-db-instances \
  --profile t9 \
  --region us-east-1 \
  --db-instance-identifier openclaw-hive-dev >/dev/null 2>&1; then
  echo "Target RDS openclaw-hive-dev already exists in t9. Stop and decide whether to keep it or replace it." >&2
  exit 1
fi

aws rds restore-db-instance-from-db-snapshot \
  --profile t9 \
  --region us-east-1 \
  --db-instance-identifier openclaw-hive-dev \
  --db-snapshot-identifier "${SNAPSHOT_ID}-t9-encrypted" \
  --db-instance-class db.t4g.micro \
  --db-subnet-group-name "$DB_SUBNET_GROUP" \
  --vpc-security-group-ids "$RDS_SG_ID" \
  --publicly-accessible \
  --no-multi-az \
  --storage-type gp3

aws rds wait db-instance-available \
  --profile t9 \
  --region us-east-1 \
  --db-instance-identifier openclaw-hive-dev

aws rds describe-db-instances \
  --profile t9 \
  --region us-east-1 \
  --db-instance-identifier openclaw-hive-dev \
  --query 'DBInstances[0].Endpoint.Address' \
  --output text
```

Executed during the 2026-06-02 write-freeze:

- Source snapshot: `openclaw-hive-dev-final-20260601173022`
- Target encrypted snapshot: `openclaw-hive-dev-final-20260601173022-t9-encrypted`
- Restored target RDS: `openclaw-hive-dev.c89gkagwy37d.us-east-1.rds.amazonaws.com:5432`
- Target RDS is encrypted, PostgreSQL `16.10`, `db.t4g.micro`, `20 GiB gp3`
- Target RDS and `control-plane-dev` Redis are imported into `infra/aws/t9-dev-core` Terraform state

The old `ww` dev ECS services were scaled to desired `0` before the final S3 sync and RDS snapshot:

- `openclaw-hive-dev/file-keeper-dev`
- `openclaw-hive-dev/control-plane-dev`
- `openclaw-hive-dev/ahand-hub-dev`
- `openclaw-hive-dev/traefik-dev`
- `folder9-dev/folder9-traefik-dev`
- `folder9-dev/folder9-dashboard-dev`
- `folder9-dev/folder9-dev`

## Redis

Target `t9` Redis resources:

- Control plane Redis Serverless cache: `control-plane-dev-z6rr48.serverless.use1.cache.amazonaws.com:6379`
- Control plane Redis SG: `sg-01024f55ce79e2342`
- aHand hub Redis cluster: `ahand-hub-dev`

Redis runtime data was not copied. Treat it as ephemeral cache/session data.

## ECS Entrypoints

Target `t9` entrypoints created during the migration:

- OpenClaw Traefik dev NLB: `traefik-dev-nlb-ba679d7f5738b11f.elb.us-east-1.amazonaws.com`
- OpenClaw Traefik dev SG: `sg-0368318519318a4ba`
- folder9 dev NLB: `folder9-dev-nlb-b95ffda8112d744a.elb.us-east-1.amazonaws.com`

The OpenClaw Traefik dev task definition now reads the Cloudflare token from
SSM instead of plaintext task environment variables and uses
`/letsencrypt/acme-t9.json` so the migrated `ww` ACME account state is not
reused in `t9`.

The OpenClaw Traefik script used to print an incorrect reminder of
`*.instance.instance.claw.dev.team9.ai`. Use the actual desired DNS records
from the dev domains instead.

## OpenClaw Runtime

OpenClaw runtime migration was cancelled on 2026-06-03. Do not continue the
`openclaw-hive:dev` image copy or deploy OpenClaw control-plane/file-keeper
services into `t9` unless the requirement changes again.

Current `t9` `openclaw-hive-dev` ECS cluster services are:

- `traefik-dev`: retained as shared ingress for aHand dev (`ahand-hub.dev.team9.ai`)
- `ahand-hub-dev`: retained for the aHand dev environment

There are no `t9` OpenClaw control-plane/file-keeper/instance services running.
The old `ww` OpenClaw dev services remain scaled to desired `0`.

On 2026-06-03, file-keeper and OpenClaw runtime were explicitly treated as
shut down rather than migrated:

- `ww/openclaw-hive-dev/file-keeper-dev`: desired `0`, running `0`
- `ww/openclaw-hive-dev/control-plane-dev`: desired `0`, running `0`
- `ww/openclaw-hive-dev`: no running or pending standalone tasks
- `t9/openclaw-hive-dev`: no file-keeper, control-plane, efs-webdav, or OpenClaw instance services/task definitions

Leave historical `ww` task definitions registered for audit/rollback context;
they have no runtime cost while no ECS service or task is using them.

## ECR

Copied `:dev` images from `ww` to `t9`:

- `control-plane:dev`
- `file-keeper:dev`
- `efs-webdav:dev`
- `ahand-hub:dev`
- `folder9:dev`
- `folder9-dashboard:dev`

`openclaw-hive:dev` did not complete via local `docker push`; use GitHub Actions or retry from a better network path before launching workloads that require it.
This image is no longer required for the current migration scope because
OpenClaw runtime migration has been cancelled.

## SSM Parameters

Copied folder9 dev SSM parameters from `ww` to `t9` after folder9 Terraform apply:

- `/folder9/dev/*`
- `/folder9-dashboard/dev/*`
- `/folder9/shared/cloudflare_dns_token`

The copied `DATABASE_URL` values were rewritten from the old RDS endpoint to `openclaw-hive-dev.c89gkagwy37d.us-east-1.rds.amazonaws.com`.

## EFS Copy

Copy these source file systems:

- `fs-05f7f1c836631ddce` (`folder9-dev`)
- `fs-057baa1f60ff58b91` (`folder9-dev-acme`)
- `fs-0f3888df726d8d9f8` (`openclaw-hive-dev`)
- `fs-0920bb3d4db7aa843` (`openclaw-hive-dev-efs`)

Target file systems created in `t9` so far:

- `fs-01a332c4d065de570` (`openclaw-hive-dev`)
- `fs-08ba71f27e0f12b75` (`openclaw-hive-dev-efs`)
- `fs-03ce541320ea7827c` (`folder9-dev`)
- `fs-0875869ddefaba679` (`folder9-dev-acme`)

Executed during the 2026-06-02 write-freeze using temporary Fargate tasks and S3 tarballs:

- `fs-05f7f1c836631ddce` -> `fs-03ce541320ea7827c`: `folder9.tgz`, restored count `11633`
- `fs-057baa1f60ff58b91` -> `fs-0875869ddefaba679`: `folder9-acme.tgz`, restored count `1`
- `fs-0f3888df726d8d9f8` -> `fs-01a332c4d065de570`: `openclaw.tgz`, restored count `2015`
- `fs-0920bb3d4db7aa843` -> `fs-08ba71f27e0f12b75`: `openclaw-extra.tgz`, restored count `268`

Temporary migration S3 buckets and inline IAM policies were removed after verification.
CloudWatch migration logs are retained for 7 days in `/ecs/efs-migration` in both accounts.
Keep folder9 app services at desired `0` until final app secret/runtime verification is complete.
