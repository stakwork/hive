# Mock System Documentation

## Overview

The Hive platform uses a centralized mock system to enable end-to-end manual testing without requiring real external services.

## Configuration

### Environment Variables

```env
# Enable all mocks
USE_MOCKS=true
```

When `USE_MOCKS=true`:
- All external service calls route to internal mock endpoints
- Mock responses follow exact same format as real services
- State is maintained in-memory for the session
- Database writes proceed normally

### Services Mocked

1. **Pool Manager** - Pod/workspace management
   - Authentication (`/auth/login`)
   - Pool CRUD (`/pools`)
   - Workspace claiming (`/pools/[name]/workspace`)
   - Usage tracking (`mark-used`, `mark-unused`)

2. **Stakwork** (via existing `/api/mock/chat`)
   - AI chat responses
   - Workflow execution
   - Status updates

3. **Jarvis** (via existing `/api/mock/jarvis`)
   - Graph statistics
   - Node data

## Architecture

### URL Resolution

Services never check `USE_MOCKS` directly. Instead:

```typescript
import { getServiceUrl } from "@/lib/env";

// Automatically routes to mock or real URL based on USE_MOCKS
const url = getServiceUrl("POOL_MANAGER");
```

### State Management

Mock state is managed by singleton classes:
- `PoolManagerMockState` - Pools, workspaces, users
- Auto-creates resources on demand
- Provides `reset()` for test isolation

### Auto-Creation

Mocks auto-create missing resources:
```typescript
// If pool doesn't exist, creates it automatically
const workspace = poolManagerState.claimWorkspace("my-pool");
```

## Usage

### Development

```bash
# Start with mocks enabled
USE_MOCKS=true npm run dev
```

### Manual Testing

1. Set `USE_MOCKS=true` in `.env.local`
2. Start application: `npm run dev`
3. Test user journeys end-to-end
4. All external API calls use mocks
5. Database state persists normally

### Testing Specific Service

```typescript
// In test file
process.env.USE_MOCKS = "true";

// All service calls now use mocks
await claimPodAndGetFrontend(poolName, poolApiKey);
```

## Mock Endpoints

### Pool Manager

**Base URL:** `/api/mock/pool-manager`

#### Authentication
```
POST /api/mock/pool-manager/auth/login
Body: { username, password }
Response: { success: true, token: "mock-token-..." }
```

#### Create Pool
```
POST /api/mock/pool-manager/pools
Headers: Authorization: Bearer <token>
Body: { pool_name, minimum_vms, repo_name, branch_name, ... }
Response: { success: true, pool: {...} }
```

#### Delete Pool
```
DELETE /api/mock/pool-manager/pools/[poolName]
Headers: Authorization: Bearer <token>
Response: { success: true, message: "..." }
```

#### Update Pool
```
PUT /api/mock/pool-manager/pools/[poolName]
Headers: Authorization: Bearer <token>
Body: { env_vars: [...] }
Response: { success: true, pool: {...} }
```

#### Claim Workspace
```
GET /api/mock/pool-manager/pools/[poolName]/workspace
Headers: Authorization: Bearer <token>
Response: { success: true, workspace: {...} }
```

#### Get Workspace
```
GET /api/mock/pool-manager/workspaces/[workspaceId]
Headers: Authorization: Bearer <token>
Response: { success: true, workspace: {...} }
```

#### Mark Used/Unused
```
POST /api/mock/pool-manager/pools/[poolName]/workspaces/[id]/mark-used
POST /api/mock/pool-manager/pools/[poolName]/workspaces/[id]/mark-unused
Headers: Authorization: Bearer <token>
Response: { success: true, message: "..." }
```

## Extending

### Adding New Service Mock

1. **Add to URL resolver** in `src/lib/env.ts`:
```typescript
export function getServiceUrl(serviceName: "POOL_MANAGER" | "STAKWORK" | "NEW_SERVICE")
```

2. **Create state manager** in `src/app/api/mock/new-service/state.ts`

3. **Create endpoints** in `src/app/api/mock/new-service/`

4. **Update service layer** to use `getServiceUrl()`

5. **Update this documentation**

## Best Practices

1. **Never check `USE_MOCKS` in application code** - use `getServiceUrl()` abstraction
2. **Match response formats exactly** - check types/interfaces
3. **Auto-create resources** - don't require pre-seeding
4. **Keep mocks simple** - just return appropriate responses
5. **Allow database writes** - only mock external APIs

## Testing Strategy

### Manual Testing Checklist

- [ ] Set `USE_MOCKS=true`
- [ ] Create workspace
- [ ] Claim pod - verify returns mock workspace data
- [ ] Check task.agentUrl persists in database
- [ ] Refresh page - verify URL still present
- [ ] Drop pod - verify marks as unused
- [ ] Claim again - gets same or different pod

### Integration Tests

```typescript
// src/__tests__/integration/api/mock-pool-manager.test.ts
describe("Mock Pool Manager", () => {
  beforeEach(() => {
    process.env.USE_MOCKS = "true";
    poolManagerState.reset();
  });

  test("should authenticate and return token", async () => {
    const response = await fetch("/api/mock/pool-manager/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "admin", password: "mock-password" }),
    });

    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.token).toMatch(/^mock-token-/);
  });

  test("should claim workspace from pool", async () => {
    const authResponse = await fetch("/api/mock/pool-manager/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "admin", password: "mock-password" }),
    });
    const { token } = await authResponse.json();

    const response = await fetch("/api/mock/pool-manager/pools/test-pool/workspace", {
      headers: { Authorization: `Bearer ${token}` },
    });

    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.workspace).toBeDefined();
    expect(data.workspace.usage_status).toBe("in-use");
  });
});
```

## Troubleshooting

### Mock not being used

1. Verify `USE_MOCKS=true` in `.env.local`
2. Restart dev server after env changes
3. Check service is using `getServiceUrl()` helper
4. Verify no hardcoded URLs in service code

### Workspace not persisting

1. Mocks only store transient state - database writes persist
2. Check database connection
3. Verify `task.agentUrl` field is being saved
4. Check for database errors in logs

### Pool not found error

1. Mocks auto-create pools on first claim
2. Ensure pool name is consistent across calls
3. Check authentication token is valid
4. Verify pool wasn't deleted

## Migration Notes

### From Real Services

When switching from real services to mocks:

1. Set `USE_MOCKS=true`
2. Restart application
3. Clear any cached service instances
4. Test all user journeys

### Back to Real Services

When switching back to real services:

1. Set `USE_MOCKS=false`
2. Restart application
3. Ensure real service credentials are configured
4. Test connectivity to real services

## Future Enhancements

- Mock management UI (view/reset state)
- Mock request logging
- Mock latency simulation
- Configurable mock responses
- Mock persistence across restarts