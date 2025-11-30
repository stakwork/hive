# Pool Manager Mock

This document describes the Pool Manager mock implementation for local development and testing.

## Overview

The Pool Manager mock simulates a VM/container pool management service, allowing developers to test the full pod claiming workflow without requiring real infrastructure.

## Configuration

### Enable Mock Mode

Set in your `.env.local`:
```bash
USE_MOCKS="true"
```

### How It Works

When `USE_MOCKS=true`:
- All Pool Manager API calls are routed to `/api/mock/pool-manager/*`
- An in-memory state manager tracks pools and pods
- Pods are auto-created on demand
- Database operations still work normally (only external API calls are mocked)

## Mock State

The mock maintains:
- **Pools**: Collection of pod workspaces
- **Pods**: Virtual workspaces with URLs and state
- **Auto-creation**: Pools and pods are created automatically when requested

### Default State

On startup, the mock creates:
- A default pool named `"default-pool"`
- 5 available pods in the default pool

When a workspace uses a custom pool name, the mock:
- Auto-creates the pool with 3 available pods
- Creates additional pods on-demand when all are claimed

## Endpoints

### Claim a Pod
```
GET /api/mock/pool-manager/pools/[poolName]/workspace?workspaceId=<id>
```

Returns an available pod from the pool. If all pods are claimed, a new pod is created automatically.

**Response:**
```json
{
  "success": true,
  "workspace": {
    "id": "pod-pool-123-1",
    "poolName": "default-pool",
    "url": "https://mock-pod-1.mock.sphinx.chat",
    "password": "mock-password",
    "usage_status": "used",
    "claimedBy": "workspace-123",
    "portMappings": {
      "15551": "https://mock-pod-1.mock.sphinx.chat:15551",
      "15552": "https://mock-pod-1.mock.sphinx.chat:15552",
      "3000": "https://mock-pod-1.mock.sphinx.chat:3000"
    }
  }
}
```

### Get Pool Status
```
GET /api/mock/pool-manager/pools/[poolName]/status
```

Returns pool statistics and pod list.

**Response:**
```json
{
  "success": true,
  "pool": {
    "name": "default-pool",
    "id": "pool-123",
    "total_workspaces": 5,
    "available_workspaces": 3,
    "used_workspaces": 2
  },
  "workspaces": [
    {
      "id": "pod-pool-123-1",
      "status": "used",
      "claimed_by": "workspace-123",
      "claimed_at": "2024-01-15T10:30:00Z",
      "url": "https://mock-pod-1.mock.sphinx.chat"
    }
  ]
}
```

### List Pool Workspaces
```
GET /api/mock/pool-manager/pools/[poolName]/workspaces
```

Returns all workspaces/pods in a pool.

### Get Single Workspace
```
GET /api/mock/pool-manager/workspaces/[podId]
```

Returns details for a specific pod.

### Update Pod
```
POST /api/mock/pool-manager/workspaces/[podId]/update
```

Updates pod repositories (simulates git sync).

**Request:**
```json
{
  "repositories": ["owner/repo1", "owner/repo2"]
}
```

### Mark Pod as Used
```
POST /api/mock/pool-manager/workspaces/[podId]/mark-used
```

Marks a pod as in-use (idempotent operation).

### Create Pool
```
POST /api/mock/pool-manager/pools
```

Creates a new pool with default pods.

**Request:**
```json
{
  "name": "my-pool",
  "apiKey": "optional-key"
}
```

## Testing

### Happy Path: Claim a Pod

1. Set `USE_MOCKS=true` in `.env.local`
2. Start the development server: `npm run dev`
3. Navigate to a workspace
4. Configure services in the Services Modal
5. Click "Launch Pods" button
6. Mock pod is instantly claimed
7. Frontend, IDE, and Goose URLs are returned

### State Management

The mock maintains state across requests during the same server session. State is reset on server restart.

**Manual Reset:** Restart the development server to clear mock state.

## Differences from Real Service

| Feature | Real Service | Mock |
|---------|-------------|------|
| Pod creation | Pre-provisioned VMs | Instant in-memory creation |
| Repository sync | Real git operations | Simulated (instant) |
| Startup time | 30-60 seconds | Instant |
| State persistence | Database-backed | In-memory (resets on restart) |
| URL resolution | Real domain mapping | Mock URLs (*.mock.sphinx.chat) |
| Resource limits | Physical VM constraints | Unlimited pods created on-demand |
| Network access | Real SSH/HTTP | Mock URLs (not accessible) |

## Troubleshooting

### Pods Not Claimed

Check that:
1. `USE_MOCKS=true` is set in `.env.local`
2. Workspace has a swarm with `poolApiKey` (any value works in mock mode)
3. Mock endpoints are accessible (should see 🎭 emoji in console logs)
4. No middleware blocking `/api/mock/pool-manager/*` routes

### State Inconsistencies

**Solution:** Restart the development server to reset mock state.

```bash
# Stop server (Ctrl+C)
npm run dev  # Restart
```

### Mock URLs Not Working

The mock returns URLs like `https://mock-pod-1.mock.sphinx.chat`. These URLs are **not real** - they're for display purposes only. The mock simulates the API responses but doesn't create actual accessible services.

### Database Still Empty

The mock only mocks external Pool Manager API calls. Database operations (saving swarm configuration, workspace data) still work normally. Check:

1. Database is running: `npx prisma studio`
2. Swarm record exists for workspace: Check `Swarm` table
3. `poolState` is set to `COMPLETE` after pool creation

## Development Workflow

### Typical Development Flow

1. **Enable mocks:**
   ```bash
   # .env.local
   USE_MOCKS="true"
   ```

2. **Start server:**
   ```bash
   npm run dev
   ```

3. **Create workspace:**
   - Use mock auth or real GitHub OAuth
   - Configure services via Services Modal
   - Set pool name (auto-created by mock)

4. **Launch pods:**
   - Click "Launch Pods"
   - Pool creation succeeds instantly
   - `poolState` changes to `COMPLETE`

5. **Claim pod:**
   - Navigate to task or capacity page
   - Click "Claim Pod" or similar action
   - Pod claimed instantly with mock URL

6. **Test features:**
   - Test UI interactions
   - Verify database updates
   - Check state management

7. **Reset if needed:**
   - Restart server for clean state
   - Or manually query database to check records

### Testing Without External Services

With `USE_MOCKS=true`, you can test:
- ✅ Pool creation workflow
- ✅ Pod claiming/releasing
- ✅ Pool status updates
- ✅ Repository configuration
- ✅ Database persistence
- ✅ UI state management
- ✅ Error handling

Without needing:
- ❌ Real Pool Manager API credentials
- ❌ Actual VM infrastructure
- ❌ Network access to external services
- ❌ Stakwork account setup

## Integration Tests

The mock is designed to work with integration tests:

```typescript
// Example test
import { poolManagerState } from "@/app/api/mock/pool-manager/state";

describe("Pool Manager Mock", () => {
  beforeEach(() => {
    // Reset state before each test
    poolManagerState.reset();
  });

  test("should claim and release pod", () => {
    const pool = poolManagerState.getOrCreatePool("test-pool", "test-key");
    const pod = poolManagerState.claimPod("test-pool", "workspace-123");
    
    expect(pod.usage_status).toBe("used");
    expect(pod.claimedBy).toBe("workspace-123");
    
    const released = poolManagerState.releasePod(pod.id);
    expect(released.usage_status).toBe("free");
  });
});
```

## Console Logging

The mock uses distinctive emoji prefixes for easy log filtering:

- 🎭 `[Mock Pool Manager]` - All mock operations
- ✅ `[Mock Pool Manager]` - Successful operations
- ❌ `[Mock Pool Manager]` - Error conditions

**Filter in console:** Search for "Mock Pool Manager" to see only mock-related logs.

## Future Enhancements

Potential improvements for the mock:

1. **Persistent state:** Save mock state to database for cross-restart persistence
2. **Simulated delays:** Add configurable delays to simulate real provisioning time
3. **Failure simulation:** Add error injection for testing error handling
4. **WebSocket support:** Mock real-time pod status updates
5. **Resource constraints:** Simulate pool capacity limits
6. **Goose service mock:** Mock the Goose agent service responses
7. **State export/import:** Save and restore mock state for test scenarios