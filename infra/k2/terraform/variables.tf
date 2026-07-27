variable "region" {
  type        = string
  description = "K2 Cloud region."
  default     = "ru-msk"
}

variable "name_prefix" {
  type        = string
  description = "Prefix for created resources."
  default     = "garden-rhythm"
}

variable "vpc_id" {
  type        = string
  description = "Existing K2 VPC ID."
}

variable "subnet_id" {
  type        = string
  description = "Existing private subnet ID."
}

variable "admin_cidrs" {
  type        = string
  description = "Optional comma-separated CIDRs outside RFC1918 private networks."
  default     = ""
}

variable "ssh_key" {
  type        = string
  description = "Existing K2 key pair name or an SSH public key."
  sensitive   = true
}

variable "ssh_user" {
  type        = string
  description = "SSH user for the selected image."
  default     = "ubuntu"
}

variable "app_ami_id" {
  type        = string
  description = "Explicit K2 image ID."
  default     = ""
}

variable "app_ami_name_patterns" {
  type        = list(string)
  description = "Fallback Ubuntu image names."
  default = [
    "Ubuntu 24.04 [Cloud Image]*",
    "Ubuntu 22.04 [Cloud Image]*"
  ]
}

variable "app_ami_owners" {
  type        = list(string)
  description = "Trusted K2 image owners."
  default     = ["templates@cloud.croc.ru"]
}

variable "app_instance_type" {
  type        = string
  description = "Application VM type."
  default     = "c5.large"
}

variable "app_root_volume_size" {
  type        = number
  description = "Application VM root disk in GiB."
  default     = 40
}

variable "postgres_instance_type" {
  type        = string
  description = "Managed PostgreSQL instance type."
  default     = "c5.large"
}

variable "postgres_root_volume_size" {
  type    = number
  default = 32
}

variable "postgres_data_volume_size" {
  type    = number
  default = 40
}

variable "postgres_version" {
  type    = string
  default = "16"
}

variable "postgres_database" {
  type    = string
  default = "garden"
}

variable "postgres_username" {
  type    = string
  default = "garden_app"
}
