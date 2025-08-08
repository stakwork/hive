# Tasks Feature Test Suite

This directory contains comprehensive unit and integration tests for the Tasks feature.

## Test Structure

```
src/__tests__/
├── utils/
│   ├── test-helpers.ts      # Common test utilities and helper functions
│   └── mock-data.ts         # Mock data fixtures and test constants
├── unit/
│   └── api/
│       └── tasks/
│           ├── get.test.ts  # Unit tests for GET /api/tasks endpoint
│           └── post.test.ts # Unit tests for POST /api/tasks endpoint
├── integration/
│   └── tasks/
│       ├── task-fetching.test.ts # Integration tests for task fetching workflow
│       └── task-creation.test.ts # Integration tests for task creation workflow
├── setup.ts                 # Global test setup and mocks
└── README.md               # This documentation file
```

## Test Categories

### Unit Tests

Unit tests focus on testing individual API endpoints in isolation with mocked dependencies.

#### GET /api/tasks (`src/__tests__/unit/api/tasks/get.test.ts`)
- **Authentication**: Session validation, user ID extraction
- **Request Validation**: Parameter validation, URL parsing
- **Workspace Authorization**: Owner/member access checks
- **Task Querying**: Database query structure, relationship includes
- **Error Handling**: Database failures, malformed requests
- **Edge Cases**: Null relationships, multiple parameters

#### POST /api/tasks (`src/__tests__/unit/api/tasks/post.test.ts`)
- **Authentication**: Session validation, user authorization
- **Request Validation**: Required fields, field trimming
- **Workspace Validation**: Workspace existence, access permissions
- **Status Validation**: Enum validation, 'active' → IN_PROGRESS mapping
- **Priority Validation**: Enum validation, default values
- **Assignee Validation**: User existence, deleted user exclusion
- **Repository Validation**: Repository existence, workspace ownership
- **Task Creation**: Database operations, relationship includes
- **Error Handling**: Validation failures, database errors

### Integration Tests

Integration tests validate complete end-to-end workflows using a real test database.

#### Task Fetching Workflow (`src/__tests__/integration/tasks/task-fetching.test.ts`)
- **Basic Fetching**: Owner and member access patterns
- **Relationship Loading**: Assignees, repositories, creators, counts
- **Authorization**: Member vs non-member access control
- **Data Filtering**: Deleted task exclusion, workspace isolation
- **Ordering**: Creation date sorting (newest first)
- **Complex Scenarios**: Multiple workspaces, bulk operations
- **Performance**: Large dataset handling

#### Task Creation Workflow (`src/__tests__/integration/tasks/task-creation.test.ts`)
- **Basic Creation**: Minimal and complete task creation
- **Authorization**: Owner/member permissions, non-member rejection
- **Status Mapping**: 'active' status to IN_PROGRESS conversion
- **Validation**: Field validation, relationship validation
- **Data Integrity**: Trimming, null handling, constraint validation
- **Complex Scenarios**: Concurrent creation, membership changes
- **Error Recovery**: Transaction failures, consistency maintenance

## Test Utilities

### Test Helpers (`src/__tests__/utils/test-helpers.ts`)
- **Session Mocking**: `mockGetServerSession()`, `mockSession()`
- **Database Helpers**: `createTestUser()`, `createTestWorkspace()`, `createTestTask()`
- **Request Mocking**: `mockNextRequest()`, `mockRequestWithBody()`
- **Response Assertions**: `expectSuccessResponse()`, `expectErrorResponse()`
- **Cleanup**: `cleanupDatabase()`, database teardown utilities
- **Console Mocking**: `mockConsole()` to reduce test noise

### Mock Data (`src/__tests__/utils/mock-data.ts`)
- **Users**: Owner, member, non-member, assignee fixtures
- **Workspaces**: Primary, secondary, deleted workspace data
- **Repositories**: Various repository configurations
- **Tasks**: Different status, priority, and relationship combinations
- **Payloads**: Valid and invalid request payloads
- **Responses**: Expected API response structures
- **URLs**: Test URL generation utilities

## Running Tests

### All Tests
```bash
npm test                    # Run all tests once
npm run test:watch          # Run all tests in watch mode
npm run test:coverage       # Run tests with coverage report
```

### Unit Tests Only
```bash
npm run test:unit           # Run unit tests once
npm run test:unit:watch     # Run unit tests in watch mode
```

### Integration Tests Only
```bash
npm run test:integration    # Run integration tests once
npm run test:integration:watch # Run integration tests in watch mode
```

### Full Integration Test Suite (with database)
```bash
npm run test:integration:full # Start test DB, run integration tests, stop DB
```

### Test Database Management
```bash
npm run test:db:start       # Start test database (Docker)
npm run test:db:stop        # Stop test database
npm run test:db:setup       # Set up test database schema
npm run test:db:cleanup     # Clean test database
npm run test:db:reset       # Reset test database (cleanup + setup)
```

## Test Configuration

### Environment Variables
```bash
NODE_ENV=test
TEST_SUITE=integration     # Set for integration tests
DATABASE_URL=postgresql://test:test@localhost:5432/test_db
NEXTAUTH_SECRET=test-secret
```

### Vitest Configuration (`vitest.config.ts`)
- **Environment**: jsdom for React component compatibility
- **Timeouts**: 10s for tests, 30s for setup/teardown
- **Coverage**: v8 provider with text, JSON, HTML reports
- **Path Aliases**: `@/` for src, `@/tests` for test utilities

### Global Setup (`src/__tests__/setup.ts`)
- **NextAuth Mocking**: Global session mocking setup
- **Console Mocking**: Automatic console noise reduction
- **Database Mocking**: Conditional mocking (unit vs integration)
- **Environment Setup**: Test-specific configuration

## Test Data Management

### Database Strategy
- **Unit Tests**: Mock Prisma client, no real database operations
- **Integration Tests**: Real PostgreSQL database with Docker
- **Isolation**: Each test creates/cleans its own data
- **Consistency**: Shared fixtures ensure predictable test conditions

### Mock Strategy
- **Sessions**: NextAuth session mocking for authentication
- **Requests**: NextRequest/NextResponse mocking for API testing  
- **Database**: Conditional Prisma mocking based on test type
- **Console**: Automatic console output mocking to reduce noise

## Coverage Goals

### Functional Coverage
- ✅ All API endpoint paths (GET/POST /api/tasks)
- ✅ Authentication and authorization flows
- ✅ Input validation and sanitization
- ✅ Database operations and relationships
- ✅ Error handling and edge cases
- ✅ Status and priority enum handling

### Scenario Coverage
- ✅ Happy path: Successful task creation and fetching
- ✅ Authentication failures: No session, invalid session
- ✅ Authorization failures: Non-member access attempts
- ✅ Validation failures: Invalid fields, missing data
- ✅ Database failures: Connection errors, constraint violations
- ✅ Edge cases: Null relationships, concurrent operations

### Integration Coverage
- ✅ End-to-end task fetching workflow
- ✅ End-to-end task creation workflow
- ✅ Frontend-backend communication patterns
- ✅ Database transaction integrity
- ✅ Real authentication and authorization flows

## Best Practices

### Test Organization
- Group related tests using `describe` blocks
- Use descriptive test names that explain the scenario
- Follow AAA pattern: Arrange, Act, Assert
- Clean up test data after each test

### Mock Management
- Use shared mocks from test utilities
- Reset mocks between tests
- Mock at appropriate levels (unit vs integration)
- Verify mock interactions when relevant

### Data Management
- Use factory functions for test data creation
- Clean up database after each integration test
- Use realistic but minimal test data
- Avoid test interdependencies

### Error Testing
- Test both expected and unexpected errors
- Verify error messages and status codes
- Test error recovery and consistency
- Include edge cases and boundary conditions

## Maintenance

### Adding New Tests
1. Choose appropriate test type (unit vs integration)
2. Use existing utilities and mock data patterns
3. Follow naming conventions and file structure
4. Include both happy path and error scenarios
5. Update documentation for new test coverage

### Updating Tests
1. Keep tests in sync with API changes
2. Update mock data when models change
3. Maintain test utilities for reusability
4. Update coverage goals when adding features

### Debugging Tests
1. Use `test.only()` to run individual tests
2. Check console output for detailed error information
3. Verify database state in integration tests
4. Use coverage reports to identify gaps