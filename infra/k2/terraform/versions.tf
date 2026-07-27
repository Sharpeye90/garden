terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "c2devel/rockitcloud"
      version = "~> 25.2"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.7"
    }
  }
}

provider "aws" {
  region = var.region
}
