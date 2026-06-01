locals {
  s3_buckets = {
    team9_files_dev     = { name = "team9-files-dev", public_read = false }
    team9_files_prod    = { name = "team9-files-prod", public_read = false }
    ahand_hub_dev       = { name = "team9-ahand-hub-dev", public_read = false }
    ahand_hub_prod      = { name = "team9-ahand-hub-prod", public_read = false }
    capability_hub_dev  = { name = "team9-capability-hub-dev", public_read = true }
    capability_hub_prod = { name = "team9-capability-hub-prod", public_read = true }
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

  depends_on = [aws_s3_bucket_public_access_block.service_public_read]

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
