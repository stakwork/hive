# NPM Audit Vulnerability Remediation Guide

## Overview

This guide provides step-by-step instructions for remediating npm audit vulnerabilities in the Hive Platform project.

## Prerequisites

- **Package Manager**: Yarn 1.22.22 (locked via Corepack in package.json)
- **Node.js**: Version 22 (Alpine in Docker)
- **Access**: Write access to repository
- **Environment**: Local development environment with all dependencies installed

## Quick Reference

```bash
# View vulnerabilities
npm run audit

# View only moderate+ severity
npm run audit:check

# Attempt automatic fixes
npm run audit:fix

# Update specific package
yarn upgrade [package-name]

# Update to specific version
yarn upgrade [package-name]@[version]

# Validate with tests
npm run test
npm run test:coverage
npm run build
```

## Step-by-Step Remediation Process

### Step 1: Identify All Vulnerabilities

Run the audit command to generate a vulnerability report:

```bash
npm run audit
```

**Expected Output Format:**
```
┌───────────────┬──────────────────────────────────────────────────────────────┐
│ High          │ Prototype Pollution in axios                                 │
├───────────────┼──────────────────────────────────────────────────────────────┤
│ Package       │ axios                                                        │
├───────────────┼──────────────────────────────────────────────────────────────┤
│ Patched in    │ >=1.11.0                                                     │
├───────────────┼──────────────────────────────────────────────────────────────┤
│ Dependency of │ @octokit/rest                                                │
├───────────────┼──────────────────────────────────────────────────────────────┤
│ Path          │ @octokit/rest > axios                                        │
└───────────────┴──────────────────────────────────────────────────────────────┘
```

**Document the following for each vulnerability:**
1. Vulnerability ID (e.g., CVE-2024-XXXXX)
2. Severity level (CRITICAL/HIGH/MEDIUM/LOW)
3. Affected package name and current version
4. Recommended patched version
5. Dependency chain (direct vs transitive)
6. CVSS score if available

### Step 2: Categorize and Prioritize

**Priority 1: CRITICAL and HIGH severity**
- Remote code execution
- SQL injection
- Authentication bypass
- Prototype pollution in user-facing packages

**Priority 2: MEDIUM severity**
- Denial of service
- Information disclosure
- XSS in development dependencies

**Priority 3: LOW severity**
- Development-only vulnerabilities
- Minor information leaks

**Focus on Security-Critical Packages First:**
- `next-auth` (^4.24.11) - Authentication
- `jsonwebtoken` (^9.0.2) - Token security
- `bcryptjs` (^3.0.2) - Password hashing
- `axios` (^1.10.0) - HTTP client (frequent CVEs)
- `@sentry/nextjs` (^9.34.0) - Error monitoring
- `bitcoinjs-lib` (^6.1.7) - Cryptocurrency operations

### Step 3: Analyze Semantic Versioning Constraints

Before updating, review the version constraints in `package.json`:

**Caret (^) Syntax:**
- `^15.4.1` allows `>=15.4.1` and `<16.0.0`
- Minor and patch updates allowed
- Major version changes NOT allowed

**Tilde (~) Syntax:**
- `~15.4.1` allows `>=15.4.1` and `<15.5.0`
- Patch updates only

**Exact Version (no prefix):**
- `15.4.1` requires exactly that version
- No updates allowed without manual change

**Update Strategy:**
```bash
# Safe: Update within constraints (respects ^ or ~)
yarn upgrade axios

# Targeted: Update to specific version (modifies package.json if needed)
yarn upgrade axios@1.11.0

# Risky: Update all packages (test thoroughly)
yarn upgrade
```

### Step 4: Apply Updates (Batch Approach)

**Recommended Batch Strategy:**

**Batch 1: Security-Critical Direct Dependencies**
```bash
# Update security-sensitive packages one at a time
yarn upgrade next-auth
yarn upgrade jsonwebtoken
yarn upgrade bcryptjs
yarn upgrade axios
yarn upgrade @sentry/nextjs

# Test after each batch
npm run test:unit
npm run test:integration
```

**Batch 2: Framework and Core Dependencies**
```bash
yarn upgrade next
yarn upgrade react
yarn upgrade react-dom
yarn upgrade @prisma/client
yarn upgrade prisma

# Full test suite
npm run test
npm run test:coverage
npm run build
```

**Batch 3: Transitive Dependencies**
```bash
# Let Yarn resolve transitive updates
yarn install

# Verify with audit
npm run audit
```

**Batch 4: Development Dependencies**
```bash
yarn upgrade --pattern "@types/*"
yarn upgrade --pattern "eslint*"
yarn upgrade --pattern "prettier*"

# Quick validation
npm run lint
npm run format
```

### Step 5: Validate Each Batch

After each batch of updates, run the complete validation suite:

#### 5.1 Unit Tests
```bash
npm run test:unit
```
- Must pass 100% of existing tests
- Check for any deprecation warnings
- Review test output for unexpected failures

#### 5.2 Integration Tests
```bash
# Start test database
npm run test:db:start

# Run integration tests
npm run test:integration

# Cleanup
npm run test:db:stop
```
- Verify database operations work correctly
- Check API route functionality
- Validate service integrations

#### 5.3 E2E Tests
```bash
npx playwright test
```
- Run full E2E suite
- Check authentication flows
- Verify workspace operations
- Test task management functionality

#### 5.4 Coverage Report
```bash
npm run test:coverage
```
- Ensure coverage hasn't decreased
- Review any newly uncovered code
- Check coverage threshold compliance

#### 5.5 Production Build
```bash
npm run build
```
- Must build without errors
- Check bundle sizes (warn if significantly increased)
- Verify no build-time deprecation warnings

### Step 6: Handle Breaking Changes

If updates introduce breaking changes:

#### 6.1 Review Changelog
```bash
# View changelog for package
yarn info [package-name] --all
```

#### 6.2 Check Migration Guides
- Visit package's GitHub repository
- Review CHANGELOG.md or MIGRATION.md
- Check for documented breaking changes

#### 6.3 Update Code
- Modify affected code to match new API
- Update type definitions if TypeScript errors occur
- Add new required configurations

#### 6.4 Update Tests
- Modify tests to match new behavior
- Add new tests for new functionality
- Ensure test coverage remains high

### Step 7: Verify Docker Build

After all updates applied and tests passing:

```bash
# Build Docker image
docker build -t hive-platform:test .

# Verify it builds successfully
docker run --rm hive-platform:test npm run build
```

**Note**: Dockerfile now uses `yarn install --frozen-lockfile` (fixed from previous `npm ci` inconsistency)

### Step 8: Final Verification

```bash
# Confirm all vulnerabilities resolved
npm run audit

# Expected output:
# "found 0 vulnerabilities"
```

If vulnerabilities remain:
1. Check if they're in development dependencies only
2. Verify if patches are available
3. Consider manual workarounds if patches not available
4. Document any accepted risks in SECURITY.md

### Step 9: Commit Changes

```bash
# Stage package files
git add package.json yarn.lock

# Commit with descriptive message
git commit -m "fix: remediate npm audit vulnerabilities

- Updated axios from 1.10.0 to 1.11.0 (HIGH severity)
- Updated jsonwebtoken from 9.0.2 to 9.0.3 (MEDIUM severity)
- Updated next-auth from 4.24.11 to 4.24.15 (CRITICAL severity)
... (list all updates)

All tests passing. Zero vulnerabilities remaining.
Verified with: npm run audit
"

# Push to branch
git push origin security/npm-audit-remediation
```

### Step 10: Create Pull Request

**PR Title**: `fix: remediate npm audit vulnerabilities (14 resolved)`

**PR Description Template**:
```markdown
## Summary
Remediates 14 npm audit vulnerabilities identified in security scan.

## Vulnerabilities Resolved
- [ ] CRITICAL: next-auth prototype pollution (CVE-2024-XXXXX)
- [ ] HIGH: axios SSRF vulnerability (CVE-2024-XXXXX)
- [ ] MEDIUM: jsonwebtoken timing attack (CVE-2024-XXXXX)
... (list all 14)

## Changes
- Updated `axios` from 1.10.0 → 1.11.0
- Updated `jsonwebtoken` from 9.0.2 → 9.0.3
- Updated `next-auth` from 4.24.11 → 4.24.15
... (list all updates)

## Testing
- [x] Unit tests pass (`npm run test:unit`)
- [x] Integration tests pass (`npm run test:integration`)
- [x] E2E tests pass (`npx playwright test`)
- [x] Coverage maintained (`npm run test:coverage`)
- [x] Production build successful (`npm run build`)
- [x] Docker build verified
- [x] Zero vulnerabilities remaining (`npm run audit`)

## Breaking Changes
None. All updates within semantic versioning constraints.

## Deployment Notes
No special deployment steps required. Standard deployment process applies.
```

## Troubleshooting

### Issue: Yarn Upgrade Fails

**Error**: `error Package "package-name" not found`

**Solution**:
```bash
# Clear yarn cache
yarn cache clean

# Reinstall
rm -rf node_modules
yarn install
```

### Issue: Tests Fail After Update

**Error**: Tests fail with new package version

**Solution**:
1. Review test failure output carefully
2. Check if test expectations need updating
3. Review package changelog for breaking changes
4. Consider rolling back to previous version
5. File issue with package maintainer if bug

### Issue: Transitive Dependency Not Updating

**Error**: Vulnerability in transitive dependency remains after update

**Solution**:
```bash
# Force resolution in package.json
"resolutions": {
  "axios": "1.11.0"
}

# Reinstall
yarn install
```

### Issue: Docker Build Fails

**Error**: Docker build fails after updates

**Solution**:
1. Verify Dockerfile uses `yarn install` (not `npm ci`)
2. Clear Docker build cache: `docker builder prune`
3. Rebuild: `docker build --no-cache -t hive-platform:test .`

## Prevention and Ongoing Maintenance

### Automated Monitoring (Now Configured)

1. **Dependabot** (`.github/dependabot.yml`)
   - Automatically creates PRs for security updates
   - Weekly scan schedule
   - Groups security updates together

2. **GitHub Security Alerts**
   - Email notifications for new vulnerabilities
   - Enabled by default for all repositories

### Manual Reviews

- **Weekly**: Review and merge Dependabot PRs
- **Monthly**: Run `npm run audit` manually
- **Before major releases**: Full security audit

### Best Practices

1. **Keep Dependencies Updated**: Don't let them drift too far behind
2. **Review Changelogs**: Always read breaking changes before updating
3. **Test Thoroughly**: Run full test suite after every update
4. **Monitor Production**: Watch for errors after deployment
5. **Document Decisions**: Record why certain vulnerabilities are accepted

## Emergency Rollback

If a security update causes production issues:

```bash
# Restore previous yarn.lock
git checkout HEAD~1 -- yarn.lock

# Reinstall previous versions
yarn install

# Build and deploy
npm run build
```

## Additional Resources

- [Yarn Documentation](https://classic.yarnpkg.com/en/docs)
- [npm Audit Documentation](https://docs.npmjs.com/cli/v10/commands/npm-audit)
- [Semantic Versioning Spec](https://semver.org/)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)

## Support

For questions or issues with vulnerability remediation:
- Internal: Slack #engineering channel
- External: security@stakwork.com