# Jarvis Mock Endpoints

This document describes the mock endpoints created for the Jarvis dashboard and call summary pages.

## Dashboard Statistics Endpoint

### GET `/api/swarm/jarvis/stats`

Returns mock statistics about the knowledge graph for display on the dashboard.

**Query Parameters:**
- `id` (required): Workspace ID

**Response:**
```json
{
  "success": true,
  "data": {
    "function_nodes": 50,
    "variable_nodes": 50,
    "contributors": 3,
    "call_episodes": 5,
    "total_nodes": 108,
    "last_updated": "2024-11-09T03:00:00.000Z"
  }
}
```

**Usage Example:**
```typescript
const response = await fetch(`/api/swarm/jarvis/stats?id=${workspaceId}`);
const data = await response.json();
```

---

## Call Summary Topics Endpoint

### GET `/api/workspaces/[slug]/calls/[ref_id]/topics`

Returns mock topics discussed in a specific call/episode for the call summary page.

**URL Parameters:**
- `slug` (required): Workspace slug
- `ref_id` (required): Call/Episode reference ID

**Response:**
```json
{
  "topics": [
    {
      "id": "topic-1",
      "title": "Project Architecture",
      "description": "Discussion about the overall system architecture and design patterns being used in the project.",
      "timestamp": 120,
      "relevance_score": 0.95
    },
    {
      "id": "topic-2",
      "title": "Database Schema",
      "description": "Review of database schema changes and migration strategies for the upcoming release.",
      "timestamp": 450,
      "relevance_score": 0.88
    },
    {
      "id": "topic-3",
      "title": "API Endpoints",
      "description": "Planning and implementation details for new REST API endpoints and their authentication requirements.",
      "timestamp": 780,
      "relevance_score": 0.92
    },
    {
      "id": "topic-4",
      "title": "Testing Strategy",
      "description": "Discussion of unit testing, integration testing, and end-to-end testing approaches.",
      "timestamp": 1100,
      "relevance_score": 0.85
    },
    {
      "id": "topic-5",
      "title": "Deployment Pipeline",
      "description": "Review of CI/CD pipeline improvements and deployment automation strategies.",
      "timestamp": 1450,
      "relevance_score": 0.90
    }
  ],
  "total": 5
}
```

**Usage Example:**
```typescript
const response = await fetch(`/api/workspaces/${slug}/calls/${refId}/topics`);
const data = await response.json();
```

---

## Mock Data Details

### Dashboard Statistics
- **50 Function Nodes**: Represents functions in the codebase
- **50 Variable Nodes**: Represents variables in the codebase
- **3 Contributors**: Team members contributing to the project
- **5 Call Episodes**: Recorded calls/meetings

### Call Topics
Returns 5 diverse topics with:
- Unique IDs for tracking
- Descriptive titles and descriptions
- Timestamps (in seconds) indicating when the topic was discussed
- Relevance scores (0-1) indicating topic importance

---

## Integration Notes

### Dashboard Integration
To display these stats on the dashboard graph, you can create a widget component that:
1. Fetches data from `/api/swarm/jarvis/stats`
2. Displays the counts in an overlay or side panel
3. Updates periodically if needed

### Call Summary Integration
To display topics on the call detail page:
1. Fetch data from `/api/workspaces/[slug]/calls/[ref_id]/topics`
2. Display as a list or timeline
3. Optional: Link timestamps to video player for navigation

---

## Authentication

Both endpoints require authentication:
- User must have a valid session
- User must have access to the specified workspace
- Returns 401 if unauthorized, 403 if access denied

---

## Error Handling

Both endpoints return standard error responses:
```json
{
  "success": false,
  "message": "Error description",
  // or
  "error": "Error description"
}
```

Common status codes:
- `200`: Success
- `400`: Bad request (missing parameters)
- `401`: Unauthorized (no session)
- `403`: Forbidden (no workspace access)
- `404`: Not found (workspace not found)
- `500`: Internal server error
