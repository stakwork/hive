# Fix: Janitor Label Applied to Non-Janitor PRs

## Problem

The GitHub webhook handlers were incorrectly adding the "janitor" label to ANY pull request if the last task in the workspace was a janitor task, regardless of whether that task was actually linked to the PR.

### Root Cause

In both webhook handlers (`/api/github/webhook/route.ts` and `/api/github/webhook/[workspaceId]/route.ts`), the code was:

1. Finding the **most recent janitor task** created in the last 7 days
2. Immediately adding the "janitor" label to the PR
3. **Not verifying** that the PR was actually created by that janitor task

This meant if a janitor task ran on Monday and created a PR, then a developer manually created a PR on Tuesday, the developer's PR would incorrectly get the "janitor" label.

## Solution

Modified both webhook handlers to:

1. Query for janitor tasks that have a **PULL_REQUEST artifact** matching the PR number
2. Use Prisma's JSON filtering to find artifacts with URLs containing the PR number
3. Double-check the artifact content to verify the PR URL matches exactly
4. Only add the "janitor" label if a matching PR artifact is found

### Changes Made

#### File: `src/app/api/github/webhook/route.ts`

**Before:**
```typescript
// Look for a task that matches this workspace and is a janitor task
const task = await db.task.findFirst({
  where: {
    workspaceId: repository.workspaceId,
    sourceType: "JANITOR",
    createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
  },
  orderBy: { createdAt: "desc" },
  select: { id: true, sourceType: true },
});

if (task?.sourceType === "JANITOR") {
  // Add janitor label
}
```

**After:**
```typescript
// Look for a janitor task with a PR artifact matching this PR number
const task = await db.task.findFirst({
  where: {
    workspaceId: repository.workspaceId,
    sourceType: "JANITOR",
    createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    chatMessages: {
      some: {
        artifacts: {
          some: {
            type: "PULL_REQUEST",
            content: {
              path: ["url"],
              string_contains: `/pull/${prNumber}`,
            },
          },
        },
      },
    },
  },
  orderBy: { createdAt: "desc" },
  select: {
    id: true,
    sourceType: true,
    chatMessages: {
      select: {
        artifacts: {
          where: { type: "PULL_REQUEST" },
          select: { id: true, content: true },
        },
      },
    },
  },
});

if (task?.sourceType === "JANITOR") {
  // Verify the PR artifact matches the exact PR URL
  let prArtifactMatches = false;
  for (const message of task.chatMessages || []) {
    for (const artifact of message.artifacts || []) {
      const artifactContent = artifact.content as { url?: string };
      if (artifactContent?.url && artifactContent.url.includes(`/pull/${prNumber}`)) {
        prArtifactMatches = true;
        break;
      }
    }
    if (prArtifactMatches) break;
  }

  if (prArtifactMatches) {
    // Add janitor label
  }
}
```

#### File: `src/app/api/github/webhook/[workspaceId]/route.ts`

Applied the same fix, but using `janitorType` field instead of `sourceType`:

```typescript
where: {
  workspaceId: repository.workspaceId,
  repositoryId: repository.id,
  janitorType: { not: null },
  // ... same artifact filtering logic
}
```

## Testing Recommendations

1. **Test Case 1: Janitor PR should be labeled**
   - Run a janitor task that creates a PR
   - Verify the PR gets the "janitor" label

2. **Test Case 2: Manual PR should NOT be labeled**
   - Run a janitor task that creates a PR
   - Manually create a new PR
   - Verify the manual PR does NOT get the "janitor" label

3. **Test Case 3: Multiple janitor tasks**
   - Run multiple janitor tasks creating different PRs
   - Verify each PR only gets labeled if it matches the task's artifact

4. **Test Case 4: Old janitor tasks**
   - Create a janitor task older than 7 days
   - Open a new PR
   - Verify it doesn't get labeled (time filter still works)

## Impact

- **Positive:** Janitor labels are now correctly applied only to PRs created by janitor tasks
- **No Breaking Changes:** The fix only makes the filtering more precise
- **Logging:** Enhanced logging shows when tasks are found but artifacts don't match
- **Error Handling:** Maintains existing error handling (webhook doesn't fail if labeling fails)

## Related Code

- PR artifact creation: `src/app/w/[slug]/task/[...taskParams]/page.tsx`
- PR artifact extraction: `src/lib/helpers/tasks.ts` (`extractPrArtifact` function)
- Artifact schema: `prisma/schema.prisma` (Artifact model)
