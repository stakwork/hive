# Repository Sync Configuration

This document describes the configurable repository sync settings added to control code ingestion behavior per repository.

## Overview

Repositories now have three configuration flags that control how they interact with the swarm (stakgraph) and pod systems:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `codeIngestionEnabled` | Boolean | `true` | Whether to sync code to stakgraph |
| `docsEnabled` | Boolean | `true` | Whether to generate docs on ingest/sync |
| `mocksEnabled` | Boolean | `false` | Whether to generate mocks on ingest/sync |

## Behavior

### `codeIngestionEnabled`

Controls whether a repository participates in code ingestion and automatic syncing:

- **When `true` (default)**:
  - Repository is ingested to stakgraph
  - GitHub webhook is created for automatic sync on push
  - Push events trigger `triggerAsyncSync` to keep code up to date

- **When `false`**:
  - Repository is still created on pods (via `updatePodRepositories`)
  - No stakgraph ingestion occurs
  - No GitHub webhook is set up
  - Push events are ignored (early return with 202)

### `docsEnabled` and `mocksEnabled`

These flags control optional processing during ingestion and sync:

- Passed to swarm's `/ingest_async` and `/sync_async` endpoints
- For single-repo operations: passed as `true` if enabled
- For multi-repo operations:
  - If all repos have the flag enabled: `true`
  - If some repos have it enabled: comma-separated list of repo names (e.g., `"api,web"`)
  - If no repos have it enabled: omitted from request

## Database Schema

```prisma
model Repository {
  // ... existing fields ...
  
  // Sync configuration
  codeIngestionEnabled Boolean @default(true)  @map("code_ingestion_enabled")
  docsEnabled          Boolean @default(true)  @map("docs_enabled")
  mocksEnabled         Boolean @default(false) @map("mocks_enabled")
}
```

## Migration

Migration `20260203150000_add_repository_sync_config` adds these columns with defaults:

```sql
ALTER TABLE "repositories" ADD COLUMN "code_ingestion_enabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "repositories" ADD COLUMN "docs_enabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "repositories" ADD COLUMN "mocks_enabled" BOOLEAN NOT NULL DEFAULT false;
```

All existing repositories automatically receive `codeIngestionEnabled=true`, `docsEnabled=true`, `mocksEnabled=false` - maintaining existing behavior.

## API Changes

### Stakgraph Actions (`src/services/swarm/stakgraph-actions.ts`)

New `SyncOptions` interface:

```typescript
export interface SyncOptions {
  docs?: boolean | string;   // true = all repos, string = comma-separated repo names
  mocks?: boolean | string;  // true = all repos, string = comma-separated repo names
}
```

Updated function signatures:

```typescript
export async function triggerAsyncSync(
  swarmHost: string,
  apiKey: string,
  repoUrl: string,
  creds?: Creds,
  callbackUrl?: string,
  useLsp?: boolean,
  options?: SyncOptions,  // NEW
): Promise<AsyncSyncResult>

export async function triggerIngestAsync(
  swarmName: string,
  apiKey: string,
  repoUrl: string,
  creds: { username: string; pat: string },
  callbackUrl?: string,
  useLsp?: boolean,
  options?: SyncOptions,  // NEW
)
```

## Affected Routes

### Ingest Route (`/api/swarm/stakgraph/ingest`)

1. Filters repositories to only include those with `codeIngestionEnabled === true`
2. Returns 400 if no repositories have code ingestion enabled
3. Builds `docs` and `mocks` params based on per-repo settings
4. Only sets up GitHub webhooks for repos with code ingestion enabled
5. Passes `SyncOptions` to `triggerIngestAsync`

### Webhook Route (`/api/github/webhook/[workspaceId]`)

1. Fetches `codeIngestionEnabled`, `docsEnabled`, `mocksEnabled` with repository
2. Early returns with 202 on push events if `codeIngestionEnabled === false`
3. Passes `SyncOptions` to `triggerAsyncSync` based on repo settings

### Pod Creation (unchanged)

All repositories are still sent to `updatePodRepositories` regardless of `codeIngestionEnabled` setting. This allows repos to be cloned on pods even if they don't participate in stakgraph ingestion.

## Use Cases

1. **Code-only repo**: `codeIngestionEnabled=true`, `docsEnabled=false`, `mocksEnabled=false`
   - Syncs code to stakgraph but skips docs/mocks generation

2. **Pod-only repo**: `codeIngestionEnabled=false`
   - Repository cloned on pods but not indexed in stakgraph
   - Useful for dependency repos or repos that don't need AI analysis

3. **Full processing**: `codeIngestionEnabled=true`, `docsEnabled=true`, `mocksEnabled=true`
   - Complete ingestion with docs and mocks generation

## Files Modified

- `prisma/schema.prisma` - Added 3 new fields to Repository model
- `prisma/migrations/20260203150000_add_repository_sync_config/migration.sql` - Migration
- `src/lib/helpers/repository.ts` - Updated `RepositoryInfo` type and queries
- `src/services/swarm/stakgraph-actions.ts` - Added `SyncOptions` and updated functions
- `src/app/api/swarm/stakgraph/ingest/route.ts` - Filtering and options logic
- `src/app/api/github/webhook/[workspaceId]/route.ts` - Early return and options logic
