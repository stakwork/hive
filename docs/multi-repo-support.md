# Multi-Repository Support Plan

This document outlines the changes required to support multiple repositories in workspaces for both stakgraph (code analysis) and pods (development environments).

## Executive Summary

The Hive Platform has **schema-level support** for multiple repositories per workspace, but the **application logic is heavily single-repo focused**. There are 53+ usages of `getPrimaryRepository()` and 29+ usages of `repositories[0]` throughout the codebase. Supporting multi-repo stakgraph and pods requires changes across database operations, stakgraph ingestion, pool manager integration, task workflows, and UI components.

---

## Current Architecture

### Data Model (Already Supports Multi-Repo)

```
Workspace (1) <---> (1) Swarm
    |
    +---> (N) Repository
           |
           +---> (N) Task (optional association)
```

**Key Observations:**
- `Repository` model supports multiple repos per workspace via `workspaceId` foreign key
- `Swarm` has a 1:1 relationship with `Workspace` (not with Repository)
- Tasks can optionally link to a specific repository via `repositoryId`

### Where Multi-Repo Fails Today

| Component | Current Behavior | Multi-Repo Impact |
|-----------|------------------|-------------------|
| **Stakgraph Ingest** | Uses `getPrimaryRepository()` - single repo URL | Only first repo is indexed |
| **Pool Creation** | Sends single `repo_name` to Pool Manager | Only primary repo cloned in pods |
| **Task Workflows** | Uses `workspace.repositories[0]` for context | Tasks always get primary repo context |
| **Janitor Runs** | Uses `repositories[0]` for analysis | Janitors only analyze primary repo |
| **GitHub Webhooks** | Set up only for primary repository | Changes in other repos not detected |
| **Knowledge Graph UI** | Gets repo name from `repositories[0]` | Only shows primary repo |
| **Dashboard** | Shows only `workspace.repositories[0]` | Users can't see other repos |

---

## Required Changes

### 1. Database Schema Changes

#### A. Track Repository Ingestion Status per Swarm

Currently swarms don't directly track which repositories have been ingested. For multi-repo stakgraph, we need to track per-repo ingestion status.

**Option 1: Join Table (Recommended for complex state)**

```prisma
model SwarmRepository {
  id           String           @id @default(cuid())
  swarmId      String           @map("swarm_id")
  repositoryId String           @map("repository_id")
  status       RepositoryStatus @default(PENDING)
  lastSyncedAt DateTime?        @map("last_synced_at")
  ingestRefId  String?          @map("ingest_ref_id")
  createdAt    DateTime         @default(now()) @map("created_at")
  updatedAt    DateTime         @updatedAt @map("updated_at")
  
  swarm        Swarm      @relation(fields: [swarmId], references: [id], onDelete: Cascade)
  repository   Repository @relation(fields: [repositoryId], references: [id], onDelete: Cascade)
  
  @@unique([swarmId, repositoryId])
  @@map("swarm_repositories")
}
```

**Option 2: Array on Swarm (Simpler)**

```prisma
model Swarm {
  // ... existing fields
  ingestedRepoIds String[] @map("ingested_repo_ids")
}
```

#### B. Pool Manager Multi-Repo Tracking

```prisma
model Swarm {
  // ... existing fields
  poolRepositories Json? @map("pool_repositories")
  // Schema: Array<{ repositoryId: string, status: 'PENDING' | 'CLONED' | 'FAILED' }>
}
```

---

### 2. Helper Function Updates

**File:** `/src/lib/helpers/repository.ts`

```typescript
// Add new function for multi-repo scenarios
export async function getAllRepositories(workspaceId: string): Promise<{
  id: string;
  repositoryUrl: string;
  ignoreDirs: string | null;
  unitGlob: string | null;
  integrationGlob: string | null;
  e2eGlob: string | null;
  name: string;
  description: string | null;
  branch: string;
}[]> {
  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    include: {
      repositories: {
        select: {
          id: true,
          repositoryUrl: true,
          ignoreDirs: true,
          unitGlob: true,
          integrationGlob: true,
          e2eGlob: true,
          name: true,
          description: true,
          branch: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  return workspace?.repositories || [];
}

// Keep getPrimaryRepository for backward compatibility but mark deprecated
/** @deprecated Use getAllRepositories() for multi-repo support */
export async function getPrimaryRepository(workspaceId: string) { ... }
```

**Files requiring updates (53+ usages of `getPrimaryRepository()`):**

| File | Update Required |
|------|-----------------|
| `/src/app/api/swarm/stakgraph/ingest/route.ts` | Ingest all repos or accept repo ID |
| `/src/app/api/swarm/stakgraph/sync/route.ts` | Sync specific repo or all |
| `/src/app/api/swarm/stakgraph/services/route.ts` | Return services per repo |
| `/src/app/api/swarm/stakgraph/agent-stream/route.ts` | Accept repo ID |
| `/src/services/pool-manager/sync.ts` | Sync all repos to pool |
| `/src/app/api/github/app/callback/route.ts` | Verify access to all repos |
| `/src/app/api/github/app/status/route.ts` | Check status for all repos |
| `/src/app/api/github/app/install/route.ts` | Handle multi-repo installation |
| `/src/services/swarm/stakgraph-status.ts` | Update status for specific repo |
| `/src/app/api/workspaces/[slug]/stakgraph/route.ts` | Return per-repo status |
| `/src/app/api/tests/coverage/route.ts` | Accept repo ID parameter |
| `/src/app/api/tests/nodes/route.ts` | Filter by repo |
| `/src/app/api/ask/quick/route.ts` | Accept repo context |
| `/src/app/api/learnings/route.ts` | Filter by repo |
| `/src/app/api/learnings/features/create/route.ts` | Accept repo ID |

---

### 3. Stakgraph Ingestion Changes

**Key Discovery:** The stakgraph service already supports multiple repositories via **comma-separated URLs** in the `repo_url` parameter. This simplifies the implementation significantly.

**File:** `/src/services/swarm/stakgraph-actions.ts`

#### Current Implementation (line 63-88)

```typescript
export async function triggerIngestAsync(
  swarmName: string,
  apiKey: string,
  repoUrl: string,  // Currently single repo, but stakgraph accepts comma-separated
  creds: { username: string; pat: string },
  callbackUrl?: string,
  useLsp: boolean = false,
) {
  const data: Record<string, string | boolean> = {
    repo_url: repoUrl,  // Can be "url1,url2,url3"
    username: creds.username,
    pat: creds.pat,
    use_lsp: useLsp,
    realtime: true,
  };
  // ...
}
```

#### Multi-Repo Implementation

No changes needed to `triggerIngestAsync` - it already passes `repo_url` through. The change is in how we call it:

```typescript
// Helper to build comma-separated repo URLs
export function buildMultiRepoUrl(repositories: Array<{ repositoryUrl: string }>): string {
  return repositories.map(r => r.repositoryUrl).join(',');
}
```

**File:** `/src/app/api/swarm/stakgraph/ingest/route.ts`

#### Current Implementation (lines 78-84)

```typescript
const primaryRepo = await getPrimaryRepository(repoWorkspaceId);
const finalRepo = primaryRepo?.repositoryUrl;  // Single URL
```

#### Multi-Repo Implementation

```typescript
// Option 1: Ingest all repos (default behavior change)
const repositories = await db.repository.findMany({
  where: { workspaceId: repoWorkspaceId },
  orderBy: { createdAt: 'asc' },
});
const repoUrls = repositories.map(r => r.repositoryUrl).join(',');

// Option 2: Support optional repositoryId param for single-repo ingest
const { useLsp, workspaceId, repositoryId } = body;

let repoUrls: string;
if (repositoryId) {
  // Ingest specific repo only
  const repo = await db.repository.findUnique({
    where: { id: repositoryId, workspaceId },
  });
  repoUrls = repo?.repositoryUrl || '';
} else {
  // Ingest all repositories (comma-separated)
  const repositories = await db.repository.findMany({
    where: { workspaceId },
    orderBy: { createdAt: 'asc' },
  });
  repoUrls = repositories.map(r => r.repositoryUrl).join(',');
}

// Then pass to triggerIngestAsync
const apiResult = await triggerIngestAsync(
  swarmVanityAddress,
  decryptedApiKey,
  repoUrls,  // Now comma-separated: "url1,url2,url3"
  { username, pat },
  stakgraphCallbackUrl,
  use_lsp,
);
```

#### Status Tracking Consideration

With comma-separated repos, we get a single `request_id` for all repos. Options:
1. **Single status for all** - Track one `ingestRefId` on Swarm (current behavior, simplest)
2. **Per-repo status** - Parse callback to update individual Repository statuses based on which URLs completed

---

### 3b. Stakgraph Sync Changes (Single Repo Only)

**Important:** Unlike ingest, sync does NOT support comma-separated URLs. This is fine because sync is triggered per-repo via GitHub webhooks.

**File:** `/src/app/api/swarm/stakgraph/sync/route.ts`

#### Current Implementation (lines 38-39)

```typescript
const primaryRepo = await getPrimaryRepository(swarm.workspaceId);
const repositoryUrl = primaryRepo?.repositoryUrl;
```

#### Multi-Repo Implementation

For the sync API endpoint, we need to accept a `repositoryId` parameter to specify which repo to sync:

```typescript
const { workspaceId, swarmId, repositoryId } = body;

let repositoryUrl: string | undefined;

if (repositoryId) {
  // Sync specific repo
  const repo = await db.repository.findUnique({
    where: { id: repositoryId, workspaceId: swarm.workspaceId },
  });
  repositoryUrl = repo?.repositoryUrl;
} else {
  // Fallback to primary (backward compatible)
  const primaryRepo = await getPrimaryRepository(swarm.workspaceId);
  repositoryUrl = primaryRepo?.repositoryUrl;
}
```

**File:** `/src/app/api/github/webhook/[workspaceId]/route.ts`

The webhook handler already receives the repo URL from the GitHub event payload, so it naturally handles multi-repo:

```typescript
// Line 272 - already uses the specific repo from the webhook event
const apiResult: AsyncSyncResult = await triggerAsyncSync(
  swarm.name,
  swarm.swarmApiKey,
  repositoryUrl,  // From GitHub webhook payload - already repo-specific
  // ...
);
```

**No UI needed for sync** - it's triggered automatically by GitHub webhooks when code is pushed to any tracked repo.

---

### 4. Pool Manager Changes

**File:** `/src/app/api/pool-manager/create-pool/route.ts`

#### Current Implementation

```typescript
const repository = await db.repository.findFirst({
  where: { workspaceId: swarm.workspaceId },
});

const pool = await poolManager.createPool({
  pool_name: swarm.id,
  repo_name: repository?.repositoryUrl || "",  // SINGLE
  branch_name: repository?.branch || "",
  // ...
});
```

#### Multi-Repo Implementation

```typescript
const repositories = await db.repository.findMany({
  where: { workspaceId: swarm.workspaceId },
  orderBy: { createdAt: 'asc' },
});

const primaryRepo = repositories[0];
const additionalRepos = repositories.slice(1);

const pool = await poolManager.createPool({
  pool_name: swarm.id,
  // Primary repo (backward compatible)
  repo_name: primaryRepo?.repositoryUrl || "",
  branch_name: primaryRepo?.branch || "",
  // Additional repos (new field - requires Pool Manager support)
  additional_repositories: additionalRepos.map(r => ({
    repo_url: r.repositoryUrl,
    branch: r.branch,
  })),
  // ...
});
```

**File:** `/src/types/pool-manager.ts`

```typescript
export interface CreatePoolRequest {
  pool_name: string;
  minimum_vms: number;
  repo_name: string;
  branch_name: string;
  github_pat: string;
  github_username: string;
  env_vars: EnvironmentVariable[];
  container_files: Record<string, string>;
  // New field for multi-repo
  additional_repositories?: Array<{
    repo_url: string;
    branch: string;
  }>;
}
```

**Note:** The `updatePodRepositories()` function in `/src/lib/pods/utils.ts` already supports multi-repo - it sends an array of repository URLs to the pod's `/latest` endpoint.

---

### 5. Task Workflow Changes

**File:** `/src/services/task-workflow.ts`

#### Current Implementation

```typescript
const repoUrl = task.workspace.repositories?.[0]?.repositoryUrl || null;
const baseBranch = task.workspace.repositories?.[0]?.branch || null;
```

#### Multi-Repo Implementation

```typescript
// Use task's repository if set, otherwise fall back to primary
const taskRepo = task.repository;
const primaryRepo = task.workspace.repositories?.[0];
const activeRepo = taskRepo || primaryRepo;

const repoUrl = activeRepo?.repositoryUrl || null;
const baseBranch = activeRepo?.branch || null;
const repoName = activeRepo?.name || null;
```

**File:** `/src/services/stakwork-run.ts`

```typescript
// Similar pattern - use task's repository when available
const repo = run.task?.repository || workspace.repositories[0];
const vars = {
  repo_url: repo?.repositoryUrl || null,
  base_branch: repo?.branch || null,
  // ...
};
```

---

### 6. Janitor System Updates

**File:** `/src/services/janitor.ts`

#### Option A: Per-Repository Janitors (Recommended)

Create separate janitor runs for each repository:

```typescript
export async function createJanitorRunsForAllRepos(
  janitorConfigId: string,
  workspaceId: string,
): Promise<JanitorRun[]> {
  const repositories = await db.repository.findMany({
    where: { workspaceId },
  });
  
  const runs = [];
  for (const repo of repositories) {
    const run = await createJanitorRun({
      janitorConfigId,
      repositoryId: repo.id,  // New field
    });
    runs.push(run);
  }
  return runs;
}
```

#### Option B: Add Repository Field to JanitorRun

```prisma
model JanitorRun {
  // ... existing fields
  repositoryId String? @map("repository_id")
  repository   Repository? @relation(...)
}
```

---

### 7. GitHub Webhook Setup

**File:** `/src/app/api/workspaces/[slug]/stakgraph/route.ts`

#### Current Implementation

```typescript
const primaryRepo = await getPrimaryRepository(workspace.id);
// Only sets up webhook for primary repo
```

#### Multi-Repo Implementation

```typescript
const repositories = await getAllRepositories(workspace.id);

// Set up webhooks for all repositories
for (const repo of repositories) {
  await webhookService.ensureRepoWebhook({
    userId: session.user.id,
    workspaceId: workspace.id,
    repositoryUrl: repo.repositoryUrl,
    callbackUrl,
  });
}
```

---

### 8. UI Component Updates

#### Dashboard Repository Card

**File:** `/src/components/dashboard/repository-card/index.tsx`

```typescript
// Current: Shows only first
const repository = workspace.repositories[0];

// Multi-repo: Show all repositories
const repositories = workspace.repositories;

return (
  <div>
    {repositories.map((repo) => (
      <RepositoryCard key={repo.id} repository={repo} />
    ))}
  </div>
);
```

#### Knowledge Graph

**File:** `/src/components/knowledge-graph/Universe/GitSeeScene/index.tsx`

```typescript
// Current
return workspace.repositories[0].name;

// Multi-repo: Support selecting or showing multiple
const [selectedRepo, setSelectedRepo] = useState(workspace.repositories[0]);
return selectedRepo?.name || 'Select Repository';
```

#### Stakgraph Settings Form

Already supports multiple repositories in UI. Backend operations need to use all repos.

---

### 9. API Contract Changes

| API | Current | Multi-Repo Change |
|-----|---------|-------------------|
| `POST /api/swarm/stakgraph/ingest` | Single repo via `getPrimaryRepository()` | Build comma-separated `repo_url` from all repos; optionally accept `repositoryId` to ingest single repo |
| `POST /api/swarm/stakgraph/sync` | Single repo via `getPrimaryRepository()` | Add optional `repositoryId` param (sync only supports single repo - no comma-separated URLs) |
| `GET /api/workspaces/[slug]/stakgraph` | Returns settings | Include per-repo ingestion status |
| `POST /api/pool-manager/create-pool` | Single repo | Add `additional_repositories` array |
| `POST /api/tasks` | Optional `repositoryId` | Ensure UI allows selecting repo |
| `POST /api/janitor-configs/[id]/runs` | No repo param | Add optional `repositoryId` |

---

## External Service Dependencies

### 1. Stakgraph Microservice (port 7799)

**✅ Ingest:** Supports multi-repo via comma-separated URLs in `repo_url` parameter.

**⚠️ Sync:** Does NOT support multiple repos - only single `repo_url`. This is important because:
- Sync is triggered automatically via GitHub webhooks when code is pushed
- Each webhook event is for a specific repo, so this is naturally single-repo
- For multi-repo workspaces, we need to ensure the webhook identifies which repo changed and syncs only that one

**Remaining questions:**
- How are cross-repo relationships (imports, dependencies) handled in the graph?
- Does the ingest callback return status for each repo individually or all together?
- How does querying work across multiple ingested repos?

**Stakgraph service changes:**
- Ingest: No changes needed - just pass comma-separated URLs
- Sync: No changes needed - naturally single-repo per webhook event

### 2. Pool Manager Service

**Questions to verify:**
- Does `createPool` support multiple repository URLs?
- How are multiple repos cloned into a single pod filesystem?
- What's the directory structure for multi-repo pods?

**Required Pool Manager changes (if not supported):**
- Add `additional_repositories` parameter to `createPool`
- Clone all repos during pod provisioning
- Configure devcontainer for multi-repo workspace

### 3. repo2graph Service (port 3355)

**Questions to verify:**
- Can it query across multiple ingested repositories?
- How does context retrieval work for multi-repo?
- Are cross-repo references resolved?

---

## Implementation Phases

### Phase 1: Foundation (Non-Breaking)

**Goal:** Add infrastructure without breaking existing single-repo behavior

1. Add `getAllRepositories()` helper alongside `getPrimaryRepository()`
2. Add `SwarmRepository` join table (or array field) for tracking ingestion status
3. Update `Repository` model to track individual sync status
4. Add `repositoryId` to relevant API params as optional

**Estimated effort:** 1-2 days

### Phase 2: Stakgraph Multi-Repo

**Goal:** Enable ingesting and querying multiple repositories

1. Verify stakgraph service multi-repo capabilities
2. Update `/api/swarm/stakgraph/ingest` to process all repositories
3. Update `/api/swarm/stakgraph/sync` to handle specific or all repos
4. Update webhook callbacks to track per-repo status
5. Set up GitHub webhooks for all repositories

**Estimated effort:** 2-3 days

### Phase 3: Pod Multi-Repo

**Goal:** Clone and manage multiple repositories in pods

1. Verify Pool Manager multi-repo capabilities
2. Update pool creation to include all repositories
3. Update pod claiming to ensure all repos are cloned
4. Update `updatePodRepositories` calls to use all repos
5. Test pod repair with multiple repos

**Estimated effort:** 2-3 days

### Phase 4: Workflows & UI

**Goal:** Enable repo-aware task workflows and UI

1. Update task workflows to use `task.repositoryId` when set
2. Update janitor runs to support per-repo analysis
3. Update dashboard to show all repositories
4. Add repository selection in task creation UI
5. Update knowledge graph for multi-repo display

**Estimated effort:** 3-4 days

---

## Testing Strategy

### Unit Tests

- `getAllRepositories()` helper function
- Multi-repo ingestion logic
- Task repository selection logic

### Integration Tests

- Multi-repo pool creation
- Multi-repo stakgraph ingestion
- Per-repo webhook callbacks
- Task creation with repository selection

### E2E Tests

- Add second repository to workspace
- Verify both repos are ingested
- Create task for specific repository
- Verify task context uses correct repo

---

## Migration Notes

### Existing Workspaces

- Existing workspaces with single repos continue to work unchanged
- `getPrimaryRepository()` remains available for backward compatibility
- New multi-repo features are opt-in (add more repos to enable)

### Database Migration

```sql
-- Add SwarmRepository table
CREATE TABLE swarm_repositories (
  id VARCHAR(255) PRIMARY KEY,
  swarm_id VARCHAR(255) NOT NULL REFERENCES swarm(id) ON DELETE CASCADE,
  repository_id VARCHAR(255) NOT NULL REFERENCES repository(id) ON DELETE CASCADE,
  status VARCHAR(50) DEFAULT 'PENDING',
  last_synced_at TIMESTAMP,
  ingest_ref_id VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(swarm_id, repository_id)
);

-- Add repositoryId to janitor_runs (optional)
ALTER TABLE janitor_runs ADD COLUMN repository_id VARCHAR(255) REFERENCES repository(id);
```

---

## Open Questions

1. ~~**Stakgraph service:** Does it already support multi-repo, or does the external service need updates?~~
   **ANSWERED:** Yes, stakgraph supports multi-repo via comma-separated URLs in `repo_url` parameter.

2. **Pool Manager service:** Does it support cloning multiple repos, or does it need updates?

3. **Cross-repo context:** For AI tasks, should code context include:
   - Only the task's associated repository?
   - All repositories in the workspace?
   - User-selectable repositories?

4. **Janitor scope:** Should janitors:
   - Run separately per repository (multiple runs)?
   - Analyze all repositories together (single run)?

5. **UI priority:** Which views need multi-repo support first?
   - Dashboard (show all repos)
   - Task creation (select repo)
   - Knowledge graph (multi-repo view)

---

## Files Changed Summary

| Category | Files |
|----------|-------|
| Schema | `prisma/schema.prisma` |
| Helpers | `src/lib/helpers/repository.ts` |
| Stakgraph | `src/services/swarm/stakgraph-actions.ts`, `src/app/api/swarm/stakgraph/ingest/route.ts`, `src/app/api/swarm/stakgraph/sync/route.ts` |
| Pool Manager | `src/app/api/pool-manager/create-pool/route.ts`, `src/types/pool-manager.ts` |
| Tasks | `src/services/task-workflow.ts`, `src/services/stakwork-run.ts` |
| Janitors | `src/services/janitor.ts` |
| GitHub | `src/app/api/workspaces/[slug]/stakgraph/route.ts`, `src/services/github/WebhookService.ts` |
| UI | `src/components/dashboard/repository-card/index.tsx`, `src/components/knowledge-graph/Universe/GitSeeScene/index.tsx` |
| Types | `src/types/pool-manager.ts` |
