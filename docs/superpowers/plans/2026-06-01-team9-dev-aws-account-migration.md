# Team9 Dev AWS Account Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the AWS-backed Team9 dev dependency environment from the `ww` AWS account to the `t9` AWS account while preserving RDS, EFS, and S3 data.

**Architecture:** Use a staged migration: bootstrap shared `t9` resources first, migrate IaC and deploy trust in each service repo, pre-copy mutable data, then use an accepted dev write-freeze window for final RDS/EFS/S3 sync and DNS cutover. Railway Team9 stays in place; its AWS dependency endpoints continue to use stable dev domains wherever possible.

**Tech Stack:** AWS CLI, Terraform, S3, DynamoDB, VPC, ECS/Fargate, ECR, RDS PostgreSQL, ElastiCache Redis, EFS, SSM Parameter Store, GitHub Actions OIDC, Cloudflare DNS, pnpm/Prettier for docs.

---

## Source Documents

- Spec: `/Users/winrey/Projects/weightwave/team9/docs/superpowers/specs/2026-06-01-team9-dev-aws-account-migration-design.md`
- Source AWS profile: `ww`
- Target AWS profile: `t9`
- Source AWS account: `471112576951`
- Target AWS account: `149614785083`
- Region: `us-east-1`

## Scope Split

The spec spans several independently deployable repos. Keep the top-level migration in this Team9 plan, but commit implementation changes in the repo that owns each deploy surface:

- `/Users/winrey/Projects/weightwave/team9`: migration docs and target-account bootstrap Terraform.
- `/Users/winrey/Projects/weightwave/aHand`: aHand Hub Terraform and GitHub Actions account migration.
- `/Users/winrey/Projects/weightwave/folder9`: folder9 Terraform and GitHub Actions account migration.
- `/Users/winrey/Projects/weightwave/openclaw-hive`: dev deployment roles, ECR references, task definitions, and EFS/RDS/Redis target wiring.
- `/Users/winrey/Projects/weightwave/capability-hub`: S3 env documentation and smoke verification only unless runtime deployment wiring is found during execution.

Do not apply Terraform, copy data, change DNS, or stop services until the plan step explicitly says to do so.

## File Map

Create in Team9:

- `/Users/winrey/Projects/weightwave/team9/infra/aws/t9-bootstrap/versions.tf`: Terraform version and providers.
- `/Users/winrey/Projects/weightwave/team9/infra/aws/t9-bootstrap/providers.tf`: AWS provider using profile `t9`.
- `/Users/winrey/Projects/weightwave/team9/infra/aws/t9-bootstrap/main.tf`: state bucket, lock table, migration S3 buckets, ECR repos.
- `/Users/winrey/Projects/weightwave/team9/infra/aws/t9-bootstrap/outputs.tf`: bucket and ECR outputs.
- `/Users/winrey/Projects/weightwave/team9/infra/aws/t9-dev-core/versions.tf`: Terraform version and providers for dev core.
- `/Users/winrey/Projects/weightwave/team9/infra/aws/t9-dev-core/backend.tf`: remote state in `team9-tfstate`.
- `/Users/winrey/Projects/weightwave/team9/infra/aws/t9-dev-core/providers.tf`: AWS provider using profile `t9`.
- `/Users/winrey/Projects/weightwave/team9/infra/aws/t9-dev-core/main.tf`: dedicated dev VPC, subnets, openclaw ECS cluster, RDS subnet group and security group, openclaw EFS.
- `/Users/winrey/Projects/weightwave/team9/infra/aws/t9-dev-core/outputs.tf`: values consumed by aHand, folder9, and openclaw-hive migration steps.
- `/Users/winrey/Projects/weightwave/team9/docs/aws/team9-dev-aws-migration-runbook.md`: operator runbook for data copy, write-freeze, DNS cutover, rollback.

Modify in aHand:

- `/Users/winrey/Projects/weightwave/aHand/infra/shared/backend.tf`
- `/Users/winrey/Projects/weightwave/aHand/infra/shared/providers.tf`
- `/Users/winrey/Projects/weightwave/aHand/infra/shared/variables.tf`
- `/Users/winrey/Projects/weightwave/aHand/infra/envs/dev/backend.tf`
- `/Users/winrey/Projects/weightwave/aHand/infra/envs/dev/providers.tf`
- `/Users/winrey/Projects/weightwave/aHand/infra/modules/ahand-hub/variables.tf`
- `/Users/winrey/Projects/weightwave/aHand/infra/modules/ahand-hub/ssm.tf`
- `/Users/winrey/Projects/weightwave/aHand/infra/modules/ahand-hub/iam.tf`
- `/Users/winrey/Projects/weightwave/aHand/.github/workflows/deploy-hub.yml`
- `/Users/winrey/Projects/weightwave/aHand/deploy/hub/deploy.sh`

Modify in folder9:

- `/Users/winrey/Projects/weightwave/folder9/infra/shared/backend.tf`
- `/Users/winrey/Projects/weightwave/folder9/infra/shared/providers.tf`
- `/Users/winrey/Projects/weightwave/folder9/infra/shared/terraform.tfvars`
- `/Users/winrey/Projects/weightwave/folder9/infra/envs/dev/backend.tf`
- `/Users/winrey/Projects/weightwave/folder9/infra/envs/dev/providers.tf`
- `/Users/winrey/Projects/weightwave/folder9/infra/envs/dev/main.tf`
- `/Users/winrey/Projects/weightwave/folder9/infra/envs/dev/terraform.tfvars`
- `/Users/winrey/Projects/weightwave/folder9/.github/workflows/deploy.yml`
- `/Users/winrey/Projects/weightwave/folder9/.github/workflows/deploy-dashboard.yml`
- `/Users/winrey/Projects/weightwave/folder9/deploy.sh`
- `/Users/winrey/Projects/weightwave/folder9/dashboard/deploy.sh`

Modify in openclaw-hive:

- `/Users/winrey/Projects/weightwave/openclaw-hive/.github/workflows/control-plane-dev.yml`
- `/Users/winrey/Projects/weightwave/openclaw-hive/.github/workflows/file-keeper-dev.yml`
- `/Users/winrey/Projects/weightwave/openclaw-hive/.github/workflows/aws-images-dev.yml`
- `/Users/winrey/Projects/weightwave/openclaw-hive/.github/workflows/efs-webdav-dev.yml`
- `/Users/winrey/Projects/weightwave/openclaw-hive/control-plane/task-definition.dev.template.json`
- `/Users/winrey/Projects/weightwave/openclaw-hive/deploy/traefik/deploy-dev.sh`
- `/Users/winrey/Projects/weightwave/openclaw-hive/deploy/traefik/deploy.sh`
- `/Users/winrey/Projects/weightwave/openclaw-hive/Makefile`

Reference in capability-hub:

- `/Users/winrey/Projects/weightwave/capability-hub/src/config/config.schema.ts`
- `/Users/winrey/Projects/weightwave/capability-hub/src/file/file.service.ts`
- `/Users/winrey/Projects/weightwave/capability-hub/src/file/s3-client.provider.ts`

## Task 1: Preflight Snapshot and Branches

**Files:**

- No file changes.

- [ ] **Step 1: Verify all repos are clean before editing**

Run:

```bash
for repo in team9 aHand folder9 openclaw-hive capability-hub; do
  echo "== $repo =="
  git -C "/Users/winrey/Projects/weightwave/$repo" status --short
  git -C "/Users/winrey/Projects/weightwave/$repo" branch --show-current
done
```

Expected: each repo prints its short status followed by its current branch. `team9` should start on `dev`; the other repos may already be on local work branches.

If any repo has unrelated dirty files, leave those files untouched and record them in the runbook before editing.

- [ ] **Step 2: Create implementation branches**

Run:

```bash
git -C /Users/winrey/Projects/weightwave/team9 switch -c codex/team9-dev-aws-migration-plan-execution
git -C /Users/winrey/Projects/weightwave/aHand switch -c codex/team9-dev-aws-migration-ahand
git -C /Users/winrey/Projects/weightwave/folder9 switch -c codex/team9-dev-aws-migration-folder9
git -C /Users/winrey/Projects/weightwave/openclaw-hive switch -c codex/team9-dev-aws-migration-openclaw
```

Expected: each command prints `Switched to a new branch`.

- [ ] **Step 3: Confirm AWS identities**

Run:

```bash
aws sts get-caller-identity --profile ww --query '{Account:Account,Arn:Arn}' --output table
aws sts get-caller-identity --profile t9 --query '{Account:Account,Arn:Arn}' --output table
```

Expected:

```text
ww Account: 471112576951
t9 Account: 149614785083
```

Do not continue if either account differs.

## Task 2: Create Target Account Bootstrap Terraform

**Files:**

- Create: `/Users/winrey/Projects/weightwave/team9/infra/aws/t9-bootstrap/versions.tf`
- Create: `/Users/winrey/Projects/weightwave/team9/infra/aws/t9-bootstrap/providers.tf`
- Create: `/Users/winrey/Projects/weightwave/team9/infra/aws/t9-bootstrap/main.tf`
- Create: `/Users/winrey/Projects/weightwave/team9/infra/aws/t9-bootstrap/outputs.tf`

- [ ] **Step 1: Create bootstrap directory**

Run:

```bash
mkdir -p /Users/winrey/Projects/weightwave/team9/infra/aws/t9-bootstrap
```

Expected: command exits with status 0.

- [ ] **Step 2: Add Terraform versions file**

Write `/Users/winrey/Projects/weightwave/team9/infra/aws/t9-bootstrap/versions.tf`:

```hcl
terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}
```

- [ ] **Step 3: Add provider file**

Write `/Users/winrey/Projects/weightwave/team9/infra/aws/t9-bootstrap/providers.tf`:

```hcl
provider "aws" {
  region  = "us-east-1"
  profile = "t9"

  default_tags {
    tags = {
      Project   = "team9"
      ManagedBy = "Terraform"
      Account   = "t9"
    }
  }
}
```

- [ ] **Step 4: Add bootstrap resources**

Write `/Users/winrey/Projects/weightwave/team9/infra/aws/t9-bootstrap/main.tf`:

```hcl
locals {
  s3_buckets = {
    team9_files_dev           = { name = "team9-files-dev", public_read = false }
    team9_files_prod          = { name = "team9-files-prod", public_read = false }
    ahand_hub_dev             = { name = "team9-ahand-hub-dev", public_read = false }
    ahand_hub_prod            = { name = "team9-ahand-hub-prod", public_read = false }
    capability_hub_dev        = { name = "team9-capability-hub-dev", public_read = true }
    capability_hub_prod       = { name = "team9-capability-hub-prod", public_read = true }
  }

  # aHand's own shared Terraform creates the ahand-hub ECR repository.
  # folder9 dev looks up its ECR repositories as pre-existing resources, so
  # bootstrap creates those two repos before the dev stack runs.
  ecr_repositories = toset([
    "control-plane",
    "file-keeper",
    "efs-webdav",
    "openclaw-hive",
    "folder9",
    "folder9-dashboard",
  ])
}

resource "aws_s3_bucket" "tfstate" {
  bucket = "team9-tfstate"
}

resource "aws_s3_bucket_versioning" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "tfstate" {
  bucket                  = aws_s3_bucket.tfstate.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_dynamodb_table" "terraform_state_lock" {
  name         = "terraform-state-lock"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }
}

resource "aws_s3_bucket" "service" {
  for_each = local.s3_buckets
  bucket   = each.value.name
}

resource "aws_s3_bucket_server_side_encryption_configuration" "service" {
  for_each = aws_s3_bucket.service
  bucket   = each.value.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "service_private" {
  for_each = {
    for key, cfg in local.s3_buckets : key => cfg
    if cfg.public_read == false
  }

  bucket                  = aws_s3_bucket.service[each.key].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_public_access_block" "service_public_read" {
  for_each = {
    for key, cfg in local.s3_buckets : key => cfg
    if cfg.public_read == true
  }

  bucket                  = aws_s3_bucket.service[each.key].id
  block_public_acls       = true
  block_public_policy     = false
  ignore_public_acls      = true
  restrict_public_buckets = false
}

resource "aws_s3_bucket_policy" "capability_hub_public_read" {
  for_each = {
    for key, cfg in local.s3_buckets : key => cfg
    if cfg.public_read == true
  }

  bucket = aws_s3_bucket.service[each.key].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "PublicReadObjects"
        Effect    = "Allow"
        Principal = "*"
        Action    = "s3:GetObject"
        Resource  = "${aws_s3_bucket.service[each.key].arn}/*"
      }
    ]
  })
}

resource "aws_s3_bucket_lifecycle_configuration" "team9_files" {
  bucket = aws_s3_bucket.service["team9_files_dev"].id

  rule {
    id     = "auto-delete-pending-uploads"
    status = "Enabled"

    filter {
      tag {
        key   = "status"
        value = "pending"
      }
    }

    expiration {
      days = 1
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "ahand_hub_dev" {
  bucket = aws_s3_bucket.service["ahand_hub_dev"].id

  rule {
    id     = "expire-file-ops-dev"
    status = "Enabled"

    filter {
      prefix = "file-ops/"
    }

    expiration {
      days = 7
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

resource "aws_ecr_repository" "service" {
  for_each             = local.ecr_repositories
  name                 = each.value
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}
```

- [ ] **Step 5: Add outputs**

Write `/Users/winrey/Projects/weightwave/team9/infra/aws/t9-bootstrap/outputs.tf`:

```hcl
output "tfstate_bucket" {
  value = aws_s3_bucket.tfstate.bucket
}

output "lock_table" {
  value = aws_dynamodb_table.terraform_state_lock.name
}

output "service_buckets" {
  value = {
    for key, bucket in aws_s3_bucket.service : key => bucket.bucket
  }
}

output "ecr_repository_urls" {
  value = {
    for name, repo in aws_ecr_repository.service : name => repo.repository_url
  }
}
```

- [ ] **Step 6: Format and validate**

Run:

```bash
cd /Users/winrey/Projects/weightwave/team9/infra/aws/t9-bootstrap
terraform fmt -recursive
terraform init
terraform validate
terraform plan -out /tmp/t9-bootstrap.tfplan
```

Expected:

```text
Success! The configuration is valid.
```

The plan output must contain only create actions for the bootstrap resources in this task, with `0 to change` and `0 to destroy`.

- [ ] **Step 7: Review the plan before apply**

Run:

```bash
cd /Users/winrey/Projects/weightwave/team9/infra/aws/t9-bootstrap
terraform show -no-color /tmp/t9-bootstrap.tfplan | sed -n '1,240p'
```

Expected: only `team9-tfstate`, `terraform-state-lock`, approved `team9-*` S3 buckets, and listed ECR repositories are planned.

- [ ] **Step 8: Commit bootstrap Terraform**

Run:

```bash
cd /Users/winrey/Projects/weightwave/team9
git add infra/aws/t9-bootstrap
git commit -m "infra: add t9 aws bootstrap"
```

Expected: commit succeeds.

## Task 3: Apply Target Bootstrap Resources

**Files:**

- No file changes.

- [ ] **Step 1: Re-check bucket name availability**

Run:

```bash
for b in team9-tfstate team9-files-dev team9-files-prod team9-ahand-hub-dev team9-ahand-hub-prod team9-capability-hub-dev team9-capability-hub-prod; do
  aws s3api head-bucket --profile t9 --bucket "$b" >/tmp/head-"$b".out 2>/tmp/head-"$b".err
  code=$?
  echo "$b $code $(tr '\n' ' ' </tmp/head-"$b".err)"
done
```

Expected: every bucket prints `404` / `Not Found`, or prints success only if the bucket is already owned by the `t9` account from a previous successful run.

- [ ] **Step 2: Apply bootstrap Terraform**

Run:

```bash
cd /Users/winrey/Projects/weightwave/team9/infra/aws/t9-bootstrap
terraform apply /tmp/t9-bootstrap.tfplan
```

Expected: apply completes with approved resources created.

- [ ] **Step 3: Verify target buckets and repositories**

Run:

```bash
aws s3api list-buckets --profile t9 --query 'Buckets[?starts_with(Name, `team9-`)].Name' --output table
aws ecr describe-repositories --profile t9 --region us-east-1 --query 'repositories[].repositoryName' --output table
aws dynamodb describe-table --profile t9 --region us-east-1 --table-name terraform-state-lock --query 'Table.TableStatus' --output text
```

Expected:

```text
team9-tfstate
team9-files-dev
team9-files-prod
team9-ahand-hub-dev
team9-ahand-hub-prod
team9-capability-hub-dev
team9-capability-hub-prod
ACTIVE
```

## Task 3A: Create Target Dev Core Infrastructure

**Files:**

- Create: `/Users/winrey/Projects/weightwave/team9/infra/aws/t9-dev-core/versions.tf`
- Create: `/Users/winrey/Projects/weightwave/team9/infra/aws/t9-dev-core/backend.tf`
- Create: `/Users/winrey/Projects/weightwave/team9/infra/aws/t9-dev-core/providers.tf`
- Create: `/Users/winrey/Projects/weightwave/team9/infra/aws/t9-dev-core/main.tf`
- Create: `/Users/winrey/Projects/weightwave/team9/infra/aws/t9-dev-core/outputs.tf`

- [ ] **Step 1: Create dev core directory**

Run:

```bash
mkdir -p /Users/winrey/Projects/weightwave/team9/infra/aws/t9-dev-core
```

Expected: command exits with status 0.

- [ ] **Step 2: Add Terraform versions file**

Write `/Users/winrey/Projects/weightwave/team9/infra/aws/t9-dev-core/versions.tf`:

```hcl
terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}
```

- [ ] **Step 3: Add remote backend**

Write `/Users/winrey/Projects/weightwave/team9/infra/aws/t9-dev-core/backend.tf`:

```hcl
terraform {
  backend "s3" {
    bucket         = "team9-tfstate"
    key            = "team9/dev-core/terraform.tfstate"
    region         = "us-east-1"
    profile        = "t9"
    dynamodb_table = "terraform-state-lock"
    encrypt        = true
  }
}
```

- [ ] **Step 4: Add provider file**

Write `/Users/winrey/Projects/weightwave/team9/infra/aws/t9-dev-core/providers.tf`:

```hcl
provider "aws" {
  region  = "us-east-1"
  profile = "t9"

  default_tags {
    tags = {
      Project     = "team9"
      Environment = "dev"
      ManagedBy   = "Terraform"
      Stack       = "dev-core"
    }
  }
}
```

- [ ] **Step 5: Add dev core resources**

Write `/Users/winrey/Projects/weightwave/team9/infra/aws/t9-dev-core/main.tf`:

```hcl
data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  azs = slice(data.aws_availability_zones.available.names, 0, 2)
}

resource "aws_vpc" "dev" {
  cidr_block           = "10.90.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name = "team9-dev"
  }
}

resource "aws_internet_gateway" "dev" {
  vpc_id = aws_vpc.dev.id

  tags = {
    Name = "team9-dev"
  }
}

resource "aws_subnet" "public" {
  for_each = {
    a = { cidr = "10.90.1.0/24", az = local.azs[0] }
    b = { cidr = "10.90.2.0/24", az = local.azs[1] }
  }

  vpc_id                  = aws_vpc.dev.id
  cidr_block              = each.value.cidr
  availability_zone       = each.value.az
  map_public_ip_on_launch = true

  tags = {
    Name = "team9-dev-public-${each.key}"
  }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.dev.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.dev.id
  }

  tags = {
    Name = "team9-dev-public"
  }
}

resource "aws_route_table_association" "public" {
  for_each       = aws_subnet.public
  subnet_id      = each.value.id
  route_table_id = aws_route_table.public.id
}

resource "aws_ecs_cluster" "openclaw_hive_dev" {
  name = "openclaw-hive-dev"
}

resource "aws_security_group" "rds" {
  name        = "openclaw-hive-dev-rds"
  description = "PostgreSQL ingress from Team9 dev VPC"
  vpc_id      = aws_vpc.dev.id

  ingress {
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = [aws_vpc.dev.cidr_block]
    description = "PostgreSQL from dev VPC"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "openclaw_traefik" {
  name        = "openclaw-hive-dev-traefik"
  description = "OpenClaw Hive dev Traefik ingress and egress"
  vpc_id      = aws_vpc.dev.id

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "HTTP from internet"
  }

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "HTTPS from internet"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_db_subnet_group" "openclaw_hive_dev" {
  name       = "openclaw-hive-dev"
  subnet_ids = [for subnet in aws_subnet.public : subnet.id]
}

resource "aws_security_group" "efs" {
  name        = "openclaw-hive-dev-efs"
  description = "NFS ingress from Team9 dev VPC"
  vpc_id      = aws_vpc.dev.id

  ingress {
    from_port   = 2049
    to_port     = 2049
    protocol    = "tcp"
    cidr_blocks = [aws_vpc.dev.cidr_block]
    description = "NFS from dev VPC"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_efs_file_system" "openclaw_hive_dev" {
  creation_token = "openclaw-hive-dev"
  encrypted      = true

  tags = {
    Name = "openclaw-hive-dev"
  }
}

resource "aws_efs_file_system" "openclaw_hive_dev_efs" {
  creation_token = "openclaw-hive-dev-efs"
  encrypted      = true

  tags = {
    Name = "openclaw-hive-dev-efs"
  }
}

resource "aws_efs_mount_target" "openclaw_hive_dev" {
  for_each        = aws_subnet.public
  file_system_id  = aws_efs_file_system.openclaw_hive_dev.id
  subnet_id       = each.value.id
  security_groups = [aws_security_group.efs.id]
}

resource "aws_efs_mount_target" "openclaw_hive_dev_efs" {
  for_each        = aws_subnet.public
  file_system_id  = aws_efs_file_system.openclaw_hive_dev_efs.id
  subnet_id       = each.value.id
  security_groups = [aws_security_group.efs.id]
}
```

- [ ] **Step 6: Add dev core outputs**

Write `/Users/winrey/Projects/weightwave/team9/infra/aws/t9-dev-core/outputs.tf`:

```hcl
output "vpc_id" {
  value = aws_vpc.dev.id
}

output "public_subnet_ids" {
  value = [for subnet in aws_subnet.public : subnet.id]
}

output "openclaw_cluster_name" {
  value = aws_ecs_cluster.openclaw_hive_dev.name
}

output "rds_security_group_id" {
  value = aws_security_group.rds.id
}

output "openclaw_traefik_security_group_id" {
  value = aws_security_group.openclaw_traefik.id
}

output "db_subnet_group_name" {
  value = aws_db_subnet_group.openclaw_hive_dev.name
}

output "efs_security_group_id" {
  value = aws_security_group.efs.id
}

output "openclaw_hive_dev_efs_id" {
  value = aws_efs_file_system.openclaw_hive_dev.id
}

output "openclaw_hive_dev_extra_efs_id" {
  value = aws_efs_file_system.openclaw_hive_dev_efs.id
}
```

- [ ] **Step 7: Plan and apply dev core**

Run:

```bash
cd /Users/winrey/Projects/weightwave/team9/infra/aws/t9-dev-core
terraform fmt -recursive
terraform init
terraform validate
terraform plan -out /tmp/t9-dev-core.tfplan
terraform apply /tmp/t9-dev-core.tfplan
```

Expected: Terraform creates one dedicated VPC, two public subnets, one openclaw-hive dev ECS cluster, one RDS subnet group, one RDS security group, one OpenClaw Traefik security group, one EFS security group, and two openclaw EFS file systems in `t9`.

- [ ] **Step 8: Commit dev core Terraform**

Run:

```bash
cd /Users/winrey/Projects/weightwave/team9
git add infra/aws/t9-dev-core
git commit -m "infra: add t9 dev core network"
```

Expected: commit succeeds.

## Task 4: Migrate aHand IaC and Deploy Trust to t9

**Files:**

- Modify: `/Users/winrey/Projects/weightwave/aHand/infra/shared/backend.tf`
- Modify: `/Users/winrey/Projects/weightwave/aHand/infra/shared/providers.tf`
- Modify: `/Users/winrey/Projects/weightwave/aHand/infra/shared/variables.tf`
- Modify: `/Users/winrey/Projects/weightwave/aHand/infra/envs/dev/backend.tf`
- Modify: `/Users/winrey/Projects/weightwave/aHand/infra/envs/dev/providers.tf`
- Modify: `/Users/winrey/Projects/weightwave/aHand/infra/modules/ahand-hub/variables.tf`
- Modify: `/Users/winrey/Projects/weightwave/aHand/infra/modules/ahand-hub/ssm.tf`
- Modify: `/Users/winrey/Projects/weightwave/aHand/.github/workflows/deploy-hub.yml`
- Modify: `/Users/winrey/Projects/weightwave/aHand/deploy/hub/deploy.sh`

- [ ] **Step 1: Replace Terraform backend account settings**

In both aHand backend files, set:

```hcl
bucket         = "team9-tfstate"
profile        = "t9"
dynamodb_table = "terraform-state-lock"
```

Preserve the existing `key` values:

```hcl
key = "ahand-hub/shared/terraform.tfstate"
key = "ahand-hub/envs/dev/terraform.tfstate"
```

- [ ] **Step 2: Replace aHand AWS provider profile**

In both aHand provider files, set:

```hcl
provider "aws" {
  region  = "us-east-1"
  profile = "t9"
```

- [ ] **Step 3: Set target account default**

In `/Users/winrey/Projects/weightwave/aHand/infra/shared/variables.tf` and `/Users/winrey/Projects/weightwave/aHand/infra/modules/ahand-hub/variables.tf`, set:

```hcl
default     = "149614785083"
```

for `variable "aws_account_id"`.

- [ ] **Step 4: Add explicit aHand S3 bucket parameter**

In `/Users/winrey/Projects/weightwave/aHand/infra/modules/ahand-hub/ssm.tf`, add:

```hcl
resource "aws_ssm_parameter" "s3_bucket" {
  name  = "/ahand-hub/${var.env}/S3_BUCKET"
  type  = "String"
  value = "team9-ahand-hub-${var.env}"
  tags  = local.common_tags
}

resource "aws_ssm_parameter" "s3_region" {
  name  = "/ahand-hub/${var.env}/S3_REGION"
  type  = "String"
  value = var.aws_region
  tags  = local.common_tags
}
```

- [ ] **Step 5: Update GitHub Actions target account**

In `/Users/winrey/Projects/weightwave/aHand/.github/workflows/deploy-hub.yml`, set:

```yaml
env:
  AWS_REGION: us-east-1
  ECR_REGISTRY: 149614785083.dkr.ecr.us-east-1.amazonaws.com
  ECR_REPO: ahand-hub
```

and:

```yaml
role-to-assume: arn:aws:iam::149614785083:role/GitHubActionsAhandHubDeploy
```

- [ ] **Step 6: Update deploy script account**

In `/Users/winrey/Projects/weightwave/aHand/deploy/hub/deploy.sh`, set:

```bash
ACCOUNT_ID="149614785083"
```

- [ ] **Step 7: Validate aHand Terraform without applying**

Run this after Task 3A has applied dev core and Task 9 Step 3 has restored `openclaw-hive-dev` in `t9`.

Run:

```bash
export TF_VAR_vpc_id="$(terraform -chdir=/Users/winrey/Projects/weightwave/team9/infra/aws/t9-dev-core output -raw vpc_id)"
export TF_VAR_subnet_ids="$(terraform -chdir=/Users/winrey/Projects/weightwave/team9/infra/aws/t9-dev-core output -json public_subnet_ids)"
export TF_VAR_traefik_security_group_id="$(terraform -chdir=/Users/winrey/Projects/weightwave/team9/infra/aws/t9-dev-core output -raw openclaw_traefik_security_group_id)"
export TF_VAR_openclaw_rds_security_group_id="$(terraform -chdir=/Users/winrey/Projects/weightwave/team9/infra/aws/t9-dev-core output -raw rds_security_group_id)"
export TF_VAR_openclaw_rds_host="$(aws rds describe-db-instances --profile t9 --region us-east-1 --db-instance-identifier openclaw-hive-dev --query 'DBInstances[0].Endpoint.Address' --output text)"

cd /Users/winrey/Projects/weightwave/aHand/infra/shared
terraform init -reconfigure
terraform fmt -recursive
terraform validate
terraform plan -out /tmp/ahand-shared-t9.tfplan

cd /Users/winrey/Projects/weightwave/aHand/infra/envs/dev
terraform init -reconfigure
terraform fmt -recursive
terraform validate
terraform plan -out /tmp/ahand-dev-t9.tfplan
```

Expected:

```text
Success! The configuration is valid.
```

The dev plan must create resources in account `149614785083`, not `471112576951`.

- [ ] **Step 8: Commit aHand changes**

Run:

```bash
cd /Users/winrey/Projects/weightwave/aHand
git add infra .github/workflows/deploy-hub.yml deploy/hub/deploy.sh
git commit -m "infra: retarget ahand hub dev to t9 aws"
```

Expected: commit succeeds.

## Task 5: Migrate folder9 IaC and Deploy Trust to t9

**Files:**

- Modify: `/Users/winrey/Projects/weightwave/folder9/infra/shared/backend.tf`
- Modify: `/Users/winrey/Projects/weightwave/folder9/infra/shared/providers.tf`
- Modify: `/Users/winrey/Projects/weightwave/folder9/infra/shared/terraform.tfvars`
- Modify: `/Users/winrey/Projects/weightwave/folder9/infra/envs/dev/backend.tf`
- Modify: `/Users/winrey/Projects/weightwave/folder9/infra/envs/dev/providers.tf`
- Modify: `/Users/winrey/Projects/weightwave/folder9/infra/envs/dev/main.tf`
- Modify: `/Users/winrey/Projects/weightwave/folder9/infra/envs/dev/terraform.tfvars`
- Modify: `/Users/winrey/Projects/weightwave/folder9/.github/workflows/deploy.yml`
- Modify: `/Users/winrey/Projects/weightwave/folder9/.github/workflows/deploy-dashboard.yml`
- Modify: `/Users/winrey/Projects/weightwave/folder9/deploy.sh`
- Modify: `/Users/winrey/Projects/weightwave/folder9/dashboard/deploy.sh`

- [ ] **Step 1: Replace Terraform backend account settings**

In folder9 backend files, set:

```hcl
bucket         = "team9-tfstate"
profile        = "t9"
dynamodb_table = "terraform-state-lock"
```

Preserve existing state keys:

```hcl
key = "folder9/shared/terraform.tfstate"
key = "folder9/dev/terraform.tfstate"
```

- [ ] **Step 2: Replace folder9 AWS provider profile**

In folder9 provider files, set:

```hcl
provider "aws" {
  region  = "us-east-1"
  profile = "t9"
```

- [ ] **Step 3: Set target account values**

In `/Users/winrey/Projects/weightwave/folder9/infra/shared/terraform.tfvars`, set:

```hcl
aws_account_id       = "149614785083"
create_oidc_provider = true
```

In `/Users/winrey/Projects/weightwave/folder9/infra/envs/dev/terraform.tfvars`, replace the Cloudflare token ARN with:

```hcl
cloudflare_token_ssm_arn = "arn:aws:ssm:us-east-1:149614785083:parameter/folder9/shared/cloudflare_dns_token"
```

- [ ] **Step 4: Update remote state profile**

In `/Users/winrey/Projects/weightwave/folder9/infra/envs/dev/main.tf`, set the remote state config to:

```hcl
data "terraform_remote_state" "shared" {
  backend = "s3"
  config = {
    bucket  = "team9-tfstate"
    key     = "folder9/shared/terraform.tfstate"
    region  = "us-east-1"
    profile = "t9"
  }
}
```

- [ ] **Step 5: Update GitHub Actions target account**

In `/Users/winrey/Projects/weightwave/folder9/.github/workflows/deploy.yml` and `/Users/winrey/Projects/weightwave/folder9/.github/workflows/deploy-dashboard.yml`, set:

```yaml
ECR_REGISTRY: 149614785083.dkr.ecr.us-east-1.amazonaws.com
```

and:

```yaml
role-to-assume: arn:aws:iam::149614785083:role/GitHubActionsFolder9Deploy
```

- [ ] **Step 6: Update deploy scripts account IDs**

In `/Users/winrey/Projects/weightwave/folder9/deploy.sh` and `/Users/winrey/Projects/weightwave/folder9/dashboard/deploy.sh`, replace source account references:

```bash
471112576951
```

with:

```bash
149614785083
```

- [ ] **Step 7: Validate folder9 Terraform without applying**

Run this after Task 3A has applied dev core and Task 9 Step 3 has restored `openclaw-hive-dev` in `t9`.

Run:

```bash
export TF_VAR_vpc_id="$(terraform -chdir=/Users/winrey/Projects/weightwave/team9/infra/aws/t9-dev-core output -raw vpc_id)"
export TF_VAR_subnet_ids="$(terraform -chdir=/Users/winrey/Projects/weightwave/team9/infra/aws/t9-dev-core output -json public_subnet_ids)"
export TF_VAR_nlb_subnet_ids="$(terraform -chdir=/Users/winrey/Projects/weightwave/team9/infra/aws/t9-dev-core output -json public_subnet_ids)"
export TF_VAR_rds_security_group_id="$(terraform -chdir=/Users/winrey/Projects/weightwave/team9/infra/aws/t9-dev-core output -raw rds_security_group_id)"
export RDS_HOST="$(aws rds describe-db-instances --profile t9 --region us-east-1 --db-instance-identifier openclaw-hive-dev --query 'DBInstances[0].Endpoint.Address' --output text)"
export TF_VAR_rds_endpoint="${RDS_HOST}:5432"

cd /Users/winrey/Projects/weightwave/folder9/infra/shared
terraform init -reconfigure
terraform fmt -recursive
terraform validate
terraform plan -out /tmp/folder9-shared-t9.tfplan

cd /Users/winrey/Projects/weightwave/folder9/infra/envs/dev
terraform init -reconfigure
terraform fmt -recursive
terraform validate
terraform plan -out /tmp/folder9-dev-t9.tfplan
```

Expected:

```text
Success! The configuration is valid.
```

The plans must target account `149614785083`.

- [ ] **Step 8: Commit folder9 changes**

Run:

```bash
cd /Users/winrey/Projects/weightwave/folder9
git add infra .github/workflows/deploy.yml .github/workflows/deploy-dashboard.yml deploy.sh dashboard/deploy.sh
git commit -m "infra: retarget folder9 dev to t9 aws"
```

Expected: commit succeeds.

## Task 6: Standardize openclaw-hive Dev Deploy Path for t9

**Files:**

- Modify: `/Users/winrey/Projects/weightwave/openclaw-hive/.github/workflows/control-plane-dev.yml`
- Modify: `/Users/winrey/Projects/weightwave/openclaw-hive/.github/workflows/file-keeper-dev.yml`
- Modify: `/Users/winrey/Projects/weightwave/openclaw-hive/.github/workflows/aws-images-dev.yml`
- Modify: `/Users/winrey/Projects/weightwave/openclaw-hive/.github/workflows/efs-webdav-dev.yml`
- Modify: `/Users/winrey/Projects/weightwave/openclaw-hive/control-plane/task-definition.dev.template.json`
- Modify: `/Users/winrey/Projects/weightwave/openclaw-hive/deploy/traefik/deploy-dev.sh`
- Modify: `/Users/winrey/Projects/weightwave/openclaw-hive/deploy/traefik/deploy.sh`
- Modify: `/Users/winrey/Projects/weightwave/openclaw-hive/Makefile`

- [ ] **Step 1: Switch dev workflows from static keys to OIDC**

In each dev workflow, set:

```yaml
permissions:
  id-token: write
  contents: read
```

Replace:

```yaml
aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
```

with:

```yaml
role-to-assume: arn:aws:iam::149614785083:role/GitHubActionsOpenClawHiveDevDeploy
```

Keep:

```yaml
aws-region: ${{ env.AWS_REGION }}
```

- [ ] **Step 2: Set target ECR registry account**

In dev workflows and shell scripts, replace:

```text
471112576951.dkr.ecr.us-east-1.amazonaws.com
```

with:

```text
149614785083.dkr.ecr.us-east-1.amazonaws.com
```

- [ ] **Step 3: Remove hardcoded source EFS from EFS WebDAV workflow**

In `/Users/winrey/Projects/weightwave/openclaw-hive/.github/workflows/efs-webdav-dev.yml`, replace:

```yaml
EFS_FILESYSTEM_ID: fs-0f3888df726d8d9f8
```

with:

```yaml
EFS_FILESYSTEM_ID: ${{ vars.OPENCLAW_HIVE_DEV_EFS_FILESYSTEM_ID }}
```

- [ ] **Step 4: Replace hardcoded account IDs in scripts**

In `/Users/winrey/Projects/weightwave/openclaw-hive/Makefile`, `/Users/winrey/Projects/weightwave/openclaw-hive/deploy/traefik/deploy-dev.sh`, and `/Users/winrey/Projects/weightwave/openclaw-hive/deploy/traefik/deploy.sh`, replace account `471112576951` with `149614785083`.

Use t9 role names:

```bash
EXECUTION_ROLE_ARN="arn:aws:iam::149614785083:role/ecsTaskExecutionRole"
TASK_ROLE_ARN="arn:aws:iam::149614785083:role/ecsTaskRole"
```

- [ ] **Step 5: Keep task-definition env values domain-stable**

In `/Users/winrey/Projects/weightwave/openclaw-hive/control-plane/task-definition.dev.template.json`, keep these values unchanged unless the target dev domains change:

```json
{ "name": "DOMAIN", "value": "instance.claw.dev.team9.ai" },
{ "name": "CONTROL_PLANE_URL", "value": "https://plane.claw.dev.team9.ai" },
{ "name": "TEAM9_BASE_URL", "value": "https://api.dev.team9.ai" },
{ "name": "AWS_ECS_CLUSTER", "value": "openclaw-hive-dev" }
```

Replace only source-account or source-resource IDs found by:

```bash
rg -n "471112576951|fs-0f3888df726d8d9f8|chq8i2se49qd|dd3mb5" /Users/winrey/Projects/weightwave/openclaw-hive
```

The execution step must replace found source IDs with `t9` output values, not with guessed IDs.

- [ ] **Step 6: Validate workflows are syntactically parseable**

Run:

```bash
cd /Users/winrey/Projects/weightwave/openclaw-hive
python - <<'PY'
import pathlib, yaml
for path in pathlib.Path(".github/workflows").glob("*dev.yml"):
    with path.open() as f:
        yaml.safe_load(f)
    print(f"ok {path}")
PY
```

Expected: every dev workflow prints `ok`.

- [ ] **Step 7: Commit openclaw-hive deploy path changes**

Run:

```bash
cd /Users/winrey/Projects/weightwave/openclaw-hive
git add .github/workflows control-plane/task-definition.dev.template.json deploy/traefik Makefile
git commit -m "infra: retarget openclaw dev deploys to t9 aws"
```

Expected: commit succeeds.

## Task 7: Apply Service IaC in t9

**Files:**

- No new source files beyond Tasks 4-6.

- [ ] **Step 1: Apply aHand shared and dev stacks**

Run:

```bash
cd /Users/winrey/Projects/weightwave/aHand/infra/shared
terraform apply /tmp/ahand-shared-t9.tfplan

cd /Users/winrey/Projects/weightwave/aHand/infra/envs/dev
terraform apply /tmp/ahand-dev-t9.tfplan
```

Expected: aHand OIDC role, task roles, SSM parameters, ECS service stub, RDS/Redis access rules, and S3 SSM params are created in `t9`.

- [ ] **Step 2: Apply folder9 shared and dev stacks**

Run:

```bash
cd /Users/winrey/Projects/weightwave/folder9/infra/shared
terraform apply /tmp/folder9-shared-t9.tfplan

cd /Users/winrey/Projects/weightwave/folder9/infra/envs/dev
terraform apply /tmp/folder9-dev-t9.tfplan
```

Expected: folder9 OIDC role, ECS cluster, NLB, EFS, services, dashboard, SSM parameters, and security groups are created in `t9`.

- [ ] **Step 3: Verify target ECS/RDS/EFS/SSM inventory**

Run:

```bash
aws ecs list-clusters --profile t9 --region us-east-1 --output table
aws rds describe-db-instances --profile t9 --region us-east-1 --query 'DBInstances[].DBInstanceIdentifier' --output table
aws efs describe-file-systems --profile t9 --region us-east-1 --query 'FileSystems[].{Id:FileSystemId,Name:Name}' --output table
aws ssm describe-parameters --profile t9 --region us-east-1 --query 'Parameters[].Name' --output table
```

Expected: target resources exist and source account IDs do not appear.

## Task 8: Copy S3 Data

**Files:**

- Modify: `/Users/winrey/Projects/weightwave/team9/docs/aws/team9-dev-aws-migration-runbook.md`

- [ ] **Step 1: Create runbook directory**

Run:

```bash
mkdir -p /Users/winrey/Projects/weightwave/team9/docs/aws
```

Expected: command exits with status 0.

- [ ] **Step 2: Add S3 copy commands to runbook**

Write this section into `/Users/winrey/Projects/weightwave/team9/docs/aws/team9-dev-aws-migration-runbook.md`:

````markdown
# Team9 Dev AWS Migration Runbook

## S3 Pre-Copy

Run before write-freeze. The local staging directory is safe because the known S3 data is under 1 GB:

```bash
mkdir -p /tmp/team9-s3-migration
aws s3 sync s3://ahand-hub-dev /tmp/team9-s3-migration/ahand-hub-dev --region us-east-1 --profile ww
aws s3 sync /tmp/team9-s3-migration/ahand-hub-dev s3://team9-ahand-hub-dev --region us-east-1 --profile t9
aws s3 sync s3://t9-development /tmp/team9-s3-migration/t9-development --region us-east-1 --profile ww
aws s3 sync /tmp/team9-s3-migration/t9-development s3://team9-files-dev --region us-east-1 --profile t9
aws s3 sync s3://capability-hub /tmp/team9-s3-migration/capability-hub --region us-east-1 --profile ww
aws s3 sync /tmp/team9-s3-migration/capability-hub s3://team9-capability-hub-prod --region us-east-1 --profile t9
```

Run during write-freeze:

```bash
aws s3 sync s3://ahand-hub-dev /tmp/team9-s3-migration/ahand-hub-dev --region us-east-1 --profile ww --delete
aws s3 sync /tmp/team9-s3-migration/ahand-hub-dev s3://team9-ahand-hub-dev --region us-east-1 --profile t9 --delete
aws s3 sync s3://t9-development /tmp/team9-s3-migration/t9-development --region us-east-1 --profile ww --delete
aws s3 sync /tmp/team9-s3-migration/t9-development s3://team9-files-dev --region us-east-1 --profile t9 --delete
aws s3 sync s3://capability-hub /tmp/team9-s3-migration/capability-hub --region us-east-1 --profile ww --delete
aws s3 sync /tmp/team9-s3-migration/capability-hub s3://team9-capability-hub-prod --region us-east-1 --profile t9 --delete
```
````

- [ ] **Step 3: Run S3 pre-copy**

Run:

```bash
mkdir -p /tmp/team9-s3-migration
aws s3 sync s3://ahand-hub-dev /tmp/team9-s3-migration/ahand-hub-dev --region us-east-1 --profile ww
aws s3 sync /tmp/team9-s3-migration/ahand-hub-dev s3://team9-ahand-hub-dev --region us-east-1 --profile t9
aws s3 sync s3://t9-development /tmp/team9-s3-migration/t9-development --region us-east-1 --profile ww
aws s3 sync /tmp/team9-s3-migration/t9-development s3://team9-files-dev --region us-east-1 --profile t9
aws s3 sync s3://capability-hub /tmp/team9-s3-migration/capability-hub --region us-east-1 --profile ww
aws s3 sync /tmp/team9-s3-migration/capability-hub s3://team9-capability-hub-prod --region us-east-1 --profile t9
```

Expected: no `fatal error` lines. If AccessDenied appears on download, verify the `ww` profile still has read access to the source bucket. If AccessDenied appears on upload, verify the `t9` profile has write access to the target bucket.

- [ ] **Step 4: Verify S3 object counts**

Run:

```bash
for b in team9-ahand-hub-dev team9-files-dev team9-capability-hub-prod; do
  aws cloudwatch get-metric-data --profile t9 --region us-east-1 \
    --start-time "$(date -u -v-3d +%Y-%m-%dT%H:%M:%SZ)" \
    --end-time "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --metric-data-queries "[{\"Id\":\"objects\",\"MetricStat\":{\"Metric\":{\"Namespace\":\"AWS/S3\",\"MetricName\":\"NumberOfObjects\",\"Dimensions\":[{\"Name\":\"BucketName\",\"Value\":\"$b\"},{\"Name\":\"StorageType\",\"Value\":\"AllStorageTypes\"}]},\"Period\":86400,\"Stat\":\"Average\"},\"ReturnData\":true}]" \
    --query 'MetricDataResults[0].Values[0]' --output text
done
```

Expected after CloudWatch S3 daily metrics refresh:

```text
team9-ahand-hub-dev: approximately 2 objects
team9-files-dev: approximately 137 objects
team9-capability-hub-prod: approximately 432 objects
```

- [ ] **Step 5: Commit runbook**

Run:

```bash
cd /Users/winrey/Projects/weightwave/team9
git add docs/aws/team9-dev-aws-migration-runbook.md
git commit -m "docs: add aws migration runbook"
```

Expected: commit succeeds.

## Task 9: Migrate RDS and EFS Data

**Files:**

- Modify: `/Users/winrey/Projects/weightwave/team9/docs/aws/team9-dev-aws-migration-runbook.md`

- [ ] **Step 1: Add RDS snapshot procedure to runbook**

Append:

````markdown
## RDS Final Snapshot and Restore

During write-freeze:

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

Then copy or restore the shared snapshot in the `t9` account. Prefer an encrypted copy in `t9`:

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
````

- [ ] **Step 2: Add EFS copy procedure to runbook**

Append:

````markdown
## EFS Copy

Copy these source file systems:

- `fs-05f7f1c836631ddce` (`folder9-dev`)
- `fs-057baa1f60ff58b91` (`folder9-dev-acme`)
- `fs-0f3888df726d8d9f8` (`openclaw-hive-dev`)
- `fs-0920bb3d4db7aa843` (`openclaw-hive-dev-efs`)

Use AWS DataSync when available. If DataSync is not already configured, run a temporary migration EC2 instance with both source and target EFS mounted over reachable networking. Copy with:

```bash
sudo rsync -aHAX --numeric-ids --info=progress2 /mnt/source/ /mnt/target/
sudo find /mnt/target -maxdepth 2 -type f | head -50
```

Run the same `rsync` commands once before write-freeze and once during write-freeze.
````

- [ ] **Step 3: Execute RDS final snapshot only during write-freeze**

Run the runbook commands under `RDS Final Snapshot and Restore`.

Expected:

```text
aws rds wait db-snapshot-completed exits 0 in both accounts.
aws rds wait db-instance-available exits 0 in t9.
The final command prints the target RDS endpoint hostname.
```

- [ ] **Step 4: Execute EFS final sync only during write-freeze**

Run the runbook commands under `EFS Copy`.

Expected:

```text
rsync exits 0.
```

- [ ] **Step 5: Commit data migration runbook additions**

Run:

```bash
cd /Users/winrey/Projects/weightwave/team9
git add docs/aws/team9-dev-aws-migration-runbook.md
git commit -m "docs: add rds and efs migration steps"
```

Expected: commit succeeds.

## Task 10: Write-Freeze, Cutover, and Validation

**Files:**

- Modify: `/Users/winrey/Projects/weightwave/team9/docs/aws/team9-dev-aws-migration-runbook.md`

- [ ] **Step 1: Add write-freeze commands**

Append:

````markdown
## Write-Freeze

Scale source dev services down:

```bash
aws ecs update-service --profile ww --region us-east-1 --cluster openclaw-hive-dev --service ahand-hub-dev --desired-count 0
aws ecs update-service --profile ww --region us-east-1 --cluster openclaw-hive-dev --service control-plane-dev --desired-count 0
aws ecs update-service --profile ww --region us-east-1 --cluster openclaw-hive-dev --service file-keeper-dev --desired-count 0
aws ecs update-service --profile ww --region us-east-1 --cluster folder9-dev --service folder9-dev --desired-count 0
aws ecs update-service --profile ww --region us-east-1 --cluster folder9-dev --service folder9-dashboard-dev --desired-count 0
```

Do not scale down `traefik-dev` or `folder9-traefik-dev` until DNS cutover is ready; keeping them up allows fast rollback before target validation.
````

- [ ] **Step 2: Add target start commands**

Append:

````markdown
## Start Target Services

After final data sync and target SSM values are verified:

```bash
aws ecs update-service --profile t9 --region us-east-1 --cluster openclaw-hive-dev --service ahand-hub-dev --desired-count 1
aws ecs update-service --profile t9 --region us-east-1 --cluster openclaw-hive-dev --service control-plane-dev --desired-count 1
aws ecs update-service --profile t9 --region us-east-1 --cluster openclaw-hive-dev --service file-keeper-dev --desired-count 1
aws ecs update-service --profile t9 --region us-east-1 --cluster folder9-dev --service folder9-dev --desired-count 2
aws ecs update-service --profile t9 --region us-east-1 --cluster folder9-dev --service folder9-dashboard-dev --desired-count 1
```
````

- [ ] **Step 3: Add DNS validation commands**

Append:

````markdown
## DNS Cutover Checks

After Cloudflare records point to `t9` NLB names:

```bash
dig +short ahand-hub.dev.team9.ai
dig +short folder.dev.team9.ai
dig +short git.folder.dev.team9.ai
dig +short admin.folder.dev.team9.ai
dig +short plane.claw.dev.team9.ai
```

Each hostname must resolve to the new target load balancer chain.
````

- [ ] **Step 4: Add smoke test commands**

Append:

````markdown
## Smoke Tests

Run:

```bash
curl -fsS https://ahand-hub.dev.team9.ai/health || curl -fsS https://ahand-hub.dev.team9.ai/
curl -fsS https://folder.dev.team9.ai/health || curl -fsS https://folder.dev.team9.ai/
curl -fsS https://admin.folder.dev.team9.ai/ || true
curl -fsS https://plane.claw.dev.team9.ai/health || curl -fsS https://plane.claw.dev.team9.ai/
```

Also verify from Railway Team9 by creating or listing a dev OpenClaw instance through the existing Team9 dev UI/API.
````

- [ ] **Step 5: Add rollback commands**

Append:

````markdown
## Rollback

Before any intentional writes to `t9`, rollback is DNS and scale based:

```bash
aws ecs update-service --profile t9 --region us-east-1 --cluster openclaw-hive-dev --service ahand-hub-dev --desired-count 0
aws ecs update-service --profile t9 --region us-east-1 --cluster openclaw-hive-dev --service control-plane-dev --desired-count 0
aws ecs update-service --profile t9 --region us-east-1 --cluster openclaw-hive-dev --service file-keeper-dev --desired-count 0
aws ecs update-service --profile t9 --region us-east-1 --cluster folder9-dev --service folder9-dev --desired-count 0
aws ecs update-service --profile t9 --region us-east-1 --cluster folder9-dev --service folder9-dashboard-dev --desired-count 0

aws ecs update-service --profile ww --region us-east-1 --cluster openclaw-hive-dev --service ahand-hub-dev --desired-count 1
aws ecs update-service --profile ww --region us-east-1 --cluster openclaw-hive-dev --service control-plane-dev --desired-count 1
aws ecs update-service --profile ww --region us-east-1 --cluster openclaw-hive-dev --service file-keeper-dev --desired-count 1
aws ecs update-service --profile ww --region us-east-1 --cluster folder9-dev --service folder9-dev --desired-count 2
aws ecs update-service --profile ww --region us-east-1 --cluster folder9-dev --service folder9-dashboard-dev --desired-count 1
```

Then repoint Cloudflare records back to the old `ww` NLB targets.
````

- [ ] **Step 6: Commit cutover runbook additions**

Run:

```bash
cd /Users/winrey/Projects/weightwave/team9
git add docs/aws/team9-dev-aws-migration-runbook.md
git commit -m "docs: add dev cutover and rollback steps"
```

Expected: commit succeeds.

## Task 11: Final Verification

**Files:**

- No file changes.

- [ ] **Step 1: Verify no source account IDs remain in active deploy files**

Run:

```bash
rg -n "471112576951|weightwave-tfstate|profile\\s*=\\s*\"ww\"" \
  /Users/winrey/Projects/weightwave/aHand/infra \
  /Users/winrey/Projects/weightwave/aHand/.github/workflows \
  /Users/winrey/Projects/weightwave/aHand/deploy \
  /Users/winrey/Projects/weightwave/folder9/infra \
  /Users/winrey/Projects/weightwave/folder9/.github/workflows \
  /Users/winrey/Projects/weightwave/folder9/deploy.sh \
  /Users/winrey/Projects/weightwave/folder9/dashboard/deploy.sh \
  /Users/winrey/Projects/weightwave/openclaw-hive/.github/workflows \
  /Users/winrey/Projects/weightwave/openclaw-hive/control-plane/task-definition.dev.template.json \
  /Users/winrey/Projects/weightwave/openclaw-hive/deploy/traefik \
  /Users/winrey/Projects/weightwave/openclaw-hive/Makefile
```

Expected: no matches in active deploy/config files. Matches in historical docs are acceptable only if outside the listed paths.

- [ ] **Step 2: Verify target AWS inventory**

Run:

```bash
aws ecs list-clusters --profile t9 --region us-east-1 --output table
aws ecr describe-repositories --profile t9 --region us-east-1 --query 'repositories[].repositoryName' --output table
aws s3api list-buckets --profile t9 --query 'Buckets[?starts_with(Name, `team9-`)].Name' --output table
aws ssm describe-parameters --profile t9 --region us-east-1 --query 'Parameters[].Name' --output table
```

Expected: all target clusters, repos, buckets, and parameters are present.

- [ ] **Step 3: Verify repo test/format commands**

Run:

```bash
cd /Users/winrey/Projects/weightwave/team9 && pnpm prettier --check docs/superpowers/specs/2026-06-01-team9-dev-aws-account-migration-design.md docs/superpowers/plans/2026-06-01-team9-dev-aws-account-migration.md docs/aws/team9-dev-aws-migration-runbook.md
cd /Users/winrey/Projects/weightwave/capability-hub && pnpm test -- src/file/file.service.spec.ts src/config/config.schema.spec.ts
```

Expected:

```text
All matched files use Prettier code style!
PASS src/file/file.service.spec.ts
PASS src/config/config.schema.spec.ts
```

- [ ] **Step 4: Record final commit IDs**

Run:

```bash
for repo in team9 aHand folder9 openclaw-hive; do
  git -C "/Users/winrey/Projects/weightwave/$repo" log -1 --oneline
done
```

Expected: each repo prints the migration branch commit intended for review.
