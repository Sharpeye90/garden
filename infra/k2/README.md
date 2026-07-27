# K2 Cloud

The alpha environment is intentionally private:

- one VM in the existing VPC/subnet;
- one managed PostgreSQL 16 service;
- no Elastic IP and no public DNS;
- access to the app on port `8000` through VPN/private networks;
- PostgreSQL accepts connections only from the application security group.

The root `.env` is loaded without `eval` and is ignored by Git. Required keys:
`K2_ACCESS_KEY`, `K2_SECRET_KEY`, `K2_REGION`, `K2_VPC_ID`,
`K2_SUBNET_ID`, `K2_SSH_KEY`, `K2_DEPLOY_SSH_USER`, and
`K2_APP_AMI_ID`.

Optional overrides include `K2_ADMIN_CIDR`, `K2_APP_INSTANCE_TYPE`,
`K2_POSTGRES_INSTANCE_TYPE`, `K2_POSTGRES_VERSION`,
`K2_SSH_PRIVATE_KEY_PATH`, `GARDEN_SINGLE_USER_KEY`, and
`GARDEN_SINGLE_USER_NAME`.

```bash
./scripts/k2-terraform.sh plan
./scripts/k2-terraform.sh apply
./scripts/k2-deploy-app.sh
```

The application URL is printed after deployment and is also available via:

```bash
./scripts/k2-terraform.sh output -raw app_url
```
