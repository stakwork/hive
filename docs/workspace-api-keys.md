# Workspace API Keys

This document describes the plan for implementing workspace API keys to enable programmatic access to Hive APIs, primarily for MCP (Model Context Protocol) server integration.

## Overview

Workspace API keys provide a way for external tools (like AI coding assistants via MCP) to authenticate with Hive on behalf of a specific workspace. Unlike OAuth tokens tied to user sessions, API keys are:

- **Workspace-scoped**: Each key belongs to a specific workspace
- **Independent**: Multiple keys per workspace for different developers/agents
- **Revocable**: Individual keys can be revoked without affecting others
- **Auditable**: Track which key made which request

## Use Cases

1. **MCP Server Access**: AI coding assistants (Cursor, Claude Desktop, Windsurf) connecting to Hive's MCP endpoint
2. **CI/CD Integration**: Automated workflows interacting with workspace tasks
3. **Custom Tooling**: Third-party tools accessing Hive APIs

## Data Model

### New Table: `WorkspaceApiKey`

```prisma
model WorkspaceApiKey {
  id           String    @id @default(cuid())
  workspaceId  String    @map("workspace_id")
  workspace    Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  
  // Key identification
  name         String                // Human-readable name, e.g. "Cursor - John's laptop"
  keyPrefix    String    @map("key_prefix")  // First 8 chars for display: "hive_abc1..."
  keyHash      String    @unique @map("key_hash")  // SHA-256 hash for lookup
  
  // Ownership & audit
  createdById  String    @map("created_by_id")
  createdBy    User      @relation(fields: [createdById], references: [id], onDelete: Cascade)
  createdAt    DateTime  @default(now()) @map("created_at")
  lastUsedAt   DateTime? @map("last_used_at")
  expiresAt    DateTime? @map("expires_at")  // Optional expiration
  
  // Status
  revokedAt    DateTime? @map("revoked_at")
  revokedById  String?   @map("revoked_by_id")
  revokedBy    User?     @relation("RevokedBy", fields: [revokedById], references: [id])

  @@index([workspaceId])
  @@index([keyHash])
  @@index([createdById])
  @@map("workspace_api_keys")
}
```

### Key Format

```
hive_{workspaceIdPrefix}_{randomBytes}
```

Example: `hive_cm5x_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6`

- `hive_` - Static prefix identifying Hive workspace keys
- `{workspaceIdPrefix}` - First 4 chars of workspace ID (for debugging)
- `{randomBytes}` - 32 cryptographically random bytes, base62 encoded

### Storage Strategy

**We do NOT store the raw key** - only:
1. `keyPrefix`: First 8 characters for display in UI (`hive_...`)
2. `keyHash`: SHA-256 hash of full key for lookup

The raw key is only shown **once** at creation time.

## API Endpoints

### Create API Key

```
POST /api/workspaces/[slug]/api-keys
```

**Request:**
```json
{
  "name": "Cursor - John's MacBook",
  "expiresAt": "2025-12-31T23:59:59Z"  // Optional
}
```

**Response (201):**
```json
{
  "id": "clxyz...",
  "name": "Cursor - John's MacBook",
  "keyPrefix": "hive_",
  "key": "hive_cm5x_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",  // Only returned once!
  "createdAt": "2025-01-31T12:00:00Z",
  "expiresAt": "2025-12-31T23:59:59Z"
}
```

**Permissions:** OWNER, ADMIN, PM, DEVELOPER

### List API Keys

```
GET /api/workspaces/[slug]/api-keys
```

**Response (200):**
```json
{
  "keys": [
    {
      "id": "clxyz...",
      "name": "Cursor - John's MacBook",
      "keyPrefix": "hive_",
      "createdAt": "2025-01-31T12:00:00Z",
      "lastUsedAt": "2025-01-31T14:30:00Z",
      "expiresAt": "2025-12-31T23:59:59Z",
      "createdBy": {
        "id": "user123",
        "name": "John Doe"
      },
      "isRevoked": false
    }
  ]
}
```

**Permissions:** OWNER, ADMIN, PM, DEVELOPER

### Revoke API Key

```
DELETE /api/workspaces/[slug]/api-keys/[keyId]
```

**Response (200):**
```json
{
  "success": true,
  "message": "API key revoked"
}
```

**Permissions:** 
- OWNER, ADMIN: Can revoke any key
- PM, DEVELOPER: Can only revoke keys they created

## MCP Server Integration

### Endpoint

```
/api/mcp/[transport]?apiKey={key}
```

The MCP server uses `mcp-handler` with custom token verification:

```typescript
// app/api/mcp/[transport]/route.ts
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { validateApiKey } from "@/lib/api-keys";

const handler = createMcpHandler(
  (server) => {
    // Register MCP tools here
    server.registerTool("list_tasks", { /* ... */ }, async (args, extra) => {
      const { workspaceId } = extra.authInfo?.extra as { workspaceId: string };
      // Use workspaceId to scope queries
    });
  },
  {},
  { basePath: "/api/mcp" }
);

const verifyToken = async (
  req: Request,
  bearerToken?: string
): Promise<AuthInfo | undefined> => {
  // Support both query param and Authorization header
  const url = new URL(req.url);
  const apiKey = url.searchParams.get("apiKey") || bearerToken;
  
  if (!apiKey) return undefined;
  
  const result = await validateApiKey(apiKey);
  if (!result) return undefined;
  
  return {
    token: apiKey,
    clientId: result.workspace.id,
    extra: {
      workspaceId: result.workspace.id,
      workspaceSlug: result.workspace.slug,
      apiKeyId: result.apiKey.id,
    },
  };
};

const authHandler = withMcpAuth(handler, verifyToken, {
  required: true,
});

export { authHandler as GET, authHandler as POST };
```

### Client Configuration

**Claude Desktop / Cursor / Windsurf:**

```json
{
  "mcpServers": {
    "hive": {
      "url": "https://hive.example.com/api/mcp/mcp?apiKey=hive_cm5x_..."
    }
  }
}
```

**For stdio-only clients:**

```json
{
  "mcpServers": {
    "hive": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://hive.example.com/api/mcp/mcp?apiKey=hive_cm5x_..."]
    }
  }
}
```

## Implementation Details

### Key Generation

```typescript
// src/lib/api-keys.ts
import crypto from "crypto";

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function generateApiKey(workspaceId: string): string {
  const prefix = `hive_${workspaceId.slice(0, 4)}_`;
  const randomBytes = crypto.randomBytes(32);
  
  // Base62 encode
  let encoded = "";
  for (const byte of randomBytes) {
    encoded += ALPHABET[byte % 62];
  }
  
  return prefix + encoded;
}

function hashApiKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}
```

### Key Validation

```typescript
// src/lib/api-keys.ts
import { prisma } from "@/lib/prisma";

export async function validateApiKey(key: string) {
  if (!key.startsWith("hive_")) {
    return null;
  }
  
  const hash = hashApiKey(key);
  
  const apiKey = await prisma.workspaceApiKey.findUnique({
    where: { keyHash: hash },
    include: {
      workspace: {
        select: { id: true, slug: true, name: true, deleted: true },
      },
    },
  });
  
  if (!apiKey) return null;
  if (apiKey.revokedAt) return null;
  if (apiKey.expiresAt && apiKey.expiresAt < new Date()) return null;
  if (apiKey.workspace.deleted) return null;
  
  // Update lastUsedAt (fire-and-forget)
  prisma.workspaceApiKey.update({
    where: { id: apiKey.id },
    data: { lastUsedAt: new Date() },
  }).catch(() => {}); // Ignore errors
  
  return {
    apiKey,
    workspace: apiKey.workspace,
  };
}
```

## Security Considerations

1. **Key Hashing**: Raw keys are never stored; only SHA-256 hashes
2. **One-Time Display**: Full key shown only at creation time
3. **Timing-Safe Comparison**: Use constant-time comparison for hash matching
4. **Rate Limiting**: Consider rate limiting per API key
5. **Audit Logging**: Log all API key usage with key ID (not the key itself)
6. **Expiration**: Support optional expiration dates
7. **Revocation**: Immediate revocation takes effect on next request
8. **Workspace Deletion**: Keys cascade delete with workspace
9. **HTTPS Only**: API keys should only be transmitted over HTTPS

### Key Rotation

Users should be able to:
1. Create a new key
2. Update their MCP client configuration
3. Revoke the old key

This is preferable to "regenerating" a key in-place, as it allows gradual migration.

## UI Components

### API Keys Settings Page

Location: `/w/[slug]/settings/api-keys`

Features:
- List all API keys for the workspace
- Create new key (with modal showing full key once)
- Revoke existing keys
- Show last used timestamp
- Show who created each key
- Copy key prefix for identification

### Creation Flow

1. User clicks "Create API Key"
2. Modal asks for name (e.g., "Cursor - Work laptop")
3. Optional: Set expiration date
4. Key is generated and displayed **once** with copy button
5. Warning: "This key won't be shown again. Copy it now!"
6. User confirms they've saved the key

## Migration Plan

1. **Phase 1**: Add database model and migration
2. **Phase 2**: Implement CRUD API endpoints
3. **Phase 3**: Add MCP server with API key auth
4. **Phase 4**: Add settings UI for key management
5. **Phase 5**: Documentation and client setup guides

## MCP Tools (Future)

Initial MCP tools to expose:

1. `list_tasks` - List tasks in workspace
2. `get_task` - Get task details
3. `update_task_status` - Update task status
4. `list_recommendations` - List janitor recommendations
5. `get_codebase_info` - Get repository and codebase information

## Environment Variables

No new environment variables required. API keys are stored in the database and validated at runtime.

## Testing

### Unit Tests
- Key generation produces valid format
- Key hashing is deterministic
- Validation rejects revoked keys
- Validation rejects expired keys

### Integration Tests
- Create key returns full key once
- List keys does not expose full keys
- Revoke key immediately invalidates it
- MCP endpoint authenticates with valid key
- MCP endpoint rejects invalid/revoked keys

### E2E Tests
- Full flow: create key, use in MCP client, revoke key
