# Security - Exposed Secrets Remediation

## ⚠️ CRITICAL: Secrets Exposed in Git History

The following secrets were previously hardcoded in `docker-compose.yml` and are now exposed in the git repository history. **These secrets MUST be rotated immediately** after deploying the updated configuration.

### Exposed Secrets Requiring Rotation

1. **POSTGRES_PASSWORD**: `hive_password`
   - Impact: Database access credential
   - Action: Generate new strong password and update in .env.production
   - Command: `openssl rand -base64 32`

2. **DATABASE_URL**: Contains embedded credentials `hive_user:hive_password`
   - Impact: Complete database connection string
   - Action: Update password component after rotating POSTGRES_PASSWORD

3. **NEXTAUTH_SECRET**: `bywYKt/K8MWQbRZQpUeujcTCzGctEsS0G8kfy1kqyDs=`
   - Impact: Session token encryption/signing
   - Action: Generate new secret with `openssl rand -base64 32`
   - Warning: Will invalidate all existing user sessions

4. **JWT_SECRET**: `eb68e8048db53877963f8b4beb1fd55e72e1c6826777cd5a8694b28c21cd7f61f485bf3a6136293152584180f717fc840a10c27659ed1c14a29de07eb5e52148`
   - Impact: JWT token signing for API authentication
   - Action: Generate new 64-character hex secret with `npm run setup`
   - Warning: Will invalidate all existing JWT tokens

5. **GITHUB_CLIENT_SECRET**: `2ee2e8a84251ee787a8729369535f12f3f7ae7dd`
   - Impact: GitHub OAuth application credential
   - Action: Regenerate in GitHub OAuth app settings
   - Location: https://github.com/settings/developers
   - Warning: Will break GitHub authentication until updated

6. **NEXTAUTH_URL**: `http://100.97.107.124:3000` (exposed internal IP)
   - Impact: Application URL exposure
   - Action: Update to production domain URL
   - Format: `https://your-production-domain.com`

---

## Secret Rotation Procedure

### Step 1: Prepare New Secrets

```bash
# 1. Generate new POSTGRES_PASSWORD
openssl rand -base64 32

# 2. Generate new NEXTAUTH_SECRET
openssl rand -base64 32

# 3. Generate new JWT_SECRET
npm run setup

# 4. Regenerate GITHUB_CLIENT_SECRET
# Visit: https://github.com/settings/developers
# Click on your OAuth app → Generate new client secret
```

### Step 2: Update .env.production

```bash
# Copy template if not exists
cp .env.production.example .env.production

# Edit with your favorite editor
nano .env.production
```

Update the following variables with newly generated values:
- `POSTGRES_PASSWORD`
- `DATABASE_URL` (update password in connection string)
- `NEXTAUTH_SECRET`
- `JWT_SECRET`
- `GITHUB_CLIENT_SECRET`
- `NEXTAUTH_URL` (use production domain)

### Step 3: Deploy Updated Configuration

```bash
# Stop existing containers
docker-compose down

# Remove old volumes (if database needs reset)
docker volume rm hive_postgres_data

# Start with new secrets
docker-compose up -d

# Verify services are healthy
docker-compose ps
docker-compose logs -f hive-app
```

### Step 4: Verify Rotation

1. **Database Connection**: Verify app connects with new credentials
2. **Authentication**: Test GitHub OAuth login flow
3. **Sessions**: Confirm existing sessions are invalidated (expected)
4. **API Tokens**: Verify JWT token generation and validation

---

## Future Secret Management Best Practices

### Environment-Specific Secrets

Always use separate secrets for each environment:

| Environment | Configuration File | Storage Location |
|-------------|-------------------|------------------|
| Development | `.env.local` | Local filesystem (gitignored) |
| Testing | `.env.test` | Local filesystem (gitignored) |
| Staging | `.env.staging` | Secret management service |
| Production | `.env.production` | Secret management service |

### Secret Generation Guidelines

1. **Length Requirements**:
   - Database passwords: 32+ characters
   - API keys/tokens: 32+ characters
   - JWT secrets: 64 characters (hex)
   - Encryption keys: 32 bytes (64 hex characters)

2. **Entropy Requirements**:
   - Use cryptographically secure random generators
   - Preferred: `openssl rand`, `crypto.randomBytes`
   - Never use: predictable patterns, dictionary words, personal information

3. **Rotation Schedule**:
   - Production secrets: Every 90 days
   - Service API keys: Every 180 days
   - Compromise suspected: Immediately

### Secret Storage Recommendations

**Local Development**:
- Use `.env.local` file (already gitignored)
- Never commit to version control
- Share securely via encrypted channels (1Password, LastPass, etc.)

**Production** (Recommended Approach):
- Use AWS Secrets Manager or HashiCorp Vault
- Enable automatic rotation where possible
- Implement audit logging for secret access
- Use IAM roles instead of static credentials (already done for AWS S3)

**Production** (Current Approach - Acceptable):
- Store secrets in `.env.production` on server
- Ensure file permissions: `chmod 600 .env.production`
- Restrict access to deployment pipeline only
- Never commit `.env.production` to version control

---

## Monitoring & Incident Response

### Secret Exposure Checklist

If you suspect a secret has been exposed:

- [ ] Rotate the exposed secret immediately
- [ ] Review git history for the exposure commit
- [ ] Check if the repository was ever public
- [ ] Audit access logs for unauthorized usage
- [ ] Update all dependent systems with new secrets
- [ ] Document the incident (date, scope, resolution)

### Monitoring Recommendations

1. **GitHub Secret Scanning**: Enable GitHub's secret scanning alerts
2. **Access Logs**: Monitor failed authentication attempts
3. **Database Logs**: Track connection attempts from unexpected IPs
4. **API Rate Limits**: Detect unauthorized API key usage

---

## Additional Resources

- [OWASP Secrets Management Cheat Sheet](https://cheatsheetsproject.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)
- [AWS Secrets Manager Documentation](https://docs.aws.amazon.com/secretsmanager/)
- [GitHub Secret Scanning](https://docs.github.com/en/code-security/secret-scanning)
- [Docker Secrets](https://docs.docker.com/engine/swarm/secrets/)

---

## Contact

For security concerns or questions, contact the security team at security@your-domain.com.

**Last Updated**: 2024-01-XX (Update after remediation deployment)