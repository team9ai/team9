# Team9 Dev AWS Migration Runbook

## Current Accounts

- Source AWS account (`ww`): `471112576951`
- Target AWS account (`t9`): `149614785083`
- Region: `us-east-1`

## S3 Pre-Copy

Run before write-freeze. The 2026-06-02 source inventory is under 1 GiB:

- `ahand-hub-dev`: 10 objects, 84.4 KiB
- `t9-development`: 140 objects, 118.0 MiB
- `capability-hub`: 432 objects, 652.7 MiB

The migration target buckets are:

- `ahand-hub-dev` -> `team9-ahand-hub-dev`
- `t9-development` -> `team9-files-dev`
- `capability-hub` -> `team9-capability-hub-prod`

`team9-capability-hub-dev` is created separately and starts empty because no distinct old dev source bucket was found.

Pre-copy was completed on 2026-06-02 and verified with matching source/target totals:

- `team9-ahand-hub-dev`: 10 objects, 84.4 KiB
- `team9-files-dev`: 140 objects, 118.0 MiB
- `team9-capability-hub-prod`: 432 objects, 652.7 MiB
- `team9-capability-hub-dev`: 0 objects, 0 Bytes

```bash
mkdir -p /tmp/team9-s3-migration
aws s3 sync s3://ahand-hub-dev /tmp/team9-s3-migration/ahand-hub-dev --region us-east-1 --profile ww
aws s3 sync /tmp/team9-s3-migration/ahand-hub-dev s3://team9-ahand-hub-dev --region us-east-1 --profile t9
aws s3 sync s3://t9-development /tmp/team9-s3-migration/t9-development --region us-east-1 --profile ww
aws s3 sync /tmp/team9-s3-migration/t9-development s3://team9-files-dev --region us-east-1 --profile t9
aws s3 sync s3://capability-hub /tmp/team9-s3-migration/capability-hub --region us-east-1 --profile ww
aws s3 sync /tmp/team9-s3-migration/capability-hub s3://team9-capability-hub-prod --region us-east-1 --profile t9
```

Run again during write-freeze with `--delete`:

```bash
aws s3 sync s3://ahand-hub-dev /tmp/team9-s3-migration/ahand-hub-dev --region us-east-1 --profile ww --delete
aws s3 sync /tmp/team9-s3-migration/ahand-hub-dev s3://team9-ahand-hub-dev --region us-east-1 --profile t9 --delete
aws s3 sync s3://t9-development /tmp/team9-s3-migration/t9-development --region us-east-1 --profile ww --delete
aws s3 sync /tmp/team9-s3-migration/t9-development s3://team9-files-dev --region us-east-1 --profile t9 --delete
aws s3 sync s3://capability-hub /tmp/team9-s3-migration/capability-hub --region us-east-1 --profile ww --delete
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

The OpenClaw Traefik script prints an incorrect reminder of `*.instance.instance.claw.dev.team9.ai`.
Use the actual desired DNS records from the dev domains instead.

## ECR

Copied `:dev` images from `ww` to `t9`:

- `control-plane:dev`
- `file-keeper:dev`
- `efs-webdav:dev`
- `ahand-hub:dev`
- `folder9:dev`
- `folder9-dashboard:dev`

`openclaw-hive:dev` did not complete via local `docker push`; use GitHub Actions or retry from a better network path before launching workloads that require it.

## SSM Parameters

Copied folder9 dev SSM parameters from `ww` to `t9` after folder9 Terraform apply:

- `/folder9/dev/*`
- `/folder9-dashboard/dev/*`

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

Use AWS DataSync when available. If DataSync is not already configured, run a temporary migration EC2 instance with both source and target EFS mounted over reachable networking. Copy once before write-freeze and once during write-freeze:

```bash
sudo rsync -aHAX --numeric-ids --info=progress2 /mnt/source/ /mnt/target/
sudo find /mnt/target -maxdepth 2 -type f | head -50
```

EFS content has not yet been copied as of this runbook update. Keep folder9 app services at desired `0` until EFS data and real SSM secrets are verified.
