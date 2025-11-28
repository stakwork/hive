# Pool Manager Mock Endpoints

This directory contains mock implementations of the Pool Manager API for local development and E2E testing without requiring access to the real Pool Manager service.

## Overview

The mock endpoints provide instant, predictable responses that match the real Pool Manager API format. All pool state is maintained in-memory via a singleton state manager, enabling full pool lifecycle operations.

## Usage

The application automatically uses mock endpoints when the `POOL_MANAGER_API_KEY` environment variable is **not set**. No additional configuration is required.

### Development Setup

```bash
# Do NOT set POOL_MANAGER_API_KEY in .env.local
# The service will automatically use mock endpoints

# Start development server
npm run dev
```

### Testing

```bash
# Run integration tests
npm run test:integration -- pool-manager-mock.test.ts
```

## Available Endpoints

All endpoints are accessible at `/api/mock/pool-manager/*` and require no authentication.

### 1. Create Pool

**Endpoint:** `POST /api/mock/pool-manager/pools`

Creates a new pool in the mock system.

**Request Body:**
```json
{
  "pool_name": "my-pool",
  "minimum_vms": 2,
  "repo_name": "owner/repo",
  "branch_name": "main",
  "github_pat": "ghp_token",
  "github_username": "username",
  "env_vars": [
    { "name": "NODE_ENV", "value": "development" },
    { "name": "API_KEY", "value": "secret" }
  ],
  "container_files": {
    "devcontainer": "base64_content",
    "dockerfile": "base64_content"
  }
}
```

**Response:** `201 Created`
```json
{
  "id": "pool-1234567890-abc123",
  "name": "my-pool",
  "description": "Mock pool for owner/repo",
  "owner_id": "mock-owner-id",
  "created_at": "2025-11-28T10:00:00.000Z",
  "updated_at": "2025-11-28T10:00:00.000Z",
  "status": "active"
}
```

**Error Responses:**
- `400` - Missing required fields
- `409` - Pool with same name already exists

### 2. Get Pool Status

**Endpoint:** `GET /api/mock/pool-manager/pools/{name}`

Retrieves pool status and configuration.

**Response:** `200 OK`
```json
{
  "id": "pool-1234567890-abc123",
  "name": "my-pool",
  "description": "Mock pool for owner/repo",
  "owner_id": "mock-owner-id",
  "created_at": "2025-11-28T10:00:00.000Z",
  "updated_at": "2025-11-28T10:00:00.000Z",
  "status": {
    "running_vms": 2,
    "pending_vms": 0,
    "failed_vms": 0,
    "used_vms": 0,
    "unused_vms": 2,
    "last_check": "2025-11-28T10:00:00.000Z"
  },
  "config": {
    "env_vars": [
      { "name": "NODE_ENV", "value": "development", "masked": false },
      { "name": "API_KEY", "value": "***MASKED***", "masked": true }
    ]
  }
}
```

**Error Responses:**
- `404` - Pool not found

### 3. Update Pool

**Endpoint:** `PUT /api/mock/pool-manager/pools/{name}`

Updates pool environment variables and configuration.

**Request Body:**
```json
{
  "env_vars": [
    { "name": "NEW_VAR", "value": "new_value" }
  ],
  "poolCpu": "4",
  "poolMemory": "8Gi",
  "github_pat": "new_token",
  "github_username": "newuser"
}
```

**Response:** `200 OK`
```json
{
  "success": true
}
```

**Error Responses:**
- `404` - Pool not found

### 4. Delete Pool

**Endpoint:** `DELETE /api/mock/pool-manager/pools/{name}`

Deletes a pool from the mock system.

**Response:** `200 OK`
```json
{
  "id": "pool-1234567890-abc123",
  "name": "my-pool",
  "description": "Mock pool for owner/repo",
  "owner_id": "mock-owner-id",
  "created_at": "2025-11-28T10:00:00.000Z",
  "updated_at": "2025-11-28T10:00:00.000Z",
  "status": "deleted"
}
```

**Error Responses:**
- `404` - Pool not found

## Mock Behavior

### State Management
- All pools are stored in-memory via a singleton state manager
- State persists across API calls within the same process
- State is cleared when the development server restarts
- Test suite clears state between test runs

### Instant Responses
- All operations return immediately (no delays)
- Pool creation always succeeds (if validation passes)
- VMs are instantly "running" at `minimum_vms` count
- Status queries always return healthy pools

### Security & Masking
Sensitive values are automatically masked in responses:
- GitHub PAT: Always replaced with `***MASKED***`
- Environment variables matching patterns: `password`, `secret`, `token`, `key`, `pat`, `api_key`, `auth`
- Masked values are marked with `"masked": true` in the response

### Validation
- All required fields must be present
- Pool names must be unique
- Invalid operations (e.g., deleting non-existent pool) return appropriate errors

## Implementation Details

### File Structure
```
src/app/api/mock/pool-manager/
├── state.ts                    # In-memory state manager singleton
├── pools/
│   ├── route.ts                # POST /pools (create)
│   └── [name]/
│       └── route.ts            # GET, PUT, DELETE /pools/{name}
└── README.md                   # This file
```

### Service Integration
The `PoolManagerService` automatically uses mock endpoints when `POOL_MANAGER_API_KEY` is not configured:

```typescript
// src/config/services.ts
poolManager: {
  baseURL:
    process.env.POOL_MANAGER_API_KEY
      ? process.env.POOL_MANAGER_BASE_URL || "https://workspaces.sphinx.chat/api"
      : process.env.NEXT_PUBLIC_API_BASE_URL
        ? `${process.env.NEXT_PUBLIC_API_BASE_URL}/api/mock/pool-manager`
        : "http://localhost:3000/api/mock/pool-manager",
  apiKey: process.env.POOL_MANAGER_API_KEY || "",
  // ...
}
```

## Testing

Integration tests are located at:
- `src/__tests__/integration/api/pool-manager-mock.test.ts`

Test coverage includes:
- ✅ Pool creation with validation
- ✅ Duplicate pool rejection
- ✅ Pool status retrieval
- ✅ Pool updates (env vars, CPU, memory, credentials)
- ✅ Pool deletion
- ✅ Sensitive data masking
- ✅ State management across operations
- ✅ Error handling (404, 400, 409)

Run tests:
```bash
npm run test:integration -- pool-manager-mock.test.ts
```

## Differences from Real API

### Simplified Behavior
- No actual VM provisioning
- No network delays or timeouts
- No rate limiting or authentication
- No persistent storage (in-memory only)
- Instant "healthy" status for all pools

### Consistent with Real API
- ✅ Request/response formats match exactly
- ✅ Status codes match real API
- ✅ Error messages follow same patterns
- ✅ Field names and types are identical
- ✅ Sensitive data masking behavior

## Troubleshooting

### Mock not being used
**Problem:** Application still tries to connect to real Pool Manager

**Solution:** Ensure `POOL_MANAGER_API_KEY` is **not set** in your `.env.local` file

### State not persisting
**Problem:** Pools disappear between API calls

**Solution:** This is expected behavior - state is in-memory only and clears on server restart

### Tests failing
**Problem:** Integration tests fail

**Solution:** 
1. Ensure test database is running: `npm run test:db:start`
2. Clear state between tests (automatic in test suite)
3. Check for timing issues (rare with async operations)

## Future Enhancements

Potential improvements (not currently implemented):
- Persistent state via file system or SQLite
- Configurable delays to simulate network latency
- VM state transitions (pending → running → failed)
- Pool capacity limits
- Webhook simulation for pool events
- Mock workspace allocation and claiming
