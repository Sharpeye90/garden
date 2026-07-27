locals {
  postgres_endpoint = try(
    tolist(tolist(aws_paas_service.postgres.endpoints)[0].addresses)[0],
    "${tolist(aws_paas_service.postgres.instances)[0].private_ip}:5432"
  )
}

output "app_private_ip" {
  value       = aws_instance.app.private_ip
  description = "Private VM address reachable through VPN."
}

output "app_url" {
  value       = "http://${aws_instance.app.private_ip}:8000"
  description = "Private application URL."
}

output "app_instance_id" {
  value = aws_instance.app.id
}

output "postgres_service_id" {
  value = aws_paas_service.postgres.id
}

output "postgres_endpoint" {
  value = local.postgres_endpoint
}

output "database_url" {
  value     = "postgresql://${var.postgres_username}:${random_password.postgres.result}@${local.postgres_endpoint}/${var.postgres_database}"
  sensitive = true
}

output "ssh_user" {
  value = var.ssh_user
}
