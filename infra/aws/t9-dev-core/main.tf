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
