# Stakgraph Mock Endpoints

This document describes the mock implementation of the Stakgraph service, which handles code repository ingestion and synchronization.

## Overview

The Stakgraph service (port 7799) is a swarm microservice that:
- Ingests code repositories from GitHub
- Parses and indexes code for AI analysis
- Provides LSP (Language Server Protocol) support
- Notifies via webhooks when complete

## Enabling Mock Mode

Set `USE_MOCKS=true` to automatically route Stakgraph calls to local mocks:

```bash
# .env.local
USE_MOCKS=true
```

## Mock Endpoints

### 1. Ingest Async

**POST** `/api/mock/stakgraph/ingest_async`

Starts asynchronous code ingestion.

**Request:**
```json
{
  "repo_url": "https://github.com/owner/repo",
  "username": "github-username",
  "pat": "github-token",
  "callback_url": "https://app.example.com/api/webhook",
  "use_lsp": false,
  "realtime": true
}
```

**Response:**
```json
{
  "request_id": "req-000001",
  "status": "pending",
  "message": "Ingestion started"
}
```

### 2. Sync Async

**POST** `/api/mock/stakgraph/sync_async`

Syncs an existing repository (incremental update).

**Request:**
```json
{
  "repo_url": "https://github.com/owner/repo",
  "username": "github-username",
  "pat": "github-token",
  "callback_url": "https://app.example.com/api/webhook",
  "use_lsp": false
}
```

**Response:**
```json
{
  "request_id": "req-000002",
  "status": "pending",
  "message": "Sync started"
}
```

### 3. Sync (Blocking)

**POST** `/api/mock/stakgraph/sync`

Blocking sync operation (returns after completion).

**Request:**
```json
{
  "repo_url": "https://github.com/owner/repo",
  "username": "github-username",
  "use_lsp": false
}
```

**Response:**
```json
{
  "status": "completed",
  "message": "Sync completed successfully",
  "repo_url": "https://github.com/owner/repo"
}
```

### 4. Check Status

**GET** `/api/mock/stakgraph/status/{request_id}`

Check the status of an ingestion/sync request.

**Response:**
```json
{
  "request_id": "req-000001",
  "status": "completed",
  "progress": 100,
  "repo_url": "https://github.com/owner/repo",
  "created_at": "2024-12-03T10:00:00.000Z",
  "completed_at": "2024-12-03T10:00:07.000Z"
}
```

## Status Transitions

The mock simulates realistic ingestion with these status transitions:

1. **PENDING** (0%) - Request created
2. **PROCESSING** (10%) - Started (1s delay)
3. **PROCESSING** (30%) - Cloning repository (2s delay)
4. **PROCESSING** (60%) - Parsing code (2s delay)
5. **PROCESSING** (90%) - Building index (1.5s delay)
6. **COMPLETED** (100%) - Done (0.5s delay)

Total mock ingestion time: ~7 seconds

## Auto-Creation Behavior

The mock auto-creates resources on demand:
- Unknown request IDs return as "completed" with mock data
- This ensures tests don't fail due to missing seed data
- Production behavior requires explicit request creation

## Architecture

### State Manager

**File:** `src/lib/mock/stakgraph-state.ts`

Singleton state manager that:
- Tracks all ingestion requests in memory
- Simulates async status transitions with setTimeout
- Auto-creates missing requests for test resilience
- Provides reset() method for test isolation

### URL Resolution

**File:** `src/lib/utils/stakgraph-url.ts`

Helper function that routes requests:
- `USE_MOCKS=true` → `http://localhost:3000/api/mock/stakgraph`
- `USE_MOCKS=false` → `https://{swarmName}:7799`

### Service Integration

**Files:**
- `src/services/swarm/stakgraph-actions.ts` - Updated to use URL helper
- `src/app/api/swarm/stakgraph/status/route.ts` - Updated to use URL helper

All Stakgraph service calls now route through the centralized URL helper, enabling transparent mock switching.

## Testing

### Manual Testing

```typescript
// Start ingestion
const response = await fetch('/api/swarm/stakgraph/ingest', {
  method: 'POST',
  body: JSON.stringify({
    workspaceId: 'workspace-123',
    useLsp: false,
  }),
});

const { request_id } = await response.json();

// Poll for completion
const checkStatus = async () => {
  const status = await fetch(
    `/api/swarm/stakgraph/status?id=${workspaceId}&requestId=${request_id}`
  );
  return status.json();
};
```

### Test Isolation

```typescript
import { stakgraphState } from "@/lib/mock/stakgraph-state";

beforeEach(() => {
  stakgraphState.reset();
});
```

## Integration with Existing Mocks

The Stakgraph mock follows the same patterns as:
- **Pool Manager** - Pod lifecycle management
- **Stakwork** - Workflow execution with webhooks
- **Swarm Super Admin** - Swarm provisioning
- **GitHub** - API simulation

All use the same `USE_MOCKS` flag and state manager pattern.

## Development Workflow

1. Set `USE_MOCKS=true` in `.env.local`
2. Start dev server: `npm run dev`
3. Create workspace and add repository
4. Trigger ingestion - routes to mock automatically
5. Verify status updates every ~2 seconds
6. Check database for Repository.status updates

## Future Enhancements

- **GitSee Mock** (port 3355) - Git visualization
- **Webhook Callbacks** - Actually trigger callbacks instead of logging
- **Error Simulation** - Add failure scenarios for testing
- **Performance Metrics** - Track mock call patterns