# API Unit Tests

This directory contains unit tests for API route handlers.

## Test Coverage

### `/api/tasks` Endpoint

#### POST - Task Creation
**File:** `tasks.test.ts`  
**Coverage:** ✅ Comprehensive (15 test cases)

- Authentication validation (401 scenarios)
- Input validation (required fields, enums)
- Authorization (workspace access control)
- Entity validation (assignee, repository)
- Status mapping (`active` → `IN_PROGRESS`)
- Error handling
- Success scenarios

#### GET - Task Retrieval
**File:** `tasks-get.test.ts`  
**Coverage:** ✅ Comprehensive (40+ test cases)

- Authentication validation
- Authorization (workspace owner/member)
- Input validation (query parameters)
- Pagination (page, limit, boundaries)
- Query parameters (includeLatestMessage)
- Soft-delete filtering
- Relations loading
- hasActionArtifact flag logic
- Error handling
- Success scenarios

#### UPDATE/DELETE Operations
**Status:** ❌ Not Implemented

These endpoints do not exist in the codebase. Only a specialized title update endpoint exists:
- `PUT /api/tasks/[taskId]/title` - Uses API token auth (not NextAuth)
- Full UPDATE/DELETE operations need to be implemented first

## Test Patterns

### Shared Fixtures
**Location:** `src/__tests__/support/fixtures/task.ts`

Centralized test data builders following DRY principles:
- `createMockTask()` - Complete task with relations
- `createMinimalMockTask()` - Task without optional fields
- `createMockTaskList()` - List of tasks for pagination testing
- `createMockTaskWithActionArtifact()` - Task with workflow status
- `buildTasksQueryParams()` - Query string builder

### Mocking Strategy
All tests use Vitest mocks for:
- `next-auth/next` - Session management
- `@/lib/db` - Prisma database client
- `@/lib/auth/nextauth` - Auth configuration

### Assertion Helpers
**Location:** `src/__tests__/support/helpers/api-assertions.ts`

- `expectSuccess()` - Validates successful responses
- `expectError()` - Validates error messages
- `expectUnauthorized()` - 401 assertions
- `expectForbidden()` - 403 assertions
- `expectNotFound()` - 404 assertions

## Running Tests

```bash
# Run all unit tests
npm run test:unit

# Run specific test file
npm run test:unit tasks-get.test.ts

# Watch mode
npm run test:unit:watch

# With coverage
npm run test:coverage
```

## Next Steps

### Priority 1: Integration Tests
Create `src/__tests__/integration/api/tasks-operations.test.ts`:
- Real database interactions
- Foreign key constraint validation
- Cascade delete behavior
- Concurrent operations

### Priority 2: Implement UPDATE/DELETE
Before creating tests, implement:
- `PUT /api/tasks/[taskId]` - Full task update
- `DELETE /api/tasks/[taskId]` - Soft-delete operation

Use NextAuth session authentication (not API token) and follow POST endpoint patterns.

### Priority 3: E2E Tests
Create end-to-end tests for full user workflows:
- Task creation → retrieval → update → delete
- Workspace member permissions
- Real-time Pusher notifications
- External service integrations (Stakwork, GitHub)

## Test Principles

Following repository testing guidelines:

✅ **DRY** - Centralized fixtures, reusable builders  
✅ **Readable** - Descriptive test names, clear assertions  
✅ **Independent** - Isolated tests with fresh mocks  
✅ **Fast** - Unit tests with mocked dependencies  
✅ **Maintainable** - Consistent patterns across test files