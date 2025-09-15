# Security Policy

## Supported Versions

We provide security updates for the following versions:

| Version | Supported          |
| ------- | ------------------ |
| latest  | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability in this project, please follow these steps:

1. **Do not** create a public GitHub issue for security vulnerabilities
2. Email the security team at [stakwork-security@stakwork.com] with:
   - A clear description of the vulnerability
   - Steps to reproduce the issue
   - Potential impact assessment
   - Any suggested fixes (if available)

## Security Measures

### Dependency Management

- Dependencies are regularly audited using `npm audit`
- Security patches are applied promptly
- Automated security scanning runs daily via GitHub Actions
- Pull requests are automatically checked for vulnerabilities

### Key Security Dependencies

This project uses the following security-critical dependencies:

- **axios**: HTTP client for API calls (SSRF prevention)
- **next**: Web framework with built-in security features
- **next-auth**: Authentication library with CSRF protection
- **prisma**: Database ORM with SQL injection prevention
- **prismjs**: Syntax highlighting (XSS prevention)

### Security Best Practices

1. **Authentication**: Uses NextAuth.js with secure session management
2. **Authorization**: Role-based access control implemented
3. **Input Validation**: Zod schemas validate all inputs
4. **CSRF Protection**: Built-in protection via NextAuth.js
5. **XSS Prevention**: React's built-in XSS protection + sanitization
6. **SQL Injection**: Prisma ORM prevents SQL injection attacks

## Vulnerability Response Process

1. **Acknowledgment**: We will acknowledge receipt within 24 hours
2. **Assessment**: Initial assessment within 48 hours
3. **Fix Development**: Security patches developed and tested
4. **Disclosure**: Coordinated disclosure with reporter
5. **Deployment**: Emergency deployment if critical

## Security Updates

Subscribe to our security advisories to receive notifications about:
- Critical vulnerability patches
- Security-related dependency updates
- Security feature announcements

## Contact

For security-related questions or concerns:
- Security Team: stakwork-security@stakwork.com
- Maintainers: See CODEOWNERS file

---

**Note**: This security policy is regularly reviewed and updated. Last updated: December 2024.