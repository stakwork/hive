# User Journeys Table - Implementation Plan

src/app/api/workspaces/[slug]/user-journeys/route.ts
src/components/UserJourneys.tsx
src/app/api/stakwork/user-journey/route.ts

## Current Architecture Problems

### Dual Data Source Complexity
The User Journeys table currently fetches from **two sources** and merges them:

1. **GRAPH_NODE** - E2E tests from swarm graph microservice
   - Represents deployed/merged tests
   - Shows "Live" badge
   - Test code in `node.properties.body`

2. **TASK** - Records from PostgreSQL
   - Represents tests in-progress or under review
   - Shows PR/workflow badges
   - Test code in ChatMessage

**Problems:**
- Complex merging logic (line 374-376 in route.ts)
- Filtering to prevent duplicates (line 301-303)
- Self-referential API call using `NEXT_PUBLIC_APP_URL`
- Type union complexity (`type: "GRAPH_NODE" | "TASK"`)
- Different code retrieval strategies based on type

---

## Proposed Simplified Architecture

### Single Source of Truth: Tasks Table

**Concept:** Sync graph nodes into Tasks table on page load, use Tasks as only data source for UI.

**Flow:**
```
Page Load
  ↓
Fetch Tasks (sourceType=USER_JOURNEY)
  ↓
Fetch Graph Nodes (E2etest)
  ↓
Sync: Match/Create/Update Tasks
  ↓
Return Tasks[] only
```

---

## Implementation Plan

### 1. GitHub Utilities (`src/lib/github/userJourneys.ts`)

Create new module with Octokit-based utilities:

```typescript
/**
 * Get PR status from GitHub API
 * @param prUrl - Full PR URL (e.g., https://github.com/owner/repo/pull/123)
 * @param githubToken - User's GitHub access token
 * @returns PR status: open | merged | closed
 */
export async function getPRStatus(
  prUrl: string,
  githubToken: string
): Promise<'open' | 'merged' | 'closed'>

/**
 * Get list of files changed in a PR
 * @param prUrl - Full PR URL
 * @param githubToken - User's GitHub access token
 * @returns Array of file paths changed in PR
 */
export async function getPRChangedFiles(
  prUrl: string,
  githubToken: string
): Promise<string[]>

/**
 * Match task to graph node via PR correlation
 * Used when testFilePath doesn't match (handles path changes during workflow)
 * @param task - Task with merged PR artifact
 * @param graphNodes - All graph nodes for workspace
 * @param githubToken - User's GitHub access token
 * @returns Matching graph node or null
 */
export async function matchTaskToGraphViaPR(
  task: TaskWithPR,
  graphNodes: E2eTestNode[],
  githubToken: string
): Promise<E2eTestNode | null>
```

**Export from** `src/lib/github/index.ts`

**Pattern:** Follow existing `storePullRequest.ts` pattern (Octokit initialization, error handling)

---

### 2. API Route Refactor (`src/app/api/workspaces/[slug]/user-journeys/route.ts`)

#### Current Logic to Remove:
- Lines 309-327: Self-referential API call using `NEXT_PUBLIC_APP_URL`
- Lines 301-303: Filtering merged tasks to prevent duplicates
- Lines 336-350: Converting graph nodes to response format
- Lines 353-371: Converting tasks to response format
- Lines 374-376: Merging and sorting both types

#### New Logic:

```typescript
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  // 1. Auth & workspace verification (keep existing)

  // 2. Fetch existing tasks
  const tasks = await db.task.findMany({
    where: {
      workspaceId: workspace.id,
      deleted: false,
      sourceType: TaskSourceType.USER_JOURNEY,
    },
    include: {
      repository: true,
      chatMessages: {
        orderBy: { timestamp: 'desc' },
        take: 1,
        include: {
          artifacts: {
            where: { type: 'PULL_REQUEST' },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  // 3. Fetch graph nodes directly (no self-call)
  let graphNodes: E2eTestNode[] = [];
  if (workspace.swarm?.swarmUrl && workspace.swarm?.swarmApiKey) {
    const decryptedApiKey = encryptionService.decryptField(
      "swarmApiKey",
      workspace.swarm.swarmApiKey
    );
    graphNodes = await fetchE2eTestsFromGraph(
      workspace.swarm.swarmUrl,
      decryptedApiKey
    );
  }

  // 4. Group graph nodes by file (one task per file)
  const nodesByFile = new Map<string, E2eTestNode[]>();
  graphNodes.forEach(node => {
    const filePath = node.properties.file;
    if (!nodesByFile.has(filePath)) {
      nodesByFile.set(filePath, []);
    }
    nodesByFile.get(filePath)!.push(node);
  });

  // 5. Sync graph files to tasks
  const githubToken = await getGithubToken(userId, workspace.slug);

  for (const [filePath, nodes] of nodesByFile) {
    // Try to match existing task by testFilePath
    let existingTask = tasks.find(t => t.testFilePath === filePath);

    // Fallback: PR correlation (handles path changes)
    if (!existingTask) {
      const mergedTasks = tasks.filter(t =>
        t.chatMessages[0]?.artifacts[0]?.content?.status === 'DONE'
      );
      for (const task of mergedTasks) {
        const prArtifact = task.chatMessages[0]?.artifacts[0];
        if (prArtifact) {
          const match = await matchTaskToGraphViaPR(
            task,
            nodes,
            githubToken
          );
          if (match) {
            existingTask = task;
            break;
          }
        }
      }
    }

    // Create new task if no match (manually added tests)
    if (!existingTask) {
      existingTask = await db.task.create({
        data: {
          title: nodes[0].properties.name, // First test name
          description: `E2E test file: ${filePath}`,
          workspaceId: workspace.id,
          sourceType: TaskSourceType.USER_JOURNEY,
          status: 'DONE',
          workflowStatus: 'COMPLETED',
          priority: 'MEDIUM',
          testFilePath: filePath,
          testFileUrl: constructGithubUrl(repository, filePath),
          repositoryId: repository?.id || null,
          createdById: workspace.ownerId,
          updatedById: workspace.ownerId,
        },
      });
    } else {
      // Update existing task to mark as deployed
      await db.task.update({
        where: { id: existingTask.id },
        data: {
          status: 'DONE',
          workflowStatus: 'COMPLETED',
          title: nodes[0].properties.name, // Update to actual test name
        },
      });
    }
  }

  // 6. Refresh tasks after sync
  const updatedTasks = await db.task.findMany({
    where: {
      workspaceId: workspace.id,
      deleted: false,
      sourceType: TaskSourceType.USER_JOURNEY,
    },
    include: {
      repository: true,
      chatMessages: {
        orderBy: { timestamp: 'desc' },
        take: 1,
        include: {
          artifacts: {
            where: { type: 'PULL_REQUEST' },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  // 7. Process PR artifacts with GitHub utils
  const processedTasks = await Promise.all(
    updatedTasks.map(async (task) => {
      const prArtifact = await extractPrArtifact(task, userId);
      return {
        id: task.id,
        title: task.title,
        testFilePath: task.testFilePath,
        testFileUrl: task.testFileUrl,
        createdAt: task.createdAt.toISOString(),
        badge: calculateBadge(task, prArtifact),
        task: {
          description: task.description,
          status: task.status,
          workflowStatus: task.workflowStatus,
          stakworkProjectId: task.stakworkProjectId,
          repository: task.repository || undefined,
        },
      };
    })
  );

  return NextResponse.json({
    success: true,
    data: processedTasks,
  });
}
```

#### Helper Function:
```typescript
async function fetchE2eTestsFromGraph(
  swarmUrl: string,
  swarmApiKey: string
): Promise<E2eTestNode[]> {
  // Reuse pattern from migrate-e2e-to-tasks.ts:78-108
  const swarmUrlObj = new URL(swarmUrl);
  const graphUrl = `https://${swarmUrlObj.hostname}:3355/nodes`;

  const response = await fetch(graphUrl, {
    method: 'GET',
    headers: {
      'x-api-token': swarmApiKey,
    },
    params: {
      node_type: 'E2etest',
      output: 'json',
    },
  });

  if (!response.ok) return [];

  const data = await response.json();
  return Array.isArray(data) ? data : [];
}
```

---

### 3. Frontend Component (`src/components/UserJourneys.tsx`)

#### Remove:
- `type: "GRAPH_NODE" | "TASK"` from `UserJourneyRow` interface (line 30)
- `graphNode` field from interface (lines 47-50)
- `hidePending` state and Switch toggle (replace with dropdown)
- Type-based conditional logic:
  - Lines 161-167: `handleCopyCode`
  - Lines 268-274: `handleReplay`
  - Line 525: `row.type === "GRAPH_NODE"` check

#### Add:
```typescript
// Filter state (defaults)
const [showPendingTasks, setShowPendingTasks] = useState(true);
const [showFailedTasks, setShowFailedTasks] = useState(false);

// Updated filter logic
const filteredRows = userJourneys.filter(row => {
  // Filter out pending tasks if toggled off
  if (!showPendingTasks) {
    const isPending = row.task?.status === 'IN_PROGRESS' &&
                      !row.task?.prArtifact;
    if (isPending) return false;
  }

  // Filter out failed workflows without PR if toggled off (default)
  if (!showFailedTasks) {
    const isFailed = ['FAILED', 'ERROR', 'HALTED'].includes(
      row.task?.workflowStatus || ''
    );
    const hasNoPR = !row.task?.prArtifact;
    if (isFailed && hasNoPR) return false;
  }

  return true;
});
```

#### Update Test Code Retrieval:
```typescript
const fetchTestCode = async (row: UserJourneyRow): Promise<string | null> => {
  // Try ChatMessage first (pending tasks)
  try {
    const messagesResponse = await fetch(`/api/tasks/${row.id}/messages`);
    if (messagesResponse.ok) {
      const result = await messagesResponse.json();
      const testCode = result.data?.messages?.[0]?.message;
      if (testCode && testCode.trim().length > 0) {
        return testCode;
      }
    }
  } catch (error) {
    console.error("Error fetching from ChatMessage:", error);
  }

  // Fallback to graph (deployed tasks)
  if (row.testFilePath) {
    try {
      const graphResponse = await fetch(
        `/api/workspaces/${slug}/graph/nodes?node_type=E2etest&output=json`
      );
      if (graphResponse.ok) {
        const result = await graphResponse.json();
        if (result.success && Array.isArray(result.data)) {
          const node = result.data.find(
            n => n.properties.file === row.testFilePath
          );
          if (node?.properties.body) {
            return node.properties.body;
          }
        }
      }
    } catch (error) {
      console.error("Error fetching from graph:", error);
    }
  }

  return null;
};
```

#### UI Updates:
```tsx
import { Eye } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

<CardHeader>
  <div className="flex items-center justify-between">
    <div className="flex items-center gap-2">
      {/* Filter dropdown with eye icon */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
            <Eye className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuCheckboxItem
            checked={showPendingTasks}
            onCheckedChange={setShowPendingTasks}
          >
            Pending Tasks
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            checked={showFailedTasks}
            onCheckedChange={setShowFailedTasks}
          >
            Failed Tasks
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  </div>
</CardHeader>
```

---

### 4. Badge Calculation Simplification

Remove type-based branching, use single logic:

```typescript
function calculateBadge(
  task: Task,
  prArtifact?: PRArtifact | null
): BadgeMetadata {
  // Check PR artifact first (highest priority)
  if (prArtifact?.content) {
    const prStatus = prArtifact.content.status;
    const prUrl = prArtifact.content.url;

    if (prStatus === "IN_PROGRESS") {
      return {
        type: "PR",
        text: "Open",
        url: prUrl,
        color: "#238636",
        borderColor: "#238636",
        icon: "GitPullRequest",
      };
    }

    if (prStatus === "CANCELLED") {
      return {
        type: "PR",
        text: "Closed",
        url: prUrl,
        color: "#6e7681",
        borderColor: "#6e7681",
        icon: "GitPullRequestClosed",
      };
    }

    if (prStatus === "DONE") {
      // Deployed test (merged PR)
      return {
        type: "PR",
        text: "Merged",
        url: prUrl,
        color: "#8957e5",
        borderColor: "#8957e5",
        icon: "GitMerge",
      };
    }
  }

  // Check if deployed to graph (no PR artifact but status=DONE)
  if (task.status === "DONE" && task.workflowStatus === "COMPLETED") {
    return {
      type: "LIVE",
      text: "Live",
      color: "#10b981",
      borderColor: "#10b981",
      icon: null,
    };
  }

  // Fallback to workflow status
  const workflowStatus = task.workflowStatus;

  if (workflowStatus === "FAILED" || workflowStatus === "ERROR" || workflowStatus === "HALTED") {
    return {
      type: "WORKFLOW",
      text: "Failed",
      color: "#dc2626",
      borderColor: "#dc2626",
      icon: null,
    };
  }

  if (workflowStatus === "IN_PROGRESS" || workflowStatus === "PENDING") {
    return {
      type: "WORKFLOW",
      text: "In Progress",
      color: "#ca8a04",
      borderColor: "#ca8a04",
      icon: null,
    };
  }

  // Default: Pending
  return {
    type: "WORKFLOW",
    text: "Pending",
    color: "#6b7280",
    borderColor: "#6b7280",
    icon: null,
  };
}
```

---

### 5. Database Schema

**No migrations required!** Existing schema already supports this:

```prisma
model Task {
  testFilePath        String?      // Primary matching key
  testFileUrl         String?      // GitHub blob URL
  status              TaskStatus   // User/PM lifecycle
  workflowStatus      WorkflowStatus? // System automation state
  sourceType          TaskSourceType  // USER_JOURNEY filter
  chatMessages        ChatMessage[]   // Test code for pending
  // ... other fields
}
```

---

## Benefits

### Complexity Reduction
- **Before:** Two data sources, complex merging, type unions
- **After:** Single source, simple array operations

### Code Size
- Remove ~150 lines of merging/filtering logic
- Remove dual badge calculation paths
- Simplify TypeScript interfaces

### Performance
- One database query instead of two API calls
- Sync happens server-side (faster)
- Client receives flat array

### Maintainability
- Single code path for all tests
- Easier debugging
- Clear data flow

### UX Improvements
- Cleaner UI with eye icon dropdown filter instead of multiple toggles
- Failed workflows hidden by default (cleaner table)
- Pending tasks shown by default (matches user expectations)
- Test names instead of filenames (better labels)
- Consistent badge behavior

---

## Migration Path

### Phase 1: Add GitHub Utils
1. Create `src/lib/github/userJourneys.ts`
2. Add PR status and file fetching functions
3. Export from `src/lib/github/index.ts`
4. Write unit tests

### Phase 2: Refactor API Route
1. Add `fetchE2eTestsFromGraph` helper
2. Implement sync logic
3. Replace dual-source fetch with single query
4. Remove GRAPH_NODE response type
5. Test with existing data

### Phase 3: Update Frontend
1. Remove `type` field from interface
2. Replace toggles with eye icon dropdown (Pending Tasks ON, Failed Tasks OFF by default)
3. Update filter logic
4. Simplify test code retrieval
5. Test all interactions (copy, replay, display)

### Phase 4: Cleanup
1. Remove unused type definitions
2. Remove old badge calculation branches
3. Update CLAUDE.md documentation
4. Run full test suite

---

## Testing Checklist

- [ ] Pending test with ChatMessage shows correct code
- [ ] Deployed test fetches code from graph
- [ ] Eye icon dropdown opens and shows filter options
- [ ] Pending tasks shown by default (checkbox checked)
- [ ] Failed workflows hidden by default (checkbox unchecked)
- [ ] Failed workflows visible when checkbox enabled
- [ ] Pending tasks hidden when checkbox disabled
- [ ] PR badges show correct status (open/merged/closed)
- [ ] Live badge shows for deployed tests without PR
- [ ] Manually added graph tests auto-create tasks
- [ ] Path changes during workflow handled via PR correlation
- [ ] Multiple tests in one file grouped correctly
- [ ] Test names (not filenames) shown in table
- [ ] Copy code works for both pending and deployed
- [ ] Replay works for both pending and deployed

---

## Future Enhancements

### Webhooks Instead of Page Load Sync
Instead of syncing on every page load, use Stakwork webhook after PR merge to update task status. More efficient but requires webhook reliability.

### Graph API File-Level Endpoint
Add `GET /files?node_type=E2etest` to graph service for file-level aggregation. Reduces data transfer and matches task granularity.

### Real-time Updates
Use Pusher to broadcast task updates when graph sync occurs. Other users see new tests appear without refresh.
