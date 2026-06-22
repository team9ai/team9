data "aws_iam_policy_document" "github_oidc_openclaw_hive_dev" {
  statement {
    effect = "Allow"

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    actions = ["sts:AssumeRoleWithWebIdentity"]

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values = [
        "repo:weightwave/openclaw-hive:ref:refs/heads/dev",
        "repo:weightwave/openclaw-hive:ref:refs/tags/dev-*",
        "repo:weightwave/openclaw-hive:environment:development",
      ]
    }
  }
}

data "aws_iam_policy_document" "ecs_tasks_assume" {
  statement {
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }

    actions = ["sts:AssumeRole"]
  }
}

resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

resource "aws_iam_role" "github_actions_openclaw_hive_dev_deploy" {
  name        = "GitHubActionsOpenClawHiveDevDeploy"
  description = "Assumed via OIDC by dev OpenClaw Hive deployment workflows"

  assume_role_policy = data.aws_iam_policy_document.github_oidc_openclaw_hive_dev.json
}

resource "aws_iam_role_policy" "github_actions_openclaw_hive_dev_deploy" {
  name = "openclaw-hive-dev-deploy"
  role = aws_iam_role.github_actions_openclaw_hive_dev_deploy.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ECRAuth"
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
        Resource = "*"
      },
      {
        Sid    = "ECRPush"
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload",
          "ecr:PutImage",
          "ecr:DescribeRepositories",
          "ecr:DescribeImages",
        ]
        Resource = [
          "arn:aws:ecr:us-east-1:149614785083:repository/control-plane",
          "arn:aws:ecr:us-east-1:149614785083:repository/file-keeper",
          "arn:aws:ecr:us-east-1:149614785083:repository/efs-webdav",
          "arn:aws:ecr:us-east-1:149614785083:repository/openclaw-hive",
        ]
      },
      {
        Sid    = "ECSDeploy"
        Effect = "Allow"
        Action = [
          "ecs:RegisterTaskDefinition",
          "ecs:DeregisterTaskDefinition",
          "ecs:CreateService",
          "ecs:UpdateService",
          "ecs:DescribeServices",
          "ecs:DescribeTaskDefinition",
          "ecs:DescribeTasks",
          "ecs:ListServices",
          "ecs:ListTasks",
          "ecs:RunTask",
          "ecs:StopTask",
        ]
        Resource = "*"
      },
      {
        Sid      = "CreateDeployLogGroups"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup"]
        Resource = "*"
      },
      {
        Sid    = "ConfigureControlPlaneAutoscaling"
        Effect = "Allow"
        Action = [
          "application-autoscaling:RegisterScalableTarget",
          "application-autoscaling:PutScalingPolicy",
        ]
        Resource = "*"
      },
      {
        Sid    = "PassOpenClawEcsRoles"
        Effect = "Allow"
        Action = ["iam:PassRole"]
        Resource = [
          aws_iam_role.ecs_task_execution.arn,
          aws_iam_role.ecs_task.arn,
        ]
      },
    ]
  })
}

resource "aws_iam_service_linked_role" "ecs_application_autoscaling" {
  aws_service_name = "ecs.application-autoscaling.amazonaws.com"
  description      = "Allows Application Auto Scaling to manage ECS service desired counts"
}

resource "aws_iam_role" "ecs_task_execution" {
  name               = "ecsTaskExecutionRole"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy_attachment" "ecs_task_execution" {
  role       = aws_iam_role.ecs_task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "ecs_task_execution_ssm_secrets" {
  name = "SSMSecretRead"
  role = aws_iam_role.ecs_task_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ReadSharedCloudflareToken"
        Effect = "Allow"
        Action = [
          "ssm:GetParameter",
          "ssm:GetParameters",
        ]
        Resource = "arn:aws:ssm:us-east-1:149614785083:parameter/folder9/shared/cloudflare_dns_token"
      },
    ]
  })
}

resource "aws_iam_role" "ecs_task" {
  name               = "ecsTaskRole"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy" "ecs_task_control_plane_management" {
  name = "ControlPlaneManagement"
  role = aws_iam_role.ecs_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ECSTaskManagement"
        Effect = "Allow"
        Action = [
          "ecs:RunTask",
          "ecs:StopTask",
          "ecs:DescribeTasks",
          "ecs:DescribeTaskDefinition",
          "ecs:RegisterTaskDefinition",
          "ecs:DeregisterTaskDefinition",
          "ecs:TagResource",
        ]
        Resource = "*"
      },
      {
        Sid    = "EFSAccessPointManagement"
        Effect = "Allow"
        Action = [
          "elasticfilesystem:CreateAccessPoint",
          "elasticfilesystem:DeleteAccessPoint",
          "elasticfilesystem:DescribeAccessPoints",
          "elasticfilesystem:TagResource",
        ]
        Resource = "*"
      },
      {
        Sid    = "PassRole"
        Effect = "Allow"
        Action = ["iam:PassRole"]
        Resource = [
          aws_iam_role.ecs_task_execution.arn,
          aws_iam_role.ecs_task.arn,
        ]
      },
      {
        Sid    = "CloudWatchLogs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "logs:FilterLogEvents",
          "logs:GetLogEvents",
          "logs:DescribeLogGroups",
          "logs:DescribeLogStreams",
          "logs:StartLiveTail",
          "logs:StartQuery",
          "logs:GetQueryResults",
        ]
        Resource = "*"
      },
      {
        Sid    = "ECRImageManagement"
        Effect = "Allow"
        Action = [
          "ecr:DescribeImages",
          "ecr:BatchDeleteImage",
          "ecr:ListImages",
        ]
        Resource = "arn:aws:ecr:us-east-1:149614785083:repository/openclaw-hive"
      },
      {
        Sid    = "SQSECSEvents"
        Effect = "Allow"
        Action = [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes",
        ]
        Resource = "arn:aws:sqs:us-east-1:149614785083:openclaw-hive-ecs-events-dev"
      },
    ]
  })
}

resource "aws_iam_role_policy" "ecs_task_exec" {
  name = "ECSExecPolicy"
  role = aws_iam_role.ecs_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ssmmessages:CreateControlChannel",
          "ssmmessages:CreateDataChannel",
          "ssmmessages:OpenControlChannel",
          "ssmmessages:OpenDataChannel",
        ]
        Resource = "*"
      },
    ]
  })
}

resource "aws_iam_role_policy" "ecs_task_efs_access" {
  name = "EFSAccess"
  role = aws_iam_role.ecs_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "EFSMountAccess"
        Effect = "Allow"
        Action = [
          "elasticfilesystem:ClientMount",
          "elasticfilesystem:ClientWrite",
          "elasticfilesystem:ClientRootAccess",
        ]
        Resource = "*"
      },
      {
        Sid    = "EFSManagement"
        Effect = "Allow"
        Action = [
          "elasticfilesystem:CreateFileSystem",
          "elasticfilesystem:CreateAccessPoint",
          "elasticfilesystem:CreateMountTarget",
          "elasticfilesystem:DescribeFileSystems",
          "elasticfilesystem:DescribeAccessPoints",
          "elasticfilesystem:DescribeMountTargets",
          "elasticfilesystem:DescribeMountTargetSecurityGroups",
          "elasticfilesystem:DescribeFileSystemPolicy",
          "elasticfilesystem:TagResource",
          "elasticfilesystem:DeleteAccessPoint",
        ]
        Resource = "*"
      },
      {
        Sid    = "EC2NetworkForEFS"
        Effect = "Allow"
        Action = [
          "ec2:DescribeSubnets",
          "ec2:DescribeNetworkInterfaces",
          "ec2:DescribeSecurityGroups",
        ]
        Resource = "*"
      },
    ]
  })
}

resource "aws_iam_role_policy" "ecs_task_traefik_discovery" {
  name = "TraefikECSDiscovery"
  role = aws_iam_role.ecs_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ecs:ListClusters",
          "ecs:ListTasks",
          "ecs:DescribeClusters",
          "ecs:DescribeTasks",
          "ecs:DescribeContainerInstances",
          "ecs:DescribeTaskDefinition",
          "ec2:DescribeInstances",
          "ec2:DescribeNetworkInterfaces",
        ]
        Resource = "*"
      },
    ]
  })
}
