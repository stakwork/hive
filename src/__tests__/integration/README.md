# Integration Tests

This directory contains integration tests that verify the interaction between multiple components and external services.

## Test Structure

### `/api/swarm/stakgraph/ingest.test.ts`

Comprehensive integration tests for the POST `/api/swarm/stakgraph/ingest` endpoint covering:

- **Code Ingestion**: Verifies the endpoint correctly triggers code ingestion via `triggerIngestAsync`
- **Repository Management**: Tests repository upsertion with proper status handling
- **GitHub Webhook Setup**: Validates webhook creation and configuration
- **Swarm Updates**: Ensures swarm `ingestRefId` is properly updated
- **Error Handling**: Comprehensive testing of all failure scenarios and edge cases

## Running Tests

### All Integration Tests
```bash
npm run test:integration
```

### Watch Mode
```bash
npm run test:integration:watch
```

### With Coverage
```bash
npm run test:coverage
```

### Test Database Setup

Integration tests require a test database. Use these commands:

```bash
# Start test database
npm run test:db:start

# Setup test database schema
npm run test:db:setup

# Reset test database
npm run test:db:reset

# Stop test database
npm run test:db:stop

# Run full integration test cycle
npm run test:integration:full
```

## Test Environment

Integration tests use:
- **Vitest** as the testing framework
- **Mocked dependencies** for external services (GitHub API, database operations)
- **Test environment** variables defined in test configuration
- **Isolated test database** for database operations

## Key Testing Patterns

### 1. External Service Mocking
```typescript
// Mock external dependencies
vi.mock('@/lib/db');
vi.mock('@/services/swarm/stakgraph-actions');
vi.mock('@/services/github/WebhookService');

// Configure mocks in beforeEach
vi.mocked(triggerIngestAsync).mockResolvedValue({
  ok: true,
  status: 200,
  data: { request_id: 'test-123' }
});
```

### 2. Database Operation Testing
```typescript
// Verify repository upsertion
expect(db.repository.upsert).toHaveBeenCalledWith({
  where: {
    repositoryUrl_workspaceId: {
      repositoryUrl: 'https://github.com/owner/repo',
      workspaceId: 'workspace-123',
    },
  },
  update: { status: RepositoryStatus.PENDING },
  create: {
    name: 'repo',
    repositoryUrl: 'https://github.com/owner/repo',
    workspaceId: 'workspace-123',
    status: RepositoryStatus.PENDING,
    branch: 'main',
  },
});
```

### 3. Error Scenario Testing
```typescript
it('should handle database failures gracefully', async () => {
  vi.mocked(db.swarm.findFirst).mockRejectedValue(new Error('Database error'));
  
  const response = await POST(mockRequest);
  
  expect(response.status).toBe(500);
  expect(responseData.message).toBe('Failed to ingest code');
});
```

## Test Scenarios Covered

### Success Cases
- ✅ Valid requests with `workspaceId`
- ✅ Valid requests with `swarmId`
- ✅ Repository creation and updates
- ✅ GitHub webhook setup
- ✅ Swarm `ingestRefId` updates
- ✅ Handling missing GitHub credentials
- ✅ Webhook setup failures (non-blocking)

### Error Cases
- ✅ Authentication failures (401)
- ✅ Missing swarm (404)
- ✅ Invalid swarm configuration (400)
- ✅ Missing repository URL (400)
- ✅ Database operation failures (500)
- ✅ External API failures (500)
- ✅ Encryption service errors (500)

### Edge Cases
- ✅ Malformed request bodies
- ✅ Missing/null default branches
- ✅ Empty repository names
- ✅ Both `workspaceId` and `swarmId` provided
- ✅ Non-object API response data
- ✅ Partial GitHub credentials

## Adding New Integration Tests

1. **Create test file** in appropriate subdirectory
2. **Mock external dependencies** using `vi.mock()`
3. **Setup test data** in `beforeEach()` hooks
4. **Test both success and failure paths**
5. **Verify all side effects** (database calls, API calls, etc.)
6. **Include edge cases** and error scenarios
7. **Document test purpose** and expectations

## Best Practices

### Mock Strategy
- Mock all external dependencies (APIs, databases, services)
- Use realistic test data that matches production schemas
- Reset mocks between tests to ensure isolation

### Assertion Strategy
- Test both return values and side effects
- Verify the correct sequence of operations
- Check error handling and logging behavior

### Test Organization
- Group related tests using `describe()` blocks
- Use descriptive test names that explain the scenario
- Include both positive and negative test cases
- Test edge cases and boundary conditions

### Performance
- Keep tests focused and fast
- Minimize test setup complexity
- Use appropriate test timeouts for async operations