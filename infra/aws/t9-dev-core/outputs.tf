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

output "github_oidc_provider_arn" {
  value = aws_iam_openid_connect_provider.github.arn
}

output "openclaw_hive_dev_deploy_role_arn" {
  value = aws_iam_role.github_actions_openclaw_hive_dev_deploy.arn
}

output "ecs_task_execution_role_arn" {
  value = aws_iam_role.ecs_task_execution.arn
}

output "ecs_task_role_arn" {
  value = aws_iam_role.ecs_task.arn
}
