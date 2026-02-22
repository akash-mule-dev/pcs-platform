# PCS Platform — Infrastructure

## AWS Account
- Account ID: 365885288238
- Region: ap-south-1 (Mumbai)
- IAM User: PCS_openclaw

## 3 Environments

### DEV
- **Frontend:** http://pcs-frontend-dev-primeterminal.s3-website.ap-south-1.amazonaws.com
- **Backend:** http://43.204.37.17:3001
- **Swagger:** http://43.204.37.17:3001/api/docs
- **Port:** 3001
- **PM2 Name:** pcs-dev

### STAGE
- **Frontend:** http://pcs-frontend-stage-primeterminal.s3-website.ap-south-1.amazonaws.com
- **Backend:** http://43.204.37.17:3002
- **Swagger:** http://43.204.37.17:3002/api/docs
- **Port:** 3002
- **PM2 Name:** pcs-stage

### PROD
- **Frontend:** http://pcs-frontend-prod-primeterminal.s3-website.ap-south-1.amazonaws.com
- **Backend:** http://43.204.37.17:3000
- **Swagger:** http://43.204.37.17:3000/api/docs
- **Port:** 3000
- **PM2 Name:** pcs-prod

## EC2 Instance
- Instance ID: i-02140b6fbb9abf976
- Type: t3.micro (free tier)
- IP: 43.204.37.17
- OS: Ubuntu 22.04
- SSH Key: ~/.ssh/pcs-key.pem
- SSH: `ssh -i ~/.ssh/pcs-key.pem ubuntu@43.204.37.17`

## Database
- Provider: Neon PostgreSQL
- All environments share same DB (neondb) for now
- Secrets stored in AWS SSM Parameter Store under /pcs/{env}/

## S3 Buckets
- pcs-frontend-dev-primeterminal
- pcs-frontend-stage-primeterminal
- pcs-frontend-prod-primeterminal

## VPC
- VPC: vpc-0170654f784a116fa
- Subnet: subnet-05caae9172aa2eb72
- Security Group: sg-0da18892863ce990a

## Login Credentials (all environments)
- admin@pcs.local / password123
- manager@pcs.local / password123
- operator1@pcs.local / password123
