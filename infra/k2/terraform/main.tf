locals {
  admin_cidrs = [
    for cidr in split(",", var.admin_cidrs) : trimspace(cidr)
    if trimspace(cidr) != ""
  ]

  private_cidrs = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"]

  ssh_key_trimmed   = trimspace(var.ssh_key)
  ssh_key_is_public = can(regex("^(ssh-rsa|ssh-ed25519|ecdsa-sha2-|sk-)", local.ssh_key_trimmed))
  ssh_key_name      = local.ssh_key_is_public ? aws_key_pair.garden[0].key_name : local.ssh_key_trimmed
  app_ami_id        = var.app_ami_id != "" ? var.app_ami_id : data.aws_ami.ubuntu[0].id
}

data "aws_vpc" "target" {
  id = var.vpc_id
}

data "aws_subnet" "target" {
  id = var.subnet_id
}

data "aws_ami" "ubuntu" {
  count       = var.app_ami_id == "" ? 1 : 0
  most_recent = true
  owners      = var.app_ami_owners

  filter {
    name   = "name"
    values = var.app_ami_name_patterns
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

resource "aws_key_pair" "garden" {
  count      = local.ssh_key_is_public ? 1 : 0
  key_name   = "${var.name_prefix}-key"
  public_key = local.ssh_key_trimmed

  tags = {
    Name    = "${var.name_prefix}-key"
    Project = var.name_prefix
  }
}

resource "aws_security_group" "app" {
  name        = "${var.name_prefix}-app"
  description = "Garden app access through private networks and VPN"
  vpc_id      = data.aws_vpc.target.id

  dynamic "ingress" {
    for_each = toset(local.private_cidrs)
    content {
      description = "Private network ${ingress.value}"
      from_port   = 0
      to_port     = 0
      protocol    = "-1"
      cidr_blocks = [ingress.value]
    }
  }

  ingress {
    description = "Public HTTP for HTTPS certificate validation and redirect"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "Public HTTPS for Garden Rhythm demo"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "Public HTTP/3 for Garden Rhythm demo"
    from_port   = 443
    to_port     = 443
    protocol    = "udp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  dynamic "ingress" {
    for_each = toset(local.admin_cidrs)
    content {
      description = "SSH from admin CIDR"
      from_port   = 22
      to_port     = 22
      protocol    = "tcp"
      cidr_blocks = [ingress.value]
    }
  }

  dynamic "ingress" {
    for_each = toset(local.admin_cidrs)
    content {
      description = "Garden UI from admin CIDR"
      from_port   = 8000
      to_port     = 8000
      protocol    = "tcp"
      cidr_blocks = [ingress.value]
    }
  }

  egress {
    description = "Outbound services and package installation"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name    = "${var.name_prefix}-app"
    Project = var.name_prefix
  }
}

resource "aws_security_group" "database" {
  name        = "${var.name_prefix}-postgres"
  description = "PostgreSQL access from the garden app only"
  vpc_id      = data.aws_vpc.target.id

  ingress {
    description     = "PostgreSQL from application VM"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.app.id]
  }

  egress {
    description = "Managed database outbound traffic"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name    = "${var.name_prefix}-postgres"
    Project = var.name_prefix
  }
}

resource "random_password" "postgres" {
  length  = 32
  special = false
}

resource "aws_paas_service" "postgres" {
  name          = "garden-rhythm-pg"
  instance_type = var.postgres_instance_type

  root_volume {
    type = "gp2"
    size = var.postgres_root_volume_size
  }

  data_volume {
    type = "gp2"
    size = var.postgres_data_volume_size
  }

  delete_interfaces_on_destroy = true
  security_group_ids           = [aws_security_group.database.id]
  subnet_ids                   = [data.aws_subnet.target.id]
  ssh_key_name                 = local.ssh_key_name

  pgsql {
    version = var.postgres_version

    user {
      name     = var.postgres_username
      password = random_password.postgres.result
    }

    database {
      name  = var.postgres_database
      owner = var.postgres_username
    }
  }

  timeouts {
    create = "45m"
    update = "60m"
    delete = "30m"
  }
}

resource "aws_instance" "app" {
  ami                         = local.app_ami_id
  instance_type               = var.app_instance_type
  subnet_id                   = data.aws_subnet.target.id
  vpc_security_group_ids      = [aws_security_group.app.id]
  associate_public_ip_address = false
  key_name                    = local.ssh_key_name
  user_data = templatefile("${path.module}/templates/cloud-init.yaml.tftpl", {
    ssh_user = var.ssh_user
  })

  root_block_device {
    volume_size           = var.app_root_volume_size
    volume_type           = "gp2"
    delete_on_termination = true
  }

  tags = {
    Name    = "${var.name_prefix}-app"
    Project = var.name_prefix
  }

  volume_tags = {
    Name    = "${var.name_prefix}-app-root"
    Project = var.name_prefix
  }

  depends_on = [aws_paas_service.postgres]

  lifecycle {
    ignore_changes = [associate_public_ip_address]
  }
}
