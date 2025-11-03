# API Security Strategy

## Overview

This document outlines the comprehensive security enhancements implemented across all Hive Platform API endpoints, including authentication, authorization, encryption, and webhook signature validation strategies.

## Architecture

### Three-Tier Security Model

1. **Middleware Layer** (JWT Validation)
   - Validates NextAuth JWT tokens using `getToken()`
   - Attaches user context to request headers (`x-middleware-user-id`, `x-middleware-user-email`, `x-middleware-user-name`)
   - Enforces route-level access policies (public, webhook, system, protected)
   - Location: `/src/middleware.ts`

2. **Application Layer** (Session/Signature Validation)
   - **Session-based routes**: Validates session via `getServerSession(authOptions)`
   - **Webhook routes**: HMAC-SHA256 signature validation with encrypted secrets
   - **API key routes**: Validates encrypted API keys with workspace association
   - Locations: Individual API route handlers

3. **Business Logic Layer** (RBAC)
   - Role-based access control via `validateWorkspaceAccess(slug, userId)`
   - Returns granular permissions: `canRead`, `canWrite`, `canAdmin`
   - Permission hierarchy: VIEWER < STAKEHOLDER < DEVELOPER < PM < ADMIN < OWNER
   - Location: `/src/services/workspace.ts`

## Implementation Details

### 1. Webhook Signature Validation

**Affected Endpoints:**
- `/api/stakwork/webhook` - Stakwork task status updates
- `/api/janitors/webhook` - Janitor run completion notifications
- `/api/webhook/stakwork/response` - Stakwork run webhooks

**Security Pattern:**
```typescript
// 1. Extract signature from request header
const signature = request.headers.get("x-stakwork-signature");

// 2. Get raw body for HMAC computation
const rawBody = await request.text();

// 3. Retrieve encrypted workspace-specific webhook secret
const workspace = await db.workspace.findUnique({
  where: { id: workspaceId },
  select: { stakworkWebhookSecret: true },
});

// 4. Decrypt webhook secret
const encryptionService = EncryptionService.getInstance();
const webhookSecret = encryptionService.decryptField(
  "stakworkWebhookSecret",
  workspace.stakworkWebhookSecret,
);

// 5. Validate signature using constant-time comparison
const isValid = validateWebhookSignature({
  secret: webhookSecret,
  payload: rawBody,
  signature,
  algorithm: "sha256",
});
```

**Key Security Features:**
- **Workspace-specific secrets**: Each workspace has unique encrypted webhook secrets
- **Constant-time comparison**: Prevents timing attacks using `crypto.timingSafeEqual()`
- **HMAC-SHA256**: Industry-standard signature algorithm
- **Encrypted storage**: All webhook secrets stored encrypted using `EncryptionService`

**Database Schema Changes:**
```prisma
model Workspace {
  stakworkWebhookSecret String? @map("stakwork_webhook_secret") @db.Text
  janitorWebhookSecret  String? @map("janitor_webhook_secret") @db.Text
}
```

### 2. API Key Management System

**Purpose:** Replace static environment variable tokens (`ADMIN_TOKEN`, `API_TOKEN`) with secure, rotatable, workspace-scoped encrypted API keys.

**New Prisma Model:**
```prisma
model ApiKey {
  id           String    @id @default(cuid())
  workspaceId  String    @map("workspace_id")
  name         String
  keyHash      String    @unique @map("key_hash")
  encryptedKey String    @map("encrypted_key") @db.Text
  permissions  String[]  @default([])
  lastUsedAt   DateTime? @map("last_used_at")
  expiresAt    DateTime? @map("expires_at")
  isActive     Boolean   @default(true) @map("is_active")
  createdBy    String    @map("created_by")
  createdAt    DateTime  @default(now()) @map("created_at")
  updatedAt    DateTime  @updatedAt @map("updated_at")

  workspace    Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@index([workspaceId])
  @@index([keyHash])
  @@index([isActive, expiresAt])
  @@map("api_keys")
}
```

**Key Features:**
- **Format**: `hive_{64_hex_characters}` (e.g., `hive_a1b2c3...`)
- **Hashing**: SHA256 hash of full key stored for validation (original key never stored plaintext)
- **Encryption**: Full key encrypted using `EncryptionService` for recovery/audit purposes
- **Workspace-scoped**: Each key associated with specific workspace
- **Permissions**: Array of permission strings (e.g., `["chat:write", "task:read"]`)
- **Expiration**: Optional expiration timestamp for time-limited keys
- **Rotation**: Built-in rotation support via `rotateApiKey()` method

**Service API:**
```typescript
// Create new API key
const { id, key } = await apiKeyService().createApiKey({
  workspaceId: "workspace-123",
  userId: "user-456",
  name: "Chat Integration Key",
  permissions: ["chat:write"],
  expiresAt: new Date("2025-12-31"),
});

// Validate API key
const result = await apiKeyService().validateApiKey(key);
if (result.isValid) {
  const { workspaceId, permissions, apiKeyId } = result;
  // Proceed with request
}

// Rotate API key
const newKey = await apiKeyService().rotateApiKey(
  "old-key-id",
  "workspace-slug",
  "user-id",
);

// Revoke API key
await apiKeyService().revokeApiKey(
  "key-id",
  "workspace-slug",
  "user-id",
);
```

### 3. Authenticated Endpoint Pattern

**Affected Endpoints:**
- `/api/transcript/chunk` - Previously unsecured, now requires session + workspace write access

**Security Pattern:**
```typescript
export async function POST(request: NextRequest) {
  // 1. Authenticate user session
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Validate workspace access
  const access = await validateWorkspaceAccess(workspaceSlug, session.user.id);
  if (!access.canWrite) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  // 3. Execute business logic
  // ...
}
```

### 4. Encryption Strategy

**Field-Level Encryption:**
All sensitive data encrypted at rest using AES-256-GCM via `EncryptionService`:

**Encrypted Fields:**
- OAuth tokens: `access_token`, `refresh_token`, `id_token`
- API keys: `swarmApiKey`, `poolApiKey`, `stakworkApiKey`, `apiKey`
- Webhook secrets: `githubWebhookSecret`, `stakworkWebhookSecret`, `janitorWebhookSecret`
- Environment variables: `environmentVariables`
- Source control tokens: `source_control_token`, `source_control_refresh_token`

**Encrypted Data Format:**
```typescript
interface EncryptedData {
  data: string;       // Base64-encoded ciphertext
  iv: string;         // Base64-encoded initialization vector
  tag: string;        // Base64-encoded authentication tag
  keyId?: string;     // Key identifier for rotation
  version: string;    // Encryption version
  encryptedAt: string; // ISO timestamp
}
```

**Key Management:**
- **Active Key**: `TOKEN_ENCRYPTION_KEY` environment variable (64-char hex)
- **Key ID**: `TOKEN_ENCRYPTION_KEY_ID` environment variable (e.g., "k2")
- **Key Registry**: Supports multiple keys for zero-downtime rotation
- **Old Keys**: `ROTATION_OLD_KEYS` JSON map for decrypting legacy data

**Key Rotation Process:**
```bash
# 1. Generate new key
npm run setup

# 2. Add old key to registry
export ROTATION_OLD_KEYS='{"k1":"old_key_hex"}'
export TOKEN_ENCRYPTION_KEY_ID="k2"
export TOKEN_ENCRYPTION_KEY="new_key_hex"

# 3. Run rotation script
npm run rotate-keys

# 4. Verify rotation
npm run test:decrypt
```

**Rotation Script Coverage:**
- Account OAuth tokens (access, refresh, ID tokens)
- Swarm API keys (swarm, pool, environment variables)
- Repository webhook secrets
- Workspace Stakwork API keys

## Security Checklist

### Endpoint Security Audit

✅ **Secured Webhooks (HMAC Validation)**
- `/api/github/webhook` - GitHub webhook with signature validation
- `/api/swarm/stakgraph/webhook` - Stakgraph webhook with signature validation
- `/api/stakwork/webhook` - **NEWLY SECURED** with workspace-specific secret
- `/api/janitors/webhook` - **NEWLY SECURED** with workspace-specific secret
- `/api/webhook/stakwork/response` - **NEWLY SECURED** with workspace-specific secret

✅ **Authenticated Endpoints (Session + RBAC)**
- `/api/transcript/chunk` - **NEWLY SECURED** with session auth + workspace write permission

✅ **Middleware-Protected Routes (JWT Validation)**
- All `/api/*` routes except explicitly marked as public/webhook/system

### Data Protection

✅ **Encrypted at Rest**
- All OAuth tokens and refresh tokens
- All API keys and secrets
- All webhook secrets
- Workspace environment variables

✅ **Key Rotation Support**
- Multi-key registry for backward compatibility
- Automated re-encryption scripts
- Zero-downtime rotation process

### Testing Coverage

✅ **Unit Tests**
- `api-key-service.test.ts` - Key generation, validation, hashing
- `env-vars.test.ts` - Environment variable encryption helpers

✅ **Integration Tests**
- `stakwork-webhook.test.ts` - Webhook signature validation flows
  - Missing signature rejection
  - Invalid signature rejection
  - Valid signature acceptance
  - Workspace secret validation
  - Timing attack prevention

⚠️ **Pending Tests** (Recommended)
- Janitor webhook signature validation
- Stakwork response webhook signature validation
- API key creation and validation flows
- API key rotation scenarios
- Transcript chunk authentication

## Migration Guide

### For Webhook Providers (Stakwork, Janitor)

1. **Generate workspace-specific webhook secrets:**
```typescript
const secret = crypto.randomBytes(32).toString("hex");
const encryptedSecret = encryptionService.encryptField(
  "stakworkWebhookSecret",
  secret
);

await db.workspace.update({
  where: { id: workspaceId },
  data: { stakworkWebhookSecret: JSON.stringify(encryptedSecret) },
});
```

2. **Update webhook senders to include HMAC signature:**
```typescript
const signature = crypto
  .createHmac("sha256", secret)
  .update(JSON.stringify(payload))
  .digest("hex");

fetch(webhookUrl, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-stakwork-signature": signature,
  },
  body: JSON.stringify(payload),
});
```

### For API Key Consumers (Chat, Tasks)

1. **Generate workspace API keys:**
```typescript
const apiKeyService = new ApiKeyService();
const { key } = await apiKeyService.createApiKey({
  workspaceId: "workspace-123",
  userId: "user-456",
  name: "Chat Integration",
  permissions: ["chat:write"],
});

// Share key securely with integration
console.log(`API Key: ${key}`);
```

2. **Update API consumers to use new keys:**
```typescript
fetch("/api/chat/response", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-api-key": key, // Changed from x-api-token
  },
  body: JSON.stringify(message),
});
```

### Database Migration Steps

1. **Create migration:**
```bash
npx prisma migrate dev --name add_webhook_secrets_and_api_keys
```

2. **Generate Prisma client:**
```bash
npx prisma generate
```

3. **Run migration:**
```bash
npx prisma migrate deploy
```

## Discussion Points for Gonza

### 1. Webhook Secret Management

**Current Implementation:**
- Each workspace has unique encrypted webhook secrets
- Secrets stored in `stakworkWebhookSecret` and `janitorWebhookSecret` fields
- HMAC-SHA256 with constant-time comparison

**Questions:**
- Should webhook secrets be configurable via UI or auto-generated?
- Should we implement webhook secret rotation UI?
- Do we need webhook signature version support (e.g., v1, v2)?
- Should we log webhook authentication failures for security monitoring?

### 2. API Key Permissions Model

**Current Implementation:**
- Simple string array for permissions (e.g., `["chat:write", "task:read"]`)
- No formal permission registry or validation

**Questions:**
- Should we define a formal permission schema (e.g., `resource:action` pattern)?
- Do we need role-based API keys (e.g., `["role:developer"]`)?
- Should API key permissions map to workspace roles?
- How should we handle permission validation in endpoints?

### 3. Encryption Key Rotation Schedule

**Current Implementation:**
- Manual rotation via script (`npm run rotate-keys`)
- Supports multiple keys via registry
- No automated rotation schedule

**Questions:**
- Should we implement automated quarterly key rotation?
- Do we need audit logs for key rotation events?
- Should we enforce key rotation policies (e.g., max 90 days)?
- How should we notify workspace owners of rotation requirements?

### 4. Static Token Migration

**Current Tokens:**
- `ADMIN_TOKEN` - Used for admin operations
- `API_TOKEN` - Used for general API access
- `POD_URL` - Mock authentication provider

**Migration Strategy:**
- Replace with workspace-scoped API keys
- Maintain backward compatibility during transition period
- Gradual deprecation with warning logs

**Questions:**
- What's the timeline for deprecating `ADMIN_TOKEN` and `API_TOKEN`?
- Should we maintain a global admin API key for system operations?
- How should we communicate migration to existing integrations?
- Do we need a migration tool for bulk API key creation?

### 5. Security Monitoring & Alerting

**Current Implementation:**
- Console logging for authentication failures
- No structured security event logging

**Questions:**
- Should we implement structured security audit logs?
- Do we need alerting for suspicious activity (e.g., repeated failed auth)?
- Should we track API key usage metrics (requests per key, last used)?
- Do we need rate limiting per API key?

### 6. Compliance & Standards

**Questions:**
- Do we need to document security for compliance (SOC 2, GDPR)?
- Should we implement key management best practices (e.g., NIST guidelines)?
- Do we need security certifications for encryption methods?
- Should we conduct third-party security audits?

## Security Best Practices

### For Developers

1. **Always use `validateWorkspaceAccess()`** after session authentication
2. **Never log sensitive data** (tokens, keys, secrets)
3. **Use constant-time comparisons** for signature validation
4. **Encrypt all sensitive fields** using `EncryptionService`
5. **Validate input** before database operations
6. **Return generic error messages** to prevent information disclosure

### For Workspace Owners

1. **Rotate API keys regularly** (recommended: every 90 days)
2. **Use separate API keys** for different integrations
3. **Set expiration dates** for time-limited access
4. **Revoke unused keys** immediately
5. **Monitor API key usage** via last used timestamps
6. **Store API keys securely** (use environment variables, secret managers)

## Next Steps

1. **Run database migration** to add new fields
2. **Deploy webhook signature validation** updates
3. **Test webhook integrations** with Stakwork/Janitor teams
4. **Create API key management UI** for workspace settings
5. **Write remaining integration tests** for full coverage
6. **Document migration guide** for external integrations
7. **Schedule security review** with Gonza
8. **Plan deprecation timeline** for static tokens

## References

- [OWASP API Security Top 10](https://owasp.org/www-project-api-security/)
- [NIST Key Management Guidelines](https://csrc.nist.gov/publications/detail/sp/800-57-part-1/rev-5/final)
- [GitHub Webhook Security](https://docs.github.com/en/developers/webhooks-and-events/webhooks/securing-your-webhooks)