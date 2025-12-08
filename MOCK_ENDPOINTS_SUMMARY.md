# Mock Endpoints Summary

## Created Endpoints

### 1. Dashboard Statistics Endpoint
**File:** `/src/app/api/swarm/jarvis/stats/route.ts`

**Endpoint:** `GET /api/swarm/jarvis/stats?id={workspaceId}`

**Returns:**
- 50 function nodes
- 50 variable nodes
- 3 contributors
- 5 call episodes
- Total nodes count
- Last updated timestamp

### 2. Call Summary Topics Endpoint
**File:** `/src/app/api/workspaces/[slug]/calls/[ref_id]/topics/route.ts`

**Endpoint:** `GET /api/workspaces/{slug}/calls/{ref_id}/topics`

**Returns:**
5 topics with:
- Project Architecture
- Database Schema
- API Endpoints
- Testing Strategy
- Deployment Pipeline

Each topic includes:
- ID
- Title
- Description
- Timestamp (when discussed in call)
- Relevance score

### 3. Dashboard Graph Nodes (UPDATED)
**File:** `/src/app/api/swarm/jarvis/nodes/route.ts`

**Endpoint:** `GET /api/swarm/jarvis/nodes?id={workspaceId}`

**What Changed:**
Added mock data fallback when swarm is not configured. The endpoint now returns:
- 50 function nodes (processData1-50)
- 50 variable nodes (config1-50)
- 3 person nodes (Alice Johnson, Bob Smith, Charlie Davis)
- 5 episode nodes (meetings/discussions)
- Edges connecting the nodes

**This fixes the issue where no nodes were showing on the dashboard!**

## Files Created/Modified

1. ✅ `/src/app/api/swarm/jarvis/stats/route.ts` - Dashboard stats endpoint
2. ✅ `/src/app/api/workspaces/[slug]/calls/[ref_id]/topics/route.ts` - Call topics endpoint
3. ✅ `/src/app/api/swarm/jarvis/nodes/route.ts` - **MODIFIED** to include mock data fallback
4. ✅ `/docs/JARVIS_MOCK_ENDPOINTS.md` - Complete documentation

## Features

- ✅ Authentication required for both endpoints
- ✅ Workspace access validation
- ✅ Proper error handling (401, 403, 404, 500)
- ✅ TypeScript types
- ✅ Formatted with Prettier
- ✅ Compatible with existing Next.js App Router structure
- ✅ **Mock data fallback for development when swarm not configured**

## Usage Examples

### Dashboard Stats
```typescript
const response = await fetch(`/api/swarm/jarvis/stats?id=${workspaceId}`);
const { data } = await response.json();
console.log(data.function_nodes); // 50
```

### Call Topics
```typescript
const response = await fetch(`/api/workspaces/${slug}/calls/${refId}/topics`);
const { topics } = await response.json();
console.log(topics.length); // 5
```

## Next Steps

To integrate these endpoints:

1. **Dashboard Page**: Add a widget component that fetches from `/api/swarm/jarvis/stats` and displays the counts
2. **Call Detail Page**: Add a topics section that fetches from `/api/workspaces/[slug]/calls/[ref_id]/topics` and displays the list

See `/docs/JARVIS_MOCK_ENDPOINTS.md` for complete documentation.

## Anthropic Claude API Mock

**Purpose:** Simulates Anthropic Claude API for AI-powered feature extraction, code generation, and chat assistance

**State Manager:** `src/lib/mock/anthropic-state.ts`

**Endpoints:** (2 endpoints)

- Messages API: `POST /api/mock/anthropic/v1/messages` (streaming & non-streaming)
- Models list: `GET /api/mock/anthropic/v1/models`

**Key Features:**

- Intelligent context-aware responses based on prompts
- Auto-generates feature specs, user stories, code assistance
- Supports both streaming and non-streaming modes
- Pattern-based response generation (no actual LLM)
- Simulates Vercel AI SDK integration

**State Management:**

```typescript
// Tracked state
- conversations: Map<string, MockConversation>
- requestCounter: number
- Model configurations for haiku, sonnet, opus
```

**Response Types:**

- Feature extraction from voice transcripts
- User story and acceptance criteria generation
- Phase and milestone planning
- Wake word detection
- Commit message generation
- Code assistance queries

**Integration:**

- Used through `src/lib/ai/provider.ts` wrapper
- Automatically enabled when `USE_MOCKS=true`
- All `aieo` library calls route to mock endpoints

**Documentation:** `docs/ANTHROPIC_MOCK_ENDPOINTS.md`
