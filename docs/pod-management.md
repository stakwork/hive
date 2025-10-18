# Pod Management API

This document describes the pod claiming and dropping functionality for managing virtual machine workspaces from a pool.

## Overview

The pod management system allows workspaces to claim virtual machines (pods) from a pool manager service, use them for development work, and then return them to the pool when done. This enables efficient resource utilization and dynamic workspace provisioning.

## Architecture

### Core Components

- **Pool Manager**: External service that manages a pool of pre-provisioned virtual machines
- **Pod Workspace**: A virtual machine instance with development environment, accessible via various ports
- **Workspace**: Hive workspace that can claim and use pods
- **Repositories**: Git repositories that can be synchronized to pods

### Key Files

- `/src/app/api/pool-manager/claim-pod/[workspaceId]/route.ts` - Claim pod endpoint
- `/src/app/api/pool-manager/drop-pod/[workspaceId]/route.ts` - Drop pod endpoint
- `/src/lib/pods.ts` - Core pod management utilities
- `/src/components/UserJourneys.tsx` - Example frontend implementation

## Claiming a Pod

### Endpoint

```
POST /api/pool-manager/claim-pod/[workspaceId]?latest=true
```

### Query Parameters

- `latest` (optional): If `true`, updates the pod repositories to match the workspace's configured repositories

### Process Flow

1. **Authentication & Authorization**: Verify user has access to the workspace
2. **Pool Configuration**: Check workspace has valid pool configuration (poolName, poolApiKey)
3. **Get Workspace**: Request an available pod from the pool
4. **Mark as Used**: Mark the pod as in-use in the pool manager
5. **Discover Frontend**: Query the pod's process list to find the frontend application port
6. **Update Repositories** (if `?latest=true`): Sync workspace repositories to the pod
7. **Return URLs**: Return frontend, control, IDE, and goose URLs

### Response

```json
{
  "success": true,
  "message": "Pod claimed successfully",
  "frontend": "https://frontend-url.example.com",
  "control": "https://control-url.example.com",
  "ide": "https://ide-url.example.com",
  "goose": "https://goose-url.example.com"
}
```

### URL Mappings

- **frontend**: User-facing application (discovered via process list)
- **control** (port 15552): Control API for pod management
- **ide**: Main IDE/workspace URL
- **goose** (port 15551): Goose AI service

## Dropping a Pod

### Endpoint

```
POST /api/pool-manager/drop-pod/[workspaceId]?latest=true
```

### Query Parameters

- `latest` (optional): If `true`, resets the pod repositories to the workspace's configured state before dropping

### Process Flow

1. **Authentication & Authorization**: Verify user has access to the workspace
2. **Pool Configuration**: Check workspace has valid pool configuration
3. **Get Workspace Info**: Retrieve current pod workspace details
4. **Reset Repositories** (if `?latest=true`): Update pod repositories back to workspace defaults
5. **Mark as Unused**: Return the pod to the pool as available

### Response

```json
{
  "success": true,
  "message": "Pod dropped successfully"
}
```

## Frontend Integration

### Basic Usage

```typescript
// Claim a pod
const response = await fetch(`/api/pool-manager/claim-pod/${workspaceId}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' }
});

const { frontend, control, ide, goose } = await response.json();

// Use the pod...
// Display frontend in iframe, access IDE, etc.

// Drop the pod when done
await fetch(`/api/pool-manager/drop-pod/${workspaceId}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' }
});
```

### Automatic Cleanup

Implement cleanup to ensure pods are always returned to the pool:

```typescript
// Drop on component unmount
useEffect(() => {
  return () => {
    if (hasPod) {
      dropPod();
    }
  };
}, [hasPod, dropPod]);

// Drop on browser close/refresh using sendBeacon
useEffect(() => {
  if (!hasPod) return;

  const handleBeforeUnload = () => {
    const blob = new Blob([JSON.stringify({})], { type: 'application/json' });
    navigator.sendBeacon(`/api/pool-manager/drop-pod/${workspaceId}`, blob);
  };

  window.addEventListener('beforeunload', handleBeforeUnload);
  return () => window.removeEventListener('beforeunload', handleBeforeUnload);
}, [hasPod, workspaceId]);
```

## Repository Management

### With `?latest=true`

When claiming or dropping a pod with the `latest` parameter:

**On Claim**: Syncs workspace repositories TO the pod
```typescript
// Workspace has repos: ["https://github.com/org/repo1", "https://github.com/org/repo2"]
// Pod will be updated to have these repositories
await fetch(`/api/pool-manager/claim-pod/${workspaceId}?latest=true`, {
  method: 'POST'
});
```

**On Drop**: Resets pod repositories back to workspace defaults
```typescript
// Ensures pod has the correct repos before being returned to pool
await fetch(`/api/pool-manager/drop-pod/${workspaceId}?latest=true`, {
  method: 'POST'
});
```

### Repository Update Implementation

Repositories are updated via the control port (15552):

```typescript
PUT /latest
Authorization: Bearer {pod-password}
Content-Type: application/json

{
  "repos": [
    { "url": "https://github.com/org/repo1" },
    { "url": "https://github.com/org/repo2" }
  ]
}
```

## Error Handling

### Common Errors

- **401 Unauthorized**: User not authenticated
- **403 Forbidden**: User doesn't have access to workspace
- **404 Not Found**: Workspace or swarm not found
- **400 Bad Request**: Missing pool configuration (poolName, poolApiKey)
- **500 Internal Server Error**: Pool Manager API errors, network failures, or pod discovery failures

### Error Response Format

```json
{
  "error": "Error message",
  "service": "pool-manager",
  "details": "Additional error details"
}
```

## Pool Manager API Integration

### Environment Configuration

```bash
POOL_MANAGER_BASE_URL=https://pool-manager.example.com
```

### Pool Configuration Storage

Pool configuration is stored encrypted in the `Swarm` model:

```typescript
{
  poolName: string;        // Pool identifier
  poolApiKey: string;      // Encrypted API key for pool access
  poolState: string;       // Pool provisioning state
}
```

### External API Calls

The system makes the following calls to the Pool Manager:

1. **Get Workspace**: `GET /pools/{poolName}/workspace`
2. **Mark Used**: `POST /pools/{poolName}/workspaces/{workspaceId}/mark-used`
3. **Mark Unused**: `POST /pools/{poolName}/workspaces/{workspaceId}/mark-unused`

## Security Considerations

1. **API Key Encryption**: Pool API keys are encrypted at rest using field-level encryption
2. **Authorization**: All requests verify user has owner or member access to workspace
3. **Pod Passwords**: Pod passwords are retrieved from Pool Manager and used for control port authentication
4. **Automatic Cleanup**: Frontend implements multiple cleanup strategies to prevent pod leaks

## Best Practices

1. **Always Drop Pods**: Implement cleanup handlers to ensure pods are returned to the pool
2. **Use sendBeacon**: For browser close events, use `navigator.sendBeacon()` for reliable delivery
3. **Handle Errors**: Always handle claim failures gracefully (no available pods, network errors, etc.)
4. **Repository Sync**: Use `?latest=true` when you need fresh repository state
5. **Non-blocking UI**: Don't await drop operations in UI handlers that need immediate response

## Example: UserJourneys Component

See `/src/components/UserJourneys.tsx` for a complete implementation example that includes:

- Pod claiming with loading states
- Frontend display in iframe
- Automatic cleanup on unmount, navigation, and browser close
- Error handling with user-friendly toast notifications
- Non-blocking close button behavior
