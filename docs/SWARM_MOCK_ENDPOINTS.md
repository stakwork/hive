# Swarm Super Admin Mock Endpoints

This document describes the mock implementation of the Swarm Super Admin Service, which enables local development and testing without requiring real AWS credentials or external service access.

## Overview

The Swarm Super Admin Service manages containerized development environments (swarms) on EC2 instances. The mock implementation provides:

- ✅ In-memory state management
- ✅ Realistic status transitions (PENDING → RUNNING after 2 seconds)
- ✅ Domain availability tracking
- ✅ Authentication validation
- ✅ Auto-creation of resources for test resilience
- ✅ Test isolation via state reset

## Enabling Mock Mode

Set the `USE_MOCKS` environment variable to enable all mock endpoints:

```bash
# .env.local
USE_MOCKS=true
SWARM_SUPERADMIN_API_KEY=your-test-token
```

When `USE_MOCKS=true`, the swarm service URL automatically resolves to:
```
http://localhost:3000/api/mock/swarm-super-admin
```

## Mock Endpoints

### 1. Create Swarm

Creates a new swarm instance with auto-generated credentials.

**Endpoint**: `POST /api/mock/swarm-super-admin/api/super/new_swarm`

**Headers**:
```json
{
  "x-super-token": "your-test-token",
  "Content-Type": "application/json"
}
```

**Request Body**:
```json
{
  "instance_type": "t3.small",
  "password": "optional-password"
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Swarm created successfully",
  "data": {
    "swarm_id": "mock-swarm-000001",
    "address": "mock-swarm-000001.test.local",
    "x_api_key": "mock-api-key-abc12345",
    "ec2_id": "i-mock0000000001"
  }
}
```

**Error Responses**:
- `401 Unauthorized` - Invalid or missing `x-super-token`
- `400 Bad Request` - Missing required field `instance_type`
- `500 Internal Server Error` - Unexpected error

### 2. Stop Swarm

Stops a running swarm instance by EC2 ID.

**Endpoint**: `POST /api/mock/swarm-super-admin/api/super/stop_swarm`

**Headers**:
```json
{
  "x-super-token": "your-test-token",
  "Content-Type": "application/json"
}
```

**Request Body**:
```json
{
  "instance_id": "i-mock0000000001"
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Swarm stopped successfully"
}
```

**Error Responses**:
- `401 Unauthorized` - Invalid or missing `x-super-token`
- `400 Bad Request` - Missing required field `instance_id`
- `200 OK` with `success: false` - Swarm not found
- `500 Internal Server Error` - Unexpected error

### 3. Check Domain Availability

Validates whether a domain name is available for a new swarm.

**Endpoint**: `GET /api/mock/swarm-super-admin/api/super/check-domain?domain=myswarm`

**Headers**:
```json
{
  "x-super-token": "your-test-token"
}
```

**Query Parameters**:
- `domain` (required) - Domain name to check

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Domain check completed",
  "data": {
    "domain_exists": false,
    "swarm_name_exist": false
  }
}
```

**Error Responses**:
- `401 Unauthorized` - Invalid or missing `x-super-token`
- `400 Bad Request` - Missing required parameter `domain`
- `500 Internal Server Error` - Unexpected error

### 4. Get Swarm Details

Fetches the current status and details of a swarm.

**Endpoint**: `GET /api/mock/swarm-super-admin/api/super/details?id=mock-swarm-000001`

**Headers**:
```json
{
  "x-super-token": "your-test-token"
}
```

**Query Parameters**:
- `id` (required) - Swarm ID

**Response - PENDING Status** (400 Bad Request):
```json
{
  "ok": false,
  "data": {
    "message": "Swarm is still starting up"
  },
  "status": 400
}
```

**Response - RUNNING Status** (200 OK):
```json
{
  "ok": true,
  "data": {
    "swarm_id": "mock-swarm-000001",
    "address": "mock-swarm-000001.test.local",
    "x_api_key": "mock-api-key-abc12345",
    "ec2_id": "i-mock0000000001",
    "instance_type": "t3.small",
    "status": "RUNNING",
    "createdAt": "2025-01-15T10:30:00Z",
    "updatedAt": "2025-01-15T10:30:02Z"
  },
  "status": 200
}
```

**Error Responses**:
- `401 Unauthorized` - Invalid or missing `x-super-token`
- `400 Bad Request` - Missing required parameter `id` OR swarm still starting
- `500 Internal Server Error` - Unexpected error

**Note**: The 400 status for PENDING swarms is intentional - it triggers the retry logic in `fetchSwarmDetails()`.

## State Manager API

The `MockSwarmStateManager` class provides direct access to mock state for testing.

```typescript
import { mockSwarmState } from '@/lib/mock/swarm-state';

// Create a swarm
const swarm = mockSwarmState.createSwarm({
  instance_type: 't3.small',
  password: 'optional-password'
});

// Get swarm details (auto-creates if not found)
const details = mockSwarmState.getSwarmDetails(swarmId);

// Stop a swarm
const result = mockSwarmState.stopSwarm(ec2Id);

// Check domain availability
const availability = mockSwarmState.checkDomain('myswarm');

// Get all swarms (for debugging)
const allSwarms = mockSwarmState.getAllSwarms();

// Reset state (for test isolation)
mockSwarmState.reset();
```

## Status Lifecycle

Swarms follow this status lifecycle:

```
PENDING → RUNNING → STOPPED
   ↓
 FAILED (not implemented in mock)
```

- **PENDING**: Initial state when swarm is created
- **RUNNING**: Automatic transition after 2 seconds
- **STOPPED**: Manual stop via `stop_swarm` endpoint
- **FAILED**: Reserved for error conditions (not currently used)

## Test Isolation

Always reset state between tests to prevent interference:

```typescript
import { describe, it, beforeEach, afterEach } from 'vitest';
import { mockSwarmState } from '@/lib/mock/swarm-state';

describe('My swarm tests', () => {
  beforeEach(() => {
    mockSwarmState.reset();
  });

  afterEach(() => {
    mockSwarmState.reset();
  });

  it('should create a swarm', () => {
    // Test code here
  });
});
```

## Auto-Creation Behavior

The mock follows the "auto-create on access" pattern used by other mock services:

- `getSwarmDetails(id)` - Auto-creates swarm if not found
- This prevents test failures due to missing setup
- Useful for testing error recovery paths

## ID Generation

IDs are deterministic and increment sequentially:

- Swarm IDs: `mock-swarm-000001`, `mock-swarm-000002`, etc.
- EC2 IDs: `i-mock0000000001`, `i-mock0000000002`, etc.
- API Keys: `mock-api-key-{random8chars}`
- Addresses: `{swarm_id}.test.local`

## Retry Logic Support

The `/details` endpoint intentionally returns 400 for PENDING swarms to support the existing retry logic in `fetchSwarmDetails()`:

```typescript
// In src/services/swarm/api/swarm.ts
const pollSwarmDetails = async (swarmId: string) => {
  // Retries until swarm is RUNNING (non-400 response)
  // Mock returns 400 for PENDING, 200 for RUNNING
};
```

## Migration Path

The mock system supports gradual migration from fake mode:

**Current (Fake Mode)**:
- `NODE_ENV=development` → `isSwarmFakeModeEnabled()` → In-memory fake data
- No API calls, instant response

**New (Mock Mode)**:
- `USE_MOCKS=true` → Routes to `/api/mock/*` endpoints
- Simulates real API behavior with status transitions
- Validates authentication and request structure

Both modes can coexist during migration.

## Environment Variables

Required environment variables for mock mode:

```bash
# Enable mock mode
USE_MOCKS=true

# Mock authentication token (any value works in mock mode)
SWARM_SUPERADMIN_API_KEY=test-super-token

# Optional: Base URL (auto-resolved when USE_MOCKS=true)
# SWARM_SUPER_ADMIN_URL=http://localhost:3000/api/mock/swarm-super-admin
```

## Testing Examples

### Unit Test Example

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { mockSwarmState } from '@/lib/mock/swarm-state';

describe('Swarm creation', () => {
  beforeEach(() => {
    mockSwarmState.reset();
  });

  it('should create a swarm with unique ID', () => {
    const swarm = mockSwarmState.createSwarm({
      instance_type: 't3.small'
    });

    expect(swarm.swarm_id).toContain('mock-swarm-');
    expect(swarm.ec2_id).toContain('i-mock');
  });

  it('should transition to RUNNING after 2 seconds', async () => {
    const swarm = mockSwarmState.createSwarm({
      instance_type: 't3.small'
    });

    expect(mockSwarmState.getSwarmDetails(swarm.swarm_id).status).toBe('PENDING');

    await new Promise(resolve => setTimeout(resolve, 2100));

    expect(mockSwarmState.getSwarmDetails(swarm.swarm_id).status).toBe('RUNNING');
  });
});
```

### Integration Test Example

```typescript
import { describe, it, expect, beforeEach } from 'vitest';

describe('POST /api/swarm', () => {
  beforeEach(() => {
    process.env.USE_MOCKS = 'true';
  });

  it('should create swarm via API', async () => {
    const response = await fetch('/api/swarm', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-token'
      },
      body: JSON.stringify({
        instance_type: 't3.small',
        workspaceId: 'test-workspace'
      })
    });

    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.swarm.swarm_id).toContain('mock-swarm-');
  });
});
```

## Troubleshooting

### "Unauthorized" errors
- Check that `SWARM_SUPERADMIN_API_KEY` is set
- Verify `x-super-token` header matches environment variable
- Ensure `USE_MOCKS=true` is set

### Swarm stays PENDING forever
- Check that status transition timer is running (2 second delay)
- Verify `getSwarmDetails()` is being called after creation
- Ensure test isn't calling `reset()` too early

### Tests interfering with each other
- Always call `mockSwarmState.reset()` in `beforeEach()` and `afterEach()`
- Check for leaked timers from status transitions
- Verify test isolation setup

### Mock endpoints not being called
- Verify `USE_MOCKS=true` in environment
- Check that `src/config/env.ts` is resolving URL correctly
- Inspect `src/config/services.ts` swarm configuration

## Related Files

- `src/lib/mock/swarm-state.ts` - State manager implementation
- `src/app/api/mock/swarm-super-admin/api/super/*/route.ts` - Mock endpoints
- `src/__tests__/unit/api/mock/swarm-super-admin.test.ts` - Unit tests
- `src/config/env.ts` - Environment configuration
- `src/config/services.ts` - Service configuration
- `src/services/swarm/api/swarm.ts` - Swarm API client
- `src/types/swarm.ts` - Type definitions

## Future Enhancements

Potential improvements to the mock system:

- [ ] Add support for FAILED status transitions
- [ ] Implement resource limits (max swarms per test)
- [ ] Add configurable transition delays
- [ ] Implement swarm update operations
- [ ] Add webhook simulation for swarm events
- [ ] Support custom domain patterns
- [ ] Add performance metrics tracking
- [ ] Implement swarm configuration options