# Security Policy

## Vulnerability Reporting

If you discover a security vulnerability in Hive Platform, please report it by emailing [security@stakwork.com](mailto:security@stakwork.com). Please do not open public issues for security vulnerabilities.

## Dependency Security Management

### Automated Monitoring

This project uses the following tools for automated dependency security monitoring:

1. **Dependabot** (`.github/dependabot.yml`)
   - Weekly automated security updates
   - Grouped security patches for easier review
   - Automatic rebase when conflicts occur

2. **GitHub Security Alerts**
   - Enabled for all security vulnerabilities
   - Notifications sent to repository maintainers

### Manual Vulnerability Scanning

Run manual security audits using the following npm scripts:

```bash
# View all vulnerabilities
npm run audit

# View only moderate and above
npm run audit:check

# Attempt automatic fixes
npm run audit:fix
```

### Remediation Workflow

When vulnerabilities are discovered:

#### 1. Identify Vulnerabilities
```bash
# Run audit to see all vulnerabilities
npm run audit

# Review output for:
# - Vulnerability severity (CRITICAL/HIGH/MEDIUM/LOW)
# - Affected packages and versions
# - Recommended update versions
# - Dependency chains
```

#### 2. Analyze Update Strategy
- Review semantic versioning constraints in `package.json`
- Check for breaking changes in recommended versions
- Prioritize CRITICAL and HIGH severity vulnerabilities
- Verify updates are within existing version ranges (^ syntax)

#### 3. Apply Updates
```bash
# Update specific package within version constraints
yarn upgrade [package-name]

# Update to specific version (modifies package.json)
yarn upgrade [package-name]@[version]

# Update all packages within constraints
yarn upgrade
```

#### 4. Validate Changes
Run the complete test suite after applying updates:

```bash
# Unit tests
npm run test:unit

# Integration tests
npm run test:integration

# E2E tests
npm run test:e2e

# Coverage report
npm run test:coverage

# Production build verification
npm run build
```

#### 5. Verify Remediation
```bash
# Confirm all vulnerabilities resolved
npm run audit

# Expected output: "found 0 vulnerabilities"
```

#### 6. Commit Changes
```bash
git add package.json yarn.lock
git commit -m "fix: remediate npm audit vulnerabilities"
git push
```

### Security-Critical Packages

The following packages require special attention due to their security-sensitive operations:

- **Authentication**: `next-auth`, `jsonwebtoken`, `bcryptjs`
- **HTTP Communication**: `axios`, `node-fetch`
- **Error Monitoring**: `@sentry/nextjs`
- **Cryptocurrency**: `bitcoinjs-lib`
- **Database**: `@prisma/client`, `prisma`
- **Encryption**: Built-in Node.js crypto (field-level encryption)

Always review changelogs and breaking changes before updating these packages.

### Testing Infrastructure

Before deploying security updates to production:

1. **Local Testing**: Run full test suite locally
2. **Test Database**: Verify with test PostgreSQL database (`docker-compose.test.yml`)
3. **Staging Environment**: Deploy to staging first if available
4. **Rollback Plan**: Keep previous `yarn.lock` for quick rollback if needed

### Environment-Specific Security

- **Development**: Use `POD_URL` mock authentication provider
- **Production**: Ensure `TOKEN_ENCRYPTION_KEY` and `JWT_SECRET` are properly rotated
- **Encryption**: Follow key rotation procedures in `/src/lib/encryption/field-encryption.ts`

### Monitoring

Post-deployment monitoring for security updates:

1. **Error Tracking**: Monitor Sentry for new errors after updates
2. **Performance**: Check response times and database query performance
3. **User Reports**: Watch for authentication or functionality issues
4. **Logs**: Review application logs for unexpected errors

### Emergency Rollback

If a security update causes critical issues:

```bash
# Restore previous yarn.lock
git checkout HEAD~1 -- yarn.lock

# Reinstall previous versions
yarn install

# Redeploy previous version
npm run build
```

### Regular Security Reviews

- **Weekly**: Review Dependabot security PRs
- **Monthly**: Manual `yarn audit` scan
- **Quarterly**: Full security review of dependencies and application code
- **Annually**: Security audit by external firm (recommended)

## Application Security

Beyond dependency security, this project includes:

- **Janitor System**: Automated codebase security scanning
- **Field-level Encryption**: Sensitive data encrypted at rest
- **Role-based Access Control**: Workspace permission system
- **GitHub App Security**: Installation tokens encrypted and rotated

See `/docs/security-architecture.md` for details on application-level security.