# Agent Diff API Route

## Overview

The Agent Diff API route (`/api/agent/diff`) retrieves code differences (diffs) from a running pod workspace and creates a chat message with the diff artifacts. This endpoint is used to fetch and display file changes made during an agent's execution.

**Location:** `src/app/api/agent/diff/route.ts`

## Endpoint

```
POST /api/agent/diff
```

## Authentication

Requires valid Next-Auth session with authenticated user.

## Request Body

```typescript
{
  podId: string;        // ID of the pod to fetch diffs from
  workspaceId: string;  // ID of the workspace
  taskId: string;       // ID of the task to associate the diff message with
}
```

## Response

### Success Response (200)

When diffs are found:
```typescript
{
  success: true;
  message: ChatMessage; // Chat message with DIFF artifact
}
```

When no diffs are found:
```typescript
{
  success: true;
  noDiffs: true;
}
```

### Error Responses

- **401 Unauthorized**: User is not authenticated or has invalid session
- **400 Bad Request**: Missing required fields (podId, workspaceId, taskId) or swarm not configured
- **403 Forbidden**: User does not have access to the workspace
- **404 Not Found**: Workspace or swarm not found
- **500 Internal Server Error**: Failed to fetch diff from pod or other server errors

## Process Flow

1. **Authentication & Validation**
   - Verifies user session
   - Validates required fields (podId, workspaceId, taskId)

2. **Authorization**
   - Checks if user is workspace owner or member
   - Verifies workspace has an associated swarm
   - Validates swarm has pool configuration

3. **Pod Communication**
   - Retrieves pod details from pool using encrypted API key
   - Extracts control port URL from pod port mappings
   - Sends GET request to `{controlPortUrl}/diff` with Bearer token authentication

4. **Diff Processing**
   - Receives array of `ActionResult` objects containing file diffs
   - If no diffs found, returns early without creating artifacts
   - If diffs exist, creates a chat message with DIFF artifact type

5. **Response**
   - Returns chat message with embedded diff artifacts
   - Includes message metadata (id, taskId, role, status, timestamps, etc.)

## Mock Mode

When `MOCK_BROWSER_URL` or `CUSTOM_GOOSE_URL` environment variables are set, the endpoint returns mock diff data:

```typescript
{
  file: "example.ts",
  action: "modify",
  content: "diff --git a/example.ts b/example.ts...",
  repoName: "test/repo"
}
```

This is useful for testing and development without requiring an actual pod.

## Data Structures

### ActionResult

```typescript
{
  file: string;      // Path to the modified file
  action: string;    // Type of action (e.g., "modify", "create", "delete")
  content: string;   // Unified diff content
  repoName: string;  // Repository name
}
```

### ChatMessage with DIFF Artifact

The created message includes:
- Role: `ASSISTANT`
- Status: `SENT`
- Artifact type: `DIFF`
- Artifact content: `{ diffs: ActionResult[] }`

## Dependencies

- **Next.js**: Server-side API routes
- **NextAuth**: Authentication
- **Prisma**: Database operations
- **EncryptionService**: Decrypt pool API keys
- **Pod Management**: Get pod details and port mappings

## Security Considerations

- User authentication required
- Workspace authorization enforced
- API keys encrypted at rest and decrypted only when needed
- Bearer token authentication used for pod communication
- Error messages don't expose sensitive information

## Example Usage

```typescript
const response = await fetch('/api/agent/diff', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    podId: 'pod-123',
    workspaceId: 'workspace-456',
    taskId: 'task-789',
  }),
});

const data = await response.json();
if (data.success && !data.noDiffs) {
  console.log('Diff message:', data.message);
  console.log('Diffs:', data.message.artifacts[0].content.diffs);
}
```

## Error Handling

The route implements comprehensive error handling:

1. **Authentication errors**: Returns 401 with appropriate message
2. **Validation errors**: Returns 400 for missing fields
3. **Authorization errors**: Returns 403 for access denied
4. **Resource errors**: Returns 404 for missing workspace/swarm
5. **Pod communication errors**: Returns status from pod response with details
6. **Generic errors**: Returns 500 for unexpected errors
7. **ApiError type**: Handled specially to preserve service and details information

## Logging

Key log points:
- Getting pod from pool
- Control port URL
- Diff fetch success with count
- Chat message creation
- Error details with stack traces
