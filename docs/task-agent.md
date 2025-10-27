# Task Agent Pod Credential Security Implementation

## Problem Statement

Currently, when agent mode tasks claim a pod, the Goose URL and pod password are passed from the backend to the frontend, and then back to the backend in subsequent `/api/agent` requests. This exposes sensitive credentials (especially the pod password) in the frontend, which is a security vulnerability.

## Solution Architecture

Store the agent URL (Goose URL) and encrypted pod password directly on the Task model in the database. This ensures credentials never leave the backend and are only accessible server-side.

## Database Schema Changes

### File: `prisma/schema.prisma`

Add two new fields to the `Task` model (around line 379):

```prisma
// Task mode (live, test, agent, etc.)
mode String @default("live")

// Agent URLs and credentials (encrypted)
agentUrl      String? @map("agent_url")
agentPassword String? @map("agent_password") // Encrypted pod password

// Bounty code for external bounty platforms
bountyCode String? @unique @map("bounty_code")
```

**After schema update:**
1. Run `npx prisma migrate dev --name add_agent_url_and_password_to_task`
2. Run `npx prisma generate`

## Implementation Steps

### 1. Update Frontend Task Page

**File:** `src/app/w/[slug]/task/[...taskParams]/page.tsx`

**Changes in `handleStart` function (lines 288-381):**

#### Before (lines 294-330):
```typescript
// Claim pod if agent mode is selected
let claimedPodUrls: { frontend: string; ide: string; goose: string } | null = null;
if (taskMode === "agent" && workspaceId) {
  try {
    const podResponse = await fetch(`/api/pool-manager/claim-pod/${workspaceId}?latest=true&goose=true`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (podResponse.ok) {
      const podResult = await podResponse.json();
      claimedPodUrls = {
        frontend: podResult.frontend,
        ide: podResult.ide,
        goose: podResult.goose,
      };
      setHasPod(true);
      setClaimedPodId(podResult.podId);
    }
  } catch (error) {
    // error handling
  }
}

// Create new task
const response = await fetch("/api/tasks", {
  method: "POST",
  // ...
});
```

#### After:
```typescript
// Create new task FIRST
const response = await fetch("/api/tasks", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    title: msg,
    description: "New task description",
    status: "active",
    workspaceSlug: slug,
    mode: taskMode,
  }),
});

if (!response.ok) {
  throw new Error(`Failed to create task: ${response.statusText}`);
}

const result = await response.json();
const newTaskId = result.data.id;
setCurrentTaskId(newTaskId);

// Claim pod if agent mode is selected (AFTER task creation)
let claimedPodUrls: { frontend: string; ide: string } | null = null;
if (taskMode === "agent" && workspaceId) {
  try {
    const podResponse = await fetch(
      `/api/pool-manager/claim-pod/${workspaceId}?latest=true&goose=true&taskId=${newTaskId}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    if (podResponse.ok) {
      const podResult = await podResponse.json();
      // Only frontend and IDE URLs are returned (no goose URL or password)
      claimedPodUrls = {
        frontend: podResult.frontend,
        ide: podResult.ide,
      };
      setHasPod(true);
      setClaimedPodId(podResult.podId);
    }
  } catch (error) {
    // error handling
  }
}
```

**Changes in `sendMessage` function (lines 398-595):**

Remove `gooseUrl` from the agent request body:

#### Before (lines 460-475):
```typescript
// Extract gooseUrl from IDE artifact if available
const gooseUrl = options?.podUrls?.goose;

const response = await fetch("/api/agent", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    taskId: options?.taskId || currentTaskId,
    message: messageText,
    workspaceSlug: slug,
    gooseUrl,  // REMOVE THIS
    artifacts: backendArtifacts,
  }),
});
```

#### After:
```typescript
const response = await fetch("/api/agent", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    taskId: options?.taskId || currentTaskId,
    message: messageText,
    workspaceSlug: slug,
    // gooseUrl removed - will be fetched from database in backend
    artifacts: backendArtifacts,
  }),
});
```

**Remove goose URL from artifacts (lines 412-431):**

The `podUrls` object should only contain `frontend` and `ide` (no `goose`):

```typescript
// Add BROWSER and IDE artifacts if podUrls are provided
if (options?.podUrls) {
  artifacts.push(
    createArtifact({
      id: generateUniqueId(),
      messageId: "",
      type: ArtifactType.BROWSER,
      content: {
        url: options.podUrls.frontend,
      },
    }),
    createArtifact({
      id: generateUniqueId(),
      messageId: "",
      type: ArtifactType.IDE,
      content: {
        url: options.podUrls.ide,
      },
    }),
  );
}
```

### 2. Update Pool Manager Claim Pod Endpoint

**File:** `src/app/api/pool-manager/claim-pod/[workspaceId]/route.ts`

**Import encryption service at the top:**
```typescript
import { fieldEncryptionService } from "@/lib/encryption/field-encryption";
```

**Add query parameter parsing and database update:**

#### Current structure:
```typescript
export async function POST(
  request: Request,
  { params }: { params: { workspaceId: string } }
) {
  // ... existing workspace validation ...

  // Claim pod from pool manager
  const podInfo = await poolManagerService.claimPod({
    latest: latestParam === "true",
    goose: gooseParam === "true",
  });

  return NextResponse.json({
    podId: podInfo.podId,
    frontend: podInfo.frontend,
    ide: podInfo.ide,
    goose: podInfo.goose,  // REMOVE from response
  });
}
```

#### Updated structure:
```typescript
export async function POST(
  request: Request,
  { params }: { params: { workspaceId: string } }
) {
  const { searchParams } = new URL(request.url);
  const latestParam = searchParams.get("latest");
  const gooseParam = searchParams.get("goose");
  const taskId = searchParams.get("taskId"); // NEW: Get taskId from query params

  // ... existing workspace validation ...

  // Claim pod from pool manager
  const podInfo = await poolManagerService.claimPod({
    latest: latestParam === "true",
    goose: gooseParam === "true",
  });

  // If taskId is provided, store agent credentials on the task
  if (taskId && gooseParam === "true") {
    try {
      // Encrypt the pod password
      const encryptedPassword = await fieldEncryptionService.encrypt(podInfo.password);

      // Update the task with agent credentials
      await prisma.task.update({
        where: { id: taskId },
        data: {
          agentUrl: podInfo.goose,
          agentPassword: encryptedPassword,
        },
      });

      console.log(`Stored agent credentials for task ${taskId}`);
    } catch (error) {
      console.error("Failed to store agent credentials:", error);
      // Don't fail the request, but log the error
    }
  }

  // Return only non-sensitive information to frontend
  return NextResponse.json({
    podId: podInfo.podId,
    frontend: podInfo.frontend,
    ide: podInfo.ide,
    // goose URL and password are NOT returned (stored in DB)
  });
}
```

### 3. Update Agent API Endpoint

**File:** `src/app/api/agent/route.ts`

**Import encryption service at the top:**
```typescript
import { fieldEncryptionService } from "@/lib/encryption/field-encryption";
```

**Fetch agent credentials from database instead of request body:**

#### Current structure:
```typescript
export async function POST(request: Request) {
  const body = await request.json();
  const { taskId, message, workspaceSlug, gooseUrl, artifacts } = body;

  // Use gooseUrl from request body
  const session = await checkGooseSession(gooseUrl);
  // ...
}
```

#### Updated structure:
```typescript
export async function POST(request: Request) {
  const body = await request.json();
  const { taskId, message, workspaceSlug, artifacts } = body;
  // gooseUrl removed from destructuring

  if (!taskId) {
    return NextResponse.json(
      { success: false, error: "Task ID is required" },
      { status: 400 }
    );
  }

  // Fetch task from database to get agent credentials
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      agentUrl: true,
      agentPassword: true,
      mode: true,
    },
  });

  if (!task) {
    return NextResponse.json(
      { success: false, error: "Task not found" },
      { status: 404 }
    );
  }

  if (task.mode !== "agent") {
    return NextResponse.json(
      { success: false, error: "Task is not in agent mode" },
      { status: 400 }
    );
  }

  if (!task.agentUrl || !task.agentPassword) {
    return NextResponse.json(
      { success: false, error: "Agent credentials not found for task" },
      { status: 400 }
    );
  }

  // Decrypt the pod password
  const podPassword = await fieldEncryptionService.decrypt(task.agentPassword);

  // Use credentials from database
  const gooseUrl = task.agentUrl;
  const session = await checkGooseSession(gooseUrl, podPassword);

  // Rest of the agent logic...
}
```

### 4. Update TypeScript Types

**File:** `src/types/agent.ts` (or wherever AgentRequestBody is defined)

Remove `gooseUrl` from the request type:

```typescript
export interface AgentRequestBody {
  taskId: string;
  message: string;
  workspaceSlug: string;
  // gooseUrl: string; // REMOVE THIS
  artifacts?: Array<{
    type: string;
    content: unknown;
  }>;
}
```

## Security Benefits

1. **Credentials never exposed to frontend**: Pod password is stored encrypted in the database and only decrypted server-side
2. **Single source of truth**: Agent credentials are tied to the task in the database
3. **Automatic cleanup**: When a task is deleted, credentials are automatically cleaned up via cascade delete
4. **Audit trail**: Credentials are stored with the task, providing clear ownership and tracking
5. **Encryption at rest**: Uses existing `fieldEncryptionService` with AES-256-GCM encryption

## Migration Path

1. Update schema and run migration
2. Update `/api/pool-manager/claim-pod` to store credentials
3. Update `/api/agent` to read credentials from database
4. Update frontend to remove credential passing
5. Test with new agent tasks
6. Old tasks without credentials will fail gracefully with clear error messages

## Testing Checklist

- [ ] Create new agent task - verify credentials stored in database
- [ ] Send message in agent task - verify agent works with DB credentials
- [ ] Check database - verify `agentPassword` is encrypted
- [ ] Test commit flow - verify it still works without gooseUrl in request
- [ ] Test pod drop - verify cleanup still works
- [ ] Test error cases - task not found, missing credentials, etc.

## Notes

- The `frontend` and `ide` URLs are still passed to the frontend and stored as artifacts (they're not sensitive)
- Only the Goose URL (`agentUrl`) and pod password (`agentPassword`) are stored in the database
- The `podId` is still returned to the frontend for drop-pod operations (it's used for cleanup)
- Existing tasks without agent credentials will need credentials to be re-claimed or will show an error
