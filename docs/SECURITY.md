# Security Architecture

This document outlines the security model, trust boundaries, and authentication mechanisms used in the Hive Platform.

## Table of Contents

- [Trust Boundaries](#trust-boundaries)
- [Authentication & Authorization](#authentication--authorization)
- [Encryption & Key Management](#encryption--key-management)
- [Webhook Security](#webhook-security)
- [API Security](#api-security)
- [Security Best Practices](#security-best-practices)

---

## Trust Boundaries

The application enforces six distinct trust boundaries to isolate different security contexts:

```
┌─────────────────────────────────────────────────────────────┐
│                        Internet                              │
│                     (Untrusted)                              │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                   Middleware Layer                           │
│              (First Line of Defense)                         │
│                                                              │
│  • Route Policy Evaluation                                   │
│  • Session Token Validation (JWT)                            │
│  • User Context Header Injection                             │
│  • Webhook Signature Verification Gate                       │
└─────────────────────────┬───────────────────────────────────┘
                          │
            ┌─────────────┼─────────────┐
            │             │             │
            ▼             ▼             ▼
    ┌──────────┐  ┌──────────┐  ┌──────────┐
    │  Public  │  │Protected │  │ Webhook  │
    │  Routes  │  │  Routes  │  │  Routes  │
    └──────────┘  └──────────┘  └──────────┘
```

### Boundary 1: User Authentication

**Enforcement Points:**
- `src/middleware.ts` (lines 114-123) - JWT token validation
- `src/lib/auth/nextauth.ts` - NextAuth.js configuration
- `src/app/api/*/route.ts` - Handler-level session checks

**Mechanisms:**
- GitHub OAuth for user authentication
- NextAuth.js with encrypted JWT/database sessions
- AES-256-GCM session encryption
- Session expiry and refresh handling

**Trust Transition:**
```
Unauthenticated Request → Middleware (validates JWT) → Authenticated Request
```

**Headers Injected:**
- `x-middleware-user-id`
- `x-middleware-user-email`
- `x-middleware-user-name`
- `x-middleware-auth-status`

---

### Boundary 2: Workspace Authorization

**Enforcement Points:**
- `src/services/workspace.ts` - Access validation functions
- `src/lib/auth/roles.ts` - Role hierarchy and permission checking
- `src/lib/helpers/workspace-member-queries.ts` - Database-level access queries

**Role Hierarchy:**
```
OWNER (100)
  ├── Full workspace control
  └── Can manage all resources
ADMIN (80)
  ├── Manage users, settings, repositories
  └── Cannot delete workspace
PM (60)
  ├── Product management, features, roadmaps
  └── Limited user management
DEVELOPER (40)
  ├── Development tasks, content creation
  └── No administrative access
STAKEHOLDER (20)
  ├── Limited content interaction
  └── Read-mostly permissions
VIEWER (10)
  └── Read-only access
```

**Access Validation:**
```typescript
// Example workspace authorization check
const hasAccess = await validateWorkspaceAccess(
  workspaceId,
  userId,
  WorkspaceRole.DEVELOPER, // Minimum required role
);
```

**Trust Transition:**
```
Authenticated User → Workspace Membership Check → Authorized Member
```

---

### Boundary 3: External Service Calls

**Enforcement Points:**
- `src/lib/http-client.ts` - HTTP client with timeout and error handling
- `src/lib/base-service.ts` - Service abstraction layer
- `src/services/*/` - Individual service implementations

**Security Measures:**
- **API keys encrypted at rest** using AES-256-GCM
- **Just-in-time decryption** - keys decrypted only when making requests
- **Timeout protection** - 10-second default via `AbortController`
- **Service-specific authentication** per `serviceConfigs`
- **Structured error handling** with service context

**Architecture:**
```
API Route → ServiceFactory → ConcreteService → BaseServiceClass
                                                      ↓
                                                 HttpClient
                                                      ↓
                                            EncryptionService.decryptField()
                                                      ↓
                                              External Service
```

**Example:**
```typescript
// API key is decrypted just before use
const decryptedKey = encryptionService.decryptField("apiKey", encryptedKey);
await httpClient.post(endpoint, data, {
  headers: { Authorization: `Bearer ${decryptedKey}` },
});
```

---

### Boundary 4: Inbound Webhooks

**Enforcement Points:**
- `src/app/api/github/webhook/route.ts` - GitHub webhook handler
- `src/app/api/stakwork/webhook/route.ts` - Stakwork webhook handler
- `src/lib/encryption/crypto.ts` - Signature verification utilities

**Security Mechanisms:**

**GitHub Webhooks:**
```typescript
// HMAC-SHA256 signature verification
const signature = request.headers.get("x-hub-signature-256");
const payload = await request.text();
const webhookSecret = await getDecryptedWebhookSecret(webhookId);

const expectedSignature = computeHmacSha256Hex(payload, webhookSecret);

// Constant-time comparison to prevent timing attacks
if (!timingSafeEqual(signature, expectedSignature)) {
  return new Response("Invalid signature", { status: 401 });
}
```

**Stakwork Webhooks:**
```typescript
// Custom signature header validation
const signature = request.headers.get("x-signature");
const isValid = await StakgraphWebhookService.verifySignature(signature, payload);
```

**Trust Transition:**
```
External Service → Webhook Endpoint → Signature Verification → Trusted Event
```

**Bypass Rationale:**
Webhook endpoints are marked `"webhook"` in `ROUTE_POLICIES` to bypass session authentication, but implement alternative cryptographic authentication (HMAC signatures, API tokens).

---

### Boundary 5: Database Access

**Enforcement Points:**
- `src/lib/db.ts` - Prisma client singleton
- `prisma/schema.prisma` - Database schema with constraints
- `src/lib/encryption/field-encryption.ts` - Field-level encryption

**Security Measures:**
- **Prisma ORM** with TypeScript type safety (prevents SQL injection)
- **Soft deletes** via `deleted: true` flag (preserves audit trail)
- **Encrypted fields** for sensitive data (tokens, API keys, secrets)
- **Application-level RLS** (no database-level row-level security)
- **Transaction support** for atomic operations

**Encrypted Field Format:**
```typescript
interface EncryptedField {
  data: string;        // Base64 encrypted data
  iv: string;          // Initialization vector
  tag: string;         // Authentication tag
  keyId?: string;      // Key version for rotation
  version: string;     // Encryption version
  encryptedAt: string; // Timestamp
}
```

**Trust Transition:**
```
API Handler → Prisma Query → Database
                  ↓
            Application-level access checks
            (workspace membership, soft deletes)
```

**Limitation:**
Row-level security is enforced at the application layer, not at the database layer. This is a limitation of Prisma ORM. Consider PostgreSQL RLS or Prisma extensions for future enhancement.

---

### Boundary 6: Frontend-Backend

**Enforcement Points:**
- `src/app/api/*/route.ts` - API route handlers
- `src/lib/schemas/*.ts` - Zod validation schemas
- `src/middleware.ts` - CSRF protection via NextAuth.js

**Security Measures:**
- **Input validation** via Zod schemas
- **CSRF protection** via NextAuth.js tokens
- **Session cookies** with `httpOnly`, `secure`, `sameSite` flags
- **Output sanitization** in responses
- **Rate limiting** (TODO: not yet implemented)

**Example Validation:**
```typescript
import { z } from "zod";
import { WorkspaceSchema } from "@/lib/schemas/workspace";

export async function POST(request: NextRequest) {
  const body = await request.json();
  
  // Validate input against schema
  const validation = WorkspaceSchema.safeParse(body);
  
  if (!validation.success) {
    return NextResponse.json(
      { error: "Invalid input", details: validation.error },
      { status: 400 },
    );
  }
  
  // Process validated data
  const workspace = await createWorkspace(validation.data);
  return NextResponse.json(workspace);
}
```

---

## Authentication & Authorization

### Authentication Flow

```
┌─────────┐
│  User   │
└────┬────┘
     │ 1. Click "Sign in with GitHub"
     ▼
┌─────────────────┐
│  /api/auth/     │
│  signin/github  │
└────┬────────────┘
     │ 2. Redirect to GitHub OAuth
     ▼
┌─────────────────┐
│  GitHub OAuth   │
└────┬────────────┘
     │ 3. User authorizes
     ▼
┌─────────────────┐
│  /api/auth/     │
│  callback/      │
│  github         │
└────┬────────────┘
     │ 4. Exchange code for token
     │ 5. Create/update User record
     │ 6. Create Session record (encrypted)
     ▼
┌─────────────────┐
│  Set session    │
│  cookie         │
└────┬────────────┘
     │ 7. Redirect to dashboard
     ▼
┌─────────────────┐
│  /w/[slug]      │
│  (protected)    │
└─────────────────┘
```

### Authorization Patterns

**Pattern 1: Middleware-Level Auth**
```typescript
// src/middleware.ts
const token = await getToken({ req, secret });
if (!token) {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
```

**Pattern 2: Handler-Level Auth**
```typescript
// src/app/api/*/route.ts
const session = await getServerSession(authOptions);
if (!session?.user) {
  return NextResponse.json({ error: "Authentication required" }, { status: 401 });
}
```

**Pattern 3: Workspace-Level Auth**
```typescript
// src/services/workspace.ts
const hasAccess = await validateWorkspaceAccess(
  workspaceId,
  userId,
  WorkspaceRole.DEVELOPER,
);

if (!hasAccess) {
  throw new Error("Insufficient permissions");
}
```

**Pattern 4: Webhook Auth**
```typescript
// src/app/api/github/webhook/route.ts
const signature = request.headers.get("x-hub-signature-256");
const isValid = verifyGitHubSignature(payload, signature, secret);

if (!isValid) {
  return new Response("Invalid signature", { status: 401 });
}
```

---

## Encryption & Key Management

### Field-Level Encryption

**Encryption Service:** `src/lib/encryption/field-encryption.ts`

**Algorithm:** AES-256-GCM

**Key Storage:** Environment variables (`TOKEN_ENCRYPTION_KEY`, `TOKEN_ENCRYPTION_KEY_ID`)

**Encrypted Fields:**
- OAuth access tokens
- OAuth refresh tokens
- API keys (Stakwork, Pool Manager, etc.)
- Webhook secrets
- GitHub App installation tokens

**Encryption Flow:**
```typescript
// Encryption
const encrypted = encryptionService.encryptField("accessToken", plaintext);
// Result: { data, iv, tag, keyId, version, encryptedAt }

// Storage
await prisma.sourceControlToken.create({
  data: {
    accessToken: encrypted, // Stored as JSON
  },
});

// Decryption (just-in-time)
const decrypted = encryptionService.decryptField("accessToken", encrypted);
// Used immediately, not stored in memory
```

### Key Rotation

**Process:**
1. Generate new encryption key: `npm run setup` or `openssl rand -hex 32`
2. Update environment variables:
   - `TOKEN_ENCRYPTION_KEY_NEW` - New key
   - `TOKEN_ENCRYPTION_KEY_ID_NEW` - New key version (e.g., "k3")
3. Run migration: `npm run rotate-keys`
4. Migration re-encrypts all encrypted fields with new key
5. Update production environment variables
6. Remove old key after verification

**Key Versioning:**
Each encrypted field stores `keyId` for rotation tracking. The service supports multiple keys simultaneously during rotation.

---

## Webhook Security

### Signature Verification

**GitHub Webhooks:**
```typescript
import { timingSafeEqual, computeHmacSha256Hex } from "@/lib/encryption/crypto";

const signature = request.headers.get("x-hub-signature-256");
const payload = await request.text();
const secret = await getDecryptedWebhookSecret(webhookId);

const expected = `sha256=${computeHmacSha256Hex(payload, secret)}`;

if (!timingSafeEqual(signature, expected)) {
  return new Response("Invalid signature", { status: 401 });
}
```

**Stakwork Webhooks:**
```typescript
const signature = request.headers.get("x-signature");
const isValid = await StakgraphWebhookService.verifySignature(
  signature,
  payload,
  secret,
);
```

### Webhook Configuration

**File:** `src/config/middleware.ts`

```typescript
// Webhook routes bypass session auth but implement signature verification
{ path: "/api/github/webhook", strategy: "prefix", access: "webhook" },
{ path: "/api/stakwork/webhook", strategy: "prefix", access: "webhook" },
{ path: "/api/swarm/stakgraph/webhook", strategy: "exact", access: "webhook" },
```

### Webhook Event Validation

1. **Signature verification** (cryptographic proof of origin)
2. **Event type validation** (ensure expected event)
3. **Repository ownership check** (verify webhook belongs to workspace)
4. **Idempotency handling** (prevent duplicate processing)

---

## API Security

### Route Access Levels

**File:** `src/config/middleware.ts`

```typescript
export const ROUTE_POLICIES = [
  // Public routes (no authentication required)
  { path: "/", strategy: "exact", access: "public" },
  { path: "/auth", strategy: "prefix", access: "public" },
  { path: "/api/auth", strategy: "prefix", access: "public" },
  { path: "/api/mock", strategy: "prefix", access: "public" }, // Dev only

  // Webhook routes (signature-based authentication)
  { path: "/api/github/webhook", strategy: "prefix", access: "webhook" },
  { path: "/api/stakwork/webhook", strategy: "prefix", access: "webhook" },
  
  // System routes (cron jobs with bearer token)
  { path: "/api/cron", strategy: "prefix", access: "system" },
  
  // Protected routes (default - session authentication required)
  // All other /api/* and /w/* routes
];
```

### API Authentication Methods

**Method 1: Session Cookies** (Default)
- Used by: All protected API routes
- Mechanism: NextAuth.js JWT/database sessions
- Headers: Session cookie automatically sent by browser

**Method 2: API Tokens** (Webhooks)
- Used by: `/api/chat/response`, `/api/tasks/*/title`
- Mechanism: `x-api-token` header validated against `process.env.API_TOKEN`

**Method 3: HMAC Signatures** (GitHub Webhooks)
- Used by: `/api/github/webhook`
- Mechanism: HMAC-SHA256 signature in `x-hub-signature-256` header

**Method 4: Bearer Tokens** (Cron Jobs)
- Used by: `/api/cron/*`
- Mechanism: `Authorization: Bearer {CRON_SECRET}` header

### Defense in Depth

The application implements **multi-layer security**:

1. **Middleware Layer**: Route-level access control
2. **Handler Layer**: Session validation and input validation
3. **Service Layer**: Workspace authorization and role checking
4. **Database Layer**: Soft deletes and encrypted fields

**Example:**
```typescript
// Layer 1: Middleware (src/middleware.ts)
const token = await getToken({ req, secret });
if (!token) return unauthorized();

// Layer 2: Handler (src/app/api/screenshots/route.ts)
const session = await getServerSession(authOptions);
if (!session?.user) return unauthorized();

// Layer 3: Service (src/services/workspace.ts)
const hasAccess = await validateWorkspaceAccess(workspaceId, userId, role);
if (!hasAccess) throw new Error("Insufficient permissions");

// Layer 4: Database (Prisma query)
const screenshot = await prisma.screenshot.findFirst({
  where: { 
    id, 
    workspace: { 
      members: { some: { userId } },
      deleted: false,
    },
  },
});
```

---

## Security Best Practices

### For Developers

#### ✅ DO

- **Always validate workspace access** before performing operations
- **Use Zod schemas** for input validation
- **Encrypt sensitive data** before storing in database
- **Use constant-time comparisons** for secrets (e.g., `timingSafeEqual`)
- **Add integration tests** for authentication and authorization
- **Document security requirements** in API route comments
- **Use parameterized queries** via Prisma (prevents SQL injection)
- **Implement rate limiting** for public endpoints (TODO)
- **Log security events** (failed auth, invalid signatures)
- **Validate webhook signatures** before processing events
- **Use just-in-time decryption** for API keys

#### ❌ DON'T

- **Never mark routes as "public" unnecessarily**
- **Never log sensitive data** (tokens, passwords, API keys)
- **Never store plaintext secrets** in the database
- **Never bypass middleware auth** without alternative security
- **Never trust user input** without validation
- **Never expose internal error details** to clients
- **Never make backend-to-backend HTTP calls** (use shared services)
- **Never hardcode secrets** in source code
- **Never commit `.env` files** to version control

### Adding New Endpoints

**Checklist:**

1. ✅ Determine appropriate route access level (`"protected"`, `"webhook"`, `"public"`)
2. ✅ Implement authentication check in handler (if protected)
3. ✅ Add Zod schema for input validation
4. ✅ Validate workspace access (if workspace-scoped)
5. ✅ Check user role permissions (if role-restricted)
6. ✅ Add integration tests for auth flows
7. ✅ Document security requirements in code comments
8. ✅ Review with security-minded team member

### Adding New Services

**Checklist:**

1. ✅ Define service configuration in `src/config/services.ts`
2. ✅ Store API keys encrypted in database
3. ✅ Extend `BaseServiceClass` for standardized error handling
4. ✅ Implement timeout handling (default 10s)
5. ✅ Use `encryptionService.decryptField()` for just-in-time decryption
6. ✅ Add service-specific authentication headers
7. ✅ Create service singleton via `ServiceFactory`
8. ✅ Add integration tests with mocked responses

---

## Threat Model

### Identified Threats

**T1: Session Hijacking**
- **Mitigation**: Encrypted JWT sessions, `httpOnly` cookies, short expiry times
- **Status**: ✅ Mitigated

**T2: SQL Injection**
- **Mitigation**: Prisma ORM with parameterized queries
- **Status**: ✅ Mitigated

**T3: XSS (Cross-Site Scripting)**
- **Mitigation**: React's automatic escaping, Content Security Policy headers
- **Status**: ⚠️ Partially mitigated (CSP TODO)

**T4: CSRF (Cross-Site Request Forgery)**
- **Mitigation**: NextAuth.js CSRF tokens, `sameSite` cookies
- **Status**: ✅ Mitigated

**T5: API Key Exposure**
- **Mitigation**: AES-256-GCM encryption, just-in-time decryption, key rotation
- **Status**: ✅ Mitigated

**T6: Webhook Replay Attacks**
- **Mitigation**: HMAC signature verification, event idempotency checks
- **Status**: ⚠️ Partially mitigated (idempotency TODO)

**T7: Privilege Escalation**
- **Mitigation**: Role hierarchy enforcement, multi-layer authorization checks
- **Status**: ✅ Mitigated

**T8: DDoS / Rate Limiting**
- **Mitigation**: None currently implemented
- **Status**: ❌ Not mitigated (TODO: Add rate limiting)

**T9: Timing Attacks on Signatures**
- **Mitigation**: `timingSafeEqual()` for constant-time comparisons
- **Status**: ✅ Mitigated

**T10: Data Leakage via Logs**
- **Mitigation**: Structured logging, sensitive data masking
- **Status**: ⚠️ Partially mitigated (audit TODO)

---

## Security Roadmap

### Immediate Priorities

- [ ] Implement rate limiting on public endpoints
- [ ] Add Content Security Policy (CSP) headers
- [ ] Audit logging for sensitive data exposure
- [ ] Add webhook event idempotency handling
- [ ] Security audit of all `"public"` and `"webhook"` routes

### Short-Term Enhancements

- [ ] Implement API key rotation mechanism
- [ ] Add intrusion detection monitoring
- [ ] Create automated security testing suite
- [ ] Document incident response procedures
- [ ] Add database query performance monitoring

### Long-Term Improvements

- [ ] Consider PostgreSQL Row-Level Security (RLS)
- [ ] Implement OAuth scopes for fine-grained permissions
- [ ] Add support for hardware security modules (HSM)
- [ ] Implement secrets management service (e.g., HashiCorp Vault)
- [ ] Add automated vulnerability scanning in CI/CD

---

## Reporting Security Issues

If you discover a security vulnerability, please:

1. **Do NOT** open a public GitHub issue
2. Email security@[domain].com with details
3. Include steps to reproduce if possible
4. Allow 90 days for patch before public disclosure

We take security seriously and will respond within 48 hours.

---

## Additional Resources

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Next.js Security Best Practices](https://nextjs.org/docs/app/building-your-application/security)
- [Prisma Security Guidelines](https://www.prisma.io/docs/guides/security)
- [NextAuth.js Security](https://next-auth.js.org/security)
- [GitHub Webhook Security](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries)

---

**Last Updated:** 2024
**Maintained By:** Security Team
**Review Frequency:** Quarterly