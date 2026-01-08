# Knowledge Provenance Plan

## Overview
Add a simple tree-view sidebar to DashboardChat showing the knowledge sources (Concepts → Files → Code entities) used to answer user questions.

## UX Design

### Layout
- Right sidebar next to chat messages (collapsible)
- Tree view with 3 levels:
  1. **Concepts** (Feature nodes)
  2. **Files** (linked via CONTAINS edges)
  3. **Code Entities** (Functions, Components, Endpoints, Datamodels within those files)

### Visual Elements
- tree nodes - nice sleek lines between them. modern minimalist but pretty design
- just show the name, dont need to list node type. And line number for code nodes.
- Icons for node types (really nice icons ... each one different color slightly. not bright colors but subtle professional looking)
  - Concept/Feature
  - File
  - Function
  - Component (Page)
  - Endpoint
  - Datamodel
  - Test (UnitTest, IntegrationTest, E2etest)
- Click behavior:
  - File: Open in GitHub or expand to show code entities
  - Code entity: Jump to line in GitHub

### When to Show
- Appears after AI response completes streaming
- Only shows if provenance data is available
- Empty state: "No sources used" (shouldn't happen often)

---

## Frontend Implementation

### 1. New Component: `ProvenanceTree.tsx`

**Location:** `/src/components/dashboard/DashboardChat/ProvenanceTree.tsx`

**Props:**
```typescript

/**
 * Code entity in provenance response
 */
export interface ProvenanceCodeEntity {
  refId: string;
  name: string;
  nodeType:
    | "Function"
    | "Page"
    | "Endpoint"
    | "Datamodel"
    | "UnitTest"
    | "IntegrationTest"
    | "E2etest";
  file: string;
  start: number;
  end: number;
}

/**
 * File with code entities in provenance response
 */
export interface ProvenanceFile {
  refId: string;
  name: string;
  path: string;
  codeEntities: ProvenanceCodeEntity[];
}

/**
 * Concept with files in provenance response
 */
export interface ProvenanceConcept {
  id: string; // Feature ID (slug, e.g., "auth-system")
  name: string;
  description?: string;
  files: ProvenanceFile[];
}

/**
 * Response from /gitree/provenance endpoint
 */
export interface ProvenanceResponse {
  concepts: ProvenanceConcept[];
}

```

**Implementation:**
- Use shadcn/ui Collapsible component for tree nodes (but by default all nodes showing)
- GitHub links: `https://github.com/{owner}/{repo}/blob/{branch}/{filePath}#L{lineNumber}`
- Loading skeleton while provenance is being fetched

### 2. Update `DashboardChat/index.tsx`

**Changes:**
1. Add state for provenance:
   ```typescript
   const [provenanceData, setProvenanceData] = useState<ProvenanceData | null>(null);
   const [isLoadingProvenance, setIsLoadingProvenance] = useState(false);
   ```

2. Subscribe to Pusher event `PROVENANCE_DATA`:
   ```typescript
   channel.bind(PUSHER_EVENTS.PROVENANCE_DATA, (payload: {
     messageId: string;
     provenance: ProvenanceData;
   }) => {
     setProvenanceData(payload.provenance);
     setIsLoadingProvenance(false);
   });
   ```

3. Clear provenance when user sends new message:
   ```typescript
   const handleSend = async (content: string, clearInput: () => void) => {
     setProvenanceData(null); // Clear previous provenance
     // ... rest of existing logic
   }
   ```

4. Add ProvenanceTree to layout:
   ```tsx
   <div className="flex gap-4">
     <div className="flex-1">
       {/* Existing chat messages */}
     </div>
     {provenanceData && (
       <div className="w-80 border-l pl-4">
         <ProvenanceTree
           provenanceData={provenanceData}
           isLoading={isLoadingProvenance}
         />
       </div>
     )}
   </div>
   ```

---

## Backend Implementation

### 1. Update `/src/app/api/ask/quick/route.ts`

**After streaming completes:**

Add to the `after()` block (after follow-up questions):

```typescript
after(async () => {
  // ... existing follow-up questions code ...

  // Generate provenance
  try {
    // Extract concept IDs from tool calls during the conversation
    const conceptIds = extractConceptIdsFromResult(result);

    if (conceptIds.length > 0) {
      // Fetch provenance from stakgraph
      const provenance = await fetchProvenance(
        baseSwarmUrl,
        decryptedSwarmApiKey,
        conceptIds
      );

      // Send via Pusher
      const channelName = getWorkspaceChannelName(workspaceSlug);
      await pusherServer.trigger(
        channelName,
        PUSHER_EVENTS.PROVENANCE_DATA,
        {
          messageId: result.messageId,
          provenance,
          timestamp: Date.now(),
        }
      );
    }
  } catch (error) {
    console.error("❌ Error generating provenance:", error);
    // Silent failure - don't break the chat flow
  }
});
```

**Helper functions to add:**

```typescript
function extractConceptIdsFromResult(result: StreamTextResult): string[] {
  // Parse through result timeline to find learn_concept tool calls
  // Return array of unique concept ref_ids
}

async function fetchProvenance(
  swarmUrl: string,
  apiKey: string,
  conceptIds: string[]
): Promise<ProvenanceData> {
  const response = await fetch(`${swarmUrl}/gitree/provenance`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-token': apiKey,
    },
    body: JSON.stringify({ conceptIds }),
  });
  return response.json();
}
```

### 2. Add Pusher Event Constant

**Location:** `/src/lib/pusher.ts`

Add to `PUSHER_EVENTS`:
```typescript
export const PUSHER_EVENTS = {
  // ... existing events
  PROVENANCE_DATA: "provenance-data",
} as const;
```

---

## Stakgraph/MCP Backend Changes

### New Endpoint: `/gitree/provenance`

**Location:** `/stakgraph/mcp/src/routes/` (or wherever gitree routes are defined)

**Method:** POST

**Request body:**
```json
{
  "conceptIds": ["feature-ref-id-1", "feature-ref-id-2"]
}
```

**Response:**
```json
{
  "concepts": [
    {
      "refId": "feature-ref-id-1",
      "name": "Authentication System",
      "description": "OAuth and session management...",
      "files": [
        {
          "refId": "file-123",
          "name": "auth.ts",
          "path": "src/lib/auth.ts",
          "codeEntities": [
            {
              "refId": "func-456",
              "name": "getSession",
              "nodeType": "Function",
              "file": "src/lib/auth.ts",
              "start": 45,
              "end": 60
            }
          ]
        }
      ]
    }
  ]
}
```

### Implementation Strategy



## Implementation Steps

### Phase 1: Backend Foundation
1. [DONE] Add `/gitree/provenance` endpoint to stakgraph/mcp
   - Implement Cypher query
   - Add text matching for entity names in Feature docs
   - Test with sample conceptIds
2. Add `PROVENANCE_DATA` Pusher event constant
3. Update `/api/ask/quick/route.ts`:
   - Add `extractConceptIdsFromResult()` helper
   - Add `fetchProvenance()` helper
   - Add provenance fetch to `after()` block

### Phase 2: Frontend Components
1. Create `ProvenanceTree.tsx` component:
   - Tree view with Collapsible components
   - Icons for different node types
   - GitHub link generation
   - Loading states
2. Update `DashboardChat/index.tsx`:
   - Add provenance state
   - Subscribe to Pusher event
   - Integrate ProvenanceTree component
   - Layout adjustments (flex with sidebar)

### Phase 3: Polish
1. Add empty states and error handling
2. Add animation for provenance panel appearing
3. Add collapse/expand all functionality
4. Mobile responsive behavior (maybe hide by default on mobile)
5. Add tests

---

## Open Questions

1. **Repository info:** Do we need to pass repository info (owner/repo/branch) for GitHub links?
   - Can get from workspace → swarm → repository
   - Should cache this in component state

2. **Multiple concepts:** If AI uses multiple concepts, show all in tree?
   - Yes, show all with clear separation

3. **No provenance:** What if AI doesn't call any concept tools?
   - Don't show sidebar at all
   - This is fine - means answer was from general knowledge

4. **Performance:** What if a concept has 100+ files?
   - Limit to top 20 most relevant files
   - Add "Show more" button

5. **Text matching accuracy:** How to handle partial matches?
   - Use word boundaries: `\b${entityName}\b`
   - Case-insensitive
   - Could add fuzzy matching later if needed

---

## Success Metrics

- Users can trace answer sources in ≤3 clicks
- Provenance loads within 2 seconds of answer completing
- <5% error rate on provenance data fetch
- Code entity links open correct GitHub location
