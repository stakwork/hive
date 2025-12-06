# Stakwork Mock Endpoints Documentation

This document describes the mock endpoints for the Stakwork service, which simulates AI-powered workflow execution, code generation, planning, and deep research capabilities.

## Overview

When `USE_MOCKS=true`, all Stakwork API calls are routed to `http://localhost:3000/api/mock/stakwork/*`.

**State Manager**: `src/lib/mock/stakwork-state.ts`

**Endpoints Directory**: `src/app/api/mock/stakwork/`

## Features

- **Workflow Execution**: Project creation and status tracking
- **Code Generation**: AI-powered code generation with file output
- **Planning Analysis**: Task breakdown and project planning
- **Deep Research**: Codebase analysis with insights and recommendations
- **Webhook Support**: Async notifications for all operations
- **Realistic Delays**: Multi-stage processing simulation (3-12 seconds)

## Endpoints

### 1. Create Project (Workflow Execution)

**Endpoint**: `POST /api/mock/stakwork/projects`

**Purpose**: Create a new Stakwork project for workflow execution

**Request Body**:
```json
{
  "name": "My Workflow",
  "description": "Workflow description",
  "workflow_type": "code_analysis",
  "webhook_url": "https://example.com/webhook"
}
```

**Response**:
```json
{
  "project_id": 10001,
  "name": "My Workflow",
  "workflow_state": "pending",
  "created_at": "2024-01-15T10:30:00Z"
}
```

**Behavior**:
- Auto-increments project ID starting at 10000
- Immediately transitions to `running` (triggers webhook)
- After 3 seconds, transitions to `complete` (triggers webhook)
- Stores webhook URL for callbacks

**Workflow States**: `pending` → `running` (immediate) → `complete` (3s)

---

### 2. Get Project Status

**Endpoint**: `GET /api/mock/stakwork/projects/[projectId]`

**Purpose**: Check workflow execution status

**Response**:
```json
{
  "project_id": 10001,
  "name": "My Workflow",
  "workflow_state": "complete",
  "created_at": "2024-01-15T10:30:00Z",
  "updated_at": "2024-01-15T10:30:03Z"
}
```

---

### 3. AI Code Generation

**Endpoint**: `POST /api/mock/stakwork/generate`

**Purpose**: Generate code based on AI prompt

**Request Body**:
```json
{
  "prompt": "Create a React component for a user profile card with avatar and bio",
  "webhookUrl": "https://example.com/webhook"
}
```

**Response**:
```json
{
  "success": true,
  "requestId": "gen_1001",
  "status": "pending",
  "progress": 0,
  "message": "Code generation started"
}
```

**Behavior**:
- Generates unique request ID (e.g., `gen_1001`)
- Simulates multi-stage processing:
  - Stage 1: 20% progress (1s delay)
  - Stage 2: 50% progress (2s delay)
  - Stage 3: 80% progress (1.5s delay)
  - Complete: 100% progress (1s delay)
- Total time: ~5.5 seconds
- Generates realistic file structure with code, tests, and styles

**Result Structure** (when completed):
```json
{
  "files": [
    {
      "path": "src/components/NewFeature/index.tsx",
      "content": "// Generated TypeScript code...",
      "language": "typescript"
    },
    {
      "path": "src/components/NewFeature/NewFeature.test.tsx",
      "content": "// Generated test code...",
      "language": "typescript"
    },
    {
      "path": "src/components/NewFeature/styles.module.css",
      "content": "/* Generated CSS... */",
      "language": "css"
    }
  ],
  "summary": "Generated a new React component with TypeScript, tests, and styles...",
  "estimatedEffort": "2-4 hours for integration and refinement"
}
```

---

### 4. Check Generation Status

**Endpoint**: `GET /api/mock/stakwork/generate?requestId=gen_1001`

**Purpose**: Poll for code generation progress and results

**Response** (in progress):
```json
{
  "success": true,
  "requestId": "gen_1001",
  "status": "processing",
  "progress": 50,
  "createdAt": "2024-01-15T10:30:00Z"
}
```

**Response** (completed):
```json
{
  "success": true,
  "requestId": "gen_1001",
  "status": "completed",
  "progress": 100,
  "result": {
    "files": [...],
    "summary": "...",
    "estimatedEffort": "..."
  },
  "createdAt": "2024-01-15T10:30:00Z",
  "completedAt": "2024-01-15T10:30:05Z"
}
```

---

### 5. AI Planning Analysis

**Endpoint**: `POST /api/mock/stakwork/plan`

**Purpose**: Generate project plan with task breakdown

**Request Body**:
```json
{
  "description": "Build a user authentication system with OAuth and email verification",
  "webhookUrl": "https://example.com/webhook"
}
```

**Response**:
```json
{
  "success": true,
  "requestId": "plan_1001",
  "status": "pending",
  "progress": 0,
  "message": "Planning analysis started"
}
```

**Behavior**:
- Generates unique request ID (e.g., `plan_1001`)
- Simulates multi-stage processing:
  - Stage 1: 25% progress (1.5s delay)
  - Stage 2: 60% progress (2s delay)
  - Stage 3: 85% progress (1.5s delay)
  - Complete: 100% progress (1s delay)
- Total time: ~6 seconds
- Generates comprehensive task breakdown with dependencies

**Result Structure** (when completed):
```json
{
  "tasks": [
    {
      "id": "task_001",
      "title": "Setup project infrastructure",
      "description": "Initialize repository, configure build tools...",
      "priority": "high",
      "estimatedHours": 8,
      "dependencies": []
    },
    {
      "id": "task_002",
      "title": "Design database schema",
      "description": "Create entity-relationship diagrams...",
      "priority": "high",
      "estimatedHours": 6,
      "dependencies": ["task_001"]
    }
    // ... 6 more tasks
  ],
  "phases": [
    {
      "name": "Foundation",
      "taskIds": ["task_001", "task_002"],
      "duration": "1-2 weeks"
    }
    // ... 2 more phases
  ],
  "summary": "Comprehensive development plan with 8 tasks across 3 phases...",
  "totalEstimatedHours": 92
}
```

---

### 6. Check Planning Status

**Endpoint**: `GET /api/mock/stakwork/plan?requestId=plan_1001`

**Purpose**: Poll for planning progress and results

**Response** (completed):
```json
{
  "success": true,
  "requestId": "plan_1001",
  "status": "completed",
  "progress": 100,
  "result": {
    "tasks": [...],
    "phases": [...],
    "summary": "...",
    "totalEstimatedHours": 92
  },
  "createdAt": "2024-01-15T10:30:00Z",
  "completedAt": "2024-01-15T10:30:06Z"
}
```

---

### 7. Deep Research Analysis

**Endpoint**: `POST /api/mock/stakwork/research`

**Purpose**: Initiate deep codebase research and analysis

**Request Body**:
```json
{
  "topic": "Performance optimization opportunities",
  "webhookUrl": "https://example.com/webhook"
}
```

**Response**:
```json
{
  "success": true,
  "requestId": "research_1001",
  "status": "pending",
  "progress": 0,
  "message": "Deep research started"
}
```

**Behavior**:
- Generates unique request ID (e.g., `research_1001`)
- Simulates deep research stages:
  - Stage 1: 15% progress (2s delay)
  - Stage 2: 35% progress (2.5s delay)
  - Stage 3: 55% progress (2s delay)
  - Stage 4: 75% progress (2.5s delay)
  - Stage 5: 90% progress (2s delay)
  - Complete: 100% progress (1.5s delay)
- Total time: ~12.5 seconds
- Generates insights with confidence scores and recommendations

**Result Structure** (when completed):
```json
{
  "insights": [
    {
      "title": "Code Architecture Patterns",
      "description": "The codebase follows a modular architecture...",
      "confidence": 0.92,
      "sources": ["src/components/*", "src/lib/*", "Architecture documentation"]
    }
    // ... 4 more insights
  ],
  "recommendations": [
    {
      "title": "Implement Database Query Optimization",
      "description": "Refactor dashboard queries to use JOIN operations...",
      "priority": "high",
      "effort": "medium"
    }
    // ... 4 more recommendations
  ],
  "summary": "Deep research analysis reveals a well-structured codebase...",
  "keyFindings": [
    "Modular architecture with clear separation of concerns",
    "68% test coverage with gaps in error handling",
    "Database query optimization needed for dashboard"
  ]
}
```

---

### 8. Get Research Results

**Endpoint**: `GET /api/mock/stakwork/research/[id]`

**Purpose**: Retrieve deep research analysis results

**Response**:
```json
{
  "success": true,
  "requestId": "research_1001",
  "topic": "Performance optimization opportunities",
  "status": "completed",
  "progress": 100,
  "result": {
    "insights": [...],
    "recommendations": [...],
    "summary": "...",
    "keyFindings": [...]
  },
  "createdAt": "2024-01-15T10:30:00Z",
  "completedAt": "2024-01-15T10:30:12Z"
}
```

---

### 9. Create Customer

**Endpoint**: `POST /api/mock/stakwork/customers`

**Purpose**: Create customer account for billing/auth

**Request Body**:
```json
{
  "name": "Acme Corp",
  "email": "contact@acme.com"
}
```

**Response**:
```json
{
  "customer_id": "cust_abc123",
  "name": "Acme Corp",
  "email": "contact@acme.com",
  "api_key": "sk_mock_abc123xyz",
  "created_at": "2024-01-15T10:30:00Z"
}
```

---

### 10. Manage Secrets

**Endpoint**: `POST /api/mock/stakwork/secrets`

**Purpose**: Store encrypted secrets for workflows

**Request Body**:
```json
{
  "key": "GITHUB_TOKEN",
  "value": "ghp_xxxxxxxxxxxx"
}
```

**Response**:
```json
{
  "secret_id": "sec_abc123",
  "key": "GITHUB_TOKEN",
  "created_at": "2024-01-15T10:30:00Z"
}
```

---

## Webhook Callbacks

All async operations (generate, plan, research) support webhook notifications:

**Webhook Payload** (on completion):
```json
{
  "type": "generate.completed",
  "requestId": "gen_1001",
  "status": "completed",
  "result": {
    // Operation-specific result data
  }
}
```

**Webhook Types**:
- `generate.completed` - Code generation finished
- `plan.completed` - Planning analysis finished
- `research.completed` - Deep research finished

---

## Status Values

All async operations use these status values:
- `pending` - Request received, not started
- `processing` - Actively processing
- `completed` - Successfully completed
- `failed` - Operation failed

---

## State Management

**State Manager**: `MockStakworkStateManager` (`src/lib/mock/stakwork-state.ts`)

**Tracked State**:
```typescript
- projects: Map<number, MockStakworkProject>
- customers: Map<string, MockStakworkCustomer>
- secrets: Map<string, MockStakworkSecret>
- generateRequests: Map<string, MockGenerateRequest>
- planRequests: Map<string, MockPlanRequest>
- researchData: Map<string, MockResearchData>
- webhookCallbacks: Map<number, string>
```

**Reset for Testing**:
```typescript
mockStakworkState.reset();
```

---

## Usage Examples

### Example 1: Code Generation Flow

```typescript
// 1. Initiate generation
const response = await fetch('/api/mock/stakwork/generate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    prompt: 'Create a login form component',
    webhookUrl: 'https://myapp.com/webhook'
  })
});
const { requestId } = await response.json();

// 2. Poll for status
const checkStatus = async () => {
  const statusResponse = await fetch(
    `/api/mock/stakwork/generate?requestId=${requestId}`
  );
  const data = await statusResponse.json();
  
  if (data.status === 'completed') {
    console.log('Generated files:', data.result.files);
  } else {
    console.log(`Progress: ${data.progress}%`);
    setTimeout(checkStatus, 1000);
  }
};

checkStatus();
```

### Example 2: Planning with Webhook

```typescript
// Initiate planning
await fetch('/api/mock/stakwork/plan', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    description: 'Build e-commerce checkout',
    webhookUrl: 'https://myapp.com/webhook/plan'
  })
});

// Webhook endpoint receives notification when complete
// POST https://myapp.com/webhook/plan
// {
//   "type": "plan.completed",
//   "requestId": "plan_1001",
//   "status": "completed",
//   "result": { tasks: [...], phases: [...] }
// }
```

### Example 3: Deep Research

```typescript
// Initiate research
const response = await fetch('/api/mock/stakwork/research', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    topic: 'Security vulnerabilities',
    webhookUrl: 'https://myapp.com/webhook/research'
  })
});
const { requestId } = await response.json();

// Later, retrieve results
const results = await fetch(`/api/mock/stakwork/research/${requestId}`);
const { result } = await results.json();

console.log('Insights:', result.insights);
console.log('Recommendations:', result.recommendations);
```

---

## Integration with Build/Plan Pages

When `USE_MOCKS=true`:

1. **Generate Button** → Calls `POST /api/mock/stakwork/generate`
2. **Plan Button** → Calls `POST /api/mock/stakwork/plan`
3. **Deep Research** → Calls `POST /api/mock/stakwork/research`
4. All operations return immediately with `requestId`
5. UI polls status endpoints or receives webhook notifications
6. Results display generated code, task plans, or research insights

---

## Configuration

Mock routing is configured in `src/config/env.ts`:

```typescript
STAKWORK_BASE_URL: USE_MOCKS
  ? `${MOCK_BASE}/api/mock/stakwork`
  : process.env.STAKWORK_BASE_URL || "https://api.stakwork.com/api/v1"
```

Enable with:
```bash
USE_MOCKS=true
```

---

## Summary

| Operation | Endpoint | Method | Time | Webhook |
|-----------|----------|--------|------|---------|
| Create Project | `/projects` | POST | 3s | ✅ |
| Get Project | `/projects/[id]` | GET | Immediate | - |
| Generate Code | `/generate` | POST | ~5.5s | ✅ |
| Check Generation | `/generate?requestId=...` | GET | Immediate | - |
| Plan Analysis | `/plan` | POST | ~6s | ✅ |
| Check Plan | `/plan?requestId=...` | GET | Immediate | - |
| Deep Research | `/research` | POST | ~12.5s | ✅ |
| Get Research | `/research/[id]` | GET | Immediate | - |
| Create Customer | `/customers` | POST | Immediate | - |
| Manage Secrets | `/secrets` | POST | Immediate | - |

**Total: 10 endpoints** supporting workflow execution, AI code generation, planning, and deep research.