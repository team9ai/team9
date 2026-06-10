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

output "team9_files_dev_cdn" {
  value = {
    alias       = local.team9_files_dev_cdn_alias
    id          = aws_cloudfront_distribution.team9_files_dev.id
    domain_name = aws_cloudfront_distribution.team9_files_dev.domain_name
  }
}
