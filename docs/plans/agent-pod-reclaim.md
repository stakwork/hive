# Agent Mode: Pod Reclaim on Revisit

## Problem

When a user revisits an existing agent-mode task after the pod has been released (or timed out), there is no mechanism to reclaim a new pod. The user sees the chat history but cannot continue working because:

1. `podId` is null on the task
2. No pod claim flow is triggered for existing tasks
3. The `handleStart` function only claims pods for new tasks (`isNewTask === true`)

## Solution: Lazy Pod Claim on First Message Send

Claim a pod on-demand when the user sends their first message to a pod-less agent task.

### Why This Approach

- **No wasted resources**: Users reviewing chat history don't consume pods
- **Minimal latency**: Only one extra network round-trip, and only when actually needed
- **Simple UX**: No new buttons or prompts - just works when user tries to continue

## Implementation Plan

### 1. Update `updatePodRepositories` Signature

**File**: `src/lib/pods/utils.ts`

Change the repository type to support optional `base_branch`:

```typescript
export async function updatePodRepositories(
  controlPortUrl: string,
  password: string,
  repositories: Array<{ url: string; base_branch?: string }>,
): Promise<void>
```

The request body becomes:
```json
{
  "repos": [
    { "url": "https://github.com/org/repo", "base_branch": "feature-branch" }
  ]
}
```

### 2. Update `claim-pod` Route to Accept Branch

**File**: `src/app/api/pool-manager/claim-pod/[workspaceId]/route.ts`

Add optional `branch` query parameter:

```typescript
const branch = searchParams.get("branch"); // optional task branch
```

When building the repositories array for `updatePodRepositories`:

```typescript
const repositories = workspace.repositories.map((repo) => ({
  url: repo.repositoryUrl,
  ...(branch && { base_branch: branch }),
}));
```

### 3. Extract Shared Helper for Pod Artifacts

**File**: `src/app/w/[slug]/task/[...taskParams]/page.tsx` (or a new `lib/` file)

The artifact creation logic already exists in `sendMessage` for new tasks. Extract it into a reusable helper:

```typescript
function createPodArtifacts(podUrls: { frontend?: string; ide?: string }): Artifact[] {
  const artifacts: Artifact[] = [];
  
  if (podUrls.frontend) {
    artifacts.push(
      createArtifact({
        id: generateUniqueId(),
        messageId: "",
        type: ArtifactType.BROWSER,
        content: { url: podUrls.frontend },
      })
    );
  }
  
  if (podUrls.ide) {
    artifacts.push(
      createArtifact({
        id: generateUniqueId(),
        messageId: "",
        type: ArtifactType.IDE,
        content: { url: podUrls.ide },
      })
    );
  }
  
  return artifacts;
}
```

Update the existing code in `sendMessage` (around line 693) to use this helper:

```typescript
if (options?.podUrls) {
  artifacts.push(...createPodArtifacts(options.podUrls));
}
```

### 4. Create Pod Reclaim Logic in `sendMessage`

**File**: `src/app/w/[slug]/task/[...taskParams]/page.tsx`

In the `sendMessage` callback, before the agent mode streaming logic, add a check:

```typescript
// Agent mode: check if we need to reclaim a pod
if (taskMode === "agent" && !podId && currentTaskId) {
  // Fetch task to get branch info
  const taskResponse = await fetch(`/api/tasks/${currentTaskId}`);
  const taskData = await taskResponse.json();
  const taskBranch = taskData.data?.branch;

  // Build claim URL with branch if present
  let claimUrl = `/api/pool-manager/claim-pod/${workspaceId}?latest=true&goose=true&taskId=${currentTaskId}`;
  if (taskBranch) {
    claimUrl += `&branch=${encodeURIComponent(taskBranch)}`;
  }

  const podResponse = await fetch(claimUrl, { method: "POST" });
  
  if (!podResponse.ok) {
    // Handle failure - show toast, don't proceed with message
    toast.error("Failed to claim pod", { description: "No pods available" });
    setIsLoading(false);
    return;
  }

  const podResult = await podResponse.json();
  
  // Update local state - the database task record is already updated
  // by the claim-pod route (podId, agentUrl, agentPassword)
  setPodId(podResult.podId);
  
  // Create BROWSER and IDE artifacts using shared helper
  const reclaimArtifacts = createPodArtifacts({
    frontend: podResult.frontend,
    ide: podResult.ide,
  });

  // Add artifacts as a system message indicating pod reconnection
  if (reclaimArtifacts.length > 0) {
    const reconnectMessage: ChatMessage = createChatMessage({
      id: generateUniqueId(),
      message: "Pod reconnected",
      role: ChatRole.ASSISTANT,
      status: ChatStatus.SENT,
      artifacts: reclaimArtifacts,
    });
    setMessages((msgs) => [...msgs, reconnectMessage]);
    
    // Persist the reconnection message with artifacts to the database
    await fetch(`/api/tasks/${currentTaskId}/messages/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Pod reconnected",
        role: "ASSISTANT",
        artifacts: reclaimArtifacts.map((a) => ({
          type: a.type,
          content: a.content,
        })),
      }),
    });
  }
}
```

This ensures that when a pod is reclaimed:
1. The `podId` state is updated so the UI shows pod-related controls
2. BROWSER and IDE artifacts are created using the same helper as new tasks
3. A "Pod reconnected" message is added to chat history (and persisted) so user knows what happened

### 5. Include Branch in Initial Pod Claim (Future)

**File**: `src/app/w/[slug]/task/[...taskParams]/page.tsx`

For new tasks, if a branch is somehow pre-set (future feature), include it in the initial claim. Currently new tasks won't have a branch yet, so this is forward-compatible.

### 6. Update Task Messages API Response

**File**: `src/app/api/tasks/[taskId]/messages/route.ts`

Ensure the `branch` field is included in the task data returned:

```typescript
select: {
  // ... existing fields
  branch: true,
}
```

## Data Flow

```
User revisits agent task (no pod)
         │
         ▼
User sends message
         │
         ▼
sendMessage detects: mode=agent, podId=null
         │
         ▼
Fetch task to get branch ──────────────────┐
         │                                  │
         ▼                                  │
POST /api/pool-manager/claim-pod           │
  ?latest=true                              │
  &goose=true                               │
  &taskId=xxx                               │
  &branch=feature-branch  ◄─────────────────┘
         │
         ▼
claim-pod calls updatePodRepositories
  with { url, base_branch }
         │
         ▼
PUT /latest on pod control port
  { repos: [{ url, base_branch }] }
         │
         ▼
Pod checks out correct branch
         │
         ▼
claim-pod route updates Task record in DB:
  - podId
  - agentUrl (control port URL)
  - agentPassword (encrypted)
         │
         ▼
Frontend receives { podId, frontend, ide }
         │
         ▼
Create BROWSER + IDE artifacts
         │
         ▼
Add "Pod reconnected" message to chat (with artifacts)
         │
         ▼
Persist message to database
         │
         ▼
Continue with normal agent streaming flow
```

## Edge Cases

1. **No pods available**: Show error toast, don't send message
2. **Pod claim succeeds but updatePodRepositories fails**: Log error but continue (existing behavior)
3. **User has pod but it became stale**: Not handled here - would need health check (future work)
4. **Race condition (double send)**: `isLoading` state prevents this

## Testing

1. Create agent task, release pod, revisit and send message - should reclaim
2. Create agent task with branch set, release pod, revisit - should pull correct branch
3. Revisit agent task when no pods available - should show error
4. Revisit non-agent task - should not attempt pod claim
5. Reclaim pod - verify BROWSER/IDE artifacts appear and preview panel is visible
6. Reclaim pod - verify "Pod reconnected" message appears in chat
7. Refresh page after reclaim - verify artifacts are persisted and load correctly
